import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../app.mjs';
import { registerExtensions } from './index.mjs';
import { createVault, hash, opaqueId } from './crypto.mjs';
import { createProviderClient, ProviderError } from './providers.mjs';
import { createStorage, createStorageBroker, normalizeImage } from './storage.mjs';

test('credential encryption authenticates ciphertext and binds it to its record', () => {
  const vault = createVault(randomBytes(32));
  const secret = { accessToken: 'secret-access-token', refreshToken: 'secret-refresh-token' };
  const value = vault.seal(secret, 'connection:one');
  assert.ok(!value.includes(secret.accessToken));
  assert.deepEqual(vault.open(value, 'connection:one'), secret);
  assert.throws(() => vault.open(value, 'connection:two'));
  const pieces = value.split('.');
  const ciphertext = Buffer.from(pieces[3], 'base64url');
  ciphertext[0] ^= 1;
  pieces[3] = ciphertext.toString('base64url');
  assert.throws(() => vault.open(pieces.join('.'), 'connection:one'));
  assert.equal(createVault(), null);
  assert.throws(() => createVault('insecure-example-key'));
});

test('disabled automatic migration checks the extension marker without any DDL or transaction', async () => {
  const app = { get() {}, put() {}, post() {}, delete() {} };
  const db = {
    prepare(sql) {
      assert.match(sql, /SELECT value FROM workspace_metadata/);
      return { get: async () => ({ value: '2' }) };
    },
    exec() {
      assert.fail('Startup must not execute DDL with migrations disabled.');
    },
    transaction() {
      assert.fail('Startup must not begin a migration transaction.');
    },
  };
  const context = {
    db,
    config: { migrate: false, databasePath: ':memory:' },
    now: () => new Date(),
    requireAuth() {},
    requireManager() {},
    options: {
      encryptionKey: '',
      appOrigin: 'http://localhost:5173',
      storage: { configured: true },
    },
  };
  const hooks = await registerExtensions(app, context);
  assert.equal(typeof hooks.bootstrap, 'function');
  db.prepare = () => ({ get: async () => undefined });
  await assert.rejects(
    () => registerExtensions(app, context),
    /extension database migration required/,
  );
});

test('Google adapter requests read-only PKCE OAuth and reads paginated properties without following URLs', async () => {
  const calls = [];
  const provider = createProviderClient({
    fetch: async (url, options) => {
      calls.push({ url: new URL(url), options });
      return Response.json(
        calls.length === 1
          ? {
              accountSummaries: [
                {
                  propertySummaries: [
                    { property: 'properties/100', displayName: 'School website' },
                  ],
                },
              ],
              nextPageToken: 'page-two',
            }
          : {
              accountSummaries: [
                { propertySummaries: [{ property: 'properties/101', displayName: 'Admissions' }] },
              ],
            },
      );
    },
  });
  const url = new URL(
    provider.authorize(
      'google',
      { clientId: 'test-client' },
      'https://school.example/callback',
      'session-state',
      'long-verifier',
    ),
  );
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/analytics.readonly');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge'));
  const accounts = await provider.discover('google', { accessToken: 'read-token' }, {});
  assert.equal(accounts.length, 2);
  assert.equal(calls[1].url.searchParams.get('pageToken'), 'page-two');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer read-token');
  assert.equal(calls[0].options.redirect, 'error');
});

test('GA4 totals use a distinct aggregate report and are never a sum of daily unique users', async () => {
  const provider = createProviderClient({
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body);
      const dimension = body.dimensions[0]?.name;
      const metric = (values) => ({
        metricValues: values.map((value) => ({ value: String(value) })),
      });
      if (!dimension) return Response.json({ rows: [metric([8, 12, 20, 2])] });
      if (dimension === 'date')
        return Response.json({
          rows: [
            { dimensionValues: [{ value: '20261101' }], ...metric([6, 7, 11, 1]) },
            { dimensionValues: [{ value: '20261102' }], ...metric([5, 5, 9, 1]) },
          ],
        });
      return Response.json({ rows: [] });
    },
  });
  const report = await provider.report(
    'properties/100',
    { accessToken: 'read-token' },
    '2026-11-01',
    '2026-11-02',
  );
  assert.equal(report.totals.users, 8);
  assert.equal(
    report.daily.reduce((total, row) => total + row.users, 0),
    11,
  );
  assert.equal(report.daily[0].date, '2026-11-01');
});

test('provider errors redact sensitive response text and distinguish ambiguous sends', async () => {
  const rejected = createProviderClient({
    fetch: async () =>
      Response.json({ error: { code: 190, message: 'secret-token-value' } }, { status: 400 }),
  });
  await assert.rejects(
    () => rejected.publish('12', '34', { pageAccessToken: 'token' }, { clientSecret: 'secret' }),
    (error) =>
      error.reauthenticate && !error.ambiguous && !error.message.includes('secret-token-value'),
  );
  const unknown = createProviderClient({
    fetch: async () => {
      throw new Error('timeout with secret URL');
    },
  });
  await assert.rejects(
    () => unknown.publish('12', '34', { pageAccessToken: 'token' }, { clientSecret: 'secret' }),
    (error) =>
      error instanceof ProviderError && error.ambiguous && !error.message.includes('secret URL'),
  );
});

test('image uploads reject spoofed types and normalize the image before approval', async () => {
  await assert.rejects(
    () => normalizeImage(Buffer.from('<svg onload="alert(1)"></svg>'), 'image/jpeg', 'fake.jpg'),
    (error) => error.code === 'unsupported_image',
  );
  await assert.rejects(
    () => normalizeImage(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg', 'broken.jpg'),
    (error) => error.code === 'invalid_image',
  );
  const png = await sharp({
    create: {
      width: 400,
      height: 500,
      channels: 4,
      background: { r: 100, g: 50, b: 150, alpha: 0.4 },
    },
  })
    .png()
    .toBuffer();
  const processed = await normalizeImage(png, 'image/png', '../test.png');
  assert.equal(processed.mimeType, 'image/jpeg');
  assert.equal(processed.name, 'test.jpg');
  assert.equal(processed.width, 400);
  assert.equal(processed.sha256, hash(processed.bytes));
  assert.equal((await sharp(processed.bytes).metadata()).hasAlpha, false);
});

test('local private media is immutable and read-time integrity checks fail closed', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'smis-private-media-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storage = createStorage({ localDirectory: directory });
  const bytes = Buffer.from('test JPEG bytes');
  const id = opaqueId('asset');
  const stored = await storage.put(id, bytes);
  const record = {
    storage_kind: stored.kind,
    storage_path: stored.path,
    size: bytes.length,
    sha256: hash(bytes),
  };
  assert.deepEqual(await storage.read(record), bytes);
  await assert.rejects(() => storage.put(id, bytes), /exist/i);
  await writeFile(join(directory, stored.path), 'different image');
  await assert.rejects(
    () => storage.read(record),
    (error) => error.code === 'asset_integrity_failed',
  );
  await assert.rejects(
    () => storage.signedUrl(record),
    (error) => error.code === 'media_delivery_required',
  );
});

test('storage broker signs the exact serialized body and never forwards private key', async () => {
  const keys = generateKeyPairSync('ed25519');
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const broker = createStorageBroker({
    url: 'https://storage.example/functions/v1/media',
    privateKey,
    now: () => new Date('2026-11-04T10:00:00Z'),
    fetch: async (url, options) => {
      const timestamp = options.headers['x-marketing-timestamp'];
      assert.ok(
        verify(
          null,
          Buffer.from(`${timestamp}.${hash(options.body)}`),
          keys.publicKey,
          Buffer.from(options.headers['x-marketing-signature'], 'base64url'),
        ),
      );
      assert.ok(!JSON.stringify(options).includes('PRIVATE KEY'));
      assert.equal(new URL(url).protocol, 'https:');
      assert.equal(options.redirect, 'error');
      return Response.json({ path: JSON.parse(options.body).path });
    },
  });
  assert.equal(
    (
      await broker({
        operation: 'put',
        path: 'assets/test.jpg',
        dataBase64: 'AA==',
        contentType: 'image/jpeg',
      })
    ).path,
    'assets/test.jpg',
  );
});

async function fixture(t, overrides = {}) {
  let time = new Date('2026-11-04T10:00:00Z');
  const bytes = new Map();
  const calls = { containers: 0, published: 0 };
  let publishFailure = null;
  let containerState = 'FINISHED';
  const fake = {
    authorize: (provider, _credentials, _uri, state) =>
      `https://accounts.example/${provider}?state=${state}`,
    exchange: async () => ({
      accessToken: 'SECRET_ACCESS',
      refreshToken: 'SECRET_REFRESH',
      expiresAt: time.getTime() + 86400000,
    }),
    refresh: async (_settings, current) => ({
      ...current,
      accessToken: 'REFRESHED',
      expiresAt: time.getTime() + 3600000,
    }),
    discover: async (provider) =>
      provider === 'google'
        ? [{ id: 'properties/123', name: 'School GA4', kind: 'ga4' }]
        : [
            {
              id: '100',
              name: '@school',
              kind: 'instagram',
              platform: 'instagram',
              pageId: '101',
              pageAccessToken: 'SECRET_PAGE',
            },
          ],
    test: async () => true,
    report: async () => ({
      totals: { users: 8, sessions: 10, views: 12, keyEvents: 2 },
      daily: [],
      pages: [],
      sources: [],
    }),
    createContainer: async () => {
      calls.containers++;
      return '200';
    },
    containerStatus: async () => containerState,
    publish: async () => {
      calls.published++;
      if (publishFailure) throw publishFailure;
      return '300';
    },
    media: async (_account, remoteId) => ({
      id: remoteId,
      caption: 'Approved caption',
      timestamp: time.toISOString(),
      permalink: 'https://www.instagram.com/p/confirmed/',
    }),
  };
  const storage = {
    configured: true,
    canDeliver: true,
    kind: 'test',
    put: async (id, data) => {
      const path = `assets/${id}.jpg`;
      if (bytes.has(path)) throw new Error('duplicate');
      bytes.set(path, data);
      return { kind: 'test', path };
    },
    read: async (asset) => {
      const data = bytes.get(asset.storage_path);
      if (!data || hash(data) !== asset.sha256) throw new Error('invalid asset');
      return data;
    },
    signedUrl: async (asset) =>
      `https://private-storage.example/${asset.storage_path}?signature=short-lived`,
  };
  const errors = [];
  let extensionHooks;
  const app = await createApp({
    demoMode: true,
    databaseUrl: '',
    databasePath: ':memory:',
    secureCookies: false,
    serveStatic: false,
    allowedOrigins: [],
    now: () => new Date(time),
    onError: (error) => errors.push(error),
    registerExtensions: async (application, context) => {
      extensionHooks = await registerExtensions(application, context);
      return extensionHooks;
    },
    extensionOptions: {
      encryptionKey: Buffer.alloc(32, 7),
      appOrigin: 'http://localhost:5173',
      publishingEnabled: true,
      cronSecret: 'test-cron-secret',
      providerClient: fake,
      storage,
      ...overrides,
    },
  });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await app.locals.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  let cookie = '',
    csrf = '';
  async function request(
    path,
    {
      method = 'GET',
      body,
      raw,
      headers = {},
      authenticated = true,
      noCsrf = false,
      redirect = 'manual',
    } = {},
  ) {
    const response = await fetch(`${url}${path}`, {
      method,
      redirect,
      headers: {
        ...(authenticated && cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(!noCsrf && csrf ? { 'x-csrf-token': csrf } : {}),
        ...headers,
      },
      ...(raw ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const newCookie = response.headers.getSetCookie()[0];
    if (newCookie) cookie = newCookie.split(';')[0];
    const type = response.headers.get('content-type') ?? '';
    const data = type.includes('application/json') ? await response.json() : await response.text();
    if (data.csrfToken) csrf = data.csrfToken;
    return { status: response.status, body: data, headers: response.headers };
  }
  await request('/api/bootstrap');
  async function connect(provider = 'instagram') {
    const configured = await request(`/api/connections/providers/${provider}`, {
      method: 'PUT',
      body: { clientId: 'APP_ID', clientSecret: 'SUPER_SECRET_APP' },
    });
    assert.equal(configured.status, 200, JSON.stringify(configured.body));
    const auth = await request('/api/connections/authorize', {
      method: 'POST',
      body: { provider, institution: 'St. Mary’s ISC' },
    });
    assert.equal(auth.status, 200, JSON.stringify(auth.body));
    const state = new URL(auth.body.url).searchParams.get('state');
    const finished = await request(`/api/connections/oauth/callback?state=${state}&code=code`);
    assert.equal(finished.status, 303);
    const id = new URLSearchParams(finished.headers.get('location').split('?')[1]).get('connected');
    assert.ok(id, finished.headers.get('location'));
    const accounts = await request(`/api/connections/${id}/accounts`);
    assert.ok(!JSON.stringify(accounts.body).includes('SECRET'));
    const selected = await request(`/api/connections/${id}/select`, {
      method: 'POST',
      body: { accountId: accounts.body.accounts[0].id },
    });
    assert.equal(selected.status, 200, JSON.stringify(selected.body));
    return { ...selected.body, state };
  }
  async function asset() {
    const image = await sharp({
      create: { width: 400, height: 500, channels: 3, background: '#7349dc' },
    })
      .png()
      .toBuffer();
    const result = await request('/api/media', {
      method: 'POST',
      raw: image,
      headers: { 'Content-Type': 'image/png', 'x-file-name': 'school.png' },
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body;
  }
  async function approved(connection, image, input = {}) {
    const created = await request('/api/posts', {
      method: 'POST',
      body: {
        title: 'Approved image',
        caption: 'Approved caption',
        platforms: ['instagram'],
        format: 'Post',
        institution: 'St. Mary’s ISC',
        scheduledAt: null,
        language: 'English',
        palette: 'violet',
        assetId: image.id,
        destinationIds: [connection.id],
        ...input,
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const post = created.body;
    assert.equal(
      (
        await request(`/api/posts/${post.id}/transition`, {
          method: 'POST',
          body: { action: 'submit', revision: 1 },
        })
      ).status,
      200,
    );
    const result = await request(`/api/posts/${post.id}/transition`, {
      method: 'POST',
      body: { action: 'approve', revision: 1 },
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body;
  }
  return {
    app,
    extensions: extensionHooks,
    db: app.locals.database,
    request,
    connect,
    asset,
    approved,
    calls,
    errors,
    fake,
    setTime: (value) => {
      time = new Date(value);
    },
    failPublish: (value) => {
      publishFailure = value;
    },
    containerState: (value) => {
      containerState = value;
    },
  };
}

async function pendingConnection(f, provider = 'instagram', institution = 'St. Mary’s ISC') {
  const auth = await f.request('/api/connections/authorize', {
    method: 'POST',
    body: { provider, institution },
  });
  assert.equal(auth.status, 200, JSON.stringify(auth.body));
  const state = new URL(auth.body.url).searchParams.get('state');
  const completed = await f.request(`/api/connections/oauth/callback?state=${state}&code=code`);
  assert.equal(completed.status, 303);
  const id = new URLSearchParams(completed.headers.get('location').split('?')[1]).get('connected');
  assert.ok(id, completed.headers.get('location'));
  return { id, state };
}

test('shared application administration is owner-only while another manager can authorize accounts', async (t) => {
  const f = await fixture(t);
  const owner = (await f.request('/api/bootstrap')).body.user;
  await f.db
    .prepare(
      "INSERT INTO workspace_metadata(key,value) VALUES ('workspace_owner_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run(owner.id);
  const configured = await f.request('/api/connections/applications/meta', {
    method: 'PUT',
    body: { clientId: 'APP_ID', clientSecret: 'SUPER_SECRET_APP' },
  });
  assert.equal(configured.status, 200, JSON.stringify(configured.body));
  const catalog = await f.request('/api/connections/applications');
  assert.equal(catalog.body.applications.length, 3);
  assert.equal(catalog.body.redirectUri, 'http://localhost:5173/api/connections/oauth/callback');
  assert.deepEqual(
    catalog.body.applications.find((item) => item.id === 'meta').services.map((item) => item.id),
    ['instagram', 'facebook', 'meta_ads'],
  );
  assert.ok(!JSON.stringify(catalog.body).includes('SUPER_SECRET_APP'));
  const created = await f.request('/api/users', {
    method: 'POST',
    body: {
      name: 'Second manager',
      email: 'second-manager@example.test',
      role: 'manager',
      password: 'Test-only-manager-password-123',
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(
    (
      await f.request('/api/auth/login', {
        method: 'POST',
        body: { email: 'second-manager@example.test', password: 'Test-only-manager-password-123' },
      })
    ).status,
    200,
  );
  const normal = await f.request('/api/connections');
  assert.equal(normal.body.applicationAdministration.isOwner, false);
  assert.ok(normal.body.providers.every((item) => !item.canConfigure));
  assert.ok(
    normal.body.providers
      .filter((item) => item.credentialGroup === 'meta')
      .every((item) => item.configured),
  );
  assert.equal((await f.request('/api/connections/applications')).status, 403);
  for (const path of ['/api/connections/applications/meta', '/api/connections/providers/instagram'])
    assert.equal(
      (
        await f.request(path, {
          method: 'PUT',
          body: { clientSecret: 'Replacement-secret-denied' },
        })
      ).status,
      403,
    );
  assert.equal(
    (
      await f.request('/api/connections/authorize', {
        method: 'POST',
        body: { provider: 'facebook', institution: 'St. Mary’s ISC' },
      })
    ).status,
    200,
  );
  await f.db.prepare('UPDATE users SET active=0 WHERE id=?').run(owner.id);
  assert.equal(
    (await f.request('/api/connections/applications')).status,
    403,
    'An inactive owner must not silently promote another manager.',
  );
});

test('new authorizations share one exact callback and legacy pending callbacks remain valid', async (t) => {
  const f = await fixture(t);
  await f.request('/api/connections/applications/google', {
    method: 'PUT',
    body: { clientId: 'APP_ID', clientSecret: 'SUPER_SECRET_APP' },
  });
  const exchanged = [];
  f.fake.authorize = (id, _credentials, uri, state) =>
    `https://accounts.example/${id}?state=${state}&redirect_uri=${encodeURIComponent(uri)}`;
  f.fake.exchange = async (id, _credentials, uri) => {
    exchanged.push({ id, uri });
    return { accessToken: 'SECRET_ACCESS', refreshToken: 'SECRET_REFRESH' };
  };
  const fresh = await f.request('/api/connections/authorize', {
    method: 'POST',
    body: { provider: 'youtube', institution: 'St. Mary’s ISC' },
  });
  const url = new URL(fresh.body.url),
    state = url.searchParams.get('state');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'http://localhost:5173/api/connections/oauth/callback',
  );
  const wrongRoute = await f.request(
    `/api/connections/oauth/youtube/callback?state=${state}&code=code`,
  );
  assert.match(wrongRoute.headers.get('location'), /oauth_callback_mismatch/);
  assert.equal(
    (await f.db.prepare('SELECT COUNT(*) AS count FROM oauth_authorizations').get()).count,
    1,
    'Wrong callback must not consume the valid state.',
  );
  const complete = await f.request(
    `/api/connections/oauth/callback?state=${state}&code=code&provider=instagram`,
  );
  assert.match(complete.headers.get('location'), /connected=/);
  assert.deepEqual(exchanged[0], {
    id: 'youtube',
    uri: 'http://localhost:5173/api/connections/oauth/callback',
  });
  const legacy = await f.request('/api/connections/authorize', {
    method: 'POST',
    body: { provider: 'search_console', institution: 'St. Mary’s ISC' },
  });
  const oldState = new URL(legacy.body.url).searchParams.get('state');
  const vault = createVault(Buffer.alloc(32, 7));
  const pending = await f.db
    .prepare('SELECT * FROM oauth_authorizations WHERE state_hash=?')
    .get(hash(oldState));
  const saved = vault.open(pending.encrypted_verifier, `oauth:${pending.state_hash}`);
  delete saved.redirectUri;
  await f.db
    .prepare('UPDATE oauth_authorizations SET encrypted_verifier=? WHERE state_hash=?')
    .run(vault.seal(saved, `oauth:${pending.state_hash}`), pending.state_hash);
  const oldComplete = await f.request(
    `/api/connections/oauth/search_console/callback?state=${oldState}&code=code`,
  );
  assert.match(oldComplete.headers.get('location'), /connected=/);
  assert.deepEqual(exchanged[1], {
    id: 'search_console',
    uri: 'http://localhost:5173/api/connections/oauth/search_console/callback',
  });
});

test('one authorization selects multiple Pages with isolated credentials, reports, and stable renewed identities', async (t) => {
  const f = await fixture(t);
  const resources = [
    {
      id: '100',
      name: 'School Page A',
      kind: 'facebook',
      pageId: '100',
      pageAccessToken: 'SECRET_PAGE_A',
    },
    {
      id: '200',
      name: 'School Page B',
      kind: 'facebook',
      pageId: '200',
      pageAccessToken: 'SECRET_PAGE_B',
    },
  ];
  f.fake.discover = async (_provider, current) => {
    assert.equal(current.pageAccessToken, undefined);
    return resources;
  };
  f.fake.platformReport = async (_provider, accountId, current) => {
    assert.equal(current.pageAccessToken, accountId === '100' ? 'SECRET_PAGE_A' : 'SECRET_PAGE_B');
    return {
      summary: [{ key: 'reach', label: 'Reach', value: Number(accountId), unit: 'count' }],
      tables: [],
      notes: [],
    };
  };
  const original = await f.connect('facebook');
  const selected = await f.request(`/api/connections/${original.id}/select-many`, {
    method: 'POST',
    body: { accountIds: ['100', '200'] },
  });
  assert.equal(selected.status, 200, JSON.stringify(selected.body));
  const [first, second] = selected.body.connections;
  assert.equal(first.id, original.id);
  assert.notEqual(first.id, second.id);
  for (const connection of [first, second]) {
    const synced = await f.request(`/api/connections/${connection.id}/sync`, {
      method: 'POST',
      body: {},
    });
    assert.equal(synced.status, 200, JSON.stringify(synced.body));
    assert.equal(synced.body.summary[0].value, Number(connection.accountId));
    assert.equal(synced.body.connectionId, connection.id);
    assert.ok(!JSON.stringify(synced.body).includes('SECRET'));
  }
  const pending = await pendingConnection(f, 'facebook');
  const renewed = await f.request(`/api/connections/${pending.id}/select-many`, {
    method: 'POST',
    body: { accountIds: ['100', '200'] },
  });
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
  assert.deepEqual(
    renewed.body.connections.map((item) => item.id),
    [first.id, second.id],
  );
  assert.equal(
    (await f.db.prepare('SELECT status FROM service_connections WHERE id=?').get(pending.id))
      .status,
    'disconnected',
  );
  assert.equal((await f.request('/api/bootstrap')).body.platformAnalytics.length, 2);
  assert.equal(
    (await f.request(`/api/connections/${second.id}`, { method: 'DELETE' })).status,
    200,
  );
  const after = (await f.request('/api/bootstrap')).body;
  assert.equal(after.platformAnalytics.length, 1);
  assert.equal(after.platformAnalytics[0].connectionId, first.id);
  assert.ok(after.connections.some((item) => item.id === first.id && item.status === 'connected'));
});

test('multiple account selection is atomic across school conflicts and stale discovery', async (t) => {
  const f = await fixture(t);
  let resources = [
    { id: 'properties/1', name: 'School website', kind: 'ga4' },
    { id: 'properties/2', name: 'New website', kind: 'ga4' },
  ];
  f.fake.discover = async () => resources;
  const first = await f.connect('google');
  const original = await f.db
    .prepare('SELECT encrypted_credentials FROM service_connections WHERE id=?')
    .get(first.id);
  const pending = await pendingConnection(f, 'google', 'St. Mary’s ICSE');
  const conflict = await f.request(`/api/connections/${pending.id}/select-many`, {
    method: 'POST',
    body: { accountIds: ['properties/2', 'properties/1'] },
  });
  assert.equal(conflict.status, 409, JSON.stringify(conflict.body));
  assert.equal(conflict.body.code, 'account_already_connected');
  assert.equal(
    (
      await f.db
        .prepare(
          "SELECT COUNT(*) AS count FROM service_connections WHERE account_id='properties/2'",
        )
        .get()
    ).count,
    0,
  );
  assert.equal(
    (
      await f.db
        .prepare('SELECT encrypted_credentials FROM service_connections WHERE id=?')
        .get(first.id)
    ).encrypted_credentials,
    original.encrypted_credentials,
  );
  const choices = (await f.request(`/api/connections/${pending.id}/accounts`)).body.accounts;
  assert.equal(
    choices.find((item) => item.id === 'properties/1').connectedInstitution,
    'St. Mary’s ISC',
  );
  resources = [resources[0]];
  const stale = await f.request(`/api/connections/${pending.id}/select-many`, {
    method: 'POST',
    body: { accountIds: ['properties/2'] },
  });
  assert.equal(stale.status, 422);
  assert.equal(stale.body.code, 'invalid_account');
  assert.equal(
    (await f.db.prepare('SELECT status FROM service_connections WHERE id=?').get(pending.id))
      .status,
    'awaiting_selection',
  );
  assert.equal(
    (
      await f.request(`/api/connections/${first.id}/select`, {
        method: 'POST',
        body: { accountId: 'properties/2' },
      })
    ).body.code,
    'account_immutable',
  );
});

test('account selection rejects authorization changed during discovery before persisting any resource', async (t) => {
  const f = await fixture(t);
  await f.request('/api/connections/applications/google', {
    method: 'PUT',
    body: { clientId: 'APP_ID', clientSecret: 'SUPER_SECRET_APP' },
  });
  const pending = await pendingConnection(f, 'google');
  const vault = createVault(Buffer.alloc(32, 7));
  f.fake.discover = async () => {
    await f.db
      .prepare('UPDATE service_connections SET encrypted_credentials=? WHERE id=?')
      .run(
        vault.seal({ accessToken: 'OTHER_AUTHORIZATION' }, `connection:${pending.id}`),
        pending.id,
      );
    return [{ id: 'properties/1', name: 'Website', kind: 'ga4' }];
  };
  const result = await f.request(`/api/connections/${pending.id}/select-many`, {
    method: 'POST',
    body: { accountIds: ['properties/1'] },
  });
  assert.equal(result.status, 409, JSON.stringify(result.body));
  assert.equal(result.body.code, 'connection_changed');
  assert.equal(
    (await f.db.prepare('SELECT account_id FROM service_connections WHERE id=?').get(pending.id))
      .account_id,
    null,
  );
});

test('internal Search Console access pins provider, school, property, capability and connection health', async (t) => {
  const f = await fixture(t);
  f.fake.discover = async () => [
    { id: 'sc-domain:school.example', name: 'School search', kind: 'search_console' },
  ];
  const connection = await f.connect('search_console');
  const expected = { accountId: connection.accountId, institution: connection.institution };
  let calls = 0;
  const callback = (row, current, app) => {
    calls++;
    assert.equal(row.account_id, expected.accountId);
    assert.equal(current.accessToken, 'SECRET_ACCESS');
    assert.equal(app.clientId, 'APP_ID');
    return { count: 1 };
  };
  assert.deepEqual(await f.extensions.withSearchConsole(connection.id, expected, callback), {
    count: 1,
  });
  for (const mismatch of [
    { ...expected, institution: 'Other school' },
    { ...expected, accountId: 'sc-domain:other.example' },
    undefined,
  ])
    await assert.rejects(() => f.extensions.withSearchConsole(connection.id, mismatch, callback), {
      code: 'search_connection_mismatch',
    });
  await f.db
    .prepare("UPDATE service_connections SET status='needs_attention' WHERE id=?")
    .run(connection.id);
  await assert.rejects(() => f.extensions.withSearchConsole(connection.id, expected, callback), {
    code: 'search_connection_mismatch',
  });
  await f.db
    .prepare("UPDATE service_connections SET status='connected', capabilities='[]' WHERE id=?")
    .run(connection.id);
  await assert.rejects(() => f.extensions.withSearchConsole(connection.id, expected, callback), {
    code: 'search_connection_mismatch',
  });
  assert.equal(calls, 1);
});

test('shared developer credentials configure sibling services and partial updates do not expose secrets', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.request('/api/connections/providers/google', {
        method: 'PUT',
        body: { clientId: 'APP_ID', clientSecret: 'SUPER_SECRET_APP' },
      })
    ).status,
    200,
  );
  const partial = await f.request('/api/connections/providers/google_ads', {
    method: 'PUT',
    body: { loginCustomerId: '1234567890' },
  });
  assert.equal(partial.status, 200, JSON.stringify(partial.body));
  const bootstrap = (await f.request('/api/bootstrap')).body;
  assert.ok(
    bootstrap.providerSetup
      .filter((item) => item.credentialGroup === 'google')
      .every((item) => item.configured),
  );
  assert.ok(!JSON.stringify(bootstrap).includes('SUPER_SECRET_APP'));
  assert.ok(!JSON.stringify(bootstrap).includes('1234567890'));
  assert.equal(
    (await f.db.prepare('SELECT COUNT(*) AS count FROM provider_settings').get()).count,
    1,
  );
});

test('a text-only Facebook post passes the same manager approval and durable queue as image posts', async (t) => {
  const f = await fixture(t);
  f.fake.discover = async () => [
    {
      id: '321',
      name: 'School Facebook',
      kind: 'facebook',
      pageId: '321',
      pageAccessToken: 'SECRET_PAGE',
    },
  ];
  const sent = [];
  f.fake.publishDirect = async (service, accountId, _current, _credentials, post, media) => {
    sent.push({ service, accountId, caption: post.caption, mediaCount: media.length });
    return { id: '321_999', url: 'https://www.facebook.com/321_999' };
  };
  const connection = await f.connect('facebook');
  const post = await f.approved(connection, { id: null }, { platforms: ['facebook'] });
  assert.equal(sent.length, 0);
  const job = (await f.request('/api/jobs/run', { method: 'POST' })).body.jobs[0];
  assert.equal(job.status, 'published');
  assert.equal(job.platform, 'facebook');
  assert.equal(job.remoteUrl, 'https://www.facebook.com/321_999');
  assert.deepEqual(sent, [
    { service: 'facebook', accountId: '321', caption: 'Approved caption', mediaCount: 0 },
  ]);
  assert.equal(
    (await f.db.prepare('SELECT asset_id FROM publication_jobs WHERE post_id = ?').get(post.id))
      .asset_id,
    null,
  );
});

test('carousel approval binds every asset and its order and worker rejects a changed order', async (t) => {
  const f = await fixture(t);
  const connection = await f.connect('instagram');
  const first = await f.asset();
  const second = await f.asset();
  const post = await f.approved(connection, first, {
    format: 'Carousel',
    assetIds: [first.id, second.id],
  });
  const job = await f.db.prepare('SELECT * FROM publication_jobs WHERE post_id = ?').get(post.id);
  assert.deepEqual(
    JSON.parse(job.approved_payload).assets.map((asset) => asset.id),
    [first.id, second.id],
  );
  await f.db
    .prepare('UPDATE posts SET asset_ids = ?, asset_id = ? WHERE id = ?')
    .run(JSON.stringify([second.id, first.id]), second.id, post.id);
  await f.request('/api/jobs/run', { method: 'POST' });
  assert.equal(f.calls.published, 0);
  assert.equal(
    (await f.db.prepare('SELECT status FROM publication_jobs WHERE id = ?').get(job.id)).status,
    'cancelled',
  );
});

test('generic platform imports persist their attribution and CSV protects spreadsheet cells', async (t) => {
  const f = await fixture(t);
  f.fake.discover = async () => [
    {
      id: 'act_123',
      name: '=unsafe-account-name',
      kind: 'meta_ads',
      credentials: { currency: 'INR' },
    },
  ];
  f.fake.platformReport = async () => ({
    currency: 'INR',
    summary: [{ key: 'spend', label: 'Spend', value: 12.5, unit: 'currency' }],
    tables: [
      {
        key: 'campaigns',
        label: 'Campaigns',
        columns: [{ key: 'name', label: 'Name', type: 'text' }],
        rows: [{ name: '=HYPERLINK("https://example.invalid")' }],
      },
    ],
    notes: ['Account attribution, not verified admissions.'],
  });
  const connection = await f.connect('meta_ads');
  const synced = await f.request(`/api/connections/${connection.id}/sync`, {
    method: 'POST',
    body: { startDate: '2026-10-01', endDate: '2026-10-30' },
  });
  assert.equal(synced.status, 200, JSON.stringify(synced.body));
  assert.equal(synced.body.currency, 'INR');
  const csv = await f.request(`/api/connections/${connection.id}/report.csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.ok(csv.body.includes("'=unsafe-account-name"));
  assert.ok(csv.body.includes("'=HYPERLINK"));
  const saved = (await f.request('/api/bootstrap')).body.platformAnalytics[0];
  assert.equal(saved.provider, 'meta_ads');
  assert.equal(saved.accountName, '=unsafe-account-name');
  assert.equal(saved.startDate, '2026-10-01');
  assert.equal(
    (await f.request(`/api/connections/${connection.id}`, { method: 'DELETE' })).status,
    200,
  );
  assert.equal((await f.request('/api/bootstrap')).body.platformAnalytics.length, 0);
});

test('OAuth state is session-bound, single use, encrypted, and secrets never enter public records', async (t) => {
  const f = await fixture(t);
  const connection = await f.connect('google');
  const replay = await f.request(
    `/api/connections/oauth/google/callback?state=${connection.state}&code=replay`,
  );
  assert.match(replay.headers.get('location'), /oauth_state_invalid/);
  const row = await f.db
    .prepare('SELECT encrypted_credentials FROM service_connections WHERE id = ?')
    .get(connection.id);
  assert.ok(!row.encrypted_credentials.includes('SECRET'));
  const bootstrap = await f.request('/api/bootstrap');
  assert.ok(!JSON.stringify(bootstrap.body).includes('SECRET'));
  assert.equal(bootstrap.body.websiteAnalytics.length, 0);
  const synced = await f.request(`/api/connections/${connection.id}/sync`, {
    method: 'POST',
    body: {},
  });
  assert.equal(synced.status, 200, JSON.stringify(synced.body));
  assert.equal(synced.body.totals.users, 8);
  assert.equal((await f.request('/api/bootstrap')).body.websiteAnalytics.length, 1);
  assert.equal((await f.request('/api/bootstrap')).body.analytics.sample, true);
  assert.equal(
    (await f.request(`/api/connections/${connection.id}`, { method: 'DELETE' })).status,
    200,
  );
  assert.equal(
    (
      await f.db
        .prepare('SELECT encrypted_credentials FROM service_connections WHERE id = ?')
        .get(connection.id)
    ).encrypted_credentials,
    null,
  );
  assert.equal((await f.request('/api/bootstrap')).body.websiteAnalytics.length, 0);
});

test('missing encryption key disables setup honestly while media and local workflow remain usable', async (t) => {
  const f = await fixture(t, { encryptionKey: '' });
  const bootstrap = await f.request('/api/bootstrap');
  assert.ok(bootstrap.body.providerSetup.every((item) => !item.configured && !item.canConfigure));
  assert.equal(
    (
      await f.request('/api/connections/providers/google', {
        method: 'PUT',
        body: { clientId: 'app', clientSecret: 'secret-123' },
      })
    ).status,
    503,
  );
  await f.asset();
});

test('media and connection endpoints require session, CSRF and manager permission', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/media', { authenticated: false })).status, 401);
  assert.equal(
    (
      await f.request('/api/connections/authorize', {
        method: 'POST',
        body: { provider: 'google', institution: 'School' },
        noCsrf: true,
      })
    ).status,
    403,
  );
  const image = await f.asset();
  assert.equal(
    (await f.request('/api/auth/demo-role', { method: 'POST', body: { role: 'contributor' } }))
      .status,
    200,
  );
  assert.equal(
    (
      await f.request('/api/connections/providers/google', {
        method: 'PUT',
        body: { clientId: 'app', clientSecret: 'secret123' },
      })
    ).status,
    403,
  );
  assert.equal((await f.request(image.url)).status, 403);
  assert.equal((await f.request('/api/jobs/run', { method: 'POST' })).status, 403);
  assert.equal((await f.request('/api/jobs/run', { authenticated: false })).status, 401);
});

test('approved revision queues once and only records published after provider confirmation', async (t) => {
  const f = await fixture(t);
  const connection = await f.connect();
  const image = await f.asset();
  const post = await f.approved(connection, image);
  const before = (await f.request('/api/bootstrap')).body;
  assert.equal(before.publicationJobs.length, 1);
  assert.equal(before.publicationJobs[0].status, 'queued');
  assert.equal(f.calls.published, 0);
  const repeat = await f.request(`/api/posts/${post.id}/publications`, {
    method: 'POST',
    body: { revision: post.revision },
  });
  assert.equal(repeat.body.jobs.length, 1);
  const result = await f.request('/api/jobs/run', { method: 'POST' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.jobs[0].status, 'published', JSON.stringify(result.body));
  assert.equal(result.body.jobs[0].remoteId, '300');
  assert.equal(f.calls.published, 1);
  assert.equal((await f.request(`/api/posts/${post.id}`)).body.status, 'published');
  assert.equal((await f.request('/api/jobs/run', { method: 'POST' })).body.processed, 0);
  assert.equal(f.calls.published, 1);
});

test('editing approved content invalidates approval and cancels durable queue without sending', async (t) => {
  const f = await fixture(t);
  const post = await f.approved(await f.connect(), await f.asset());
  const edited = await f.request(`/api/posts/${post.id}`, {
    method: 'PATCH',
    body: { revision: 1, caption: 'Changed content' },
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.approvedRevision, null);
  const data = (await f.request('/api/bootstrap')).body;
  assert.equal(data.publicationJobs[0].status, 'cancelled');
  assert.equal((await f.request('/api/jobs/run', { method: 'POST' })).body.processed, 0);
  assert.equal(f.calls.published, 0);
});

test('a partially published multi-account post cannot be edited into a second send', async (t) => {
  const f = await fixture(t);
  const first = await f.connect();
  f.fake.discover = async () => [
    {
      id: '102',
      name: '@second_school',
      kind: 'instagram',
      platform: 'instagram',
      pageId: '103',
      pageAccessToken: 'SECOND_PAGE_TOKEN',
    },
  ];
  const second = await f.connect();
  const post = await f.approved(first, await f.asset(), { destinationIds: [first.id, second.id] });
  const sent = await f.request('/api/jobs/run', { method: 'POST' });
  assert.equal(sent.body.jobs[0].status, 'published');
  const current = (await f.request(`/api/posts/${post.id}`)).body;
  assert.equal(current.status, 'approved', 'The remaining destination is still queued.');
  const edit = await f.request(`/api/posts/${post.id}`, {
    method: 'PATCH',
    body: { revision: 1, caption: 'Would cause a second publication' },
  });
  assert.equal(edit.status, 409);
  assert.equal(edit.body.code, 'publication_already_sent');
  assert.equal(f.calls.published, 1);
  const rest = await f.request('/api/jobs/run', { method: 'POST' });
  assert.equal(rest.body.jobs[0].status, 'published');
  assert.equal(f.calls.published, 2);
  assert.equal((await f.request(`/api/posts/${post.id}`)).body.status, 'published');
});

test('publish timeout parks for reconciliation and blocks retries, cancellation, edits and disconnect', async (t) => {
  const f = await fixture(t);
  const connection = await f.connect();
  const post = await f.approved(connection, await f.asset());
  f.failPublish(
    new ProviderError('Connection timed out.', 'provider_unreachable', { ambiguous: true }),
  );
  const run = await f.request('/api/jobs/run', { method: 'POST' });
  const job = run.body.jobs[0];
  assert.equal(job.status, 'needs_reconciliation');
  assert.equal(
    (await f.request(`/api/publications/${job.id}/retry`, { method: 'POST' })).status,
    409,
  );
  assert.equal(
    (await f.request(`/api/publications/${job.id}/cancel`, { method: 'POST' })).status,
    409,
  );
  assert.equal(
    (
      await f.request(`/api/posts/${post.id}`, {
        method: 'PATCH',
        body: { revision: 1, caption: 'Unsafe edit' },
      })
    ).status,
    409,
  );
  assert.equal(
    (await f.request(`/api/connections/${connection.id}`, { method: 'DELETE' })).status,
    409,
  );
  assert.equal((await f.request('/api/jobs/run', { method: 'POST' })).body.processed, 0);
  assert.equal(f.calls.published, 1);
  const reconciled = await f.request(`/api/publications/${job.id}/reconcile`, {
    method: 'POST',
    body: { remoteId: '300' },
  });
  assert.equal(reconciled.status, 200, JSON.stringify(reconciled.body));
  assert.equal(reconciled.body.status, 'published');
  assert.equal(f.calls.published, 1);
});

test('future schedule waits, processing container reuses its durable ID, and worker claims are exclusive', async (t) => {
  const f = await fixture(t);
  await f.approved(await f.connect(), await f.asset(), { scheduledAt: '2026-11-04T11:00:00.000Z' });
  assert.equal((await f.request('/api/jobs/run', { method: 'POST' })).body.processed, 0);
  f.setTime('2026-11-04T11:01:00Z');
  f.containerState('IN_PROGRESS');
  const waiting = await f.request('/api/jobs/run', { method: 'POST' });
  assert.equal(waiting.body.jobs[0].status, 'queued');
  assert.equal(f.calls.containers, 1);
  f.containerState('FINISHED');
  f.setTime('2026-11-04T11:03:00Z');
  const results = await Promise.all([
    f.request('/api/jobs/run', { method: 'POST' }),
    f.request('/api/jobs/run', { method: 'POST' }),
  ]);
  assert.equal(
    results.reduce((sum, result) => sum + result.body.processed, 0),
    1,
  );
  assert.equal(f.calls.containers, 1);
  assert.equal(f.calls.published, 1);
});

test('a manager rescheduling between due lookup and claim prevents an early send', async (t) => {
  const f = await fixture(t);
  const post = await f.approved(await f.connect(), await f.asset());
  const originalPrepare = f.db.prepare.bind(f.db);
  let rescheduled = false;
  f.db.prepare = (sql) => {
    const statement = originalPrepare(sql);
    if (!sql.includes("SELECT * FROM publication_jobs WHERE status = 'queued' AND scheduled_at <="))
      return statement;
    return {
      ...statement,
      get: async (...parameters) => {
        const selected = await statement.get(...parameters);
        if (selected && !rescheduled) {
          rescheduled = true;
          const response = await f.request(`/api/posts/${post.id}/transition`, {
            method: 'POST',
            body: { action: 'schedule', revision: 1, scheduledAt: '2026-11-05T10:00:00.000Z' },
          });
          assert.equal(response.status, 200, JSON.stringify(response.body));
        }
        return selected;
      },
    };
  };
  try {
    const run = await f.request('/api/jobs/run', { method: 'POST' });
    assert.equal(run.status, 200, JSON.stringify(run.body));
    assert.equal(run.body.processed, 0);
    assert.equal(f.calls.published, 0);
    assert.equal(
      (
        await f.db
          .prepare('SELECT scheduled_at FROM publication_jobs WHERE post_id = ?')
          .get(post.id)
      ).scheduled_at,
      '2026-11-05T10:00:00.000Z',
    );
  } finally {
    f.db.prepare = originalPrepare;
  }
});

test('crashed publication after the send marker requires reconciliation, including secret-authenticated cron', async (t) => {
  const f = await fixture(t);
  const post = await f.approved(await f.connect(), await f.asset());
  const job = await f.db.prepare('SELECT * FROM publication_jobs WHERE post_id = ?').get(post.id);
  await f.db
    .prepare(
      "UPDATE publication_jobs SET status = 'processing', lease_id = 'expired-worker', lease_expires_at = '2026-11-04T09:00:00.000Z', publish_started_at = '2026-11-04T09:00:00.000Z', container_id = '200' WHERE id = ?",
    )
    .run(job.id);
  const run = await f.request('/api/jobs/run', {
    authenticated: false,
    headers: { Authorization: 'Bearer test-cron-secret' },
  });
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(run.body.processed, 0);
  assert.equal(
    (await f.db.prepare('SELECT status FROM publication_jobs WHERE id = ?').get(job.id)).status,
    'needs_reconciliation',
  );
  assert.equal(
    (await f.request(`/api/publications/${job.id}/retry`, { method: 'POST' })).status,
    409,
  );
  assert.equal(f.calls.published, 0);
});

test('a changed account or image cannot reuse an earlier approval even through a worker credential', async (t) => {
  const f = await fixture(t);
  const connection = await f.connect();
  const post = await f.approved(connection, await f.asset());
  await f.db
    .prepare("UPDATE service_connections SET account_id = '999' WHERE id = ?")
    .run(connection.id);
  const run = await f.request('/api/jobs/run', {
    authenticated: false,
    headers: { Authorization: 'Bearer test-cron-secret' },
  });
  assert.equal(run.status, 200);
  assert.equal(run.body.processed, 0);
  assert.equal(
    (await f.db.prepare('SELECT status FROM publication_jobs WHERE post_id = ?').get(post.id))
      .status,
    'cancelled',
  );
  assert.equal(f.calls.published, 0);
});

test('reauthorizing the same account restores reconciliation access without allowing a duplicate send', async (t) => {
  const f = await fixture(t);
  const connection = await f.connect();
  const post = await f.approved(connection, await f.asset());
  f.failPublish(new ProviderError('Publish timeout.', 'provider_unreachable', { ambiguous: true }));
  await f.request('/api/jobs/run', { method: 'POST' });
  await f.db
    .prepare(
      "UPDATE service_connections SET status = 'needs_attention', error = 'Reconnect to reconcile.' WHERE id = ?",
    )
    .run(connection.id);
  const renewed = await f.connect();
  assert.equal(renewed.id, connection.id);
  assert.equal((await f.request('/api/bootstrap')).body.connections.length, 1);
  const job = await f.db.prepare('SELECT * FROM publication_jobs WHERE post_id = ?').get(post.id);
  assert.equal(
    (await f.request(`/api/publications/${job.id}/retry`, { method: 'POST' })).status,
    409,
  );
  assert.equal(
    (
      await f.request(`/api/publications/${job.id}/reconcile`, {
        method: 'POST',
        body: { remoteId: '300' },
      })
    ).status,
    200,
  );
  assert.equal(f.calls.published, 1);
});

test('a disabled deployment can review and queue but cannot send via manager or cron', async (t) => {
  const f = await fixture(t, { publishingEnabled: false });
  await f.approved(await f.connect(), await f.asset());
  assert.equal(
    (await f.request('/api/jobs/run', { method: 'POST' })).body.code,
    'publishing_disabled',
  );
  assert.equal(
    (
      await f.request('/api/jobs/run', {
        authenticated: false,
        headers: { Authorization: 'Bearer test-cron-secret' },
      })
    ).body.code,
    'publishing_disabled',
  );
  assert.equal(f.calls.published, 0);
});

test('contributors can preview shared images and retain a manager-attached image without selecting private images', async (t) => {
  const f = await fixture(t);
  const attached = await f.asset();
  const privateImage = await f.asset();
  const sharedImage = await f.asset();
  const input = {
    title: 'Team draft',
    caption: 'Team caption',
    platforms: ['instagram'],
    format: 'Post',
    institution: 'St. Mary’s ISC',
    scheduledAt: null,
    language: 'English',
    palette: 'violet',
  };
  const shared = await f.request('/api/posts', {
    method: 'POST',
    body: { ...input, assetId: sharedImage.id },
  });
  assert.equal(shared.status, 201);
  assert.equal(
    (
      await f.request(`/api/posts/${shared.body.id}/transition`, {
        method: 'POST',
        body: { action: 'submit', revision: 1 },
      })
    ).status,
    200,
  );
  await f.request('/api/auth/demo-role', { method: 'POST', body: { role: 'contributor' } });
  const authored = await f.request('/api/posts', { method: 'POST', body: input });
  assert.equal(authored.status, 201);
  await f.request('/api/auth/demo-role', { method: 'POST', body: { role: 'manager' } });
  const attachedPost = await f.request(`/api/posts/${authored.body.id}`, {
    method: 'PATCH',
    body: { revision: 1, assetId: attached.id },
  });
  assert.equal(attachedPost.status, 200);
  await f.request(`/api/posts/${authored.body.id}/transition`, {
    method: 'POST',
    body: { action: 'submit', revision: 2 },
  });
  assert.equal(
    (
      await f.request(`/api/posts/${authored.body.id}/transition`, {
        method: 'POST',
        body: { action: 'request_changes', revision: 2, feedback: 'Please update the caption.' },
      })
    ).status,
    200,
  );
  await f.request('/api/auth/demo-role', { method: 'POST', body: { role: 'contributor' } });
  const visible = (await f.request('/api/bootstrap')).body.mediaAssets.map((asset) => asset.id);
  assert.ok(
    visible.includes(attached.id),
    'Manager-attached image is visible on the author’s draft.',
  );
  assert.ok(
    visible.includes(sharedImage.id),
    'Submitted shared post includes metadata for its preview.',
  );
  assert.ok(!visible.includes(privateImage.id), 'Unattached private media is not exposed.');
  assert.equal((await f.request(attached.url)).status, 200);
  assert.equal((await f.request(sharedImage.url)).status, 200);
  assert.equal((await f.request(privateImage.url)).status, 403);
  const retained = await f.request(`/api/posts/${authored.body.id}`, {
    method: 'PATCH',
    body: { revision: 2, caption: 'Updated team caption', assetId: attached.id },
  });
  assert.equal(retained.status, 200, JSON.stringify(retained.body));
  assert.equal(retained.body.assetId, attached.id);
  assert.equal(
    (
      await f.request(`/api/posts/${authored.body.id}`, {
        method: 'PATCH',
        body: { revision: 3, assetId: privateImage.id },
      })
    ).status,
    422,
  );
});

test('automatic report imports are opt-in, manager-controlled and restricted to reporting accounts', async (t) => {
  const f = await fixture(t);
  const connection = await f.connect('google');
  assert.equal(connection.autoSync, false);
  assert.equal(connection.syncIntervalHours, 24);
  assert.equal((await f.extensions.syncDueReports()).processed, 0);
  assert.equal(
    (
      await f.request(`/api/connections/${connection.id}/sync-settings`, {
        method: 'POST',
        body: { autoSync: true, syncIntervalHours: 1 },
      })
    ).status,
    422,
  );
  const enabled = await f.request(`/api/connections/${connection.id}/sync-settings`, {
    method: 'POST',
    body: { autoSync: true },
  });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
  assert.equal(enabled.body.autoSync, true);
  assert.ok(enabled.body.nextSyncAt);
  const rangeCalls = [];
  const original = f.fake.report;
  f.fake.report = async (...args) => {
    rangeCalls.push(args.slice(2));
    return original(...args);
  };
  assert.equal((await f.extensions.syncDueReports()).processed, 1);
  assert.deepEqual(rangeCalls[0], ['2026-10-06', '2026-11-02']);
  assert.equal((await f.extensions.syncDueReports()).processed, 0);
  const after = (await f.request('/api/connections')).body.connections.find(
    (item) => item.id === connection.id,
  );
  assert.equal(after.nextSyncAt, '2026-11-05T10:00:00.000Z');
  await f.request('/api/auth/demo-role', { method: 'POST', body: { role: 'contributor' } });
  assert.equal(
    (
      await f.request(`/api/connections/${connection.id}/sync-settings`, {
        method: 'POST',
        body: { autoSync: false },
      })
    ).status,
    403,
  );
  await f.request('/api/auth/demo-role', { method: 'POST', body: { role: 'manager' } });
  const disabled = await f.request(`/api/connections/${connection.id}/sync-settings`, {
    method: 'POST',
    body: { autoSync: false },
  });
  assert.equal(disabled.body.autoSync, false);
  assert.equal(disabled.body.nextSyncAt, null);
  await f.db
    .prepare('UPDATE service_connections SET capabilities = \'["publish:text"]\' WHERE id = ?')
    .run(connection.id);
  assert.equal(
    (
      await f.request(`/api/connections/${connection.id}/sync-settings`, {
        method: 'POST',
        body: { autoSync: true },
      })
    ).status,
    422,
  );
});

test('report leases exclude concurrent imports and fence a stale worker after recovery', async (t) => {
  const f = await fixture(t);
  const connection = await f.connect('google');
  await f.request(`/api/connections/${connection.id}/sync-settings`, {
    method: 'POST',
    body: { autoSync: true },
  });
  let release;
  let entered;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  let calls = 0;
  f.fake.report = async () => {
    const call = ++calls;
    if (call === 1) {
      entered();
      await waiting;
    }
    return {
      totals: { users: call === 1 ? 8 : 99, sessions: 10, views: 12, keyEvents: 2 },
      daily: [],
      pages: [],
      sources: [],
    };
  };
  const first = f.extensions.syncDueReports();
  await started;
  assert.equal((await f.extensions.syncDueReports()).processed, 0);
  assert.equal(
    (await f.request(`/api/connections/${connection.id}/sync`, { method: 'POST', body: {} })).body
      .code,
    'report_import_running',
  );
  f.setTime('2026-11-04T10:06:00Z');
  assert.equal((await f.extensions.syncDueReports()).results[0].status, 'imported');
  release();
  assert.equal((await first).results[0].status, 'failed');
  const saved = await f.db
    .prepare('SELECT report_json FROM website_reports WHERE connection_id = ?')
    .get(connection.id);
  assert.equal(JSON.parse(saved.report_json).totals.users, 99);
  assert.equal(calls, 2);
});

test('failed scheduled reports release their lease and do not fabricate imported data', async (t) => {
  const f = await fixture(t);
  const connection = await f.connect('google');
  await f.request(`/api/connections/${connection.id}/sync-settings`, {
    method: 'POST',
    body: { autoSync: true, syncIntervalHours: 6 },
  });
  f.fake.report = async () => {
    throw new ProviderError('The provider denied permission.', 'permission_denied');
  };
  const result = await f.extensions.syncDueReports();
  assert.equal(result.results[0].status, 'failed');
  const row = await f.db
    .prepare('SELECT * FROM service_connections WHERE id = ?')
    .get(connection.id);
  assert.equal(row.sync_lease_id, null);
  assert.equal(row.status, 'needs_attention');
  assert.equal(row.next_sync_at, '2026-11-04T16:00:00.000Z');
  assert.equal(
    await f.db
      .prepare('SELECT report_json FROM website_reports WHERE connection_id = ?')
      .get(connection.id),
    undefined,
  );
  assert.equal((await f.extensions.syncDueReports()).processed, 0);
});

test('a transient reporting outage retries at the configured interval without requiring reauthorization', async (t) => {
  const f = await fixture(t);
  const connection = await f.connect('google');
  await f.request(`/api/connections/${connection.id}/sync-settings`, {
    method: 'POST',
    body: { autoSync: true, syncIntervalHours: 6 },
  });
  const original = f.fake.report;
  f.fake.report = async () => {
    throw new ProviderError('The provider rate limit was reached.', 'provider_rate_limited');
  };
  assert.equal((await f.extensions.syncDueReports()).results[0].status, 'failed');
  const failed = await f.db
    .prepare('SELECT * FROM service_connections WHERE id = ?')
    .get(connection.id);
  assert.equal(failed.status, 'connected');
  assert.equal(failed.next_sync_at, '2026-11-04T16:00:00.000Z');
  assert.equal((await f.extensions.syncDueReports()).processed, 0);
  f.fake.report = original;
  f.setTime('2026-11-04T16:01:00Z');
  assert.equal((await f.extensions.syncDueReports()).results[0].status, 'imported');
  assert.equal(
    (await f.db.prepare('SELECT error FROM service_connections WHERE id = ?').get(connection.id))
      .error,
    null,
  );
});

test('the report cron requires its own credential and imports only an explicitly enabled account', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/reports/cron', { authenticated: false })).status, 401);
  assert.equal((await f.request('/api/reports/cron')).status, 401);
  assert.equal(
    (
      await f.request('/api/reports/cron', {
        authenticated: false,
        headers: { Authorization: 'Bearer wrong' },
      })
    ).status,
    401,
  );
  const cron = () =>
    f.request('/api/reports/cron', {
      authenticated: false,
      headers: { Authorization: 'Bearer test-cron-secret' },
    });
  assert.equal((await cron()).body.processed, 0);
  const connection = await f.connect('google');
  assert.equal((await cron()).body.processed, 0);
  await f.request(`/api/connections/${connection.id}/sync-settings`, {
    method: 'POST',
    body: { autoSync: true },
  });
  const result = await cron();
  assert.equal(result.status, 200);
  assert.equal(result.body.results[0].status, 'imported');
  assert.equal(f.calls.published, 0);
});

test('an expired report worker cannot overwrite connection health after a replacement import succeeds', async (t) => {
  const f = await fixture(t);
  const connection = await f.connect('google');
  await f.request(`/api/connections/${connection.id}/sync-settings`, {
    method: 'POST',
    body: { autoSync: true },
  });
  let release;
  let entered;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const original = f.fake.report;
  let calls = 0;
  f.fake.report = async () => {
    if (++calls === 1) {
      entered();
      await waiting;
      throw new ProviderError('Old authorization was revoked.', 'reauthorization_required', {
        reauthenticate: true,
      });
    }
    return original();
  };
  const first = f.extensions.syncDueReports();
  await started;
  f.setTime('2026-11-04T10:06:00Z');
  assert.equal((await f.extensions.syncDueReports()).results[0].status, 'imported');
  release();
  assert.equal((await first).results[0].status, 'failed');
  const row = await f.db
    .prepare('SELECT status, error FROM service_connections WHERE id = ?')
    .get(connection.id);
  assert.deepEqual({ ...row }, { status: 'connected', error: null });
});
