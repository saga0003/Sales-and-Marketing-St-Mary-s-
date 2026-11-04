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
  const rawOrigins =
    options.allowedOrigins ?? (process.env.APP_ORIGIN ? [process.env.APP_ORIGIN] : []);
  const allowedOrigins = new Set(
    (Array.isArray(rawOrigins) ? rawOrigins : [rawOrigins]).map(originOf),
  );
  if (allowedOrigins.has(null))
    throw new Error('APP_ORIGIN / allowedOrigins must contain complete HTTP(S) origins.');
  return {
    demoMode,
    databasePath:
      options.databasePath ??
      process.env.DATABASE_PATH ??
      resolve(applicationRoot, 'data/workspace.sqlite'),
    adminEmail: options.adminEmail ?? process.env.BOOTSTRAP_ADMIN_EMAIL,
    adminPassword: options.adminPassword ?? process.env.BOOTSTRAP_ADMIN_PASSWORD,
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

export function createApp(options = {}) {
  const config = configFrom(options);
  const now = options.now ?? (() => new Date());
  const db = openDatabase(config.databasePath);
  try {
    initializeWorkspace(db, config, now());
  } catch (error) {
    db.close();
    throw error;
  }
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  let closed = false;
  app.locals.close = () => {
    if (!closed) {
      closed = true;
      db.close();
    }
  };
  app.locals.database = db;
  app.locals.demoMode = config.demoMode;

  // A dummy hash equalizes failed-account and failed-password verification.
  const dummyPasswordHash = hashPasswordSync(newToken());
  const loginAttempts = new Map();

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

  function readSession(request) {
    const token = cookieToken(request);
    if (!token) return null;
    const tokenHash = hashToken(token);
    const row = db
      .prepare(
        `SELECT users.*, sessions.csrf_token AS session_csrf,
      sessions.expires_at AS session_expires FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND users.active = 1`,
      )
      .get(tokenHash);
    if (!row) return null;
    if (row.session_expires <= now().getTime()) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      return null;
    }
    return { user: toUser(row), csrfToken: row.session_csrf, tokenHash };
  }

  function startSession(request, response, user) {
    const oldToken = cookieToken(request);
    const token = newToken();
    const csrfToken = newToken();
    const timestamp = now();
    transaction(db, () => {
      if (oldToken)
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(oldToken));
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(timestamp.getTime());
      db.prepare(
        'INSERT INTO sessions(token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      ).run(
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

  app.use('/api', (request, _response, next) => {
    request.auth = readSession(request);
    next();
  });

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', demoMode: config.demoMode, publishingEnabled: false });
  });

  app.post('/api/auth/login', async (request, response) => {
    const input = parse(loginSchema, request.body);
    const stamp = now().getTime();
    // Bound this process-local limiter's memory and use both account and address
    // keys; it is a small-instance safeguard, not a replacement for edge limits.
    for (const [key, attempt] of loginAttempts)
      if (attempt.resetAt <= stamp) loginAttempts.delete(key);
    const keys = [`ip:${request.ip}`, `account:${input.email}`];
    for (const key of keys) {
      const attempt = loginAttempts.get(key);
      if (attempt && attempt.count >= 10) {
        response.set(
          'Retry-After',
          String(Math.max(1, Math.ceil((attempt.resetAt - stamp) / 1000))),
        );
        throw new HttpError(
          429,
          'Too many sign-in attempts. Try again in a few minutes.',
          'rate_limited',
        );
      }
    }
    if (loginAttempts.size > 10000)
      throw new HttpError(429, 'Sign-in is busy. Try again later.', 'rate_limited');
    // Count attempts before awaiting scrypt so parallel requests cannot bypass
    // the limit while password verification is in progress.
    for (const key of keys) {
      const current = loginAttempts.get(key);
      loginAttempts.set(key, {
        count: (current?.count ?? 0) + 1,
        resetAt: current?.resetAt ?? stamp + 15 * 60 * 1000,
      });
    }
    const row = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(input.email);
    const valid = await verifyPassword(input.password, row?.password_hash ?? dummyPasswordHash);
    if (!row || !valid)
      throw new HttpError(401, 'Email or password is incorrect.', 'invalid_credentials');
    loginAttempts.delete(`account:${input.email}`);
    // Keep failed/in-flight requests counted, but do not lock out a school's
    // shared connection merely because several team members signed in.
    const addressKey = `ip:${request.ip}`;
    const addressAttempts = loginAttempts.get(addressKey);
    if (addressAttempts?.count > 1)
      loginAttempts.set(addressKey, { ...addressAttempts, count: addressAttempts.count - 1 });
    else loginAttempts.delete(addressKey);
    const user = toUser(row);
    const session = startSession(request, response, user);
    audit(
      db,
      user,
      'Signed in',
      user.id,
      'A new authenticated session was created.',
      now().toISOString(),
    );
    response.json({ user, csrfToken: session.csrfToken });
  });

  function bootstrap(user, csrfToken) {
    return {
      user,
      users: db.prepare('SELECT * FROM users WHERE active = 1 ORDER BY name').all().map(toUser),
      demoMode: config.demoMode,
      csrfToken,
      posts: listPosts(db),
      opportunities: db
        .prepare('SELECT * FROM opportunities ORDER BY published_at DESC, id ASC')
        .all()
        .map(toOpportunity),
      competitors: listResources(db, 'competitors'),
      sources: listResources(db, 'sources'),
      tasks: listResources(db, 'tasks'),
      documents: listResources(db, 'documents'),
      integrations,
      audit: db
        .prepare(
          'SELECT id, actor, action, entity_id AS entityId, created_at AS createdAt, detail FROM audit_log ORDER BY created_at DESC, rowid DESC LIMIT 150',
        )
        .all(),
      analytics: config.demoMode
        ? JSON.parse(
            db.prepare('SELECT data FROM analytics_samples WHERE id = 1').get()?.data ??
              JSON.stringify({ ...emptyAnalytics(), sample: true }),
          )
        : emptyAnalytics(),
      publishingEnabled: false,
    };
  }

  app.get('/api/bootstrap', (request, response) => {
    if (!request.auth && config.demoMode) {
      const manager = toUser(
        db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(DEMO_MANAGER_ID),
      );
      if (!manager)
        throw new HttpError(503, 'The demo manager is unavailable.', 'demo_unavailable');
      request.auth = startSession(request, response, manager);
    }
    if (!request.auth)
      return response
        .status(401)
        .json({ error: 'Sign in to open this workspace.', demoMode: false });
    response.json(bootstrap(request.auth.user, request.auth.csrfToken));
  });

  // Everything after the public routes requires authentication. No mutating
  // endpoint can rely on the role or approval state supplied by a browser.
  app.use('/api', (request, _response, next) => {
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
  });

  const requireManager = (request, _response, next) => {
    if (request.auth.user.role !== 'manager')
      return next(new HttpError(403, 'A manager must perform this action.', 'manager_required'));
    next();
  };

  function requirePost(id) {
    const post = getPost(db, id);
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

  function createPost(input, user, timestamp) {
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
      sample: config.demoMode,
    };
    insertPost(db, post);
    const saved = getPost(db, post.id);
    writePostRevision(db, saved, user.id, timestamp);
    return saved;
  }

  app.post('/api/auth/logout', (request, response) => {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(request.auth.tokenHash);
    audit(
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

  app.post('/api/auth/demo-role', (request, response) => {
    if (!config.demoMode)
      throw new HttpError(404, 'This endpoint is only available in demo mode.', 'not_found');
    const input = parse(z.object({ role }).strict(), request.body);
    const id = input.role === 'manager' ? DEMO_MANAGER_ID : DEMO_CONTRIBUTOR_ID;
    const user = toUser(db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(id));
    if (!user) throw new HttpError(503, 'That demo role is unavailable.', 'demo_unavailable');
    const session = startSession(request, response, user);
    audit(
      db,
      request.auth.user,
      'Demo role changed',
      user.id,
      `This demo session is now using the ${user.role} role.`,
      now().toISOString(),
    );
    response.json({ user, csrfToken: session.csrfToken });
  });

  app.post('/api/users', requireManager, async (request, response) => {
    const input = parse(userCreateSchema, request.body);
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(input.email)) {
      throw new HttpError(409, 'A user with that email already exists.', 'duplicate_email');
    }
    const passwordHash = await hashPassword(input.password);
    const timestamp = now().toISOString();
    const id = makeId('user');
    const user = transaction(db, () => {
      db.prepare(
        'INSERT INTO users(id, name, email, role, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(id, input.name, input.email, input.role, passwordHash, timestamp, timestamp);
      audit(
        db,
        request.auth.user,
        'Team member added',
        id,
        `${input.name} was added as a ${input.role}.`,
        timestamp,
      );
      return toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    });
    response.status(201).json(user);
  });

  app.get('/api/posts/:id', (request, response) => response.json(requirePost(request.params.id)));

  app.post('/api/posts', (request, response) => {
    const input = parse(postCreateSchema, request.body);
    const timestamp = now().toISOString();
    const post = transaction(db, () => {
      const saved = createPost(input, request.auth.user, timestamp);
      audit(
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

  app.patch('/api/posts/:id', (request, response) => {
    const { revision, ...changes } = parse(postPatchSchema, request.body);
    const user = request.auth.user;
    const updated = transaction(db, () => {
      const post = requirePost(request.params.id);
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
      const timestamp = now().toISOString();
      db.prepare(
        `UPDATE posts SET title = ?, caption = ?, platforms = ?, format = ?, institution = ?,
        scheduled_at = ?, language = ?, source_url = ?, media_url = ?, palette = ?,
        status = 'draft', revision = revision + 1, approved_revision = NULL, approved_by = NULL,
        approved_at = NULL, updated_at = ? WHERE id = ? AND revision = ?`,
      ).run(
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
        timestamp,
        post.id,
        revision,
      );
      const saved = getPost(db, post.id);
      writePostRevision(db, saved, user.id, timestamp);
      const reset =
        post.approvedRevision !== null
          ? ' Previous approval and any local queue entry were invalidated.'
          : '';
      audit(
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

  app.post('/api/posts/:id/transition', (request, response) => {
    const input = parse(transitionSchema, request.body);
    const user = request.auth.user;
    const updated = transaction(db, () => {
      const post = requirePost(request.params.id);
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
          detail = `Manager approved exactly revision ${post.revision}. Publishing remains disabled.`;
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
          action = 'Added to local schedule';
          detail = `Approved revision ${post.revision} planned for ${scheduledAt}. Local planning only: no platform publishing is implemented.`;
          break;
        }
        case 'unschedule':
          if (post.status !== 'scheduled')
            throw new HttpError(409, 'This content is not scheduled.', 'invalid_state');
          next = { ...next, status: 'approved', scheduledAt: null };
          action = 'Removed from local schedule';
          detail = `Revision ${post.revision} remains approved and is no longer scheduled.`;
          break;
      }
      db.prepare(
        `UPDATE posts SET status = ?, scheduled_at = ?, approved_revision = ?, approved_by = ?,
        approved_at = ?, feedback = ?, updated_at = ? WHERE id = ? AND revision = ?`,
      ).run(
        next.status,
        next.scheduledAt,
        next.approvedRevision,
        next.approvedBy,
        next.approvedAt,
        next.feedback,
        timestamp,
        post.id,
        input.revision,
      );
      audit(db, user, action, post.id, detail, timestamp);
      return getPost(db, post.id);
    });
    response.json(updated);
  });

  for (const [table, definition] of Object.entries(resourceDefinitions)) {
    app.post(`/api/${table}`, (request, response) => {
      const input = parse(resourceSchemas[table], request.body);
      const timestamp = now().toISOString();
      const created = transaction(db, () => {
        const value = insertResource(db, table, input, timestamp);
        audit(
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

    app.patch(`/api/${table}/:id`, (request, response) => {
      const input = parse(resourcePatchSchemas[table], request.body);
      if (!Object.keys(input).length)
        throw new HttpError(422, 'Provide at least one field to update.', 'validation_error');
      const timestamp = now().toISOString();
      const updated = transaction(db, () => {
        const current = getResource(db, table, request.params.id);
        if (!current) throw new HttpError(404, 'This item could not be found.', 'not_found');
        const value = updateResource(db, table, current.id, input, timestamp);
        audit(
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

    app.delete(`/api/${table}/:id`, (request, response) => {
      transaction(db, () => {
        const current = getResource(db, table, request.params.id);
        if (!current) throw new HttpError(404, 'This item could not be found.', 'not_found');
        db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(current.id);
        audit(
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

  app.post('/api/opportunities', (request, response) => {
    const input = parse(opportunityCreateSchema, request.body);
    const timestamp = now().toISOString();
    const id = makeId('opportunity');
    const created = transaction(db, () => {
      // Source classification is supplied by a team member. It is never
      // evidence that a source was fetched, or that its claims were verified.
      db.prepare(
        `INSERT INTO opportunities (
          id, title, summary, source, source_url, category, published_at,
          verified, verified_by, status, priority, audience, content_angle,
          source_kind, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, 'new', ?, ?, ?, ?, ?, ?)`,
      ).run(
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
      audit(
        db,
        request.auth.user,
        'Research brief added',
        id,
        `${input.title} recorded manually from ${input.source}. Source type: ${input.sourceKind}; verification is pending. No source was fetched.`,
        timestamp,
      );
      return toOpportunity(db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id));
    });
    response.status(201).json(created);
  });

  app.patch('/api/opportunities/:id', (request, response) => {
    const input = parse(opportunityPatchSchema, request.body);
    if (input.verified !== undefined && request.auth.user.role !== 'manager') {
      throw new HttpError(
        403,
        'Only a manager can record source verification.',
        'manager_required',
      );
    }
    const result = transaction(db, () => {
      const current = toOpportunity(
        db.prepare('SELECT * FROM opportunities WHERE id = ?').get(request.params.id),
      );
      if (!current) throw new HttpError(404, 'This opportunity could not be found.', 'not_found');
      const timestamp = now().toISOString();
      const verified = input.verified ?? current.verified;
      db.prepare(
        `UPDATE opportunities SET status = ?, verified = ?, verified_by =
        CASE WHEN ? = 1 THEN ? WHEN ? = 0 THEN NULL ELSE verified_by END,
        updated_at = ? WHERE id = ?`,
      ).run(
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
      audit(
        db,
        request.auth.user,
        input.verified === undefined ? 'Opportunity updated' : 'Source verification updated',
        current.id,
        `${input.status ? `Status: ${input.status}. ` : ''}${input.verified === undefined ? '' : `Verified: ${input.verified}.`}${note}`.trim(),
        timestamp,
      );
      return toOpportunity(db.prepare('SELECT * FROM opportunities WHERE id = ?').get(current.id));
    });
    response.json(result);
  });

  app.post('/api/opportunities/:id/draft', (request, response) => {
    const input = parse(opportunityDraftSchema, request.body ?? {});
    let created = false;
    const result = transaction(db, () => {
      const opportunity = toOpportunity(
        db.prepare('SELECT * FROM opportunities WHERE id = ?').get(request.params.id),
      );
      if (!opportunity)
        throw new HttpError(404, 'This opportunity could not be found.', 'not_found');
      const existing = db
        .prepare('SELECT post_id FROM opportunity_drafts WHERE opportunity_id = ?')
        .get(opportunity.id);
      if (existing) return getPost(db, existing.post_id);
      const timestamp = now().toISOString();
      const warning = opportunity.verified
        ? ''
        : 'Source verification is pending. Confirm the original notice and effective year before using this draft.\n\n';
      const caption = `${opportunity.sourceKind === 'sample' ? 'Illustrative demo brief — not a verified current announcement.\n\n' : ''}${warning}${opportunity.summary}\n\nSuggested angle: ${opportunity.contentAngle}\n\nSource: ${opportunity.sourceUrl}`;
      const post = createPost(
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
      db.prepare(
        'INSERT INTO opportunity_drafts(opportunity_id, post_id, created_at) VALUES (?, ?, ?)',
      ).run(opportunity.id, post.id, timestamp);
      db.prepare("UPDATE opportunities SET status = 'drafted', updated_at = ? WHERE id = ?").run(
        timestamp,
        opportunity.id,
      );
      audit(
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
      String(error.code).startsWith('ERR_SQLITE') &&
      /UNIQUE constraint failed: users.email/.test(String(error.message))
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
