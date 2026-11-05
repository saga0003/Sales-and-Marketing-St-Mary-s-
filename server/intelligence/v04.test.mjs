import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, insertResource } from '../database.mjs';
import { createApp } from '../app.mjs';
import { registerIntelligence } from './index.mjs';
import { normalizePublicPage, publicPageUrl } from './page-monitoring.mjs';

const manager = { id: 'v04_manager', name: 'Research manager', role: 'manager' };
const contributor = { id: 'v04_contributor', name: 'Research contributor', role: 'contributor' };
const responsePage = (url, text, type = 'text/html') => ({
  url,
  text,
  status: 200,
  headers: { 'content-type': type },
});
const website = (
  detail = 'Admissions information for families is available from the school office.',
  clock = '09:00',
) =>
  `<html><head><title>School updates</title></head><body><nav>Current time ${clock}</nav><main><h1>School updates</h1><p>${detail}</p><script>fake news</script></main><footer>Generated ${clock}</footer></body></html>`;
async function fixture(t) {
  const db = await openDatabase(':memory:');
  let clock = Date.parse('2026-11-05T04:00:00Z');
  const now = () => new Date(clock);
  for (const actor of [manager, contributor])
    await db
      .prepare(
        'INSERT INTO users(id,name,email,role,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        actor.id,
        actor.name,
        `${actor.id}@example.invalid`,
        actor.role,
        'not-used',
        now().toISOString(),
        now().toISOString(),
      );
  let read = async (url) =>
    responsePage(
      url,
      url.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /' : website(),
      url.endsWith('/robots.txt') ? 'text/plain' : 'text/html',
    );
  const hooks = await registerIntelligence(
    { get() {}, post() {}, patch() {}, delete() {} },
    {
      db,
      now,
      config: { migrate: true },
      requireAuth() {},
      requireManager() {},
      options: { reader: (...args) => read(...args) },
    },
  );
  t.after(() => db.close());
  const competitor = async (platform = 'website', name = 'Example academy') =>
    insertResource(
      db,
      'competitors',
      {
        name,
        platform,
        url:
          platform === 'google_business'
            ? 'https://www.google.com/maps/place/example-academy'
            : `https://academy.example.org/${name.replaceAll(' ', '-')}`,
        category: 'School',
        notes: '',
        monitoringStatus: 'manual',
      },
      now().toISOString(),
    );
  return {
    db,
    now,
    ...hooks.services,
    hooks,
    competitor,
    advance: (ms) => {
      clock += ms;
    },
    setReader: (value) => {
      read = value;
    },
  };
}
const examInput = (extra = {}) => ({
  name: 'Example entrance examination',
  category: 'Entrance',
  streams: ['Science'],
  description:
    'A team-maintained examination reference; eligibility must be checked in the official notice.',
  academicYear: '2027–28',
  eligibilityNotes: 'Check the current official requirements.',
  referenceLinks: [{ label: 'Official examination site', url: 'https://board.example.org/exam' }],
  milestones: [
    {
      label: 'Application window',
      date: '2027-02-01',
      notes: 'Tentative research note',
      referenceUrl: 'https://board.example.org/exam',
    },
  ],
  ...extra,
});

test('public-page snapshots ignore navigation churn, retain meaningful changes and bound history', async (t) => {
  const f = await fixture(t),
    competitor = await f.competitor();
  const monitor = await f.monitoring.createPageMonitor({ competitorId: competitor.id }, manager);
  const first = await f.monitoring.checkPage(monitor.id, { actor: manager });
  assert.equal(first.baseline, true);
  assert.equal(first.changed, false);
  assert.equal(first.snapshot.verification, 'unverified');
  assert.ok(!first.snapshot.contentText.includes('fake news'));
  f.advance(60001);
  f.setReader(async (url) =>
    responsePage(url, url.endsWith('/robots.txt') ? '' : website(undefined, '09:02')),
  );
  assert.equal((await f.monitoring.checkPage(monitor.id)).changed, false);
  assert.equal((await f.monitoring.pageSnapshots(monitor.id)).length, 1);
  for (let i = 0; i < 31; i += 1) {
    f.advance(60001);
    f.setReader(async (url) =>
      responsePage(
        url,
        url.endsWith('/robots.txt')
          ? ''
          : website(`Public academic programme update ${i}: review the original page for details.`),
      ),
    );
    const changed = await f.monitoring.checkPage(monitor.id);
    assert.equal(changed.changed, true);
    assert.equal(changed.baseline, false);
  }
  const snapshots = await f.monitoring.pageSnapshots(monitor.id);
  assert.equal(snapshots.length, 30);
  assert.ok(snapshots[0].comparison.added[0].includes('30'));
  assert.ok(
    Number(
      (
        await f.db
          .prepare("SELECT count(*) AS count FROM audit_log WHERE action='Webpage change detected'")
          .get()
      ).count,
    ) === 31,
  );
});

test('page monitors reject social/private targets, preserve baseline after errors, and cap sweeps', async (t) => {
  const f = await fixture(t),
    competitor = await f.competitor();
  for (const url of [
    'https://127.0.0.1/',
    'https://www.instagram.com/example/',
    'https://www.google.com/maps/place/example',
    'https://example.org:8443/',
  ])
    assert.throws(() => publicPageUrl(url));
  await assert.rejects(
    () => f.monitoring.createPageMonitor({ competitorId: competitor.id }, contributor),
    { code: 'forbidden' },
  );
  const monitor = await f.monitoring.createPageMonitor({ competitorId: competitor.id }, manager);
  await f.monitoring.checkPage(monitor.id);
  await assert.rejects(() => f.monitoring.checkPage(monitor.id), {
    code: 'page_check_rate_limited',
  });
  f.advance(60001);
  f.setReader(async (url) => ({
    ...responsePage(url, url.endsWith('/robots.txt') ? '' : 'Denied'),
    status: url.endsWith('/robots.txt') ? 200 : 403,
  }));
  await assert.rejects(() => f.monitoring.checkPage(monitor.id), { code: 'page_http_error' });
  assert.equal((await f.monitoring.pageSnapshots(monitor.id)).length, 1);
  const failed = (await f.monitoring.listPageMonitors())[0];
  assert.ok(failed.lastSuccessAt < failed.lastCheckedAt);
  assert.equal(failed.status, 'error');
  f.setReader(async (url) => responsePage(url, url.endsWith('/robots.txt') ? '' : website()));
  for (const name of ['Second academy', 'Third academy'])
    await f.monitoring.createPageMonitor(
      { competitorId: (await f.competitor('website', name)).id },
      manager,
    );
  assert.equal((await f.monitoring.runDue({ limit: 99 })).checked, 1);
});

test('page monitor generations rebaseline a changed URL and expired workers cannot overwrite fresh evidence', async (t) => {
  const f = await fixture(t),
    competitor = await f.competitor();
  const monitor = await f.monitoring.createPageMonitor({ competitorId: competitor.id }, manager);
  let resolveOld, started;
  const hasStarted = new Promise((resolve) => {
    started = resolve;
  });
  f.setReader(async (url) => {
    if (url.endsWith('/robots.txt')) return responsePage(url, '');
    started();
    return new Promise((resolve) => {
      resolveOld = () =>
        resolve(
          responsePage(url, website('A stale page response that must not overwrite new evidence.')),
        );
    });
  });
  const old = f.monitoring.checkPage(monitor.id);
  await hasStarted;
  await assert.rejects(() => f.monitoring.checkPage(monitor.id), { code: 'page_monitor_busy' });
  f.advance(90001);
  f.setReader(async (url) =>
    responsePage(
      url,
      url.endsWith('/robots.txt')
        ? ''
        : website('A newer authoritative response was captured after lease recovery.'),
    ),
  );
  await f.monitoring.checkPage(monitor.id);
  resolveOld();
  assert.equal((await old).skipped, true);
  assert.match(
    (await f.monitoring.pageSnapshots(monitor.id))[0].contentText,
    /newer authoritative/,
  );
  await f.monitoring.updatePageMonitor(
    monitor.id,
    { url: 'https://academy.example.org/new-page' },
    manager,
  );
  f.advance(60001);
  const next = await f.monitoring.checkPage(monitor.id);
  assert.equal(next.baseline, true);
  assert.equal(next.changed, false);
  assert.equal(next.snapshot.generation, 2);
});

test('GMB research requests do not fake source checks; cited observations compare metrics and retry safely', async (t) => {
  const f = await fixture(t),
    competitor = await f.competitor('google_business');
  let reads = 0;
  f.setReader(async () => {
    reads += 1;
    throw Error('No profile scraping should occur');
  });
  const queued = await f.monitoring.researchCompetitor(competitor.id, {}, contributor);
  assert.equal(queued.mode, 'assisted');
  assert.equal(queued.request.status, 'pending');
  assert.equal(queued.request.displayStatus, 'Needs research');
  assert.equal(
    (await f.monitoring.researchCompetitor(competitor.id, {}, contributor)).request.id,
    queued.request.id,
  );
  assert.equal(reads, 0);
  assert.equal(
    (await f.db.prepare('SELECT last_checked_at FROM competitors WHERE id=?').get(competitor.id))
      .last_checked_at,
    null,
  );
  const input = {
    observedAt: f.now().toISOString(),
    summary: 'The public profile was inspected and the visible review count was recorded.',
    evidenceUrls: [competitor.url],
    metrics: { reviewCount: 10, rating: 4.1 },
    recentItems: [
      { title: 'A public profile update', url: 'https://school.example.org/public-update' },
    ],
    requestId: queued.request.id,
    idempotencyKey: 'first-record-001',
  };
  const first = await f.monitoring.recordObservation(competitor.id, input, contributor);
  assert.equal(first.observation.comparison.baseline, true);
  assert.equal(first.observation.verification, 'unverified');
  assert.equal(
    (await f.monitoring.recordObservation(competitor.id, input, contributor)).existing,
    true,
  );
  await assert.rejects(
    () =>
      f.monitoring.recordObservation(
        competitor.id,
        { ...input, summary: 'Conflicting repeated evidence under the same key.' },
        contributor,
      ),
    { code: 'idempotency_conflict' },
  );
  assert.equal((await f.monitoring.researchContext(queued.request.id)).request.status, 'completed');
  f.advance(86400000);
  const next = await f.monitoring.recordObservation(
    competitor.id,
    {
      ...input,
      observedAt: f.now().toISOString(),
      metrics: { reviewCount: 12, rating: 4 },
      recentItems: [],
      requestId: undefined,
      idempotencyKey: 'second-record-002',
    },
    contributor,
  );
  assert.equal(
    next.observation.comparison.metricChanges.find((item) => item.key === 'reviewCount').delta,
    2,
  );
  assert.equal(
    next.observation.comparison.metricChanges.find((item) => item.key === 'rating').delta,
    -0.1,
  );
  assert.equal(next.observation.comparison.newItems.length, 0);
  assert.equal('removedItems' in next.observation.comparison, false);
  assert.equal((await f.monitoring.observations(competitor.id)).length, 2);
  await assert.rejects(
    () =>
      f.monitoring.recordObservation(
        competitor.id,
        { ...input, observedAt: '2099-01-01T00:00:00Z' },
        contributor,
      ),
    { code: 'invalid_observation_time' },
  );
});

test('research results require evidence, remain unverified and protect completed work from stale overwrites', async (t) => {
  const f = await fixture(t),
    exam = await f.education.createExam(examInput(), contributor);
  const queued = await f.monitoring.requestResearch(
    { targetType: 'exam', targetId: exam.id },
    manager,
  );
  await assert.rejects(() => f.monitoring.cancelResearch(queued.request.id, contributor), {
    code: 'forbidden',
  });
  const input = {
    summary: 'The original examination notice was read; these are notes for manager review.',
    evidenceUrls: ['https://board.example.org/exam'],
    observedAt: f.now().toISOString(),
    expectedRevision: 1,
  };
  await assert.rejects(
    () =>
      f.monitoring.recordResearchResult(
        queued.request.id,
        { ...input, evidenceUrls: [] },
        contributor,
      ),
    { code: 'validation_error' },
  );
  await assert.rejects(
    () =>
      f.monitoring.recordResearchResult(
        queued.request.id,
        { ...input, expectedRevision: 2 },
        contributor,
      ),
    { code: 'revision_conflict' },
  );
  const result = await f.monitoring.recordResearchResult(queued.request.id, input, contributor);
  assert.equal(result.status, 'completed');
  assert.equal(result.verification, 'unverified');
  assert.equal(
    (await f.monitoring.recordResearchResult(queued.request.id, input, contributor)).id,
    result.id,
  );
  await assert.rejects(
    () =>
      f.monitoring.recordResearchResult(
        queued.request.id,
        { ...input, summary: 'A stale worker attempted to replace a completed research result.' },
        contributor,
      ),
    { code: 'revision_conflict' },
  );
  assert.equal((await f.education.getExam(exam.id)).verification, 'unverified');
  const history = await f.monitoring.researchContext(queued.request.id);
  assert.equal(history.target.id, exam.id);
});

test('exam and career records protect revisions, preserve omitted fields, and require manager source review', async (t) => {
  const f = await fixture(t);
  let exam = await f.education.createExam(examInput(), contributor);
  await assert.rejects(() => f.education.createExam(examInput(), contributor), {
    code: 'exam_exists',
  });
  await assert.rejects(
    () =>
      f.education.createExam(
        { ...examInput({ name: 'Another exam' }), verified: true },
        contributor,
      ),
    { code: 'validation_error' },
  );
  await assert.rejects(
    () => f.education.verifyExam(exam.id, { expectedRevision: 1 }, contributor),
    { code: 'forbidden' },
  );
  exam = await f.education.updateExam(
    exam.id,
    { expectedRevision: 1, description: 'A revised source-linked description for team review.' },
    contributor,
  );
  assert.equal(exam.academicYear, '2027–28');
  assert.equal(exam.milestones.length, 1);
  assert.equal(exam.eligibilityNotes, 'Check the current official requirements.');
  await assert.rejects(
    () => f.education.updateExam(exam.id, { expectedRevision: 1, name: 'Stale name' }, contributor),
    { code: 'revision_conflict' },
  );
  let pathway = await f.education.createPathway(
    {
      name: 'Science research route',
      stream: 'Science',
      field: 'Pure sciences',
      description: 'An editable career planning route; research current admission rules.',
      academicYear: '2027–28',
      entryRoutes: [
        {
          name: 'Entrance route',
          method: 'Read the current examination prospectus.',
          examIds: [exam.id],
          requirements: 'Check subject and age requirements.',
          education: 'Verify current programmes.',
          outcomes: 'Research training options.',
          referenceUrls: ['https://board.example.org/prospectus'],
        },
      ],
    },
    contributor,
  );
  await assert.rejects(
    () => f.education.verifyPathway(pathway.id, { expectedRevision: 1 }, manager),
    { code: 'exam_review_required' },
  );
  await f.education.verifyExam(exam.id, { expectedRevision: 2 }, manager);
  pathway = await f.education.verifyPathway(pathway.id, { expectedRevision: 1 }, manager);
  assert.equal(pathway.verification, 'verified');
  await f.education.updateExam(
    exam.id,
    {
      expectedRevision: 2,
      eligibilityNotes: 'A later source changed the requirements; review again.',
    },
    contributor,
  );
  const changedPath = await f.education.getPathway(pathway.id);
  assert.equal(changedPath.verification, 'unverified');
  assert.equal(changedPath.revision, 2);
  const updatedPath = await f.education.updatePathway(
    pathway.id,
    {
      expectedRevision: 2,
      description: 'Expanded career route notes for the current academic year.',
    },
    contributor,
  );
  assert.equal(updatedPath.entryRoutes.length, 1);
  assert.equal(updatedPath.academicYear, '2027–28');
});

test('new linked source notices invalidate verified exam and pathway guidance without erasing evidence', async (t) => {
  const f = await fixture(t);
  const source = await insertResource(
    f.db,
    'sources',
    {
      name: 'Board',
      url: 'https://board.example.org/feed',
      category: 'Exam update',
      status: 'manual',
    },
    f.now().toISOString(),
  );
  const watch = await f.watches.create(
    {
      kind: 'source',
      resourceId: source.id,
      mode: 'rss',
      url: source.url,
      keywords: [],
      intervalHours: 6,
      active: true,
    },
    manager,
  );
  const feed = (title) =>
    `<rss><channel><item><guid>notice</guid><title>${title}</title><link>https://board.example.org/notice</link></item></channel></rss>`;
  f.setReader(async (url) =>
    responsePage(
      url,
      url.endsWith('/robots.txt') ? '' : feed('Examination application notice'),
      url.endsWith('/robots.txt') ? 'text/plain' : 'application/rss+xml',
    ),
  );
  await f.watches.run(watch.id);
  const exam = await f.education.createExam(
    examInput({ watchIds: [watch.id], status: 'tracking' }),
    contributor,
  );
  await f.education.verifyExam(exam.id, { expectedRevision: 1 }, manager);
  const pathway = await f.education.createPathway(
    {
      name: 'Admission route',
      stream: 'Science',
      field: 'Science',
      description: 'Check current entry requirements before using this guidance.',
      entryRoutes: [
        {
          name: 'Entrance',
          method: 'Check the current exam notice.',
          examIds: [exam.id],
          referenceUrls: [source.url],
        },
      ],
    },
    contributor,
  );
  await f.education.verifyPathway(pathway.id, { expectedRevision: 1 }, manager);
  f.advance(60001);
  f.setReader(async (url) =>
    responsePage(
      url,
      url.endsWith('/robots.txt') ? '' : feed('Revised examination application deadline'),
      url.endsWith('/robots.txt') ? 'text/plain' : 'application/rss+xml',
    ),
  );
  const changed = await f.watches.run(watch.id);
  assert.equal(changed.updated, 1);
  assert.equal((await f.education.getExam(exam.id)).verification, 'unverified');
  assert.equal((await f.education.getPathway(pathway.id)).verification, 'unverified');
  assert.equal((await f.watches.notices()).length, 1);
});

test('v0.4 routes enforce session/CSRF, allow research drafts and reserve verification for managers', async (t) => {
  const app = await createApp({
    databasePath: ':memory:',
    demoMode: true,
    secureCookies: false,
    serveStatic: false,
    registerExtensions: async () => ({}),
    intelligenceOptions: {
      reader: async (url) => responsePage(url, url.endsWith('/robots.txt') ? '' : website()),
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await app.locals.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${origin}/api/intelligence/education`)).status, 401);
  const boot = await fetch(`${origin}/api/bootstrap`);
  let cookie = boot.headers.get('set-cookie').split(';')[0],
    csrf = (await boot.json()).csrfToken;
  const call = async (path, body, token = csrf) => {
    const res = await fetch(`${origin}/api${path}`, {
      method: 'POST',
      headers: { cookie, origin, 'content-type': 'application/json', 'x-csrf-token': token },
      body: JSON.stringify(body),
    });
    if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  assert.equal((await call('/intelligence/exams', examInput(), '')).status, 403);
  const switched = await call('/auth/demo-role', { role: 'contributor' });
  csrf = switched.body.csrfToken;
  const created = await call('/intelligence/exams', examInput());
  assert.equal(created.status, 201);
  assert.equal(
    (await call(`/intelligence/exams/${created.body.exam.id}/verify`, { expectedRevision: 1 }))
      .status,
    403,
  );
  assert.equal(
    (await call('/intelligence/page-monitors', { competitorId: 'irrelevant' })).status,
    403,
  );
  const requested = await call('/intelligence/research-requests', {
    targetType: 'exam',
    targetId: created.body.exam.id,
  });
  assert.equal(requested.status, 201);
  assert.equal(requested.body.request.status, 'pending');
  const view = await fetch(
    `${origin}/api/intelligence/research-requests/${requested.body.request.id}`,
    { headers: { cookie } },
  );
  assert.equal(view.status, 200);
  assert.equal((await view.json()).target.id, created.body.exam.id);
});

test('page normalization never interprets hidden script markup as public content and rejects empty JS shells', () => {
  assert.throws(
    () =>
      normalizePublicPage(
        responsePage(
          'https://school.example.org/',
          '<html><body><script>content is loaded later</script></body></html>',
        ),
      ),
    { code: 'page_content_unavailable' },
  );
  const result = normalizePublicPage(
    responsePage(
      'https://school.example.org/',
      website('A useful academic update with enough readable text for an evidence baseline.'),
    ),
  );
  assert.equal(result.scope, 'main');
  assert.ok(!result.contentText.includes('Current time'));
  assert.ok(!result.contentText.includes('Generated'));
});
