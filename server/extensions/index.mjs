import express from 'express';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { transaction, getPost, audit } from '../database.mjs';
import { HttpError, parse } from '../validation.mjs';
import { createVault, opaqueId, hash, secretEqual } from './crypto.mjs';
import { PROVIDERS, ProviderError, createProviderClient } from './providers.mjs';
import {
  MAX_IMAGE_BYTES,
  IMAGE_TYPES,
  normalizeImage,
  createStorage,
  createStorageBroker,
  publicAsset,
} from './storage.mjs';
import { createPublishing, publicJob } from './publishing.mjs';

const providerId = z.enum(['google', 'instagram']);
const institutionName = z.string().trim().min(1).max(180);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  });
const dateTime = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
const publicConnection = (row) => ({
  id: row.id,
  provider: row.provider,
  accountId: row.account_id,
  accountName: row.account_name,
  institution: row.institution,
  status: row.status,
  capabilities: JSON.parse(row.capabilities),
  connectedBy: row.connected_by,
  createdAt: row.created_at,
  lastTestAt: row.last_test_at,
  lastSyncAt: row.last_sync_at,
  error: row.error,
});

export async function registerExtensions(
  app,
  { db, config, now, requireAuth, requireManager, options = {} },
) {
  const extensionVersion = '1';
  const schemaMarker = () =>
    db
      .prepare(
        "SELECT value FROM workspace_metadata WHERE key = 'provider_extensions_schema_version'",
      )
      .get();
  if (config.migrate !== false) {
    await transaction(db, async () => {
      if (db.kind === 'postgres')
        await db
          .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
          .get(`smis:${db.schema}:migrations`);
      if ((await schemaMarker())?.value !== extensionVersion)
        await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    });
  } else if ((await schemaMarker())?.value !== extensionVersion) {
    throw new Error(
      'Provider extension database migration required. Apply server/extensions/schema.sql with a migration role before deploying this release.',
    );
  }
  const vault = createVault(options.encryptionKey ?? process.env.CREDENTIAL_ENCRYPTION_KEY);
  let origin = options.appOrigin ?? config.publicOrigin ?? process.env.APP_ORIGIN;
  if (origin) {
    const parsed = new URL(origin);
    if (
      (!['https:'].includes(parsed.protocol) &&
        !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    )
      throw new Error(
        'APP_ORIGIN must be a trusted HTTPS origin (localhost HTTP is allowed for development).',
      );
    origin = parsed.origin;
  }
  const enabled = options.publishingEnabled ?? process.env.PUBLISHING_ENABLED === 'true';
  const provider =
    options.providerClient ??
    createProviderClient({
      fetch: options.fetch,
      now,
      metaVersion: options.metaVersion ?? process.env.META_API_VERSION ?? 'v25.0',
    });
  const brokerUrl = options.mediaBrokerUrl ?? process.env.MEDIA_BROKER_URL;
  const brokerKey = options.mediaBrokerPrivateKey ?? process.env.MEDIA_BROKER_PRIVATE_KEY;
  const broker =
    brokerUrl && brokerKey
      ? createStorageBroker({ url: brokerUrl, privateKey: brokerKey, fetch: options.fetch, now })
      : null;
  const storage =
    options.storage ??
    createStorage({
      localDirectory: options.mediaDirectory ?? resolve(dirname(config.databasePath), 'media'),
      blobToken: process.env.BLOB_READ_WRITE_TOKEN,
      blobStoreId: process.env.BLOB_STORE_ID,
      vercel: Boolean(process.env.VERCEL),
      broker,
      now,
    });
  const stamp = () => now().toISOString();
  const callback = (id) => (origin ? `${origin}/api/connections/oauth/${id}/callback` : '');
  function requireVault() {
    if (!vault)
      throw new HttpError(
        503,
        'A server encryption key is required before saving provider credentials or connecting accounts.',
        'encryption_required',
      );
  }
  async function connectionSettings(id) {
    requireVault();
    const saved = await db
      .prepare('SELECT encrypted_credentials FROM provider_settings WHERE provider = ?')
      .get(id);
    if (saved) {
      try {
        return vault.open(saved.encrypted_credentials, `provider:${id}`);
      } catch {
        throw new HttpError(
          503,
          'The saved provider credentials could not be decrypted. A manager must save them again.',
          'provider_credentials_unavailable',
        );
      }
    }
    const clientId = id === 'google' ? process.env.GOOGLE_CLIENT_ID : process.env.META_APP_ID;
    const clientSecret =
      id === 'google' ? process.env.GOOGLE_CLIENT_SECRET : process.env.META_APP_SECRET;
    if (!clientId || !clientSecret)
      throw new HttpError(
        409,
        'Save this provider’s application credentials before connecting an account.',
        'provider_setup_required',
      );
    return { clientId, clientSecret };
  }
  async function setup(user) {
    const result = [];
    for (const definition of Object.values(PROVIDERS)) {
      let error;
      try {
        await connectionSettings(definition.id);
      } catch (failure) {
        error =
          failure instanceof HttpError ? failure.message : 'Provider configuration is unavailable.';
      }
      if (!origin) error = 'Set the deployment’s APP_ORIGIN before starting OAuth authorization.';
      result.push({
        ...definition,
        configured: !error,
        canConfigure: Boolean(vault && user.role === 'manager'),
        redirectUri: callback(definition.id),
        ...(error ? { error } : {}),
      });
    }
    return result;
  }
  async function requireConnection(id, { lock = false, connected = false } = {}) {
    const connection = await db
      .prepare(`SELECT * FROM service_connections WHERE id = ?${lock ? db.lockSuffix : ''}`)
      .get(id);
    if (!connection || connection.status === 'disconnected')
      throw new HttpError(
        404,
        'The connection was not found or has been disconnected.',
        'connection_not_found',
      );
    if (connected && !connection.account_id)
      throw new HttpError(409, 'Select an account or property first.', 'account_required');
    return connection;
  }
  async function loadConnectionCredentials(connection) {
    requireVault();
    let current;
    try {
      current = vault.open(connection.encrypted_credentials, `connection:${connection.id}`);
    } catch {
      throw new HttpError(
        409,
        'This account’s credentials are unavailable. Reconnect it.',
        'reauthorization_required',
      );
    }
    if (current.expiresAt && current.expiresAt <= now().getTime() + 60000) {
      if (connection.provider !== 'google')
        throw new ProviderError(
          'Meta authorization has expired. Reconnect this account.',
          'reauthorization_required',
          { reauthenticate: true },
        );
      current = await provider.refresh(await connectionSettings('google'), current);
      const ciphertext = vault.seal(current, `connection:${connection.id}`);
      const updated = await db
        .prepare(
          "UPDATE service_connections SET encrypted_credentials = ? WHERE id = ? AND encrypted_credentials = ? AND status <> 'disconnected'",
        )
        .run(ciphertext, connection.id, connection.encrypted_credentials);
      if (updated.changes !== 1) {
        const latest = await requireConnection(connection.id);
        current = vault.open(latest.encrypted_credentials, `connection:${connection.id}`);
      }
    }
    return current;
  }
  async function withProvider(connection, fn) {
    try {
      return await fn(
        await loadConnectionCredentials(connection),
        await connectionSettings(connection.provider),
      );
    } catch (error) {
      if (error instanceof ProviderError || error?.code === 'reauthorization_required') {
        await db
          .prepare(
            "UPDATE service_connections SET status = 'needs_attention', error = ? WHERE id = ? AND status <> 'disconnected'",
          )
          .run(error.message, connection.id);
        throw new HttpError(
          error.code === 'provider_rate_limited' ? 429 : 409,
          error.message,
          error.code,
        );
      }
      throw error;
    }
  }
  const publishing = createPublishing({
    db,
    now,
    enabled,
    storage,
    provider,
    loadConnectionCredentials,
    connectionSettings,
  });
  async function connectionUnlocked(id, { renew = false } = {}) {
    const statuses = renew ? "('processing')" : "('processing','needs_reconciliation')";
    if (
      await db
        .prepare(
          `SELECT id FROM publication_jobs WHERE connection_id = ? AND status IN ${statuses} LIMIT 1`,
        )
        .get(id)
    )
      throw new HttpError(
        409,
        'Resolve the running or ambiguous publication before changing this connection.',
        'publication_locked',
      );
  }
  const authenticated = [requireAuth];
  const manager = [requireAuth, requireManager];

  app.get('/api/connections', ...authenticated, async (request, response) => {
    response.json({
      providers: await setup(request.auth.user),
      connections: (
        await db
          .prepare(
            "SELECT * FROM service_connections WHERE status <> 'disconnected' ORDER BY created_at DESC",
          )
          .all()
      ).map(publicConnection),
    });
  });
  app.put('/api/connections/providers/:provider', ...manager, async (request, response) => {
    requireVault();
    const id = parse(providerId, request.params.provider);
    const input = parse(
      z
        .object({
          clientId: z.string().trim().min(3).max(512),
          clientSecret: z.string().trim().min(8).max(4096),
        })
        .strict(),
      request.body,
    );
    await transaction(db, async () => {
      await db
        .prepare(
          'INSERT INTO provider_settings(provider, encrypted_credentials, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(provider) DO UPDATE SET encrypted_credentials = excluded.encrypted_credentials, updated_by = excluded.updated_by, updated_at = excluded.updated_at',
        )
        .run(id, vault.seal(input, `provider:${id}`), request.auth.user.id, stamp());
      await db.prepare('DELETE FROM oauth_authorizations WHERE provider = ?').run(id);
      await audit(
        db,
        request.auth.user,
        'Provider application configured',
        id,
        'Application credentials were saved encrypted on the server.',
        stamp(),
      );
    });
    response.json({ provider: (await setup(request.auth.user)).find((item) => item.id === id) });
  });
  app.post('/api/connections/authorize', ...manager, async (request, response) => {
    requireVault();
    if (!origin)
      throw new HttpError(409, 'Set APP_ORIGIN before connecting an account.', 'origin_required');
    const input = parse(
      z.object({ provider: providerId, institution: institutionName }).strict(),
      request.body,
    );
    const credentials = await connectionSettings(input.provider);
    const state = opaqueId('oauth');
    const verifier = `${opaqueId('pkce')}${opaqueId('pkce')}`;
    await transaction(db, async () => {
      await db
        .prepare(
          'DELETE FROM oauth_authorizations WHERE expires_at <= ? OR (user_id = ? AND provider = ?)',
        )
        .run(now().getTime(), request.auth.user.id, input.provider);
      await db
        .prepare(
          'INSERT INTO oauth_authorizations(state_hash, provider, user_id, session_hash, institution, encrypted_verifier, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          hash(state),
          input.provider,
          request.auth.user.id,
          request.auth.tokenHash,
          input.institution,
          vault.seal(
            { verifier, configHash: hash(JSON.stringify(credentials)) },
            `oauth:${hash(state)}`,
          ),
          now().getTime() + 10 * 60000,
        );
    });
    response.json({
      url: provider.authorize(
        input.provider,
        credentials,
        callback(input.provider),
        state,
        verifier,
      ),
    });
  });
  app.get('/api/connections/oauth/:provider/callback', async (request, response) => {
    try {
      requireVault();
      const id = parse(providerId, request.params.provider);
      const input = parse(
        z
          .object({
            state: z.string().min(20).max(200),
            code: z.string().min(1).max(4096).optional(),
            error: z.string().max(200).optional(),
          })
          .passthrough(),
        request.query,
      );
      if (!request.auth || request.auth.user.role !== 'manager')
        throw new HttpError(401, 'Sign in again before reconnecting.', 'oauth_session_expired');
      const pending = await transaction(db, async () => {
        const row = await db
          .prepare(`SELECT * FROM oauth_authorizations WHERE state_hash = ?${db.lockSuffix}`)
          .get(hash(input.state));
        if (
          !row ||
          row.provider !== id ||
          row.user_id !== request.auth.user.id ||
          row.session_hash !== request.auth.tokenHash ||
          Number(row.expires_at) <= now().getTime()
        )
          throw new HttpError(
            400,
            'Authorization state expired or did not match this session.',
            'oauth_state_invalid',
          );
        await db
          .prepare('DELETE FROM oauth_authorizations WHERE state_hash = ?')
          .run(hash(input.state));
        return row;
      });
      if (input.error || !input.code)
        throw new HttpError(400, 'Authorization was not granted.', 'oauth_denied');
      const credentials = await connectionSettings(id);
      const saved = vault.open(pending.encrypted_verifier, `oauth:${pending.state_hash}`);
      if (saved.configHash !== hash(JSON.stringify(credentials)))
        throw new HttpError(
          409,
          'Application settings changed. Start authorization again.',
          'oauth_setup_changed',
        );
      const tokens = await provider.exchange(
        id,
        credentials,
        callback(id),
        input.code,
        saved.verifier,
      );
      const connectionId = opaqueId('conn');
      await transaction(db, async () => {
        await db
          .prepare(
            "INSERT INTO service_connections(id, provider, account_name, institution, status, encrypted_credentials, connected_by, created_at) VALUES (?, ?, ?, ?, 'awaiting_selection', ?, ?, ?)",
          )
          .run(
            connectionId,
            id,
            id === 'google' ? 'Select a GA4 property' : 'Select an Instagram account',
            pending.institution,
            vault.seal(tokens, `connection:${connectionId}`),
            request.auth.user.id,
            stamp(),
          );
        await audit(
          db,
          request.auth.user,
          'Provider account authorized',
          connectionId,
          `${PROVIDERS[id].name}; select a property or account to complete setup.`,
          stamp(),
        );
      });
      response.redirect(303, `/#settings?connected=${encodeURIComponent(connectionId)}`);
    } catch (error) {
      const code =
        error instanceof HttpError || error instanceof ProviderError ? error.code : 'oauth_failed';
      response.redirect(
        303,
        `/#settings?connection_error=${encodeURIComponent(code ?? 'oauth_failed')}`,
      );
    }
  });
  app.get('/api/connections/:id/accounts', ...manager, async (request, response) => {
    const connection = await requireConnection(request.params.id);
    const accounts = await withProvider(connection, (current, credentials) =>
      provider.discover(connection.provider, current, credentials),
    );
    response.json({
      accounts: accounts.map(({ id, name, kind, platform, timezone }) => ({
        id,
        name,
        kind,
        ...(platform ? { platform } : {}),
        ...(timezone ? { timezone } : {}),
      })),
    });
  });
  app.post('/api/connections/:id/select', ...manager, async (request, response) => {
    const input = parse(z.object({ accountId: z.string().min(1).max(120) }).strict(), request.body);
    const connection = await requireConnection(request.params.id);
    const current = await loadConnectionCredentials(connection);
    const accounts = await withProvider(connection, (_current, credentials) =>
      provider.discover(connection.provider, _current, credentials),
    );
    const account = accounts.find((item) => item.id === input.accountId);
    if (!account)
      throw new HttpError(
        422,
        'Select an account returned by this provider authorization.',
        'invalid_account',
      );
    const result = await transaction(db, async () => {
      const locked = await requireConnection(connection.id, { lock: true });
      await connectionUnlocked(connection.id, { renew: locked.account_id === account.id });
      if (locked.account_id && locked.account_id !== account.id)
        throw new HttpError(
          409,
          'A selected connection cannot be changed to a different account. Add a new connection and update the post destination for fresh approval.',
          'account_immutable',
        );
      const credentials = {
        ...current,
        ...(account.pageAccessToken
          ? { pageAccessToken: account.pageAccessToken, pageId: account.pageId }
          : {}),
      };
      const duplicate = await db
        .prepare(
          "SELECT * FROM service_connections WHERE provider = ? AND account_id = ? AND status <> 'disconnected' AND id <> ?",
        )
        .get(connection.provider, account.id, connection.id);
      let target = locked;
      if (duplicate) {
        if (duplicate.institution !== connection.institution)
          throw new HttpError(
            409,
            'This account already belongs to a different institution in the workspace.',
            'account_already_connected',
          );
        target = await requireConnection(duplicate.id, { lock: true });
        await connectionUnlocked(target.id, { renew: true });
        await db
          .prepare(
            "UPDATE service_connections SET status = 'disconnected', encrypted_credentials = NULL WHERE id = ?",
          )
          .run(connection.id);
      }
      await db
        .prepare(
          "UPDATE service_connections SET account_id = ?, account_name = ?, status = 'connected', capabilities = ?, encrypted_credentials = ?, error = NULL, last_test_at = ? WHERE id = ?",
        )
        .run(
          account.id,
          account.name,
          JSON.stringify(
            connection.provider === 'google'
              ? ['analytics:read']
              : ['publish:image', 'account:read'],
          ),
          vault.seal(credentials, `connection:${target.id}`),
          stamp(),
          target.id,
        );
      await audit(
        db,
        request.auth.user,
        duplicate ? 'Account authorization renewed' : 'Account selected',
        target.id,
        `${account.name} connected to ${connection.institution}.`,
        stamp(),
      );
      return publicConnection(await requireConnection(target.id));
    });
    response.json(result);
  });
  app.post('/api/connections/:id/test', ...manager, async (request, response) => {
    const connection = await requireConnection(request.params.id, { connected: true });
    await withProvider(connection, (current, credentials) =>
      provider.test(connection.provider, connection.account_id, current, credentials),
    );
    await db
      .prepare(
        "UPDATE service_connections SET status = 'connected', error = NULL, last_test_at = ? WHERE id = ? AND status <> 'disconnected'",
      )
      .run(stamp(), connection.id);
    response.json(publicConnection(await requireConnection(connection.id)));
  });
  app.post('/api/connections/:id/sync', ...manager, async (request, response) => {
    const connection = await requireConnection(request.params.id, { connected: true });
    if (connection.provider !== 'google')
      throw new HttpError(
        422,
        'Instagram publication status is recorded per job. Social analytics import is not enabled in this version.',
        'analytics_not_supported',
      );
    const input = parse(
      z.object({ startDate: date.optional(), endDate: date.optional() }).strict(),
      request.body ?? {},
    );
    const endDate =
      input.endDate ?? new Date(now().getTime() - 86400000).toISOString().slice(0, 10);
    const startDate =
      input.startDate ??
      new Date(Date.parse(`${endDate}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
    if (
      endDate < startDate ||
      endDate > now().toISOString().slice(0, 10) ||
      Date.parse(endDate) - Date.parse(startDate) > 89 * 86400000
    )
      throw new HttpError(
        422,
        'Choose a valid date range of at most 90 days ending today or earlier.',
        'invalid_date_range',
      );
    const data = await withProvider(connection, (current) =>
      provider.report(connection.account_id, current, startDate, endDate),
    );
    const report = {
      connectionId: connection.id,
      accountName: connection.account_name,
      institution: connection.institution,
      provider: 'ga4',
      startDate,
      endDate,
      importedAt: stamp(),
      ...data,
    };
    await transaction(db, async () => {
      const latest = await requireConnection(connection.id, { lock: true });
      if (latest.account_id !== connection.account_id)
        throw new HttpError(
          409,
          'This account changed during sync. Try again.',
          'connection_changed',
        );
      await db
        .prepare(
          'INSERT INTO website_reports(connection_id, report_json, imported_at) VALUES (?, ?, ?) ON CONFLICT(connection_id) DO UPDATE SET report_json = excluded.report_json, imported_at = excluded.imported_at',
        )
        .run(connection.id, JSON.stringify(report), report.importedAt);
      await db
        .prepare(
          "UPDATE service_connections SET status = 'connected', error = NULL, last_sync_at = ? WHERE id = ?",
        )
        .run(report.importedAt, connection.id);
      await audit(
        db,
        request.auth.user,
        'Website analytics imported',
        connection.id,
        `${connection.account_name}; ${startDate} to ${endDate}; read-only GA4 data.`,
        stamp(),
      );
    });
    response.json(report);
  });
  app.delete('/api/connections/:id', ...manager, async (request, response) => {
    await transaction(db, async () => {
      const connection = await requireConnection(request.params.id, { lock: true });
      await connectionUnlocked(connection.id);
      await db
        .prepare(
          "UPDATE service_connections SET status = 'disconnected', encrypted_credentials = NULL, capabilities = '[]', error = NULL WHERE id = ?",
        )
        .run(connection.id);
      await db
        .prepare(
          "UPDATE publication_jobs SET status = 'cancelled', error = 'The destination was disconnected.', updated_at = ? WHERE connection_id = ? AND status IN ('queued','failed')",
        )
        .run(stamp(), connection.id);
      await db.prepare('DELETE FROM website_reports WHERE connection_id = ?').run(connection.id);
      await audit(
        db,
        request.auth.user,
        'Account disconnected',
        connection.id,
        `Saved credentials for ${connection.account_name} were removed from this workspace.`,
        stamp(),
      );
    });
    response.json({ ok: true });
  });

  async function visibleAssets(user) {
    const rows =
      user.role === 'manager'
        ? await db.prepare('SELECT * FROM media_assets ORDER BY created_at DESC LIMIT 200').all()
        : await db
            .prepare(
              "SELECT media_assets.* FROM media_assets WHERE owner_id = ? OR EXISTS (SELECT 1 FROM posts WHERE posts.asset_id = media_assets.id AND (posts.owner_id = ? OR posts.status IN ('in_review','approved','scheduled','published'))) ORDER BY created_at DESC LIMIT 200",
            )
            .all(user.id, user.id);
    return rows.map(publicAsset);
  }
  app.get('/api/media', ...authenticated, async (request, response) =>
    response.json({
      assets: await visibleAssets(request.auth.user),
      storage: { configured: storage.configured, maxBytes: MAX_IMAGE_BYTES, accept: IMAGE_TYPES },
    }),
  );
  app.post(
    '/api/media',
    ...authenticated,
    express.raw({ type: IMAGE_TYPES, limit: MAX_IMAGE_BYTES }),
    async (request, response) => {
      if (!storage.configured)
        throw new HttpError(503, 'Private image storage is not configured.', 'storage_required');
      let name;
      try {
        name = decodeURIComponent(request.get('x-file-name') ?? 'school-image');
      } catch {
        throw new HttpError(422, 'The image filename could not be read.', 'invalid_filename');
      }
      const asset = await normalizeImage(
        request.body,
        request.get('content-type')?.split(';')[0].trim().toLowerCase(),
        name,
      );
      if (
        Number((await db.prepare('SELECT COUNT(*) AS count FROM media_assets').get()).count) >= 200
      )
        throw new HttpError(
          409,
          'This initial media library has reached its 200-image limit. A manager must review storage before adding more.',
          'media_quota',
        );
      const id = opaqueId('asset');
      const stored = await storage.put(id, asset.bytes);
      await db
        .prepare(
          'INSERT INTO media_assets(id, name, mime_type, size, sha256, width, height, storage_kind, storage_path, storage_url, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          asset.name,
          asset.mimeType,
          asset.size,
          asset.sha256,
          asset.width,
          asset.height,
          stored.kind,
          stored.path,
          stored.url ?? null,
          request.auth.user.id,
          stamp(),
        );
      response
        .status(201)
        .json(publicAsset(await db.prepare('SELECT * FROM media_assets WHERE id = ?').get(id)));
    },
  );
  app.get('/api/media/:id/content', ...authenticated, async (request, response) => {
    const asset = await db
      .prepare('SELECT * FROM media_assets WHERE id = ?')
      .get(request.params.id);
    if (!asset) throw new HttpError(404, 'Image not found.', 'not_found');
    if (request.auth.user.role !== 'manager' && asset.owner_id !== request.auth.user.id) {
      const shared = await db
        .prepare(
          "SELECT id FROM posts WHERE asset_id = ? AND (owner_id = ? OR status IN ('in_review','approved','scheduled','published')) LIMIT 1",
        )
        .get(asset.id, request.auth.user.id);
      if (!shared)
        throw new HttpError(
          403,
          'This draft image is private to its author and managers.',
          'asset_private',
        );
    }
    const bytes = await storage.read(asset);
    response
      .set({
        'Content-Type': asset.mime_type,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, no-store',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(bytes);
  });
  app.post('/api/posts/:id/publications', ...manager, async (request, response) => {
    const input = parse(
      z
        .object({ revision: z.number().int().positive(), scheduledAt: dateTime.optional() })
        .strict(),
      request.body,
    );
    const jobs = await transaction(db, async () => {
      const post = await getPost(db, request.params.id, { lock: true });
      if (!post) throw new HttpError(404, 'Post not found.', 'not_found');
      if (post.revision !== input.revision)
        throw new HttpError(
          409,
          'This post changed. Review its current revision.',
          'stale_revision',
        );
      const queued = await publishing.enqueue(post, request.auth.user, input.scheduledAt);
      if (!queued.length)
        throw new HttpError(
          422,
          'Choose a connected Instagram destination and obtain approval before queuing.',
          'destination_required',
        );
      await audit(
        db,
        request.auth.user,
        'Approved publication queued',
        post.id,
        `Revision ${post.revision}; ${queued.length} destination(s).`,
        stamp(),
      );
      return queued;
    });
    response.json({ jobs });
  });
  app.post('/api/publications/:id/retry', ...manager, async (request, response) =>
    response.json(await publishing.changeJob(request.params.id, 'retry', request.auth.user)),
  );
  app.post('/api/publications/:id/cancel', ...manager, async (request, response) =>
    response.json(await publishing.changeJob(request.params.id, 'cancel', request.auth.user)),
  );
  app.post('/api/publications/:id/reconcile', ...manager, async (request, response) => {
    const input = parse(
      z.object({ remoteId: z.string().regex(/^\d{1,40}$/) }).strict(),
      request.body,
    );
    response.json(await publishing.reconcile(request.params.id, input.remoteId, request.auth.user));
  });
  app.post('/api/jobs/run', ...manager, async (_request, response) =>
    response.json(await publishing.run()),
  );
  app.get('/api/jobs/run', async (request, response) => {
    const cronSecret = options.cronSecret ?? process.env.CRON_SECRET;
    if (!cronSecret || !secretEqual(request.get('authorization'), `Bearer ${cronSecret}`))
      throw new HttpError(401, 'A valid scheduled-job credential is required.', 'unauthenticated');
    response.json(await publishing.run());
  });

  return {
    async bootstrap(request) {
      const user = request.auth.user;
      return {
        providerSetup: await setup(user),
        connections: (
          await db
            .prepare(
              "SELECT * FROM service_connections WHERE status <> 'disconnected' ORDER BY created_at DESC",
            )
            .all()
        ).map(publicConnection),
        mediaAssets: await visibleAssets(user),
        publicationJobs: (
          await db
            .prepare('SELECT * FROM publication_jobs ORDER BY created_at DESC LIMIT 200')
            .all()
        ).map(publicJob),
        websiteAnalytics: (
          await db
            .prepare('SELECT report_json FROM website_reports ORDER BY imported_at DESC')
            .all()
        ).map((row) => JSON.parse(row.report_json)),
        publishingEnabled: enabled && storage.canDeliver,
      };
    },
    async validatePost(post, user) {
      await publishing.assertUnlocked(post.id);
      if (post.assetId) {
        const asset = await db.prepare('SELECT * FROM media_assets WHERE id = ?').get(post.assetId);
        const alreadyAttached = post.id
          ? await db
              .prepare('SELECT id FROM posts WHERE id = ? AND owner_id = ? AND asset_id = ?')
              .get(post.id, user.id, post.assetId)
          : null;
        if (!asset || (user.role !== 'manager' && asset.owner_id !== user.id && !alreadyAttached))
          throw new HttpError(
            422,
            'Choose an image you uploaded, or ask a manager to attach it.',
            'invalid_asset',
          );
      }
      await publishing.validateDestinations(post);
    },
    async onPostChanged(oldPost, _newPost, _user) {
      await publishing.assertUnlocked(oldPost.id);
      await publishing.cancelPending(
        oldPost.id,
        'The content revision changed and its previous approval was invalidated.',
      );
    },
    async onPostTransition(oldPost, newPost, action, user) {
      await publishing.assertUnlocked(oldPost.id);
      if (action === 'approve' || action === 'schedule') {
        if (newPost.destinationIds?.length) await publishing.enqueue(newPost, user);
      } else if (['unschedule', 'reject', 'request_changes', 'submit'].includes(action))
        await publishing.cancelPending(oldPost.id, `The post moved to ${newPost.status}.`);
    },
  };
}
