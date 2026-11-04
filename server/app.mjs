import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  openDatabase,
  transaction,
  makeId,
  toUser,
  getPost,
  listPosts,
  insertPost,
  writePostRevision,
  audit,
  toOpportunity,
  resourceDefinitions,
  getResource,
  listResources,
  insertResource,
  updateResource,
} from './database.mjs';
import {
  COOKIE_NAME,
  cookieOptions,
  cookieToken,
  equalTokens,
  hashPassword,
  hashPasswordSync,
  hashToken,
  newToken,
  verifyPassword,
} from './auth.mjs';
import {
  HttpError,
  parse,
  postCreateSchema,
  postPatchSchema,
  transitionSchema,
  loginSchema,
  userCreateSchema,
  role,
  resourceSchemas,
  resourcePatchSchemas,
  opportunityCreateSchema,
  opportunityPatchSchema,
  opportunityDraftSchema,
} from './validation.mjs';
import { DEMO_MANAGER_ID, DEMO_CONTRIBUTOR_ID, initializeWorkspace } from './seed.mjs';
import { integrations, emptyAnalytics } from './catalog.mjs';
const applicationRoot = fileURLToPath(new URL('../', import.meta.url));
const draftStates = new Set(['draft', 'changes_requested', 'rejected']);
const reviewStates = new Set(['in_review', 'approved', 'scheduled']);
const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const toAudit = (row) => ({
  id: row.id,
  actor: row.actor,
  action: row.action,
  entityId: row.entity_id,
  createdAt: row.created_at,
  detail: row.detail,
});
function asBoolean(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (['true', '1'].includes(String(value).toLowerCase())) return true;
  if (['false', '0'].includes(String(value).toLowerCase())) return false;
  throw new Error('Boolean configuration values must be true/false or 1/0.');
}
function originOf(value) {
  try {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
      return null;
    return parsed.origin;
  } catch {
    return null;
  }
}
function configFrom(options) {
  const demoMode = asBoolean(options.demoMode ?? process.env.DEMO_MODE, false);
  const hosted = process.env.VERCEL === '1';
  if (hosted && demoMode)
    throw new Error(
      'DEMO_MODE automatic sign-in is not allowed on Vercel. Use authenticated EVALUATION_MODE instead.',
    );
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (hosted && !databaseUrl)
    throw new Error(
      'DATABASE_URL is required on Vercel. Local SQLite is not persistent hosting storage.',
    );
  const rawOrigins =
    options.allowedOrigins ??
    [
      process.env.APP_ORIGIN,
      hosted && process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
      hosted && process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : null,
    ].filter(Boolean);
  const allowedOrigins = new Set(
    (Array.isArray(rawOrigins) ? rawOrigins : [rawOrigins]).map(originOf),
  );
  if (allowedOrigins.has(null))
    throw new Error('APP_ORIGIN / allowedOrigins must contain complete HTTP(S) origins.');
  return {
    demoMode,
    evaluationMode: asBoolean(options.evaluationMode ?? process.env.EVALUATION_MODE, false),
    publicOrigin: originOf(
      options.publicOrigin ??
        process.env.APP_ORIGIN ??
        (process.env.VERCEL_PROJECT_PRODUCTION_URL
          ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
          : ''),
    ),
    databaseUrl,
    databaseSslCa: options.databaseSslCa ?? process.env.DATABASE_SSL_CA,
    databaseSchema: options.databaseSchema ?? process.env.DATABASE_SCHEMA ?? 'smis_marketing',
    migrate: asBoolean(options.migrate ?? process.env.AUTO_MIGRATE, !hosted),
    databasePath:
      options.databasePath ??
      process.env.DATABASE_PATH ??
      resolve(applicationRoot, 'data/workspace.sqlite'),
    adminEmail: options.adminEmail ?? process.env.BOOTSTRAP_ADMIN_EMAIL,
    adminPassword: options.adminPassword ?? process.env.BOOTSTRAP_ADMIN_PASSWORD,
    adminSetupToken: options.adminSetupToken ?? process.env.BOOTSTRAP_SETUP_TOKEN,
    adminName: options.adminName ?? process.env.BOOTSTRAP_ADMIN_NAME,
    secureCookies: asBoolean(
      options.secureCookies ?? process.env.COOKIE_SECURE,
      process.env.NODE_ENV === 'production',
    ),
    trustProxy: asBoolean(options.trustProxy ?? process.env.TRUST_PROXY, false),
    sessionTtlMs: options.sessionTtlMs ?? 12 * 60 * 60 * 1000,
    allowedOrigins,
    distDirectory: options.distDirectory ?? resolve(applicationRoot, 'dist'),
    serveStatic: options.serveStatic !== false,
  };
}
export async function createApp(options = {}) {
  const config = configFrom(options);
  const now = options.now ?? (() => new Date());
  const db = await openDatabase(config.databasePath, {
    databaseUrl: config.databaseUrl,
    sslCa: config.databaseSslCa,
    schema: config.databaseSchema,
    migrate: config.migrate,
    onError: options.onError,
  });
  try {
    await initializeWorkspace(db, config, now());
  } catch (error) {
    await db.close();
    throw error;
  }
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  let closed = false;
  app.locals.close = async () => {
    if (!closed) {
      closed = true;
      await db.close();
    }
  };
  app.locals.database = db;
  app.locals.demoMode = config.demoMode;
  app.locals.evaluationMode = config.evaluationMode;
  // A dummy hash equalizes failed-account and failed-password verification.
  const dummyPasswordHash = hashPasswordSync(newToken());
  let extensions = {};
  app.use((request, response, next) => {
    response.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    next();
  });
  app.use(express.json({ limit: '256kb', strict: true }));
  app.use('/api', (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    if (!unsafeMethods.has(request.method)) return next();
    if (request.get('sec-fetch-site') === 'cross-site') {
      return next(new HttpError(403, 'Cross-site requests are not allowed.', 'invalid_origin'));
    }
    const supplied = request.get('origin') ?? request.get('referer');
    if (supplied) {
      const origin = originOf(supplied);
      const requestOrigin = originOf(`${request.protocol}://${request.get('host')}`);
      const allowed = config.allowedOrigins.size
        ? config.allowedOrigins.has(origin)
        : origin === requestOrigin;
      if (!origin || !allowed)
        return next(new HttpError(403, 'The request origin is not allowed.', 'invalid_origin'));
    }
    next();
  });
  async function readSession(request) {
    const token = cookieToken(request);
    if (!token) return null;
    const tokenHash = hashToken(token);
    const row = await db
      .prepare(
        `SELECT users.*, sessions.csrf_token AS session_csrf,
      sessions.expires_at AS session_expires FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND users.active = 1`,
      )
      .get(tokenHash);
    if (!row) return null;
    if (row.session_expires <= now().getTime()) {
      await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      return null;
    }
    return { user: toUser(row), csrfToken: row.session_csrf, tokenHash };
  }
  async function startSession(request, response, user, expectedPasswordHash) {
    const oldToken = cookieToken(request);
    const token = newToken();
    const csrfToken = newToken();
    const timestamp = now();
    await transaction(db, async () => {
      const current = await db
        .prepare(`SELECT * FROM users WHERE id = ?${db.lockSuffix}`)
        .get(user.id);
      if (
        !current ||
        Number(current.active) !== 1 ||
        (expectedPasswordHash && current.password_hash !== expectedPasswordHash)
      )
        throw new HttpError(
          401,
          'Account access has changed. Sign in again.',
          'invalid_credentials',
        );
      user = toUser(current);
      if (oldToken)
        await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(oldToken));
      await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(timestamp.getTime());
      await db
        .prepare(
          'INSERT INTO sessions(token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(
          hashToken(token),
          user.id,
          csrfToken,
          timestamp.toISOString(),
          timestamp.getTime() + config.sessionTtlMs,
        );
    });
    response.cookie(COOKIE_NAME, token, cookieOptions(config.secureCookies, config.sessionTtlMs));
    return { user, csrfToken, tokenHash: hashToken(token) };
  }
  app.use('/api', async (request, _response, next) => {
    request.auth = await readSession(request);
    next();
  });
  app.get('/api/health', (_request, response) => {
    response.json({
      status: 'ok',
      demoMode: config.demoMode,
      evaluationMode: config.evaluationMode,
      storage: { driver: db.kind, persistent: db.persistent },
    });
  });
  // Reserve failures/in-flight password checks in the shared store. Row locks
  // and a consistent key order prevent parallel requests bypassing the limit.
  async function reserveLoginAttempt(keys, response) {
    const stamp = now().getTime();
    await transaction(db, async () => {
      await db.prepare('DELETE FROM login_attempts WHERE reset_at <= ?').run(stamp);
      for (const key of [...keys].sort()) {
        await db
          .prepare(
            'INSERT INTO login_attempts(key, count, reset_at) VALUES (?, 0, ?) ON CONFLICT(key) DO NOTHING',
          )
          .run(key, stamp + 15 * 60 * 1000);
        const row = await db
          .prepare(`SELECT count, reset_at FROM login_attempts WHERE key = ?${db.lockSuffix}`)
          .get(key);
        if (Number(row.count) >= 10) {
          response.set(
            'Retry-After',
            String(Math.max(1, Math.ceil((Number(row.reset_at) - stamp) / 1000))),
          );
          throw new HttpError(
            429,
            'Too many sign-in attempts. Try again in a few minutes.',
            'rate_limited',
          );
        }
        await db.prepare('UPDATE login_attempts SET count = count + 1 WHERE key = ?').run(key);
      }
    });
  }
  async function releaseSuccessfulLogin(keys) {
    await transaction(db, async () => {
      for (const key of [...keys].sort()) {
        await db
          .prepare('UPDATE login_attempts SET count = count - 1 WHERE key = ? AND count > 0')
          .run(key);
      }
    });
  }
  app.get('/api/config', (_request, response) => {
    response.json({
      workspaceName: 'St. Mary’s Marketing Workspace',
      demoMode: config.demoMode,
      evaluationMode: config.evaluationMode,
      loginEnabled: true,
      setupSupported: true,
      selfRegistration: false,
      storage: { driver: db.kind, persistent: db.persistent },
    });
  });
  app.post('/api/auth/login', async (request, response) => {
    const input = parse(loginSchema, request.body);
    const keys = [`ip:${hashToken(request.ip ?? 'unknown')}`, `account:${hashToken(input.email)}`];
    await reserveLoginAttempt(keys, response);
    const row = await db
      .prepare('SELECT * FROM users WHERE email = ? AND active = 1')
      .get(input.email);
    const valid = await verifyPassword(input.password, row?.password_hash ?? dummyPasswordHash);
    if (!row || !valid || Number(row.setup_pending) === 1)
      throw new HttpError(401, 'Email or password is incorrect.', 'invalid_credentials');
    await releaseSuccessfulLogin(keys);
    const user = toUser(row);
    const session = await startSession(request, response, user, row.password_hash);
    await audit(
      db,
      user,
      'Signed in',
      user.id,
      'A new authenticated session was created.',
      now().toISOString(),
    );
    response.json({ user: session.user, csrfToken: session.csrfToken });
  });
  app.post('/api/auth/setup', async (request, response) => {
    const input = parse(
      z
        .object({
          token: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
          password: z.string().min(12, 'Use at least 12 characters.').max(256),
        })
        .strict(),
      request.body,
    );
    const keys = [`setup:${hashToken(request.ip ?? 'unknown')}`];
    await reserveLoginAttempt(keys, response);
    const tokenHash = hashToken(input.token);
    const existing = await db
      .prepare(
        'SELECT token_hash, user_id FROM account_setup_tokens WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?',
      )
      .get(tokenHash, now().getTime());
    if (!existing)
      throw new HttpError(
        400,
        'This setup link has expired or has already been used. Ask your manager for a new link.',
        'invalid_setup_token',
      );
    const passwordHash = await hashPassword(input.password);
    const user = await transaction(db, async () => {
      // Every account mutation locks the user first, then its links/sessions.
      // This also prevents a newly issued link racing an older setup request.
      const row = await db
        .prepare(`SELECT * FROM users WHERE id = ?${db.lockSuffix}`)
        .get(existing.user_id);
      const token = await db
        .prepare(`SELECT * FROM account_setup_tokens WHERE token_hash = ?${db.lockSuffix}`)
        .get(tokenHash);
      if (!token || token.consumed_at || Number(token.expires_at) <= now().getTime())
        throw new HttpError(
          400,
          'This setup link has expired or has already been used. Ask your manager for a new link.',
          'invalid_setup_token',
        );
      if (!row || Number(row.active) !== 1)
        throw new HttpError(
          400,
          'This account is not active. Ask your manager for help.',
          'inactive_account',
        );
      const timestamp = now().toISOString();
      await db
        .prepare(
          'UPDATE users SET password_hash = ?, setup_pending = 0, updated_at = ? WHERE id = ?',
        )
        .run(passwordHash, timestamp, row.id);
      await db
        .prepare(
          'UPDATE account_setup_tokens SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL',
        )
        .run(timestamp, row.id);
      await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
      const saved = toUser(await db.prepare('SELECT * FROM users WHERE id = ?').get(row.id));
      await audit(
        db,
        saved,
        token.purpose === 'setup' ? 'Account setup completed' : 'Account access recovered',
        saved.id,
        'A single-use account link was consumed and older sessions were revoked.',
        timestamp,
      );
      return saved;
    });
    await releaseSuccessfulLogin(keys);
    const session = await startSession(request, response, user, passwordHash);
    response.json({ user: session.user, csrfToken: session.csrfToken });
  });
  async function bootstrap(user, csrfToken, request) {
    return transaction(db, async () => ({
      user,
      users: (await db.prepare('SELECT * FROM users WHERE active = 1 ORDER BY name').all()).map(
        toUser,
      ),
      teamUsers:
        user.role === 'manager'
          ? (await db.prepare('SELECT * FROM users ORDER BY active DESC, name').all()).map(toUser)
          : [],
      demoMode: config.demoMode,
      evaluationMode: config.evaluationMode,
      storage: { driver: db.kind, persistent: db.persistent },
      csrfToken,
      posts: await listPosts(db),
      opportunities: (
        await db.prepare('SELECT * FROM opportunities ORDER BY published_at DESC, id ASC').all()
      ).map(toOpportunity),
      competitors: await listResources(db, 'competitors'),
      sources: await listResources(db, 'sources'),
      tasks: await listResources(db, 'tasks'),
      documents: await listResources(db, 'documents'),
      integrations,
      audit: (
        await db
          .prepare('SELECT * FROM audit_log ORDER BY created_at DESC, id DESC LIMIT 150')
          .all()
      ).map(toAudit),
      analytics: config.demoMode
        ? JSON.parse(
            (await db.prepare('SELECT data FROM analytics_samples WHERE id = 1').get())?.data ??
              JSON.stringify({ ...emptyAnalytics(), sample: true }),
          )
        : emptyAnalytics(),
      publishingEnabled: false,
      ...(extensions.bootstrap ? await extensions.bootstrap(request) : {}),
    }));
  }
  app.get('/api/bootstrap', async (request, response) => {
    if (!request.auth && config.demoMode) {
      const manager = toUser(
        await db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(DEMO_MANAGER_ID),
      );
      if (!manager)
        throw new HttpError(503, 'The demo manager is unavailable.', 'demo_unavailable');
      request.auth = await startSession(request, response, manager);
    }
    if (!request.auth)
      return response
        .status(401)
        .json({ error: 'Sign in to open this workspace.', demoMode: false });
    response.json(await bootstrap(request.auth.user, request.auth.csrfToken, request));
  });
  // Everything after the public routes requires authentication. No mutating
  // endpoint can rely on the role or approval state supplied by a browser.
  const requireAuth = (request, _response, next) => {
    if (!request.auth)
      return next(
        new HttpError(401, 'Your session has expired. Please sign in.', 'unauthenticated'),
      );
    if (
      unsafeMethods.has(request.method) &&
      !equalTokens(request.get('x-csrf-token'), request.auth.csrfToken)
    ) {
      return next(
        new HttpError(
          403,
          'The request token is missing or expired. Refresh and try again.',
          'invalid_csrf',
        ),
      );
    }
    next();
  };
  const requireManager = (request, _response, next) => {
    if (!request.auth || request.auth.user.role !== 'manager')
      return next(new HttpError(403, 'A manager must perform this action.', 'manager_required'));
    next();
  };
  async function requirePost(id, { lock = db.inTransaction() } = {}) {
    const post = await getPost(db, id, { lock });
    if (!post) throw new HttpError(404, 'This draft could not be found.', 'not_found');
    return post;
  }
  function requireRevision(post, revision) {
    if (post.revision !== revision)
      throw new HttpError(
        409,
        'This draft has changed since you opened it. Refresh and review the latest revision.',
        'stale_revision',
      );
  }
  function requireAuthorOrManager(user, post) {
    if (user.role !== 'manager' && user.id !== post.ownerId) {
      throw new HttpError(
        403,
        'You can only edit or submit drafts that you own.',
        'owner_required',
      );
    }
  }
  async function createPost(input, user, timestamp) {
    const post = {
      ...input,
      id: makeId('post'),
      status: 'draft',
      ownerId: user.id,
      ownerName: user.name,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
      approvedRevision: null,
      approvedBy: null,
      approvedAt: null,
      feedback: '',
      sourceUrl: input.sourceUrl ?? '',
      mediaUrl: input.mediaUrl ?? '',
      assetId: input.assetId ?? null,
      destinationIds: input.destinationIds ?? [],
      sample: config.demoMode,
    };
    await extensions.validatePost?.(post, user);
    await insertPost(db, post);
    const saved = await getPost(db, post.id);
    await writePostRevision(db, saved, user.id, timestamp);
    return saved;
  }
  if (options.extensions !== false) {
    try {
      const register =
        options.registerExtensions ?? (await import('./extensions/index.mjs')).registerExtensions;
      extensions =
        (await register(app, {
          db,
          config,
          now,
          requireAuth,
          requireManager,
          requirePost,
          requireRevision,
          requireAuthorOrManager,
          options: options.extensionOptions ?? {},
        })) ?? {};
    } catch (error) {
      await db.close();
      throw error;
    }
  }
  app.use('/api', requireAuth);
  app.post('/api/auth/logout', async (request, response) => {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(request.auth.tokenHash);
    await audit(
      db,
      request.auth.user,
      'Signed out',
      request.auth.user.id,
      'The current session was revoked.',
      now().toISOString(),
    );
    response.clearCookie(COOKIE_NAME, cookieOptions(config.secureCookies));
    response.json({ ok: true });
  });
  app.post('/api/auth/password', async (request, response) => {
    const input = parse(
      z
        .object({
          currentPassword: z.string().min(1).max(256),
          password: z.string().min(12, 'Use at least 12 characters.').max(256),
        })
        .strict(),
      request.body,
    );
    const keys = [`password:${request.auth.user.id}`];
    await reserveLoginAttempt(keys, response);
    const existing = await db
      .prepare('SELECT password_hash FROM users WHERE id = ? AND active = 1')
      .get(request.auth.user.id);
    if (!existing || !(await verifyPassword(input.currentPassword, existing.password_hash)))
      throw new HttpError(401, 'Your current password is incorrect.', 'invalid_credentials');
    const passwordHash = await hashPassword(input.password);
    const user = await transaction(db, async () => {
      const current = await db
        .prepare(`SELECT * FROM users WHERE id = ?${db.lockSuffix}`)
        .get(request.auth.user.id);
      if (
        !current ||
        Number(current.active) !== 1 ||
        current.password_hash !== existing.password_hash
      )
        throw new HttpError(
          409,
          'Your account access has changed. Sign in again before changing your password.',
          'account_changed',
        );
      const timestamp = now().toISOString();
      await db
        .prepare(
          'UPDATE users SET password_hash = ?, setup_pending = 0, updated_at = ? WHERE id = ?',
        )
        .run(passwordHash, timestamp, current.id);
      await db
        .prepare(
          'UPDATE account_setup_tokens SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL',
        )
        .run(timestamp, current.id);
      await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(current.id);
      await audit(
        db,
        request.auth.user,
        'Password changed',
        current.id,
        'All older sessions and account setup links were revoked.',
        timestamp,
      );
      return toUser(await db.prepare('SELECT * FROM users WHERE id = ?').get(current.id));
    });
    await releaseSuccessfulLogin(keys);
    const session = await startSession(request, response, user, passwordHash);
    response.json({ ok: true, user: session.user, csrfToken: session.csrfToken });
  });
  app.post('/api/auth/demo-role', async (request, response) => {
    if (!config.demoMode)
      throw new HttpError(404, 'This endpoint is only available in demo mode.', 'not_found');
    const input = parse(z.object({ role }).strict(), request.body);
    const id = input.role === 'manager' ? DEMO_MANAGER_ID : DEMO_CONTRIBUTOR_ID;
    const user = toUser(
      await db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(id),
    );
    if (!user) throw new HttpError(503, 'That demo role is unavailable.', 'demo_unavailable');
    const session = await startSession(request, response, user);
    await audit(
      db,
      request.auth.user,
      'Demo role changed',
      user.id,
      `This demo session is now using the ${user.role} role.`,
      now().toISOString(),
    );
    response.json({ user, csrfToken: session.csrfToken });
  });
  function setupUrl(request, token) {
    const origin = config.publicOrigin ?? originOf(`${request.protocol}://${request.get('host')}`);
    if (!origin)
      throw new HttpError(
        503,
        'Configure APP_ORIGIN before creating account links.',
        'origin_required',
      );
    return `${origin}/#setup?token=${token}`;
  }
  async function issueSetupLink(request, user, purpose, timestamp) {
    const token = newToken();
    const expiresAt = new Date(Date.parse(timestamp) + 24 * 60 * 60 * 1000).toISOString();
    const url = setupUrl(request, token);
    await db
      .prepare(
        'UPDATE account_setup_tokens SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL',
      )
      .run(timestamp, user.id);
    await db
      .prepare(
        'INSERT INTO account_setup_tokens(token_hash, user_id, purpose, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        hashToken(token),
        user.id,
        purpose,
        request.auth.user.id,
        timestamp,
        Date.parse(expiresAt),
      );
    await audit(
      db,
      request.auth.user,
      purpose === 'setup' ? 'Account setup link created' : 'Account recovery link created',
      user.id,
      'A single-use link valid for 24 hours was created. No email was sent.',
      timestamp,
    );
    return { setupUrl: url, expiresAt, user };
  }
  app.get('/api/team', requireManager, async (_request, response) => {
    response.json(
      (await db.prepare('SELECT * FROM users ORDER BY active DESC, name').all()).map(toUser),
    );
  });
  app.post('/api/users', requireManager, async (request, response) => {
    const input = parse(userCreateSchema, request.body);
    if (await db.prepare('SELECT id FROM users WHERE email = ?').get(input.email)) {
      throw new HttpError(409, 'A user with that email already exists.', 'duplicate_email');
    }
    const passwordHash = await hashPassword(input.password ?? newToken());
    const timestamp = now().toISOString();
    const id = makeId('user');
    const user = await transaction(db, async () => {
      await db
        .prepare(
          'INSERT INTO users(id, name, email, role, password_hash, created_at, updated_at, setup_pending) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          input.name,
          input.email,
          input.role,
          passwordHash,
          timestamp,
          timestamp,
          Number(!input.password),
        );
      await audit(
        db,
        request.auth.user,
        'Team member added',
        id,
        `${input.name} was added as a ${input.role}.`,
        timestamp,
      );
      const saved = toUser(await db.prepare('SELECT * FROM users WHERE id = ?').get(id));
      if (input.password) return saved;
      const link = await issueSetupLink(request, saved, 'setup', timestamp);
      return { ...saved, setupUrl: link.setupUrl, setupExpiresAt: link.expiresAt };
    });
    response.status(201).json(user);
  });
  app.patch('/api/users/:id', requireManager, async (request, response) => {
    const input = parse(
      z
        .object({
          name: z.string().trim().min(2).max(100).optional(),
          role: role.optional(),
          active: z.boolean().optional(),
        })
        .strict()
        .refine((value) => Object.keys(value).length > 0, 'Provide at least one change.'),
      request.body,
    );
    const user = await transaction(db, async () => {
      // A consistent team lock protects the last manager even when two
      // managers try to change one another at the same time.
      const team = await db.prepare(`SELECT * FROM users ORDER BY id${db.lockSuffix}`).all();
      const actor = team.find((person) => person.id === request.auth.user.id);
      if (!actor || Number(actor.active) !== 1 || actor.role !== 'manager')
        throw new HttpError(403, 'A current manager must perform this action.', 'manager_required');
      const current = team.find((person) => person.id === request.params.id);
      if (!current) throw new HttpError(404, 'This team member could not be found.', 'not_found');
      const next = { ...toUser(current), ...input };
      if (current.id === actor.id && (!next.active || next.role !== 'manager'))
        throw new HttpError(
          409,
          'Ask another manager to change your access. You cannot remove your own manager access.',
          'self_access_change',
        );
      if (
        (!next.active || next.role !== 'manager') &&
        current.role === 'manager' &&
        Number(current.active) === 1 &&
        !team.some(
          (person) =>
            person.id !== current.id && person.role === 'manager' && Number(person.active) === 1,
        )
      )
        throw new HttpError(
          409,
          'Keep at least one active manager in the workspace.',
          'last_manager',
        );
      const timestamp = now().toISOString();
      await db
        .prepare('UPDATE users SET name = ?, role = ?, active = ?, updated_at = ? WHERE id = ?')
        .run(next.name, next.role, Number(next.active), timestamp, current.id);
      if (next.active !== (Number(current.active) === 1) || next.role !== current.role)
        await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(current.id);
      if (!next.active)
        await db
          .prepare(
            'UPDATE account_setup_tokens SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL',
          )
          .run(timestamp, current.id);
      await audit(
        db,
        request.auth.user,
        'Team member updated',
        current.id,
        `Updated fields: ${Object.keys(input).join(', ')}. Access changes revoke existing sessions.`,
        timestamp,
      );
      return toUser(await db.prepare('SELECT * FROM users WHERE id = ?').get(current.id));
    });
    response.json(user);
  });
  app.post('/api/users/:id/setup-link', requireManager, async (request, response) => {
    const input = parse(
      z.object({ purpose: z.enum(['setup', 'recovery']).default('recovery') }).strict(),
      request.body ?? {},
    );
    const result = await transaction(db, async () => {
      const current = await db
        .prepare(`SELECT * FROM users WHERE id = ?${db.lockSuffix}`)
        .get(request.params.id);
      if (!current) throw new HttpError(404, 'This team member could not be found.', 'not_found');
      if (Number(current.active) !== 1)
        throw new HttpError(
          409,
          'Reactivate this account before creating an access link.',
          'inactive_account',
        );
      return issueSetupLink(request, toUser(current), input.purpose, now().toISOString());
    });
    response.status(201).json(result);
  });
  app.get('/api/posts/:id', async (request, response) =>
    response.json(await requirePost(request.params.id)),
  );
  app.post('/api/posts', async (request, response) => {
    const input = parse(postCreateSchema, request.body);
    const timestamp = now().toISOString();
    const post = await transaction(db, async () => {
      const saved = await createPost(input, request.auth.user, timestamp);
      await audit(
        db,
        request.auth.user,
        'Draft created',
        saved.id,
        `Revision 1 created for ${saved.institution}.`,
        timestamp,
      );
      return saved;
    });
    response.status(201).json(post);
  });
  app.patch('/api/posts/:id', async (request, response) => {
    const { revision, ...changes } = parse(postPatchSchema, request.body);
    const user = request.auth.user;
    const updated = await transaction(db, async () => {
      const post = await requirePost(request.params.id);
      requireAuthorOrManager(user, post);
      requireRevision(post, revision);
      if (post.status === 'published')
        throw new HttpError(
          409,
          'Published content cannot be edited in this release.',
          'invalid_state',
        );
      if (user.role !== 'manager' && !draftStates.has(post.status)) {
        throw new HttpError(
          403,
          'This draft is under review or already approved. Ask a manager to request changes.',
          'draft_locked',
        );
      }
      const changed = Object.keys(changes).filter(
        (key) => JSON.stringify(post[key]) !== JSON.stringify(changes[key]),
      );
      if (!changed.length) return post;
      const next = { ...post, ...changes };
      await extensions.validatePost?.(next, user);
      const timestamp = now().toISOString();
      const result = await db
        .prepare(
          `UPDATE posts SET title = ?, caption = ?, platforms = ?, format = ?, institution = ?,
        scheduled_at = ?, language = ?, source_url = ?, media_url = ?, palette = ?, asset_id = ?, destination_ids = ?,
        status = 'draft', revision = revision + 1, approved_revision = NULL, approved_by = NULL,
        approved_at = NULL, updated_at = ? WHERE id = ? AND revision = ?`,
        )
        .run(
          next.title,
          next.caption,
          JSON.stringify(next.platforms),
          next.format,
          next.institution,
          next.scheduledAt,
          next.language,
          next.sourceUrl ?? '',
          next.mediaUrl ?? '',
          next.palette,
          next.assetId ?? null,
          JSON.stringify(next.destinationIds ?? []),
          timestamp,
          post.id,
          revision,
        );
      if (result.changes !== 1)
        throw new HttpError(
          409,
          'This draft changed while it was being saved. Refresh and try again.',
          'stale_revision',
        );
      const saved = await getPost(db, post.id);
      await writePostRevision(db, saved, user.id, timestamp);
      await extensions.onPostChanged?.(post, saved, user);
      const reset =
        post.approvedRevision !== null
          ? ' Previous approval and any local queue entry were invalidated.'
          : '';
      await audit(
        db,
        user,
        'Draft edited',
        post.id,
        `Revision ${saved.revision}; changed: ${changed.join(', ')}.${reset}`,
        timestamp,
      );
      return saved;
    });
    response.json(updated);
  });
  app.post('/api/posts/:id/transition', async (request, response) => {
    const input = parse(transitionSchema, request.body);
    const user = request.auth.user;
    const updated = await transaction(db, async () => {
      const post = await requirePost(request.params.id);
      requireRevision(post, input.revision);
      if (input.action === 'submit') requireAuthorOrManager(user, post);
      else if (user.role !== 'manager')
        throw new HttpError(403, 'A manager must review or schedule content.', 'manager_required');
      const timestamp = now().toISOString();
      let next = { ...post };
      let action;
      let detail;
      switch (input.action) {
        case 'submit':
          if (!draftStates.has(post.status))
            throw new HttpError(409, 'Only a draft can be submitted for review.', 'invalid_state');
          if (!post.caption.trim())
            throw new HttpError(
              422,
              'Add the content before submitting it for review.',
              'content_required',
            );
          next = {
            ...next,
            status: 'in_review',
            feedback: '',
            approvedRevision: null,
            approvedBy: null,
            approvedAt: null,
          };
          action = 'Submitted for review';
          detail = `Revision ${post.revision} is waiting for manager review.`;
          break;
        case 'approve':
          if (post.status !== 'in_review')
            throw new HttpError(
              409,
              'Only content submitted for review can be approved.',
              'invalid_state',
            );
          next = {
            ...next,
            status: 'approved',
            approvedRevision: post.revision,
            approvedBy: user.id,
            approvedAt: timestamp,
            feedback: '',
          };
          action = 'Draft approved';
          detail = `Manager approved exactly revision ${post.revision}, including its selected media and destinations.`;
          break;
        case 'reject':
        case 'request_changes':
          if (!reviewStates.has(post.status))
            throw new HttpError(
              409,
              'This content is not waiting for a review decision.',
              'invalid_state',
            );
          if (!input.feedback)
            throw new HttpError(
              422,
              'Add feedback so the author knows what to change.',
              'feedback_required',
            );
          next = {
            ...next,
            status: input.action === 'reject' ? 'rejected' : 'changes_requested',
            feedback: input.feedback,
            approvedRevision: null,
            approvedBy: null,
            approvedAt: null,
          };
          action = input.action === 'reject' ? 'Draft rejected' : 'Changes requested';
          detail = `Revision ${post.revision}: ${input.feedback}`;
          break;
        case 'schedule': {
          if (
            post.status !== 'approved' ||
            post.approvedRevision !== post.revision ||
            !post.approvedBy ||
            !post.approvedAt
          ) {
            throw new HttpError(
              409,
              'The current revision must be approved before it can be scheduled.',
              'approval_required',
            );
          }
          const scheduledAt = input.scheduledAt ?? post.scheduledAt;
          if (!scheduledAt || Date.parse(scheduledAt) <= now().getTime()) {
            throw new HttpError(
              422,
              'Choose a scheduling time in the future.',
              'future_time_required',
            );
          }
          next = { ...next, status: 'scheduled', scheduledAt };
          action = 'Added to schedule';
          detail = `Approved revision ${post.revision} planned for ${scheduledAt}. Connected destination jobs follow the workspace publishing configuration.`;
          break;
        }
        case 'unschedule':
          if (post.status !== 'scheduled')
            throw new HttpError(409, 'This content is not scheduled.', 'invalid_state');
          next = { ...next, status: 'approved', scheduledAt: null };
          action = 'Removed from schedule';
          detail = `Revision ${post.revision} remains approved and is no longer scheduled.`;
          break;
      }
      if (['submit', 'approve', 'schedule'].includes(input.action))
        await extensions.validatePost?.(next, user);
      const result = await db
        .prepare(
          `UPDATE posts SET status = ?, scheduled_at = ?, approved_revision = ?, approved_by = ?,
        approved_at = ?, feedback = ?, updated_at = ? WHERE id = ? AND revision = ? AND status = ?`,
        )
        .run(
          next.status,
          next.scheduledAt,
          next.approvedRevision,
          next.approvedBy,
          next.approvedAt,
          next.feedback,
          timestamp,
          post.id,
          input.revision,
          post.status,
        );
      if (result.changes !== 1)
        throw new HttpError(
          409,
          'This draft changed while it was being reviewed. Refresh and try again.',
          'stale_revision',
        );
      const saved = await getPost(db, post.id);
      await extensions.onPostTransition?.(post, saved, input.action, user);
      await audit(db, user, action, post.id, detail, timestamp);
      return saved;
    });
    response.json(updated);
  });
  app.post('/api/posts/:id/duplicate', async (request, response) => {
    parse(z.object({}).strict(), request.body ?? {});
    const result = await transaction(db, async () => {
      const original = await requirePost(request.params.id);
      const timestamp = now().toISOString();
      const saved = await createPost(
        {
          title: `${original.title.slice(0, 173)} (copy)`,
          caption: original.caption,
          platforms: original.platforms,
          format: original.format,
          institution: original.institution,
          scheduledAt: null,
          language: original.language,
          palette: original.palette,
          sourceUrl: original.sourceUrl,
          mediaUrl: original.mediaUrl,
          assetId: original.assetId,
          destinationIds: original.destinationIds,
        },
        request.auth.user,
        timestamp,
      );
      await audit(
        db,
        request.auth.user,
        'Draft duplicated',
        saved.id,
        `Created a new unapproved draft from ${original.id}, revision ${original.revision}.`,
        timestamp,
      );
      return saved;
    });
    response.status(201).json(result);
  });
  app.get('/api/posts/:id/history', async (request, response) => {
    await requirePost(request.params.id);
    const revisions = (
      await db
        .prepare('SELECT * FROM post_revisions WHERE post_id = ? ORDER BY revision DESC')
        .all(request.params.id)
    ).map((row) => ({
      revision: Number(row.revision),
      snapshot: JSON.parse(row.snapshot),
      changedBy: row.changed_by,
      createdAt: row.created_at,
    }));
    const events = (
      await db
        .prepare(
          'SELECT * FROM audit_log WHERE entity_id = ? ORDER BY created_at DESC, id DESC LIMIT 150',
        )
        .all(request.params.id)
    ).map(toAudit);
    response.json({ revisions, events });
  });
  app.get('/api/posts/:id/comments', async (request, response) => {
    await requirePost(request.params.id);
    const comments = (
      await db
        .prepare(
          `SELECT post_comments.*, users.name AS author_name FROM post_comments
        JOIN users ON users.id = post_comments.author_id WHERE post_id = ? ORDER BY post_comments.created_at DESC, post_comments.id DESC LIMIT 200`,
        )
        .all(request.params.id)
    )
      .reverse()
      .map((row) => ({
        id: row.id,
        postId: row.post_id,
        revision: Number(row.revision),
        authorId: row.author_id,
        authorName: row.author_name,
        body: row.body,
        createdAt: row.created_at,
      }));
    response.json(comments);
  });
  app.post('/api/posts/:id/comments', async (request, response) => {
    const input = parse(
      z
        .object({ body: z.string().trim().min(1).max(3000), revision: z.number().int().positive() })
        .strict(),
      request.body,
    );
    const comment = await transaction(db, async () => {
      const post = await requirePost(request.params.id);
      requireRevision(post, input.revision);
      const value = {
        id: makeId('comment'),
        postId: post.id,
        revision: post.revision,
        authorId: request.auth.user.id,
        authorName: request.auth.user.name,
        body: input.body,
        createdAt: now().toISOString(),
      };
      await db
        .prepare(
          'INSERT INTO post_comments(id, post_id, revision, author_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(value.id, value.postId, value.revision, value.authorId, value.body, value.createdAt);
      await audit(
        db,
        request.auth.user,
        'Comment added',
        post.id,
        `Comment added to revision ${post.revision}.`,
        value.createdAt,
      );
      return value;
    });
    response.status(201).json(comment);
  });
  for (const [table, definition] of Object.entries(resourceDefinitions)) {
    app.post(`/api/${table}`, async (request, response) => {
      const input = parse(resourceSchemas[table], request.body);
      const timestamp = now().toISOString();
      const created = await transaction(db, async () => {
        const value = await insertResource(db, table, input, timestamp);
        await audit(
          db,
          request.auth.user,
          `${definition.prefix[0].toUpperCase()}${definition.prefix.slice(1)} added`,
          value.id,
          `${value.name ?? value.title} added to the workspace.`,
          timestamp,
        );
        return value;
      });
      response.status(201).json(created);
    });
    app.patch(`/api/${table}/:id`, async (request, response) => {
      const input = parse(resourcePatchSchemas[table], request.body);
      if (!Object.keys(input).length)
        throw new HttpError(422, 'Provide at least one field to update.', 'validation_error');
      const timestamp = now().toISOString();
      const updated = await transaction(db, async () => {
        const current = await getResource(db, table, request.params.id);
        if (!current) throw new HttpError(404, 'This item could not be found.', 'not_found');
        const value = await updateResource(db, table, current.id, input, timestamp);
        await audit(
          db,
          request.auth.user,
          `${definition.prefix[0].toUpperCase()}${definition.prefix.slice(1)} updated`,
          value.id,
          `Updated fields: ${Object.keys(input).join(', ')}.`,
          timestamp,
        );
        return value;
      });
      response.json(updated);
    });
    app.delete(`/api/${table}/:id`, async (request, response) => {
      await transaction(db, async () => {
        const current = await getResource(db, table, request.params.id);
        if (!current) throw new HttpError(404, 'This item could not be found.', 'not_found');
        await db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(current.id);
        await audit(
          db,
          request.auth.user,
          `${definition.prefix[0].toUpperCase()}${definition.prefix.slice(1)} deleted`,
          current.id,
          `${current.name ?? current.title} removed from the workspace.`,
          now().toISOString(),
        );
      });
      response.json({ ok: true });
    });
  }
  app.post('/api/opportunities', async (request, response) => {
    const input = parse(opportunityCreateSchema, request.body);
    const timestamp = now().toISOString();
    const id = makeId('opportunity');
    const created = await transaction(db, async () => {
      // Source classification is supplied by a team member. It is never
      // evidence that a source was fetched, or that its claims were verified.
      await db
        .prepare(
          `INSERT INTO opportunities (
          id, title, summary, source, source_url, category, published_at,
          verified, verified_by, status, priority, audience, content_angle,
          source_kind, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, 'new', ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.title,
          input.summary,
          input.source,
          input.sourceUrl,
          input.category,
          input.publishedAt ?? timestamp,
          input.priority,
          input.audience,
          input.contentAngle,
          input.sourceKind,
          timestamp,
          timestamp,
        );
      await audit(
        db,
        request.auth.user,
        'Research brief added',
        id,
        `${input.title} recorded manually from ${input.source}. Source type: ${input.sourceKind}; verification is pending. No source was fetched.`,
        timestamp,
      );
      return toOpportunity(await db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id));
    });
    response.status(201).json(created);
  });
  app.patch('/api/opportunities/:id', async (request, response) => {
    const input = parse(opportunityPatchSchema, request.body);
    if (input.verified !== undefined && request.auth.user.role !== 'manager') {
      throw new HttpError(
        403,
        'Only a manager can record source verification.',
        'manager_required',
      );
    }
    const result = await transaction(db, async () => {
      const current = toOpportunity(
        await db
          .prepare(`SELECT * FROM opportunities WHERE id = ?${db.lockSuffix}`)
          .get(request.params.id),
      );
      if (!current) throw new HttpError(404, 'This opportunity could not be found.', 'not_found');
      const timestamp = now().toISOString();
      const verified = input.verified ?? current.verified;
      await db
        .prepare(
          `UPDATE opportunities SET status = ?, verified = ?, verified_by =
        CASE WHEN ? = 1 THEN ? WHEN ? = 0 THEN NULL ELSE verified_by END,
        updated_at = ? WHERE id = ?`,
        )
        .run(
          input.status ?? current.status,
          Number(verified),
          input.verified === undefined ? -1 : Number(input.verified),
          request.auth.user.id,
          input.verified === undefined ? -1 : Number(input.verified),
          timestamp,
          current.id,
        );
      const note =
        current.sourceKind === 'sample' && input.verified === true
          ? ' This is a demo verification, not verification of a live announcement.'
          : '';
      await audit(
        db,
        request.auth.user,
        input.verified === undefined ? 'Opportunity updated' : 'Source verification updated',
        current.id,
        `${input.status ? `Status: ${input.status}. ` : ''}${input.verified === undefined ? '' : `Verified: ${input.verified}.`}${note}`.trim(),
        timestamp,
      );
      return toOpportunity(
        await db.prepare('SELECT * FROM opportunities WHERE id = ?').get(current.id),
      );
    });
    response.json(result);
  });
  app.post('/api/opportunities/:id/draft', async (request, response) => {
    const input = parse(opportunityDraftSchema, request.body ?? {});
    let created = false;
    const result = await transaction(db, async () => {
      const opportunity = toOpportunity(
        await db
          .prepare(`SELECT * FROM opportunities WHERE id = ?${db.lockSuffix}`)
          .get(request.params.id),
      );
      if (!opportunity)
        throw new HttpError(404, 'This opportunity could not be found.', 'not_found');
      const existing = await db
        .prepare('SELECT post_id FROM opportunity_drafts WHERE opportunity_id = ?')
        .get(opportunity.id);
      if (existing) return await getPost(db, existing.post_id);
      const timestamp = now().toISOString();
      const warning = opportunity.verified
        ? ''
        : 'Source verification is pending. Confirm the original notice and effective year before using this draft.\n\n';
      const caption = `${opportunity.sourceKind === 'sample' ? 'Illustrative demo brief — not a verified current announcement.\n\n' : ''}${warning}${opportunity.summary}\n\nSuggested angle: ${opportunity.contentAngle}\n\nSource: ${opportunity.sourceUrl}`;
      const post = await createPost(
        {
          title: opportunity.title,
          caption,
          platforms: input.platforms ?? ['instagram', 'facebook'],
          format: input.format ?? 'Carousel',
          institution: input.institution ?? 'St. Mary’s ISC',
          scheduledAt: null,
          language: input.language ?? 'English + Kannada',
          palette: 'sage',
          sourceUrl: opportunity.sourceUrl,
        },
        request.auth.user,
        timestamp,
      );
      await db
        .prepare(
          'INSERT INTO opportunity_drafts(opportunity_id, post_id, created_at) VALUES (?, ?, ?)',
        )
        .run(opportunity.id, post.id, timestamp);
      await db
        .prepare("UPDATE opportunities SET status = 'drafted', updated_at = ? WHERE id = ?")
        .run(timestamp, opportunity.id);
      await audit(
        db,
        request.auth.user,
        'Opportunity turned into draft',
        post.id,
        `Created revision 1 from ${opportunity.source}. The source link and verification status were retained in the draft.`,
        timestamp,
      );
      created = true;
      return post;
    });
    response.status(created ? 201 : 200).json(result);
  });
  app.use('/api', (_request, _response, next) =>
    next(new HttpError(404, 'This API endpoint does not exist.', 'not_found')),
  );
  if (config.serveStatic && existsSync(resolve(config.distDirectory, 'index.html'))) {
    app.use(express.static(config.distDirectory, { index: false, maxAge: 0, dotfiles: 'deny' }));
    app.use((request, response, next) => {
      if (request.method !== 'GET' || !request.accepts('html')) return next();
      response.set('Cache-Control', 'no-store');
      response.sendFile(resolve(config.distDirectory, 'index.html'));
    });
  }
  app.use((error, _request, response, _next) => {
    if (response.headersSent) return _next(error);
    if (error instanceof HttpError)
      return response.status(error.status).json({ error: error.message, code: error.code });
    if (error.type === 'entity.parse.failed')
      return response
        .status(400)
        .json({ error: 'The request body must be valid JSON.', code: 'invalid_json' });
    if (error.type === 'entity.too.large')
      return response
        .status(413)
        .json({ error: 'This request is too large.', code: 'payload_too_large' });
    if (
      (String(error.code).startsWith('ERR_SQLITE') &&
        /UNIQUE constraint failed: users.email/.test(String(error.message))) ||
      (error.code === '23505' && error.constraint === 'users_email_key')
    ) {
      return response
        .status(409)
        .json({ error: 'A user with that email already exists.', code: 'duplicate_email' });
    }
    // Keep request bodies, credentials and database internals out of responses.
    options.onError?.(error);
    response.status(500).json({
      error: 'The workspace could not save this change. Please try again.',
      code: 'internal_error',
    });
  });
  return app;
}
