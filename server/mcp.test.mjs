import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createApp } from './app.mjs';
import { postLoginDestination } from '../src/lib/auth-return.ts';

test('a first-time MCP sign-in returns to consent and never accepts an external return URL', () => {
  const request = randomBytes(32).toString('base64url');
  assert.deepEqual(postLoginDestination('#settings?tab=mcp&authorize=' + request), {
    hash: '#settings?tab=mcp&authorize=' + request,
    view: 'settings',
  });
  assert.equal(
    postLoginDestination(
      '#settings?tab=mcp&authorize=' + request + '&next=https://attacker.example',
    ).hash,
    '#settings?tab=mcp&authorize=' + request,
  );
  for (const value of [
    '#overview',
    '#setup?token=old-link',
    '#settings?tab=mcp&authorize=invalid',
    'https://attacker.example/#settings?tab=mcp&authorize=' + request,
  ])
    assert.equal(postLoginDestination(value).hash, '#overview');
});

const ORIGIN = 'https://workspace.example';
const RESOURCE = ORIGIN + '/api/mcp';
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const SCOPES = ['workspace:read', 'workspace:drafts', 'workspace:research'];
async function fixture(t) {
  const app = await createApp({
    demoMode: true,
    databasePath: ':memory:',
    databaseUrl: '',
    serveStatic: false,
    secureCookies: false,
    publicOrigin: ORIGIN,
    extensionOptions: {
      encryptionKey: randomBytes(32),
      appOrigin: ORIGIN,
      storage: { configured: false },
    },
  });
  const server = await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await app.locals.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  async function raw(path, { method = 'GET', body, form, headers = {}, ...options } = {}) {
    const response = await fetch(url + path, {
      method,
      redirect: 'manual',
      ...options,
      headers: {
        ...(form
          ? { 'content-type': 'application/x-www-form-urlencoded' }
          : body !== undefined
            ? { 'content-type': 'application/json' }
            : {}),
        ...headers,
      },
      ...(form
        ? { body: new URLSearchParams(form) }
        : body !== undefined
          ? { body: JSON.stringify(body) }
          : {}),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: response.status, headers: response.headers, data };
  }
  function browser() {
    let cookie = '',
      csrf = '';
    return {
      async request(path, options = {}) {
        const result = await raw(path, {
          ...options,
          headers: {
            cookie,
            ...(options.method && options.method !== 'GET' && options.csrf !== false
              ? { 'x-csrf-token': csrf }
              : {}),
            ...options.headers,
          },
        });
        const setCookie = result.headers.getSetCookie()[0];
        if (setCookie) cookie = setCookie.split(';')[0];
        if (result.data.csrfToken) csrf = result.data.csrfToken;
        return result;
      },
    };
  }
  const manager = browser();
  const initial = await manager.request('/api/bootstrap');
  assert.equal(initial.status, 200);
  async function register(overrides = {}) {
    return raw('/api/mcp/oauth/register', {
      method: 'POST',
      body: {
        client_name: 'ChatGPT test',
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        ...overrides,
      },
    });
  }
  async function start(client, scopes = SCOPES) {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: scopes.join(' '),
      resource: RESOURCE,
      state: 'test-csrf-state',
    });
    const response = await raw('/api/mcp/oauth/authorize?' + query);
    assert.equal(response.status, 302, JSON.stringify(response.data));
    const location = new URL(response.headers.get('location'));
    assert.equal(location.origin, ORIGIN);
    const request = new URLSearchParams(location.hash.split('?')[1]).get('authorize');
    return { verifier, request };
  }
  async function approve(client, scopes = SCOPES, user = manager) {
    const started = await start(client, scopes);
    const consent = await user.request('/api/mcp/consent/' + started.request);
    assert.equal(consent.status, 200, JSON.stringify(consent.data));
    const approved = await user.request('/api/mcp/consent/' + started.request, {
      method: 'POST',
      body: { allow: true, scopes },
    });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    const callback = new URL(approved.data.redirectUrl);
    assert.equal(callback.origin, 'https://chatgpt.com');
    assert.equal(callback.searchParams.get('iss'), ORIGIN);
    assert.equal(callback.searchParams.get('state'), 'test-csrf-state');
    return { ...started, code: callback.searchParams.get('code') };
  }
  async function exchange(client, auth, changes = {}) {
    return raw('/api/mcp/oauth/token', {
      method: 'POST',
      form: {
        grant_type: 'authorization_code',
        client_id: client.client_id,
        code: auth.code,
        code_verifier: auth.verifier,
        redirect_uri: REDIRECT,
        resource: RESOURCE,
        ...changes,
      },
    });
  }
  async function connect(scopes = SCOPES) {
    const registered = await register();
    assert.equal(registered.status, 201, JSON.stringify(registered.data));
    const auth = await approve(registered.data, scopes);
    const tokens = await exchange(registered.data, auth);
    assert.equal(tokens.status, 200, JSON.stringify(tokens.data));
    return { client: registered.data, auth, tokens: tokens.data };
  }
  let nextId = 1;
  async function rpc(token, method, params = {}) {
    return raw('/api/mcp', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
      },
      body: { jsonrpc: '2.0', id: nextId++, method, params },
    });
  }
  return {
    app,
    db: app.locals.database,
    raw,
    manager,
    browser,
    register,
    start,
    approve,
    exchange,
    connect,
    rpc,
    userId: initial.data.user.id,
  };
}

test('MCP advertises resource-bound OAuth without exposing anonymous workspace data', async (t) => {
  const f = await fixture(t);
  const resource = await f.raw('/.well-known/oauth-protected-resource/api/mcp');
  assert.equal(resource.status, 200);
  assert.equal(resource.data.resource, RESOURCE);
  const metadata = await f.raw('/.well-known/oauth-authorization-server');
  assert.equal(metadata.data.authorization_response_iss_parameter_supported, true);
  assert.deepEqual(metadata.data.code_challenge_methods_supported, ['S256']);
  const unauthorized = await f.raw('/api/mcp', { method: 'POST', body: {} });
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers.get('www-authenticate'), /resource_metadata=/);
  assert.equal((await f.raw('/api/mcp/settings')).status, 401);
  assert.equal((await f.raw('/api/workspace/storage')).status, 401);
});

test('automatic client registration accepts documented ChatGPT redirects and encrypts secrets', async (t) => {
  const f = await fixture(t);
  for (const redirect of [
    'https://attacker.example/callback',
    'https://chatgpt.com.attacker.example/connector_platform_oauth_redirect',
    'http://chatgpt.com/connector_platform_oauth_redirect',
    REDIRECT + '?next=elsewhere',
  ]) {
    assert.equal((await f.register({ redirect_uris: [redirect] })).status, 400);
  }
  const registered = await f.register({ token_endpoint_auth_method: 'client_secret_post' });
  assert.equal(registered.status, 201, JSON.stringify(registered.data));
  assert.ok(registered.data.client_secret);
  const saved = await f.db
    .prepare('SELECT * FROM mcp_clients WHERE id=?')
    .get(registered.data.client_id);
  assert.ok(saved.encrypted_secret);
  assert.ok(Number(saved.expires_at) - Number(saved.created_at) <= 30 * 60000);
  assert.ok(!JSON.stringify(saved).includes(registered.data.client_secret));
  assert.equal(
    (await f.register({ token_endpoint_auth_method: 'client_secret_basic' })).status,
    400,
  );
});

test('manager consent is explicit, session-bound, CSRF protected and cannot expand requested scopes', async (t) => {
  const f = await fixture(t);
  const client = (await f.register()).data;
  const pending = await f.start(client, ['workspace:read']);
  assert.equal((await f.raw('/api/mcp/consent/' + pending.request)).status, 401);
  assert.equal((await f.manager.request('/api/mcp/consent/' + pending.request)).status, 200);
  const other = f.browser();
  await other.request('/api/bootstrap');
  assert.equal((await other.request('/api/mcp/consent/' + pending.request)).status, 403);
  assert.equal(
    (
      await f.manager.request('/api/mcp/consent/' + pending.request, {
        method: 'POST',
        csrf: false,
        body: { allow: true, scopes: ['workspace:read'] },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.manager.request('/api/mcp/consent/' + pending.request, {
        method: 'POST',
        body: { allow: true, scopes: SCOPES },
      })
    ).status,
    400,
  );
  const declined = await f.manager.request('/api/mcp/consent/' + pending.request, {
    method: 'POST',
    body: { allow: false, scopes: ['workspace:read'] },
  });
  assert.equal(new URL(declined.data.redirectUrl).searchParams.get('error'), 'access_denied');
  assert.equal(
    Number((await f.db.prepare('SELECT count(*) AS count FROM mcp_grants').get()).count),
    0,
  );
  const contributor = f.browser();
  await contributor.request('/api/bootstrap');
  await contributor.request('/api/auth/demo-role', {
    method: 'POST',
    body: { role: 'contributor' },
  });
  const again = await f.start(client);
  assert.equal((await contributor.request('/api/mcp/consent/' + again.request)).status, 403);
});

test('OAuth enforces PKCE, exact resource, registered redirect, client identity and single use codes', async (t) => {
  const f = await fixture(t);
  const client = (await f.register()).data,
    wrong = (await f.register()).data;
  const approval = await f.approve(client);
  assert.equal(
    (await f.exchange(client, approval, { code_verifier: randomBytes(32).toString('base64url') }))
      .status,
    400,
  );
  assert.equal(
    (await f.exchange(client, approval, { resource: 'https://attacker.example/api/mcp' })).status,
    400,
  );
  assert.equal(
    (
      await f.exchange(client, approval, {
        redirect_uri: 'https://chatgpt.com/connector/oauth/wrong',
      })
    ).status,
    400,
  );
  assert.equal((await f.exchange(wrong, approval)).status, 400);
  const tokens = await f.exchange(client, approval);
  assert.equal(tokens.status, 200);
  const approvedClient = await f.db
    .prepare('SELECT * FROM mcp_clients WHERE id=?')
    .get(client.client_id);
  assert.equal(
    Number(approvedClient.expires_at) - Number(approvedClient.created_at),
    90 * 86400000,
  );
  assert.equal((await f.exchange(client, approval)).status, 400);
  assert.equal((await f.rpc(tokens.data.access_token, 'tools/list')).status, 200);
  const rows = await f.db.prepare('SELECT * FROM mcp_tokens').all();
  assert.ok(!JSON.stringify(rows).includes(tokens.data.access_token));
  assert.ok(!JSON.stringify(rows).includes(tokens.data.refresh_token));
});

test('MCP exposes only granted tools and draft creation is idempotent with no publication side effect', async (t) => {
  const f = await fixture(t),
    read = await f.connect(['workspace:read']);
  const initialize = await f.rpc(read.tokens.access_token, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'verification', version: '1' },
  });
  assert.equal(initialize.status, 200, JSON.stringify(initialize.data));
  assert.equal(initialize.data.result.serverInfo.name, 'stmarys-marketing-workspace');
  const list = await f.rpc(read.tokens.access_token, 'tools/list');
  assert.ok(list.data.result.tools.some((tool) => tool.name === 'list_keywords'));
  assert.ok(!list.data.result.tools.some((tool) => tool.name === 'create_post_draft'));
  const writer = await f.connect();
  const tools = (await f.rpc(writer.tokens.access_token, 'tools/list')).data.result.tools;
  assert.ok(!tools.some((tool) => /approve|publish|advertis|secret|verify_exam/.test(tool.name)));
  const args = {
    idempotencyKey: 'draft-unique-001',
    title: 'Source review',
    caption: 'A source-backed draft ready for review.',
    institution: 'St. Mary’s ISC',
    platforms: ['instagram'],
    sourceUrl: 'https://www.nta.ac.in/',
  };
  const call = () =>
    f.rpc(writer.tokens.access_token, 'tools/call', { name: 'create_post_draft', arguments: args });
  const created = await call();
  assert.equal(created.data.result.isError, undefined, JSON.stringify(created.data));
  const post = created.data.result.structuredContent.post;
  assert.equal(post.status, 'draft');
  assert.equal(post.approvedRevision, null);
  assert.equal(post.scheduledAt, null);
  assert.deepEqual(post.destinationIds, []);
  assert.equal((await call()).data.result.structuredContent.post.id, post.id);
  assert.equal(
    Number(
      (
        await f.db
          .prepare('SELECT count(*) AS count FROM notifications WHERE user_id=? AND entity_id=?')
          .get(f.userId, post.id)
      ).count,
    ),
    1,
    'ChatGPT results notify the requesting manager once',
  );
  const conflict = await f.rpc(writer.tokens.access_token, 'tools/call', {
    name: 'create_post_draft',
    arguments: { ...args, title: 'Different intended action' },
  });
  assert.equal(conflict.data.result.isError, true);
  assert.equal(conflict.data.result.structuredContent.code, 'idempotency_conflict');
  assert.equal(
    Number(
      (
        await f.db
          .prepare('SELECT count(*) AS count FROM publication_jobs WHERE post_id=?')
          .get(post.id)
      ).count,
    ),
    0,
  );
});

test('MCP research writes are saved as unverified drafts and retain source references', async (t) => {
  const f = await fixture(t),
    connection = await f.connect();
  const result = await f.rpc(connection.tokens.access_token, 'tools/call', {
    name: 'create_exam_draft',
    arguments: {
      idempotencyKey: 'exam-source-001',
      input: {
        name: 'NEET evidence test',
        category: 'Entrance',
        streams: ['Science'],
        description: 'A record for checking official sources, not an eligibility assertion.',
        referenceLinks: [{ label: 'NTA', url: 'https://www.nta.ac.in/' }],
        status: 'tracking',
      },
    },
  });
  assert.equal(result.data.result.isError, undefined, JSON.stringify(result.data));
  const item = result.data.result.structuredContent;
  assert.equal(item.status, 'draft');
  assert.equal(item.verification, 'unverified');
  assert.equal(item.referenceLinks[0].url, 'https://www.nta.ac.in/');
});

test('MCP account reporting keeps resource identities separate and never returns provider credentials', async (t) => {
  const f = await fixture(t),
    connection = await f.connect(['workspace:read']);
  for (const number of [1, 2]) {
    await f.db
      .prepare(
        "INSERT INTO service_connections(id,provider,account_id,account_name,institution,status,encrypted_credentials,connected_by,created_at) VALUES(?,'facebook',?,?,?,'connected',?,?,?)",
      )
      .run(
        'mcp-report-' + number,
        'page-' + number,
        'Page ' + number,
        'School ' + number,
        'must-never-leak-provider-secret',
        f.userId,
        new Date().toISOString(),
      );
    await f.db
      .prepare('INSERT INTO platform_reports(connection_id,report_json,imported_at) VALUES(?,?,?)')
      .run(
        'mcp-report-' + number,
        JSON.stringify({
          connectionId: 'mcp-report-' + number,
          institution: 'School ' + number,
          accountName: 'Page ' + number,
          summary: [{ label: 'Views', value: number * 10 }],
        }),
        new Date().toISOString(),
      );
  }
  const accounts = await f.rpc(connection.tokens.access_token, 'tools/call', {
    name: 'list_connected_accounts',
    arguments: {},
  });
  assert.equal(accounts.data.result.structuredContent.items.length, 2);
  assert.ok(!JSON.stringify(accounts.data).includes('must-never-leak-provider-secret'));
  const report = await f.rpc(connection.tokens.access_token, 'tools/call', {
    name: 'get_account_report',
    arguments: { connectionId: 'mcp-report-2' },
  });
  assert.equal(report.data.result.structuredContent.report.summary[0].value, 20);
  assert.equal(report.data.result.structuredContent.connection.account_id, 'page-2');
  await f.db
    .prepare('UPDATE service_connections SET institution=? WHERE id=?')
    .run('Different school', 'mcp-report-2');
  const stale = await f.rpc(connection.tokens.access_token, 'tools/call', {
    name: 'get_account_report',
    arguments: { connectionId: 'mcp-report-2' },
  });
  assert.equal(stale.data.result.structuredContent.code, 'report_identity_mismatch');
});

test('refresh tokens rotate, replay revokes the grant, and deactivation invalidates current access', async (t) => {
  const f = await fixture(t),
    connection = await f.connect();
  const refresh = (token) =>
    f.raw('/api/mcp/oauth/token', {
      method: 'POST',
      form: {
        grant_type: 'refresh_token',
        client_id: connection.client.client_id,
        refresh_token: token,
        resource: RESOURCE,
      },
    });
  const rotated = await refresh(connection.tokens.refresh_token);
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.data.refresh_token, connection.tokens.refresh_token);
  assert.equal((await f.rpc(rotated.data.access_token, 'tools/list')).status, 200);
  assert.equal((await refresh(connection.tokens.refresh_token)).status, 400);
  assert.equal((await f.rpc(rotated.data.access_token, 'tools/list')).status, 401);
  const second = await f.connect();
  await f.db.prepare('UPDATE users SET active=0 WHERE id=?').run(f.userId);
  assert.equal((await f.rpc(second.tokens.access_token, 'tools/list')).status, 401);
});

test('revocation is scoped to the signed-in manager and bearer tokens cannot call browser administration', async (t) => {
  const f = await fixture(t),
    connection = await f.connect();
  const settings = await f.manager.request('/api/mcp/settings');
  assert.equal(settings.data.ready, true);
  assert.equal(settings.data.additionalApiSpendUsd, 0);
  assert.equal(
    (
      await f.raw('/api/users', {
        headers: { Authorization: 'Bearer ' + connection.tokens.access_token },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.manager.request('/api/mcp/grants/' + settings.data.grants[0].id + '/revoke', {
        method: 'POST',
        body: {},
      })
    ).status,
    200,
  );
  assert.equal((await f.rpc(connection.tokens.access_token, 'tools/list')).status, 401);
  const storage = await f.manager.request('/api/workspace/storage');
  assert.equal(storage.status, 200);
  assert.equal(storage.data.capacityBytes, 512 * 1024 * 1024);
  assert.equal(storage.data.emailDeliveryConfigured, false);
});
