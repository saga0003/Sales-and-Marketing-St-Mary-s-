import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, insertResource } from '../database.mjs';
import { createApp } from '../app.mjs';
import { registerIntelligence } from './index.mjs';

const actor = { id: 'intel_manager', name: 'Research manager', role: 'manager' };
const editor = { id: 'intel_editor', name: 'Research contributor', role: 'contributor' };
const feed = (title = 'Examination timetable published', extra = '') =>
  `<rss><channel><item><guid>notice-one</guid><title>${title}</title><link>https://board.example.org/notices/one.pdf</link><description>Read the original notice for the applicable year.</description><pubDate>Thu, 05 Nov 2026 00:00:00 GMT</pubDate></item>${extra}</channel></rss>`;
const page = (url, text, type = 'application/rss+xml', status = 200) => ({
  url,
  text,
  status,
  headers: { 'content-type': type },
});

async function fixture(t, options = {}) {
  const db = await openDatabase(':memory:');
  let clock = Date.parse('2026-11-05T01:00:00Z');
  const now = () => new Date(clock);
  const advance = (milliseconds) => {
    clock += milliseconds;
  };
  for (const user of [actor, editor])
    await db
      .prepare(
        'INSERT INTO users(id, name, email, role, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        user.id,
        user.name,
        `${user.id}@example.invalid`,
        user.role,
        'unused-hash',
        now().toISOString(),
        now().toISOString(),
      );
  let handler =
    options.reader ||
    ((url) =>
      page(
        url,
        url.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /' : feed(),
        url.endsWith('/robots.txt') ? 'text/plain' : 'application/rss+xml',
      ));
  const app = { get() {}, post() {}, patch() {}, delete() {} };
  const hooks = await registerIntelligence(app, {
    db,
    config: { migrate: true },
    now,
    requireAuth() {},
    requireManager() {},
    options: {
      reader: (...args) => handler(...args),
      automationEnabled: options.automationEnabled ?? true,
    },
  });
  t.after(() => db.close());
  async function watch(overrides = {}) {
    const resource = await insertResource(
      db,
      'sources',
      {
        name: 'Official board notices',
        url: 'https://board.example.org/feed',
        category: 'Board update',
        status: 'manual',
      },
      now().toISOString(),
    );
    return hooks.services.watches.create(
      {
        kind: 'source',
        resourceId: resource.id,
        mode: 'rss',
        url: resource.url,
        keywords: [],
        intervalHours: 6,
        active: true,
        ...overrides,
      },
      actor,
    );
  }
  return {
    db,
    hooks,
    ...hooks.services,
    now,
    advance,
    watch,
    setReader: (value) => {
      handler = value;
    },
  };
}

test('initial source scan is a baseline, repeat scans deduplicate, corrections retain history and invalidate a brief', async (t) => {
  const f = await fixture(t);
  const watch = await f.watch();
  const initial = await f.watches.run(watch.id, { actor });
  assert.equal(initial.baseline, true);
  assert.equal(initial.added, 1);
  const [notice] = await f.watches.notices();
  assert.equal(notice.baseline, true);
  const input = {
    audience: 'Parents',
    contentAngle: 'Explain the confirmed date and original source',
    priority: 'medium',
  };
  const brief = await f.watches.createBrief(notice.id, input, editor);
  assert.equal(brief.verified, false);
  assert.match(brief.summary, /Publisher date:/);
  assert.match(brief.summary, /initial baseline scan/);
  assert.equal((await f.watches.createBrief(notice.id, input, editor)).id, brief.id);
  await f.db
    .prepare('UPDATE opportunities SET verified = 1, verified_by = ? WHERE id = ?')
    .run(actor.id, brief.id);
  f.advance(6 * 3600000);
  const duplicate = await f.watches.run(watch.id, { actor });
  assert.equal(duplicate.added, 0);
  assert.equal(duplicate.updated, 0);
  f.setReader((url) =>
    page(
      url,
      url.endsWith('/robots.txt')
        ? 'User-agent: *\nAllow: /'
        : feed('Revised examination timetable published'),
    ),
  );
  f.advance(60001);
  const corrected = await f.watches.run(watch.id, { actor });
  assert.equal(corrected.updated, 1);
  assert.equal(corrected.baseline, false);
  assert.equal((await f.watches.notices()).length, 1);
  assert.equal((await f.watches.notices())[0].changeKind, 'updated');
  assert.equal(
    Number(
      (await f.db.prepare('SELECT verified FROM opportunities WHERE id = ?').get(brief.id))
        .verified,
    ),
    0,
  );
  assert.equal(
    Number(
      (await f.db.prepare('SELECT count(*) AS count FROM intelligence_notice_history').get()).count,
    ),
    2,
  );
  assert.equal(
    Number((await f.db.prepare('SELECT count(*) AS count FROM opportunities').get()).count),
    1,
  );
});

test('failed reads retain earlier notices, back off and rate-limit repeated manual checks', async (t) => {
  const f = await fixture(t);
  const watch = await f.watch();
  await f.watches.run(watch.id, { actor });
  await assert.rejects(() => f.watches.run(watch.id, { actor }), { code: 'watch_rate_limited' });
  f.advance(60001);
  f.setReader((url) =>
    page(
      url,
      url.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /' : 'Protected',
      'text/html',
      url.endsWith('/robots.txt') ? 200 : 403,
    ),
  );
  await assert.rejects(() => f.watches.run(watch.id, { actor }), { code: 'source_http_error' });
  const [record] = await f.watches.list();
  assert.equal(record.status, 'error');
  assert.match(record.error, /requires access/);
  assert.ok(new Date(record.nextCheckAt).getTime() >= f.now().getTime() + 6 * 3600000);
  assert.equal((await f.watches.notices()).length, 1);
  assert.equal((await f.watches.runDue()).checked, 0);
});

test('concurrent source scans use a durable lease and an expired worker cannot overwrite a newer run', async (t) => {
  const f = await fixture(t);
  const watch = await f.watch();
  let release;
  let signalStarted;
  const started = new Promise((resolve) => {
    signalStarted = resolve;
  });
  let feedReads = 0;
  f.setReader(async (url) => {
    if (url.endsWith('/robots.txt')) return page(url, 'User-agent: *\nAllow: /', 'text/plain');
    feedReads += 1;
    if (feedReads === 1) {
      signalStarted();
      await new Promise((resolve) => {
        release = resolve;
      });
      return page(url, feed('Old worker result'));
    }
    return page(url, feed('New worker result'));
  });
  const first = f.watches.run(watch.id, { actor });
  await started;
  await assert.rejects(() => f.watches.run(watch.id, { actor }), { code: 'watch_busy' });
  assert.equal(feedReads, 1);
  f.advance(91000);
  const second = await f.watches.run(watch.id, { actor });
  assert.equal(second.added, 1);
  release();
  assert.equal((await first).skipped, true);
  assert.equal((await f.watches.notices())[0].title, 'New worker result');
});

test('scheduled sweeps cap work, skip paused watches and catalog creation is idempotent', async (t) => {
  const f = await fixture(t);
  const paused = await f.watch({ active: false });
  for (let index = 0; index < 3; index += 1) await f.watch();
  const result = await f.watches.runDue({ limit: 100 });
  assert.equal(result.checked, 2);
  assert.equal((await f.watches.list()).find((item) => item.id === paused.id).lastCheckedAt, null);
  const first = await f.watches.fromCatalog('nta', actor);
  const second = await f.watches.fromCatalog('nta', actor);
  assert.equal(first.watch.id, second.watch.id);
  assert.equal(first.source.id, second.source.id);
  await f.watches.remove(first.watch.id, actor);
  assert.equal(
    (await f.db.prepare('SELECT status FROM sources WHERE id = ?').get(first.source.id)).status,
    'manual',
  );
});

test('unsupported social profiles cannot be activated as arbitrary HTML/RSS watches', async (t) => {
  const f = await fixture(t);
  const competitor = await insertResource(
    f.db,
    'competitors',
    {
      name: 'Other school',
      platform: 'instagram',
      url: 'https://www.instagram.com/otherschool',
      category: 'Education',
      notes: '',
      monitoringStatus: 'manual',
    },
    f.now().toISOString(),
  );
  await assert.rejects(
    () =>
      f.watches.create(
        {
          kind: 'competitor',
          resourceId: competitor.id,
          mode: 'html',
          keywords: [],
          intervalHours: 12,
          active: true,
        },
        actor,
      ),
    { code: 'manual_social_review_required' },
  );
  await assert.rejects(() => f.watch({ url: 'https://www.linkedin.com/company/other-school' }), {
    code: 'manual_social_review_required',
  });
});

test('first successful scan remains a baseline after an earlier failed attempt', async (t) => {
  const f = await fixture(t);
  const watch = await f.watch();
  f.setReader((url) => page(url, '', 'text/plain', 503));
  await assert.rejects(() => f.watches.run(watch.id, { actor }));
  f.advance(60001);
  f.setReader((url) => page(url, url.endsWith('/robots.txt') ? '' : feed()));
  assert.equal((await f.watches.run(watch.id, { actor })).baseline, true);
});

test('SEO requires an exact owned origin, supports a public challenge and persists bounded audit evidence', async (t) => {
  const f = await fixture(t);
  const site = await f.sites.create('https://school.example.org/about', actor);
  await assert.rejects(() => f.sites.inspect(site.id, {}, actor), {
    code: 'site_verification_required',
  });
  await assert.rejects(
    () => f.sites.inspect(site.id, { url: 'https://other.example.org/' }, actor),
    { code: 'site_origin_mismatch' },
  );
  f.setReader((url) => {
    if (url.endsWith('verification.txt')) return page(url, site.verificationToken, 'text/plain');
    if (url.endsWith('robots.txt')) return page(url, 'User-agent: *\nAllow: /', 'text/plain');
    return page(
      url,
      '<html lang="en"><head><title>Admissions</title></head><body><h1>School admissions</h1></body></html>',
      'text/html',
    );
  });
  assert.equal((await f.sites.verify(site.id, actor)).status, 'verified');
  const audit = await f.sites.inspect(
    site.id,
    { url: 'https://school.example.org/admissions' },
    actor,
  );
  assert.equal(audit.title, 'Admissions');
  assert.equal((await f.sites.reports()).length, 1);
  await assert.rejects(() => f.sites.inspect(site.id, {}, actor), { code: 'site_rate_limited' });
  f.advance(31 * 24 * 3600000);
  assert.equal((await f.sites.list())[0].status, 'pending');
  await assert.rejects(() => f.sites.inspect(site.id, {}, actor), {
    code: 'site_verification_required',
  });
});

test('ownership meta challenge must be a bounded tag in the actual head, not a script, comment or body', async (t) => {
  const f = await fixture(t);
  const site = await f.sites.create('https://school.example.org/', actor);
  for (const html of [
    `<html><head><script>const text = '${site.metaTag}';</script></head><body></body></html>`,
    `<html><head><!-- ${site.metaTag} --></head><body></body></html>`,
    `<html><head></head><body>${site.metaTag}</body></html>`,
    `<html><head>${site.metaTag.replace('<meta ', `<meta data-padding="${'A'.repeat(17000)}" `)}</head><body></body></html>`,
  ]) {
    f.setReader((url) =>
      url.endsWith('verification.txt')
        ? page(url, '', 'text/plain', 404)
        : page(url, html, 'text/html'),
    );
    await assert.rejects(() => f.sites.verify(site.id, actor), { code: 'site_not_verified' });
    f.advance(60001);
  }
  f.setReader((url) =>
    url.endsWith('verification.txt')
      ? page(url, '', 'text/plain', 404)
      : page(url, `<html><head>${site.metaTag}</head><body></body></html>`, 'text/html'),
  );
  assert.equal((await f.sites.verify(site.id, actor)).status, 'verified');
});

test('answer observations retain original prompt context and require evidence for a target-site citation', async (t) => {
  const f = await fixture(t);
  const prompt = await f.answers.create(
    {
      prompt: 'Which schools offer ICSE in this city?',
      intent: 'School shortlist',
      institution: 'Example school',
      locale: 'Bengaluru, India',
      language: 'English',
      targetUrl: 'https://school.example.org/',
      active: true,
    },
    editor,
  );
  const observation = {
    promptId: prompt.id,
    provider: 'Manual answer check',
    model: 'Model not disclosed',
    checkedAt: f.now().toISOString(),
    answerExcerpt: 'Example school was listed with its website.',
    mentioned: true,
    cited: true,
    citationUrls: ['https://school.example.org/admissions'],
    evidenceUrl: 'https://evidence.example.org/capture',
    notes: 'Fresh session; no account history used.',
  };
  await assert.rejects(
    () =>
      f.answers.record(
        { ...observation, citationUrls: ['https://unrelated.example.org/'] },
        editor,
      ),
    { code: 'citation_evidence_mismatch' },
  );
  await assert.rejects(
    () => f.answers.record({ ...observation, checkedAt: '2099-01-01T00:00:00Z' }, editor),
    { code: 'invalid_observation_time' },
  );
  const saved = await f.answers.record(observation, editor);
  await f.answers.update(prompt.id, { prompt: 'Which schools offer ISC in this city?' }, editor);
  const [record] = await f.answers.observations();
  assert.equal(record.id, saved.id);
  assert.equal(record.cited, true);
  assert.equal(record.promptSnapshot.prompt, prompt.prompt);
  assert.equal(record.promptSnapshot.locale, 'Bengaluru, India');
});

test('intelligence routes require a real session, CSRF and manager access for fetching', async (t) => {
  const app = await createApp({
    databasePath: ':memory:',
    demoMode: true,
    secureCookies: false,
    serveStatic: false,
    registerExtensions: async () => ({}),
    intelligenceOptions: {
      reader: async (url) => page(url, url.endsWith('/robots.txt') ? '' : feed()),
    },
    extensionOptions: { cronSecret: 'test-only-scheduled-credential' },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await app.locals.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${origin}/api/intelligence`)).status, 401);
  const boot = await fetch(`${origin}/api/bootstrap`);
  let cookie = boot.headers.get('set-cookie').split(';')[0];
  let csrf = (await boot.json()).csrfToken;
  const call = async (path, body, { token = csrf, authorization } = {}) => {
    const result = await fetch(`${origin}/api${path}`, {
      method: 'POST',
      headers: {
        cookie,
        origin,
        'Content-Type': 'application/json',
        'x-csrf-token': token,
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify(body || {}),
    });
    if (result.headers.get('set-cookie')) cookie = result.headers.get('set-cookie').split(';')[0];
    return { status: result.status, body: await result.json() };
  };
  assert.equal((await call('/intelligence/catalog/nta', {}, { token: '' })).status, 403);
  assert.equal((await call('/intelligence/catalog/nta')).status, 201);
  const switched = await call('/auth/demo-role', { role: 'contributor' });
  assert.equal(switched.status, 200);
  csrf = switched.body.csrfToken;
  assert.equal((await call('/intelligence/run')).status, 403);
  assert.equal(
    (await call('/intelligence/sites', { url: 'https://school.example.org/' })).status,
    403,
  );
  assert.equal((await fetch(`${origin}/api/intelligence/cron`)).status, 401);
  assert.equal(
    (
      await fetch(`${origin}/api/intelligence/cron`, {
        headers: { Authorization: 'Bearer test-only-scheduled-credential' },
      })
    ).status,
    200,
  );
});

test('migrations disabled only checks the intelligence version marker', async () => {
  const app = { get() {}, post() {}, patch() {}, delete() {} };
  const context = {
    db: {
      prepare: () => ({ get: async () => ({ value: '1' }) }),
      transaction() {
        assert.fail('No migration transaction expected.');
      },
      exec() {
        assert.fail('No DDL expected.');
      },
    },
    config: { migrate: false },
    now: () => new Date(),
    requireAuth() {},
    requireManager() {},
  };
  assert.equal(typeof (await registerIntelligence(app, context)).runDue, 'function');
  context.db.prepare = () => ({ get: async () => undefined });
  await assert.rejects(
    () => registerIntelligence(app, context),
    /Intelligence database migration required/,
  );
});
