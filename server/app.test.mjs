import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from './app.mjs';
import { newToken, hashToken } from './auth.mjs';

async function fixture(t, overrides = {}) {
  const app = await createApp({
    demoMode: true,
    extensions: false,
    databaseUrl: '',
    databasePath: ':memory:',
    secureCookies: false,
    serveStatic: false,
    ...overrides,
  });
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.on('error', reject);
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await app.locals.close();
  };
  t.after(close);
  return { app, close, url: `http://127.0.0.1:${server.address().port}` };
}

class Client {
  constructor(url) {
    this.url = url;
    this.cookie = '';
    this.csrf = '';
  }
  async request(path, { method = 'GET', body, csrf = true, origin, headers = {} } = {}) {
    const isMutation = !['GET', 'HEAD'].includes(method);
    const requestHeaders = {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(this.cookie ? { cookie: this.cookie } : {}),
      ...(isMutation && csrf && this.csrf ? { 'x-csrf-token': this.csrf } : {}),
      ...(isMutation ? { origin: origin ?? this.url } : {}),
      ...headers,
    };
    const response = await fetch(`${this.url}${path}`, {
      method,
      headers: requestHeaders,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    const cookie = response.headers.getSetCookie()[0];
    if (cookie) this.cookie = cookie.split(';')[0];
    if (value.csrfToken) this.csrf = value.csrfToken;
    return { status: response.status, body: value, headers: response.headers };
  }
  async bootstrap() {
    const result = await this.request('/api/bootstrap');
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body;
  }
}

const draftInput = (overrides = {}) => ({
  title: 'A source-backed admissions guide',
  caption: 'A carefully reviewed draft for parents.',
  platforms: ['instagram', 'facebook'],
  format: 'Carousel',
  institution: 'St. Mary’s ISC',
  scheduledAt: null,
  language: 'English',
  palette: 'navy',
  sourceUrl: 'https://www.nta.ac.in/',
  ...overrides,
});

async function createDraft(client, values = {}) {
  const result = await client.request('/api/posts', { method: 'POST', body: draftInput(values) });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}

async function transition(client, post, action, extra = {}) {
  return client.request(`/api/posts/${post.id}/transition`, {
    method: 'POST',
    body: { action, revision: post.revision, ...extra },
  });
}

test('demo bootstrap is honest about sample data and creates a protected session', async (t) => {
  const { url } = await fixture(t);
  const client = new Client(url);
  const first = await client.request('/api/bootstrap');
  assert.equal(first.status, 200);
  assert.match(first.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(first.headers.get('set-cookie'), /SameSite=Lax/i);
  assert.equal(first.body.user.role, 'manager');
  assert.equal(first.body.demoMode, true);
  assert.equal(first.body.publishingEnabled, false);
  assert.equal(first.body.analytics.sample, true);
  assert.ok(first.body.analytics.campaigns.every((item) => item.sample));
  assert.ok(first.body.integrations.every((item) => item.status === 'not_connected'));
  assert.ok(first.body.posts.every((item) => item.sample && item.status !== 'published'));
  assert.ok(
    first.body.opportunities.every((item) => item.sourceKind === 'sample' && !item.verified),
  );
  assert.ok(
    first.body.competitors.every(
      (item) => item.monitoringStatus !== 'ready' && !item.lastCheckedAt,
    ),
  );
  assert.ok(first.body.sources.every((item) => item.status === 'manual' && !item.lastCheckedAt));
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.ok(!JSON.stringify(first.body).includes('password_hash'));
  const second = await client.request('/api/bootstrap');
  assert.equal(second.headers.get('set-cookie'), null, 'existing sessions should be reused');
  assert.equal(second.body.csrfToken, first.body.csrfToken);
});

test('production has no default login, has empty analytics, and persists no plaintext password', async (t) => {
  await assert.rejects(
    () =>
      createApp({ demoMode: false, databasePath: ':memory:', adminEmail: '', adminPassword: '' }),
    /BOOTSTRAP_ADMIN/,
  );
  await assert.rejects(
    () =>
      createApp({
        demoMode: false,
        databasePath: ':memory:',
        adminEmail: 'unusable..address@example.test',
        adminPassword: 'A sufficiently long password',
      }),
    /BOOTSTRAP_ADMIN/,
  );
  const password = 'A long test password #2026';
  const { app, url } = await fixture(t, {
    demoMode: false,
    adminEmail: 'manager@example.test',
    adminPassword: password,
  });
  const client = new Client(url);
  const unauthenticated = await client.request('/api/bootstrap');
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.body.demoMode, false);
  assert.equal(unauthenticated.headers.get('set-cookie'), null);
  const wrong = await client.request('/api/auth/login', {
    method: 'POST',
    body: { email: 'manager@example.test', password: 'wrong' },
  });
  assert.equal(wrong.status, 401);
  const signedIn = await client.request('/api/auth/login', {
    method: 'POST',
    body: { email: 'MANAGER@example.test', password },
  });
  assert.equal(signedIn.status, 200);
  const data = await client.bootstrap();
  assert.equal(data.demoMode, false);
  assert.equal(data.posts.length, 0);
  assert.equal(data.opportunities.length, 0);
  assert.deepEqual(data.analytics, { sample: false, points: [], campaigns: [], channels: [] });
  const stored = (await app.locals.database.prepare('SELECT password_hash FROM users').get())
    .password_hash;
  assert.match(stored, /^scrypt\$16384\$8\$1\$/);
  assert.ok(!stored.includes(password));
  const switchRole = await client.request('/api/auth/demo-role', {
    method: 'POST',
    body: { role: 'contributor' },
  });
  assert.equal(switchRole.status, 404);
  const logout = await client.request('/api/auth/logout', { method: 'POST' });
  assert.equal(logout.status, 200);
  assert.equal((await client.request('/api/bootstrap')).status, 401);
});

test('mutations require both a current CSRF token and a matching request origin', async (t) => {
  const { url } = await fixture(t);
  const client = new Client(url);
  await client.bootstrap();
  const missing = await client.request('/api/posts', {
    method: 'POST',
    body: draftInput(),
    csrf: false,
  });
  assert.equal(missing.status, 403);
  assert.equal(missing.body.code, 'invalid_csrf');
  const foreign = await client.request('/api/posts', {
    method: 'POST',
    body: draftInput(),
    origin: 'https://attacker.example',
  });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.code, 'invalid_origin');
  const crossSite = await client.request('/api/posts', {
    method: 'POST',
    body: draftInput(),
    headers: { 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(crossSite.status, 403);
  const oldCsrf = client.csrf;
  const oldCookie = client.cookie;
  assert.equal(
    (await client.request('/api/auth/demo-role', { method: 'POST', body: { role: 'contributor' } }))
      .status,
    200,
  );
  assert.notEqual(client.csrf, oldCsrf);
  assert.notEqual(client.cookie, oldCookie);
  const staleCsrf = await client.request('/api/posts', {
    method: 'POST',
    body: draftInput(),
    headers: { 'x-csrf-token': oldCsrf },
  });
  assert.equal(staleCsrf.status, 403);
  const oldSession = new Client(url);
  oldSession.cookie = oldCookie;
  oldSession.csrf = oldCsrf;
  assert.equal(
    (await oldSession.request('/api/posts', { method: 'POST', body: draftInput() })).status,
    401,
  );
  assert.equal(
    (await client.request('/api/posts', { method: 'POST', body: draftInput() })).status,
    201,
  );
});

test('contributors can edit and submit only their own editable drafts and cannot approve or schedule', async (t) => {
  const { url } = await fixture(t);
  const manager = new Client(url);
  await manager.bootstrap();
  const managerPost = await createDraft(manager);
  const contributor = new Client(url);
  await contributor.bootstrap();
  await contributor.request('/api/auth/demo-role', {
    method: 'POST',
    body: { role: 'contributor' },
  });
  assert.equal(
    (
      await contributor.request(`/api/posts/${managerPost.id}`, {
        method: 'PATCH',
        body: { revision: 1, title: 'Hijacked draft' },
      })
    ).status,
    403,
  );
  assert.equal((await transition(contributor, managerPost, 'submit')).status, 403);
  const own = await createDraft(contributor);
  const edited = await contributor.request(`/api/posts/${own.id}`, {
    method: 'PATCH',
    body: { revision: 1, title: 'A more useful parent guide' },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.revision, 2);
  assert.equal((await transition(contributor, edited.body, 'submit')).status, 200);
  assert.equal(
    (
      await contributor.request(`/api/posts/${own.id}`, {
        method: 'PATCH',
        body: { revision: 2, caption: 'Changed during review' },
      })
    ).status,
    403,
  );
  assert.equal((await transition(contributor, edited.body, 'approve')).status, 403);
  assert.equal((await transition(contributor, edited.body, 'schedule')).status, 403);
  const forbidden = await contributor.request('/api/users', {
    method: 'POST',
    body: {
      name: 'Injected manager',
      email: 'other@example.test',
      password: 'A long test password',
      role: 'manager',
    },
  });
  assert.equal(forbidden.status, 403);
});

test('approval is bound to the content revision; edits revoke it and stale requests cannot change state', async (t) => {
  const { app, url } = await fixture(t);
  const manager = new Client(url);
  await manager.bootstrap();
  const post = await createDraft(manager);
  assert.equal(
    (await transition(manager, post, 'approve')).status,
    409,
    'drafts must first be submitted',
  );
  assert.equal((await transition(manager, post, 'submit')).status, 200);
  const approved = await transition(manager, post, 'approve');
  assert.equal(approved.status, 200);
  assert.equal(approved.body.approvedRevision, 1);
  assert.ok(approved.body.approvedAt);
  assert.equal(approved.body.approvedBy, 'manager_demo');
  const edited = await manager.request(`/api/posts/${post.id}`, {
    method: 'PATCH',
    body: { revision: 1, caption: 'Revised copy that requires another review.' },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.revision, 2);
  assert.equal(edited.body.status, 'draft');
  assert.equal(edited.body.approvedRevision, null);
  assert.equal(edited.body.approvedBy, null);
  assert.equal(edited.body.approvedAt, null);
  const stale = await transition(manager, post, 'schedule', {
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'stale_revision');
  const unapproved = await transition(manager, edited.body, 'schedule', {
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(unapproved.status, 409);
  assert.equal(unapproved.body.code, 'approval_required');
  assert.equal(
    (
      await manager.request(`/api/posts/${post.id}`, {
        method: 'PATCH',
        body: { revision: 1, title: 'Overwritten stale copy' },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await manager.request(`/api/posts/${post.id}`, {
        method: 'PATCH',
        body: { revision: 2, status: 'published' },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await manager.request(`/api/posts/${post.id}/transition`, {
        method: 'POST',
        body: { revision: 2, action: 'publish' },
      })
    ).status,
    422,
  );
  const versions = await app.locals.database
    .prepare('SELECT revision, snapshot FROM post_revisions WHERE post_id = ? ORDER BY revision')
    .all(post.id);
  assert.deepEqual(
    versions.map((item) => item.revision),
    [1, 2],
  );
  assert.equal(JSON.parse(versions[0].snapshot).caption, post.caption);
  assert.equal(JSON.parse(versions[1].snapshot).caption, edited.body.caption);
  const trail = (await manager.bootstrap()).audit.filter((item) => item.entityId === post.id);
  assert.ok(
    trail.some((item) => item.action === 'Draft approved' && item.detail.includes('revision 1')),
  );
  assert.ok(trail.some((item) => item.detail.includes('invalidated')));
});

test('scheduling validates future time and remains a local queue even after the planned time', async (t) => {
  let clock = new Date('2026-11-04T06:30:00.000Z');
  const { url } = await fixture(t, { now: () => new Date(clock) });
  const manager = new Client(url);
  await manager.bootstrap();
  const post = await createDraft(manager);
  await transition(manager, post, 'submit');
  await transition(manager, post, 'approve');
  const missing = await transition(manager, post, 'schedule');
  assert.equal(missing.status, 422);
  const past = await transition(manager, post, 'schedule', {
    scheduledAt: '2026-11-04T05:00:00.000Z',
  });
  assert.equal(past.status, 422);
  const scheduled = await transition(manager, post, 'schedule', {
    scheduledAt: '2026-11-04T07:30:00.000Z',
  });
  assert.equal(scheduled.status, 200);
  assert.equal(scheduled.body.status, 'scheduled');
  assert.equal(scheduled.body.approvedRevision, scheduled.body.revision);
  clock = new Date('2026-11-04T08:30:00.000Z');
  const data = await manager.bootstrap();
  assert.equal(data.publishingEnabled, false);
  assert.equal(data.posts.find((item) => item.id === post.id).status, 'scheduled');
  assert.ok(!data.posts.some((item) => item.status === 'published'));
  const unscheduled = await transition(manager, post, 'unschedule');
  assert.equal(unscheduled.status, 200);
  assert.equal(unscheduled.body.status, 'approved');
  assert.equal(unscheduled.body.scheduledAt, null);
  const queued = await transition(manager, post, 'schedule', {
    scheduledAt: '2026-11-04T10:30:00.000Z',
  });
  assert.equal(queued.status, 200);
  const edited = await manager.request(`/api/posts/${post.id}`, {
    method: 'PATCH',
    body: { revision: 1, title: 'Changed after scheduling' },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.status, 'draft');
  assert.equal(edited.body.approvedRevision, null);
});

test('requested changes include reviewer feedback and the author can revise and resubmit', async (t) => {
  const { url } = await fixture(t);
  const manager = new Client(url);
  await manager.bootstrap();
  const contributor = new Client(url);
  await contributor.bootstrap();
  await contributor.request('/api/auth/demo-role', {
    method: 'POST',
    body: { role: 'contributor' },
  });
  const post = await createDraft(contributor);
  await transition(contributor, post, 'submit');
  assert.equal((await transition(manager, post, 'request_changes')).status, 422);
  const changes = await transition(manager, post, 'request_changes', {
    feedback: 'Add the effective academic year and official source.',
  });
  assert.equal(changes.status, 200);
  assert.equal(changes.body.status, 'changes_requested');
  assert.match(changes.body.feedback, /academic year/);
  const edited = await contributor.request(`/api/posts/${post.id}`, {
    method: 'PATCH',
    body: {
      revision: 1,
      caption:
        'The original notice applies to the specified academic year. Source linked for review.',
    },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.revision, 2);
  assert.equal((await transition(contributor, edited.body, 'submit')).status, 200);
  const rejected = await transition(manager, edited.body, 'reject', {
    feedback: 'The linked notice does not substantiate the proposed claim.',
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.status, 'rejected');
  assert.equal(rejected.body.approvedRevision, null);
});

test('source briefs retain provenance, require manager verification and do not duplicate on retry', async (t) => {
  const { url } = await fixture(t);
  const manager = new Client(url);
  const data = await manager.bootstrap();
  const opportunity = data.opportunities[0];
  const contributor = new Client(url);
  await contributor.bootstrap();
  await contributor.request('/api/auth/demo-role', {
    method: 'POST',
    body: { role: 'contributor' },
  });
  const verify = await contributor.request(`/api/opportunities/${opportunity.id}`, {
    method: 'PATCH',
    body: { verified: true },
  });
  assert.equal(verify.status, 403);
  const saved = await contributor.request(`/api/opportunities/${opportunity.id}`, {
    method: 'PATCH',
    body: { status: 'saved' },
  });
  assert.equal(saved.status, 200);
  const duplicateChannels = await contributor.request(
    `/api/opportunities/${opportunity.id}/draft`,
    {
      method: 'POST',
      body: { platforms: ['instagram', 'instagram'] },
    },
  );
  assert.equal(duplicateChannels.status, 422);
  const generated = await contributor.request(`/api/opportunities/${opportunity.id}/draft`, {
    method: 'POST',
    body: {},
  });
  assert.equal(generated.status, 201);
  assert.equal(generated.body.sourceUrl, opportunity.sourceUrl);
  assert.equal(generated.body.status, 'draft');
  assert.match(generated.body.caption, /verification is pending/);
  assert.match(generated.body.caption, /Illustrative demo/);
  const retried = await contributor.request(`/api/opportunities/${opportunity.id}/draft`, {
    method: 'POST',
    body: {},
  });
  assert.equal(retried.status, 200);
  assert.equal(retried.body.id, generated.body.id);
  const verified = await manager.request(`/api/opportunities/${opportunity.id}`, {
    method: 'PATCH',
    body: { verified: true },
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.verified, true);
  assert.equal(verified.body.sourceKind, 'sample');
  assert.equal(verified.body.status, 'drafted');
});

test('manual production research starts unverified and follows the manager verification and draft workflow', async (t) => {
  const timestamp = '2026-11-04T09:00:00.000Z';
  const { url } = await fixture(t, {
    demoMode: false,
    adminEmail: 'manager@example.test',
    adminPassword: 'A production research manager password',
    now: () => new Date(timestamp),
  });
  const manager = new Client(url);
  assert.equal(
    (
      await manager.request('/api/auth/login', {
        method: 'POST',
        body: {
          email: 'manager@example.test',
          password: 'A production research manager password',
        },
      })
    ).status,
    200,
  );
  const account = await manager.request('/api/users', {
    method: 'POST',
    body: {
      name: 'Research contributor',
      email: 'research@example.test',
      password: 'A production research contributor password',
      role: 'contributor',
    },
  });
  assert.equal(account.status, 201);
  const contributor = new Client(url);
  assert.equal(
    (
      await contributor.request('/api/auth/login', {
        method: 'POST',
        body: {
          email: 'research@example.test',
          password: 'A production research contributor password',
        },
      })
    ).status,
    200,
  );
  const input = {
    title: 'Review an official examination notice',
    summary: "Record parents' next steps after reviewing the original notice.",
    source: 'National Testing Agency',
    sourceUrl: 'https://www.nta.ac.in/',
    category: 'Exam update',
    audience: 'Grade 11–12 families',
    contentAngle: 'Explain the actions and deadlines supported by the original evidence.',
    priority: 'high',
    sourceKind: 'official',
  };
  for (const forbidden of [{ verified: true }, { status: 'drafted' }, { id: 'client-owned-id' }]) {
    const rejected = await contributor.request('/api/opportunities', {
      method: 'POST',
      body: { ...input, ...forbidden },
    });
    assert.equal(rejected.status, 422);
  }
  const unsafe = await contributor.request('/api/opportunities', {
    method: 'POST',
    body: { ...input, sourceUrl: 'javascript:alert(1)' },
  });
  assert.equal(unsafe.status, 422);
  assert.equal((await contributor.bootstrap()).opportunities.length, 0);

  const created = await contributor.request('/api/opportunities', { method: 'POST', body: input });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.status, 'new');
  assert.equal(created.body.verified, false, 'manual official classification is not verification');
  assert.equal(created.body.sourceKind, 'official');
  assert.equal(created.body.publishedAt, timestamp);
  assert.equal(created.body.summary, input.summary);
  const opportunityPath = `/api/opportunities/${created.body.id}`;
  assert.equal(
    (await contributor.request(opportunityPath, { method: 'PATCH', body: { verified: true } }))
      .status,
    403,
  );
  const verified = await manager.request(opportunityPath, {
    method: 'PATCH',
    body: { verified: true },
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.verified, true);
  const drafted = await contributor.request(`${opportunityPath}/draft`, {
    method: 'POST',
    body: {},
  });
  assert.equal(drafted.status, 201);
  assert.equal(drafted.body.ownerId, account.body.id);
  assert.equal(drafted.body.sourceUrl, input.sourceUrl);
  assert.equal(drafted.body.status, 'draft');
  assert.equal(drafted.body.sample, false);
  assert.doesNotMatch(drafted.body.caption, /verification is pending|Illustrative demo/);
  const retried = await contributor.request(`${opportunityPath}/draft`, {
    method: 'POST',
    body: {},
  });
  assert.equal(retried.status, 200);
  assert.equal(retried.body.id, drafted.body.id);
  const data = await contributor.bootstrap();
  assert.equal(data.opportunities.length, 1);
  assert.equal(data.opportunities[0].status, 'drafted');
  assert.equal(data.opportunities[0].verified, true);
  assert.equal(data.posts.length, 1);
  assert.ok(
    data.audit.some(
      (entry) => entry.entityId === created.body.id && entry.action === 'Research brief added',
    ),
  );
  assert.deepEqual(data.analytics, { sample: false, points: [], campaigns: [], channels: [] });
  assert.equal(data.publishingEnabled, false);
});

test('workspace CRUD validates URLs and dates, preserves omitted fields, and never invents monitoring', async (t) => {
  const { url } = await fixture(t);
  const manager = new Client(url);
  await manager.bootstrap();
  const invalidUrl = await manager.request('/api/competitors', {
    method: 'POST',
    body: {
      name: 'Unsafe URL',
      platform: 'website',
      url: 'javascript:alert(1)',
    },
  });
  assert.equal(invalidUrl.status, 422);
  const competitor = await manager.request('/api/competitors', {
    method: 'POST',
    body: {
      name: 'A public profile',
      platform: 'youtube',
      url: 'https://www.youtube.com/@example',
      notes: 'Added by the team',
      monitoringStatus: 'paused',
    },
  });
  assert.equal(competitor.status, 201);
  const changed = await manager.request(`/api/competitors/${competitor.body.id}`, {
    method: 'PATCH',
    body: { name: 'Renamed public profile' },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.notes, 'Added by the team');
  assert.equal(changed.body.monitoringStatus, 'paused');
  const ready = await manager.request(`/api/competitors/${competitor.body.id}`, {
    method: 'PATCH',
    body: { monitoringStatus: 'ready' },
  });
  assert.equal(ready.status, 422);
  const invalidDate = await manager.request('/api/tasks', {
    method: 'POST',
    body: {
      title: 'Impossible deadline',
      owner: 'Team',
      dueDate: '2026-02-30',
    },
  });
  assert.equal(invalidDate.status, 422);
  const document = await manager.request('/api/documents', {
    method: 'POST',
    body: {
      title: 'Content policy',
      category: 'Brand',
      content: 'Keep the approved copy and its source.',
    },
  });
  assert.equal(document.status, 201);
  const revisedDocument = await manager.request(`/api/documents/${document.body.id}`, {
    method: 'PATCH',
    body: { title: 'Our content policy', expectedVersion: document.body.version },
  });
  assert.equal(revisedDocument.status, 200);
  assert.equal(revisedDocument.body.content, document.body.content);
  assert.equal(revisedDocument.body.category, 'Brand');
  assert.equal(
    (await manager.request(`/api/documents/${document.body.id}`, { method: 'DELETE' })).status,
    200,
  );
  assert.ok(!(await manager.bootstrap()).documents.some((item) => item.id === document.body.id));
});

test('SQLite persists edits, sessions and audit history across restarts without re-seeding', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'school-marketing-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'workspace.sqlite');
  const first = await fixture(t, { databasePath });
  const client = new Client(first.url);
  const initial = await client.bootstrap();
  const created = await createDraft(client);
  await client.request(`/api/posts/${created.id}`, {
    method: 'PATCH',
    body: { revision: 1, title: 'Saved across a restart' },
  });
  await client.request(`/api/competitors/${initial.competitors[0].id}`, { method: 'DELETE' });
  const cookie = client.cookie;
  const csrf = client.csrf;
  await first.close();
  const second = await fixture(t, { databasePath });
  const restored = new Client(second.url);
  restored.cookie = cookie;
  restored.csrf = csrf;
  const data = await restored.bootstrap();
  assert.equal(data.csrfToken, csrf, 'sessions survive a restart');
  assert.equal(data.posts.length, initial.posts.length + 1);
  assert.equal(data.posts.find((item) => item.id === created.id).title, 'Saved across a restart');
  assert.equal(data.posts.find((item) => item.id === created.id).revision, 2);
  assert.equal(
    data.competitors.length,
    initial.competitors.length - 1,
    'deleted sample data is not re-seeded',
  );
  assert.ok(
    data.audit.some((item) => item.entityId === created.id && item.action === 'Draft edited'),
  );
  await second.close();
  await assert.rejects(
    () =>
      createApp({
        demoMode: false,
        databasePath,
        adminEmail: 'manager@example.test',
        adminPassword: 'A valid admin password',
      }),
    /separate DATABASE_PATH/,
  );
});

test('production managers can create real team accounts with independent sessions', async (t) => {
  const { url } = await fixture(t, {
    demoMode: false,
    adminEmail: 'admin@example.test',
    adminPassword: 'An independent admin password',
  });
  const manager = new Client(url);
  await manager.request('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@example.test', password: 'An independent admin password' },
  });
  const account = await manager.request('/api/users', {
    method: 'POST',
    body: {
      name: 'School editor',
      email: 'editor@example.test',
      role: 'contributor',
      password: 'An independent editor password',
    },
  });
  assert.equal(account.status, 201);
  assert.equal(account.body.role, 'contributor');
  assert.ok(!JSON.stringify(account.body).includes('password'));
  const editor = new Client(url);
  const signedIn = await editor.request('/api/auth/login', {
    method: 'POST',
    body: { email: 'editor@example.test', password: 'An independent editor password' },
  });
  assert.equal(signedIn.status, 200);
  assert.notEqual(manager.cookie, editor.cookie);
  const post = await createDraft(editor);
  assert.equal(post.sample, false);
  await transition(editor, post, 'submit');
  assert.equal((await transition(editor, post, 'approve')).status, 403);
  assert.equal((await transition(manager, post, 'approve')).status, 200);
});

test('successful logins do not exhaust a shared IP failure budget while bad passwords are limited', async (t) => {
  const { url } = await fixture(t, {
    demoMode: false,
    adminEmail: 'admin@example.test',
    adminPassword: 'A shared connection test password',
  });
  const client = new Client(url);
  for (let attempt = 0; attempt < 11; attempt += 1) {
    const success = await client.request('/api/auth/login', {
      method: 'POST',
      body: {
        email: 'admin@example.test',
        password: 'A shared connection test password',
      },
    });
    assert.equal(
      success.status,
      200,
      `Valid login ${attempt + 1} should not consume the failure budget.`,
    );
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const failure = await client.request('/api/auth/login', {
      method: 'POST',
      body: {
        email: 'admin@example.test',
        password: 'incorrect password',
      },
    });
    assert.equal(failure.status, 401);
  }
  const limited = await client.request('/api/auth/login', {
    method: 'POST',
    body: {
      email: 'admin@example.test',
      password: 'incorrect password',
    },
  });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
});

test('a production setup token creates a private session once and is never exposed in public configuration', async (t) => {
  const token = newToken();
  const { app, url } = await fixture(t, {
    demoMode: false,
    evaluationMode: true,
    adminEmail: 'owner@example.test',
    adminPassword: '',
    adminSetupToken: token,
  });
  const client = new Client(url);
  const config = await client.request('/api/config');
  assert.equal(config.status, 200);
  assert.equal(config.body.evaluationMode, true);
  assert.equal(config.body.demoMode, false);
  assert.equal(config.body.selfRegistration, false);
  assert.ok(!JSON.stringify(config.body).includes(token));
  assert.ok(!JSON.stringify(config.body).includes('owner@example.test'));
  assert.equal((await client.request('/api/bootstrap')).status, 401);
  const password = 'My chosen private manager password';
  const setup = await client.request('/api/auth/setup', {
    method: 'POST',
    body: { token, password },
  });
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
  assert.equal(setup.body.user.role, 'manager');
  assert.equal(setup.body.user.setupPending, false);
  assert.equal((await client.bootstrap()).posts.length, 0);
  const stored = await app.locals.database.prepare('SELECT * FROM account_setup_tokens').get();
  assert.equal(stored.token_hash, hashToken(token));
  assert.ok(stored.consumed_at);
  assert.ok(!JSON.stringify(stored).includes(token));
  const replay = await new Client(url).request('/api/auth/setup', {
    method: 'POST',
    body: { token, password: 'A different long private password' },
  });
  assert.equal(replay.status, 400);
  assert.equal(replay.body.code, 'invalid_setup_token');
  const signedIn = await new Client(url).request('/api/auth/login', {
    method: 'POST',
    body: { email: 'owner@example.test', password },
  });
  assert.equal(signedIn.status, 200);
});

test('team links expire and rotate; deactivation revokes sessions and links; password changes revoke older sessions', async (t) => {
  let clock = new Date('2026-11-04T10:00:00.000Z');
  const { url } = await fixture(t, {
    demoMode: false,
    adminEmail: 'manager@example.test',
    adminPassword: 'A very long manager password',
    now: () => clock,
  });
  const manager = new Client(url);
  const loginManager = () =>
    manager.request('/api/auth/login', {
      method: 'POST',
      body: { email: 'manager@example.test', password: 'A very long manager password' },
    });
  assert.equal((await loginManager()).status, 200);
  const created = await manager.request('/api/users', {
    method: 'POST',
    body: { name: 'New editor', email: 'editor@example.test', role: 'contributor' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.setupPending, true);
  const editorId = created.body.id;
  const getToken = (value) => new URLSearchParams(new URL(value).hash.split('?')[1]).get('token');
  const originalToken = getToken(created.body.setupUrl);
  assert.equal(created.body.setupExpiresAt, '2026-11-05T10:00:00.000Z');
  assert.ok(!(await manager.bootstrap()).teamUsers.some((user) => 'setupUrl' in user));
  clock = new Date('2026-11-05T10:00:01.000Z');
  const editor = new Client(url);
  assert.equal(
    (
      await editor.request('/api/auth/setup', {
        method: 'POST',
        body: { token: originalToken, password: 'The editor chooses a password' },
      })
    ).status,
    400,
  );
  await loginManager();
  const replacement = await manager.request(`/api/users/${editorId}/setup-link`, {
    method: 'POST',
    body: { purpose: 'setup' },
  });
  assert.equal(replacement.status, 201);
  const token = getToken(replacement.body.setupUrl);
  assert.notEqual(token, originalToken);
  assert.equal(
    (
      await editor.request('/api/auth/setup', {
        method: 'POST',
        body: { token, password: 'The editor chooses a password' },
      })
    ).status,
    200,
  );
  const secondSession = new Client(url);
  assert.equal(
    (
      await secondSession.request('/api/auth/login', {
        method: 'POST',
        body: { email: 'editor@example.test', password: 'The editor chooses a password' },
      })
    ).status,
    200,
  );
  const oldCookie = editor.cookie;
  const changed = await editor.request('/api/auth/password', {
    method: 'POST',
    body: {
      currentPassword: 'The editor chooses a password',
      password: 'A replacement editor password',
    },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.notEqual(editor.cookie, oldCookie);
  assert.equal((await secondSession.request('/api/bootstrap')).status, 401);
  const recovery = await manager.request(`/api/users/${editorId}/setup-link`, {
    method: 'POST',
    body: { purpose: 'recovery' },
  });
  const deactivated = await manager.request(`/api/users/${editorId}`, {
    method: 'PATCH',
    body: { active: false },
  });
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.body.active, false);
  assert.equal((await editor.request('/api/bootstrap')).status, 401);
  assert.equal(
    (
      await editor.request('/api/auth/login', {
        method: 'POST',
        body: { email: 'editor@example.test', password: 'A replacement editor password' },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await manager.request(`/api/users/${editorId}/setup-link`, {
        method: 'POST',
        body: { purpose: 'recovery' },
      })
    ).status,
    409,
  );
  assert.equal(
    (await manager.request(`/api/users/${editorId}`, { method: 'PATCH', body: { active: true } }))
      .status,
    200,
  );
  assert.equal(
    (
      await editor.request('/api/auth/setup', {
        method: 'POST',
        body: {
          token: getToken(recovery.body.setupUrl),
          password: 'Cannot reuse a revoked recovery link',
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await editor.request('/api/auth/login', {
        method: 'POST',
        body: { email: 'editor@example.test', password: 'A replacement editor password' },
      })
    ).status,
    200,
  );
  assert.equal((await editor.request('/api/team')).status, 403);
  assert.equal(
    (
      await editor.request(`/api/users/${editorId}/setup-link`, {
        method: 'POST',
        body: { purpose: 'recovery' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await editor.request('/api/users/manager_initial', {
        method: 'PATCH',
        body: { active: false },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await manager.request('/api/users/manager_initial', {
        method: 'PATCH',
        body: { active: false },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await manager.request('/api/users/manager_initial', {
        method: 'PATCH',
        body: { role: 'contributor' },
      })
    ).status,
    409,
  );
  assert.equal((await manager.request('/api/team')).body.length, 2);
});

test('concurrent edits cannot overwrite a revision, and collaboration retains media and destination snapshots', async (t) => {
  const { url } = await fixture(t);
  const manager = new Client(url);
  await manager.bootstrap();
  const post = await createDraft(manager, {
    assetId: 'asset_one',
    destinationIds: ['destination_one'],
  });
  const comment = await manager.request(`/api/posts/${post.id}/comments`, {
    method: 'POST',
    body: { revision: 1, body: 'Please verify the admission dates.' },
  });
  assert.equal(comment.status, 201);
  const edits = await Promise.all([
    manager.request(`/api/posts/${post.id}`, {
      method: 'PATCH',
      body: {
        revision: 1,
        caption: 'First proposed caption',
        assetId: 'asset_two',
        destinationIds: ['destination_two'],
      },
    }),
    manager.request(`/api/posts/${post.id}`, {
      method: 'PATCH',
      body: {
        revision: 1,
        caption: 'Second proposed caption',
        assetId: 'asset_three',
        destinationIds: ['destination_three'],
      },
    }),
  ]);
  assert.deepEqual(edits.map((result) => result.status).sort(), [200, 409]);
  const winner = edits.find((result) => result.status === 200).body;
  assert.equal(winner.revision, 2);
  const staleComment = await manager.request(`/api/posts/${post.id}/comments`, {
    method: 'POST',
    body: { revision: 1, body: 'Comment on an old view' },
  });
  assert.equal(staleComment.status, 409);
  assert.equal((await transition(manager, winner, 'submit')).status, 200);
  assert.equal((await transition(manager, winner, 'approve')).status, 200);
  const history = (await manager.request(`/api/posts/${post.id}/history`)).body;
  assert.deepEqual(
    history.revisions.map((entry) => entry.revision),
    [2, 1],
  );
  assert.equal(history.revisions[1].snapshot.assetId, 'asset_one');
  assert.deepEqual(history.revisions[1].snapshot.destinationIds, ['destination_one']);
  assert.equal(history.revisions[0].snapshot.assetId, winner.assetId);
  assert.deepEqual(history.revisions[0].snapshot.destinationIds, winner.destinationIds);
  assert.ok(history.events.some((event) => event.action === 'Draft approved'));
  const comments = (await manager.request(`/api/posts/${post.id}/comments`)).body;
  assert.equal(comments.length, 1);
  assert.equal(comments[0].body, comment.body.body);
  const copy = await manager.request(`/api/posts/${post.id}/duplicate`, {
    method: 'POST',
    body: {},
  });
  assert.equal(copy.status, 201);
  assert.notEqual(copy.body.id, post.id);
  assert.equal(copy.body.status, 'draft');
  assert.equal(copy.body.revision, 1);
  assert.equal(copy.body.approvedRevision, null);
  assert.equal(copy.body.scheduledAt, null);
  assert.equal(copy.body.assetId, winner.assetId);
  assert.deepEqual(copy.body.destinationIds, winner.destinationIds);
});

test('provider hooks run inside atomic changes and a rejected job mutation rolls the edit back', async (t) => {
  const observed = [];
  const { app, url } = await fixture(t, {
    extensions: true,
    registerExtensions: async (_app, { db }) => ({
      bootstrap: async () => ({ providerTestInstalled: true }),
      validatePost: async (post) => {
        observed.push(['validate', post.revision, db.inTransaction()]);
      },
      onPostChanged: async (oldPost, newPost) => {
        observed.push(['changed', oldPost.revision, newPost.revision, db.inTransaction()]);
        if (newPost.title === 'Refuse while publishing')
          throw new Error('Simulated publication lock');
      },
      onPostTransition: async (_oldPost, newPost, action) => {
        observed.push([action, newPost.revision, db.inTransaction()]);
      },
    }),
  });
  const manager = new Client(url);
  assert.equal((await manager.bootstrap()).providerTestInstalled, true);
  const post = await createDraft(manager);
  const refusal = await manager.request(`/api/posts/${post.id}`, {
    method: 'PATCH',
    body: { revision: 1, title: 'Refuse while publishing' },
  });
  assert.equal(refusal.status, 500);
  const stored = (await manager.request(`/api/posts/${post.id}`)).body;
  assert.equal(stored.title, post.title);
  assert.equal(stored.revision, 1);
  assert.equal(
    (
      await app.locals.database
        .prepare('SELECT COUNT(*) AS count FROM post_revisions WHERE post_id = ?')
        .get(post.id)
    ).count,
    1,
  );
  assert.equal((await transition(manager, post, 'submit')).status, 200);
  assert.equal((await transition(manager, post, 'approve')).status, 200);
  assert.ok(observed.every((entry) => entry.at(-1) === true));
  assert.ok(observed.some((entry) => entry[0] === 'approve'));
});

test('password attempt limits survive an application restart', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'school-marketing-limits-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const overrides = {
    demoMode: false,
    databasePath: join(directory, 'workspace.sqlite'),
    adminEmail: 'manager@example.test',
    adminPassword: 'Long manager password for rate limits',
  };
  const first = await fixture(t, overrides);
  const client = new Client(first.url);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal(
      (
        await client.request('/api/auth/login', {
          method: 'POST',
          body: { email: 'manager@example.test', password: 'bad password' },
        })
      ).status,
      401,
    );
  }
  await first.close();
  const second = await fixture(t, overrides);
  const limited = await new Client(second.url).request('/api/auth/login', {
    method: 'POST',
    body: { email: 'manager@example.test', password: overrides.adminPassword },
  });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
});
