import express from 'express';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { transaction, getPost, audit } from '../database.mjs';
import { HttpError, parse } from '../validation.mjs';
import { createVault, opaqueId, hash, secretEqual } from './crypto.mjs';
import { PROVIDERS, ProviderError, createProviderClient } from './providers.mjs';
import { PROVIDER_IDS, providerGroup, credentialKey } from './provider-definitions.mjs';
import { migrateExtensions } from './migrate.mjs';
import { createReporting } from './reporting.mjs';
import {
  MAX_IMAGE_BYTES,
  IMAGE_TYPES,
  normalizeImage,
  createStorage,
  createStorageBroker,
  publicAsset,
} from './storage.mjs';
import { createPublishing, publicJob } from './publishing.mjs';

const providerId = z.enum(PROVIDER_IDS);
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
  autoSync: Number(row.auto_sync) === 1,
  syncIntervalHours: Number(row.sync_interval_hours || 24),
  nextSyncAt: row.next_sync_at ?? null,
  error: row.error,
});

export async function registerExtensions(
  app,
  { db, config, now, requireAuth, requireManager, options = {} },
) {
  await migrateExtensions(db, config);
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
      googleAdsVersion: options.googleAdsVersion ?? process.env.GOOGLE_ADS_API_VERSION ?? 'v26',
      linkedinVersion: options.linkedinVersion ?? process.env.LINKEDIN_API_VERSION ?? '202610',
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
    const key = credentialKey(id);
    if (!key) throw new HttpError(422, 'Unsupported provider.', 'provider_not_supported');
    const saved = await db
      .prepare('SELECT encrypted_credentials FROM provider_settings WHERE provider = ?')
      .get(key);
    if (saved) {
      try {
        return vault.open(saved.encrypted_credentials, `provider:${key}`);
      } catch {
        throw new HttpError(
          503,
          'The saved provider credentials could not be decrypted. A manager must save them again.',
          'provider_credentials_unavailable',
        );
      }
    }
    const family = providerGroup(id);
    const clientId =
      family === 'google'
        ? process.env.GOOGLE_CLIENT_ID
        : family === 'meta'
          ? process.env.META_APP_ID
          : process.env.LINKEDIN_CLIENT_ID;
    const clientSecret =
      family === 'google'
        ? process.env.GOOGLE_CLIENT_SECRET
        : family === 'meta'
          ? process.env.META_APP_SECRET
          : process.env.LINKEDIN_CLIENT_SECRET;
    if (!clientId || !clientSecret)
      throw new HttpError(
        409,
        'Save this provider’s application credentials before connecting an account.',
        'provider_setup_required',
      );
    return {
      clientId,
      clientSecret,
      ...(family === 'google' && process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
        ? { loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID }
        : {}),
    };
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
      if (providerGroup(connection.provider) === 'meta')
        throw new ProviderError(
          'Meta authorization has expired. Reconnect this account.',
          'reauthorization_required',
          { reauthenticate: true },
        );
      current = await provider.refresh(
        await connectionSettings(connection.provider),
        current,
        connection.provider,
      );
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
  async function withProvider(connection, fn, { reportLeaseId = null } = {}) {
    try {
      return await fn(
        await loadConnectionCredentials(connection),
        await connectionSettings(connection.provider),
      );
    } catch (error) {
      if (error instanceof ProviderError || error?.code === 'reauthorization_required') {
        const needsAttention =
          error.reauthenticate ||
          ['reauthorization_required', 'permission_denied', 'invalid_token_response'].includes(
            error.code,
          );
        await db
          .prepare(
            "UPDATE service_connections SET status = CASE WHEN ? = 1 THEN 'needs_attention' ELSE status END, error = ? WHERE id = ? AND status <> 'disconnected' AND (CAST(? AS TEXT) IS NULL OR sync_lease_id = ?)",
          )
          .run(needsAttention ? 1 : 0, error.message, connection.id, reportLeaseId, reportLeaseId);
        throw new HttpError(
          error.code === 'provider_rate_limited' ? 429 : 409,
          error.message,
          error.code,
        );
      }
      throw error;
    }
  }
  const reporting = createReporting({ db, now, provider, withProvider, requireConnection });
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
    const key = credentialKey(id);
    const input = parse(
      z
        .object({
          clientId: z.string().trim().min(3).max(512).optional(),
          clientSecret: z.string().trim().min(8).max(4096).optional(),
          loginCustomerId: z
            .string()
            .regex(/^\d{10}$/)
            .optional(),
          developerToken: z.string().trim().min(8).max(256).optional(),
        })
        .strict()
        .refine(
          (value) => Object.values(value).some((item) => item !== undefined),
          'Provide an application setting to save.',
        ),
      request.body,
    );
    if (providerGroup(id) !== 'google' && (input.loginCustomerId || input.developerToken))
      throw new HttpError(
        422,
        'Google Ads settings belong to the Google application group.',
        'invalid_provider_settings',
      );
    let previous = {};
    try {
      previous = await connectionSettings(id);
    } catch (error) {
      if (error.code !== 'provider_setup_required') throw error;
    }
    const merged = {
      ...previous,
      ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    };
    if (!merged.clientId || !merged.clientSecret)
      throw new HttpError(
        422,
        'Enter both the client ID and client secret for the first application setup.',
        'provider_setup_required',
      );
    const family = PROVIDER_IDS.filter((item) => credentialKey(item) === key);
    await transaction(db, async () => {
      for (const service of family) {
        for (const connection of await db
          .prepare(
            "SELECT id FROM service_connections WHERE provider = ? AND status <> 'disconnected'",
          )
          .all(service))
          await connectionUnlocked(connection.id, { renew: previous.clientId === merged.clientId });
      }
      await db
        .prepare(
          'INSERT INTO provider_settings(provider, encrypted_credentials, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(provider) DO UPDATE SET encrypted_credentials = excluded.encrypted_credentials, updated_by = excluded.updated_by, updated_at = excluded.updated_at',
        )
        .run(key, vault.seal(merged, `provider:${key}`), request.auth.user.id, stamp());
      for (const service of family) {
        await db.prepare('DELETE FROM oauth_authorizations WHERE provider = ?').run(service);
        if (previous.clientId && previous.clientId !== merged.clientId) {
          await db
            .prepare(
              "UPDATE service_connections SET status = 'needs_attention', error = 'The developer application changed. Reconnect this account.' WHERE provider = ? AND status <> 'disconnected'",
            )
            .run(service);
          await db
            .prepare(
              "UPDATE publication_jobs SET status = 'cancelled', error = 'The developer application changed. Reconnect before queuing.', updated_at = ? WHERE connection_id IN (SELECT id FROM service_connections WHERE provider = ?) AND status IN ('queued','failed')",
            )
            .run(stamp(), service);
        }
      }
      await audit(
        db,
        request.auth.user,
        'Provider application configured',
        id,
        `Application settings for the ${providerGroup(id)} group were saved encrypted on the server.`,
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
            `Select a ${PROVIDERS[id].name} account`,
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
      accounts: accounts.map(({ id, name, kind, platform, timezone, capabilities }) => ({
        id,
        name,
        kind,
        ...(platform ? { platform } : {}),
        ...(timezone ? { timezone } : {}),
        ...(capabilities ? { capabilities } : {}),
      })),
    });
  });
  app.post('/api/connections/:id/select', ...manager, async (request, response) => {
    const input = parse(
      z.object({ accountId: z.string().min(1).max(2048) }).strict(),
      request.body,
    );
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
        ...(account.credentials ?? {}),
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
          "UPDATE service_connections SET account_id = ?, account_name = ?, status = 'connected', capabilities = ?, encrypted_credentials = ?, error = NULL, last_test_at = ?, sync_lease_id = NULL, sync_lease_expires_at = NULL WHERE id = ?",
        )
        .run(
          account.id,
          account.name,
          JSON.stringify(account.capabilities ?? PROVIDERS[connection.provider].capabilities),
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
    const input = parse(
      z.object({ startDate: date.optional(), endDate: date.optional() }).strict(),
      request.body ?? {},
    );
    response.json(await reporting.syncOne(request.params.id, input, request.auth.user));
  });
  app.post('/api/connections/:id/sync-settings', ...manager, async (request, response) => {
    const input = parse(
      z
        .object({
          autoSync: z.boolean(),
          syncIntervalHours: z.number().int().min(6).max(168).optional(),
        })
        .strict(),
      request.body,
    );
    response.json(
      publicConnection(await reporting.saveSettings(request.params.id, input, request.auth.user)),
    );
  });
  app.get('/api/connections/:id/report.csv', ...authenticated, async (request, response) => {
    const connection = await requireConnection(request.params.id, { connected: true });
    const table = connection.provider === 'google' ? 'website_reports' : 'platform_reports';
    const saved = await db
      .prepare(`SELECT report_json FROM ${table} WHERE connection_id = ?`)
      .get(connection.id);
    if (!saved)
      throw new HttpError(404, 'Import a report before exporting it.', 'report_not_found');
    const report = JSON.parse(saved.report_json);
    const rows = [
      ['Provider', report.provider],
      ['Account', report.accountName],
      ['Institution', report.institution],
      ['Start date', report.startDate],
      ['End date', report.endDate],
      ['Imported at', report.importedAt],
      ['Currency', report.currency || 'Not applicable'],
      [],
    ];
    if (report.summary) {
      rows.push(['Summary metric', 'Value', 'Unit']);
      for (const item of report.summary) rows.push([item.label, item.value, item.unit || 'count']);
      for (const section of report.tables) {
        rows.push([], [section.label, section.truncated ? 'Limited rows' : '']);
        rows.push(section.columns.map((item) => item.label));
        for (const row of section.rows)
          rows.push(section.columns.map((item) => row[item.key] ?? ''));
      }
      rows.push([], ['Report notes']);
      for (const note of report.notes || []) rows.push([note]);
    } else {
      rows.push(['Metric', 'Value'], ...Object.entries(report.totals));
      for (const key of ['daily', 'pages', 'sources']) {
        rows.push([], [key]);
        const columns = Object.keys(report[key][0] || {});
        rows.push(columns, ...report[key].map((row) => columns.map((column) => row[column])));
      }
    }
    const cell = (value) => {
      const original = String(value ?? '');
      const safe =
        typeof value === 'string' && /^[=+@\-\t\r]/.test(original) ? `'${original}` : original;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    response
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${connection.provider}-report-${report.startDate}-${report.endDate}.csv"`,
      })
      .send('\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n'));
  });
  app.delete('/api/connections/:id', ...manager, async (request, response) => {
    await transaction(db, async () => {
      const connection = await requireConnection(request.params.id, { lock: true });
      await connectionUnlocked(connection.id);
      await db
        .prepare(
          "UPDATE service_connections SET status = 'disconnected', encrypted_credentials = NULL, capabilities = '[]', error = NULL, auto_sync = 0, next_sync_at = NULL, sync_lease_id = NULL, sync_lease_expires_at = NULL WHERE id = ?",
        )
        .run(connection.id);
      await db
        .prepare(
          "UPDATE publication_jobs SET status = 'cancelled', error = 'The destination was disconnected.', updated_at = ? WHERE connection_id = ? AND status IN ('queued','failed')",
        )
        .run(stamp(), connection.id);
      await db.prepare('DELETE FROM website_reports WHERE connection_id = ?').run(connection.id);
      await db.prepare('DELETE FROM platform_reports WHERE connection_id = ?').run(connection.id);
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

  const attachedIds = (row) => {
    let ids = [];
    try {
      ids = JSON.parse(row.asset_ids ?? '[]');
    } catch {
      /* legacy single image */
    }
    return ids.length ? ids : row.asset_id ? [row.asset_id] : [];
  };
  async function sharedAssetIds(user) {
    const posts = await db
      .prepare(
        "SELECT asset_id, asset_ids FROM posts WHERE owner_id = ? OR status IN ('in_review','approved','scheduled','published')",
      )
      .all(user.id);
    return new Set(posts.flatMap(attachedIds));
  }
  async function visibleAssets(user) {
    const rows = await db
      .prepare('SELECT * FROM media_assets ORDER BY created_at DESC LIMIT 200')
      .all();
    if (user.role === 'manager') return rows.map(publicAsset);
    const shared = await sharedAssetIds(user);
    return rows.filter((row) => row.owner_id === user.id || shared.has(row.id)).map(publicAsset);
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
      const id = opaqueId('asset');
      const uploadId = opaqueId('image_upload');
      await transaction(db, async () => {
        if (db.kind === 'postgres')
          await db
            .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
            .get(`smis:${db.schema}:media-quota`);
        const used = await db
          .prepare('SELECT COUNT(*) AS count, COALESCE(SUM(size),0) AS bytes FROM media_assets')
          .get();
        const reserved = await db
          .prepare(
            "SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN mime_type = 'video/mp4' THEN 41943040 ELSE expected_size END),0) AS bytes FROM media_uploads WHERE status <> 'completed'",
          )
          .get();
        if (
          Number(used.count) + Number(reserved.count) >= 200 ||
          Number(used.bytes) + Number(reserved.bytes) + asset.size > 512 * 1024 * 1024
        )
          throw new HttpError(
            409,
            'The media library has reached its 200-asset or 512 MiB workspace allowance, including pending uploads. A manager must review storage before adding more.',
            'media_quota',
          );
        await db
          .prepare(
            "INSERT INTO media_uploads(id,owner_id,name,mime_type,expected_size,storage_path,status,created_at,expires_at) VALUES (?,?,?,?,?,?,'pending',?,?)",
          )
          .run(
            uploadId,
            request.auth.user.id,
            asset.name,
            'image/jpeg',
            asset.size,
            `assets/${id}.jpg`,
            stamp(),
            new Date(now().getTime() + 2 * 3600000).toISOString(),
          );
      });
      try {
        const stored = await storage.put(id, asset.bytes);
        await transaction(db, async () => {
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
          await db
            .prepare("UPDATE media_uploads SET status = 'completed' WHERE id = ?")
            .run(uploadId);
        });
      } catch (error) {
        await db
          .prepare(
            "UPDATE media_uploads SET status = 'failed', error = 'The image upload could not be completed.' WHERE id = ? AND status <> 'completed'",
          )
          .run(uploadId);
        throw error;
      }
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
    if (
      request.auth.user.role !== 'manager' &&
      asset.owner_id !== request.auth.user.id &&
      !(await sharedAssetIds(request.auth.user)).has(asset.id)
    )
      throw new HttpError(
        403,
        'This draft asset is private to its author and managers.',
        'asset_private',
      );
    if (asset.mime_type === 'video/mp4' && asset.storage_kind !== 'local') {
      response.redirect(302, await storage.signedUrl(asset));
      return;
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
          'Choose a connected publishing destination and obtain approval before queuing.',
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
      z
        .object({
          remoteId: z
            .string()
            .min(1)
            .max(256)
            .regex(/^[A-Za-z0-9_:/.-]+$/),
        })
        .strict(),
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
    storage,
    syncDueReports: reporting.syncDueReports,
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
        platformAnalytics: (
          await db
            .prepare('SELECT report_json FROM platform_reports ORDER BY imported_at DESC')
            .all()
        ).map((row) => JSON.parse(row.report_json)),
        publishingEnabled: enabled && storage.canDeliver,
      };
    },
    async validatePost(post, user) {
      await publishing.assertUnlocked(post.id);
      const ids = post.assetIds?.length ? post.assetIds : post.assetId ? [post.assetId] : [];
      const old = post.id
        ? await db
            .prepare('SELECT asset_id, asset_ids FROM posts WHERE id = ? AND owner_id = ?')
            .get(post.id, user.id)
        : null;
      const existing = new Set(old ? attachedIds(old) : []);
      for (const id of ids) {
        const asset = await db.prepare('SELECT * FROM media_assets WHERE id = ?').get(id);
        if (!asset || (user.role !== 'manager' && asset.owner_id !== user.id && !existing.has(id)))
          throw new HttpError(
            422,
            'Choose assets you uploaded, or ask a manager to attach them.',
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
