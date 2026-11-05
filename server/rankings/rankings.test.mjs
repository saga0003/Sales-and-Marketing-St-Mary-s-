import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openDatabase } from '../database.mjs';
import { registerRankings } from './index.mjs';
import {
  calendarDate,
  searchRange,
  searchQuery,
  normalizeSearchRows,
  positionChange,
  createSearchConsoleReader,
} from './search-console.mjs';

const manager = { id: 'keyword_manager', name: 'Keyword manager', role: 'manager' };
const author = { id: 'keyword_author', name: 'Keyword contributor', role: 'contributor' };
const response = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const reported = (date, position = 10) => ({
  keys: [date],
  position,
  clicks: 4,
  impressions: 40,
  ctr: 0.1,
});

async function fixture(t, options = {}) {
  const db = await openDatabase(':memory:');
  let clock = Date.parse('2026-11-05T06:00:00Z');
  const now = () => new Date(clock);
  for (const actor of [manager, author]) {
    await db
      .prepare(
        'INSERT INTO users(id,name,email,role,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        actor.id,
        actor.name,
        `${actor.id}@example.invalid`,
        actor.role,
        'unused',
        now().toISOString(),
        now().toISOString(),
      );
  }
  await db.exec(await readFile(new URL('../extensions/schema.sql', import.meta.url), 'utf8'));
  for (const [id, account, institution] of [
    ['sc_one', 'sc-domain:school.example.org', 'St. Mary’s ISC'],
    ['sc_two', 'https://other.example.org/', 'St. Mary’s ISC'],
    ['sc_three', 'sc-domain:primary.example.org', 'St. Mary’s ICSE'],
  ]) {
    await db
      .prepare(
        "INSERT INTO service_connections(id,provider,account_id,account_name,institution,status,capabilities,encrypted_credentials,connected_by,created_at) VALUES(?,'search_console',?,?,?,'connected','[\"analytics:read\"]','unused',?,?)",
      )
      .run(id, account, account, institution, manager.id, now().toISOString());
  }
  const calls = [];
  let handler = (_url, input) => {
    const body = JSON.parse(input.body);
    return response({ rows: [reported(body.startDate, 12), reported(body.endDate, 8)] });
  };
  const app = { get() {}, post() {}, patch() {}, delete() {} };
  const hooks = await registerRankings(app, {
    db,
    config: { migrate: true },
    now,
    requireAuth() {},
    requireManager() {},
    options: {
      automationEnabled: options.automationEnabled ?? true,
      withSearchConsole: async (id, expected, callback) => {
        const row = await db.prepare('SELECT * FROM service_connections WHERE id=?').get(id);
        assert.equal(row.account_id, expected.accountId);
        assert.equal(row.institution, expected.institution);
        return callback(row, { accessToken: 'fixture-token' }, {});
      },
      fetch: async (url, input) => {
        calls.push({ url, input, body: JSON.parse(input.body) });
        return handler(url, input);
      },
    },
  });
  t.after(() => db.close());
  return {
    db,
    now,
    calls,
    hooks,
    keywords: hooks.services.keywords,
    advance: (milliseconds) => {
      clock += milliseconds;
    },
    setFetch: (value) => {
      handler = value;
    },
    create: (extra = {}) =>
      hooks.services.keywords.create(
        {
          keyword: 'best PU college in Chikmagalur',
          institution: 'St. Mary’s ISC',
          connectionId: 'sc_one',
          answerTargetUrl: 'https://school.example.org/',
          ...extra,
        },
        manager,
      ),
  };
}

test('Search Console requests keep exact query/filter identity and use settled Pacific calendar days', () => {
  assert.equal(calendarDate(new Date('2026-11-05T06:00:00Z')), '2026-11-04');
  const range = searchRange(new Date('2026-11-05T06:00:00Z'), false);
  assert.deepEqual(range, { startDate: '2026-10-05', endDate: '2026-11-01' });
  assert.deepEqual(searchRange(new Date('2026-11-05T06:00:00Z'), true), {
    startDate: '2026-10-26',
    endDate: '2026-11-01',
  });
  const query = searchQuery(
    {
      keyword: 'Best PU College',
      country: 'ind',
      device: 'MOBILE',
      search_type: 'web',
      page_url: 'https://school.example.org/admissions/',
    },
    range,
  );
  assert.equal(query.dataState, 'final');
  assert.deepEqual(query.dimensions, ['date']);
  assert.equal(query.aggregationType, 'byPage');
  assert.deepEqual(query.dimensionFilterGroups[0].filters, [
    { dimension: 'query', operator: 'equals', expression: 'Best PU College' },
    { dimension: 'country', operator: 'equals', expression: 'ind' },
    { dimension: 'device', operator: 'equals', expression: 'MOBILE' },
    { dimension: 'page', operator: 'equals', expression: 'https://school.example.org/admissions/' },
  ]);
});

test('missing query rows are gaps, lower average position is improvement, and unexpected dates cannot enter history', () => {
  const range = { startDate: '2026-10-30', endDate: '2026-11-01' };
  const samples = normalizeSearchRows(
    { rows: [reported('2026-10-30', 14), reported('2026-11-01', 9)] },
    range,
  );
  assert.equal(samples[1].position, null);
  assert.equal(samples[1].impressions, null);
  assert.equal(samples[1].availability, 'no_row');
  assert.equal(positionChange(samples).improvement, 5);
  assert.equal(positionChange(samples).previous.date, '2026-10-30');
  assert.equal(positionChange(normalizeSearchRows({}, range)).improvement, null);
  assert.throws(() => normalizeSearchRows({ rows: [reported('2026-11-03')] }, range), {
    code: 'invalid_provider_response',
  });
  assert.throws(
    () => normalizeSearchRows({ rows: [reported('2026-11-01'), reported('2026-11-01')] }, range),
    { code: 'invalid_provider_response' },
  );
  assert.throws(() => normalizeSearchRows({ rows: [reported('2026-11-01', 0)] }, range), {
    code: 'invalid_provider_response',
  });
});

test('keyword permission and identity checks isolate schools, properties, devices and exact queries', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    () =>
      f.keywords.create(
        { keyword: 'school', institution: 'St. Mary’s ISC' },
        { ...author, role: 'manager' },
      ),
    { status: 403 },
  );
  const first = await f.create();
  const second = await f.create({ connectionId: 'sc_two' });
  const mobile = await f.create({ device: 'MOBILE' });
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.id, mobile.id);
  await assert.rejects(() => f.create(), { code: 'duplicate_keyword' });
  await assert.rejects(() => f.create({ connectionId: 'sc_three' }), {
    code: 'keyword_identity_mismatch',
  });
  await assert.rejects(() => f.keywords.update(first.id, { connectionId: 'sc_two' }, manager), {
    code: 'keyword_identity_mismatch',
  });
  await assert.rejects(() => f.keywords.update(first.id, { keyword: 'changed query' }, manager), {
    status: 422,
  });
  await assert.rejects(() => f.keywords.sync(first.id, author), { status: 403 });
  await assert.rejects(() => f.keywords.remove(first.id, author), { status: 403 });
});

test('keywords can be planned without a connection but daily imports require eligible access', async (t) => {
  const f = await fixture(t);
  const keyword = await f.create({ connectionId: null });
  assert.equal(keyword.status, 'awaiting_connection');
  assert.deepEqual(keyword.searchHistory, []);
  assert.equal(keyword.autoSync, false);
  await assert.rejects(() => f.keywords.update(keyword.id, { autoSync: true }, manager), {
    code: 'search_connection_required',
  });
  const connected = await f.keywords.update(
    keyword.id,
    { connectionId: 'sc_one', autoSync: true },
    manager,
  );
  assert.equal(connected.autoSync, true);
  assert.equal(connected.propertyId, 'sc-domain:school.example.org');
  assert.equal(connected.status, 'awaiting_data');
});

test('daily imports retain history, refresh overlaps idempotently and keep missing dates as null', async (t) => {
  const f = await fixture(t);
  const keyword = await f.create({ country: 'IND', autoSync: true });
  const initial = await f.keywords.sync(keyword.id, manager);
  assert.equal(initial.keyword.searchHistory.length, 28);
  assert.equal(initial.reportedDays, 2);
  assert.equal(initial.keyword.searchHistory[1].position, null);
  assert.match(
    f.calls[0].url,
    /^https:\/\/www\.googleapis\.com\/webmasters\/v3\/sites\/sc-domain%3Aschool\.example\.org\/searchAnalytics\/query$/,
  );
  assert.equal(f.calls[0].body.dimensionFilterGroups[0].filters[1].expression, 'ind');
  assert.equal(f.calls[0].input.redirect, 'error');
  await assert.rejects(() => f.keywords.sync(keyword.id, manager), { status: 429 });
  f.advance(6 * 60000);
  f.setFetch((_url, input) => response({ rows: [reported(JSON.parse(input.body).endDate, 8)] }));
  const repeat = await f.keywords.sync(keyword.id, manager);
  assert.equal(repeat.keyword.searchHistory.length, 28);
  assert.equal(repeat.changedDays, 0);
  f.advance(86400000);
  f.setFetch(() => response({ rows: [reported('2026-11-01', 8), reported('2026-11-02', 8)] }));
  const daily = await f.keywords.runDue();
  assert.equal(daily.processed, 1);
  const saved = await f.keywords.get(keyword.id);
  assert.equal(saved.searchHistory.length, 29);
  assert.equal(saved.movement.latest.date, '2026-11-02');
  assert.equal(saved.movement.improvement, 0);
  assert.ok(saved.nextSyncAt > f.now().toISOString());
});

test('manual and MCP evidence never overwrite authorized API samples and exact retries deduplicate', async (t) => {
  const f = await fixture(t);
  const keyword = await f.create();
  await f.keywords.sync(keyword.id, manager);
  const input = {
    date: '2026-11-01',
    position: 2,
    evidenceUrl: 'https://search.google.com/search-console/performance/search-analytics',
    notes: 'Exported report observation, manually checked for this property.',
  };
  const first = await f.keywords.recordSearchObservation(keyword.id, input, author, { via: 'mcp' });
  const duplicate = await f.keywords.recordSearchObservation(keyword.id, input, author, {
    via: 'mcp',
  });
  assert.equal(first.id, duplicate.id);
  assert.equal(duplicate.duplicate, true);
  const saved = await f.keywords.get(keyword.id);
  assert.equal(saved.searchEvidence.length, 1);
  assert.equal(saved.searchEvidence[0].provenance, 'mcp');
  assert.equal(saved.searchHistory.at(-1).position, 8);
  assert.equal(saved.recordedSearchHistory.at(-1).position, 2);
  await assert.rejects(
    () =>
      f.keywords.recordSearchObservation(
        keyword.id,
        { ...input, provenance: 'search_console' },
        author,
      ),
    { status: 422 },
  );
  await assert.rejects(
    () =>
      f.keywords.recordSearchObservation(
        keyword.id,
        { ...input, evidenceUrl: 'https://school.example.org/?access_token=secret' },
        author,
      ),
    { code: 'unsafe_evidence_url' },
  );
  await assert.rejects(
    () => f.keywords.recordSearchObservation(keyword.id, { ...input, date: '2099-01-01' }, author),
    { code: 'invalid_observation_time' },
  );
});

test('binding a planned keyword preserves original evidence without relabelling its chart as property data', async (t) => {
  const f = await fixture(t);
  const keyword = await f.create({ connectionId: null });
  const input = {
    date: '2026-11-01',
    position: 7,
    evidenceUrl: 'https://school.example.org/research/',
    notes: 'Initial manual check before a property was selected.',
  };
  await f.keywords.recordSearchObservation(keyword.id, input, author);
  assert.equal((await f.keywords.get(keyword.id)).recordedSearchHistory.length, 1);
  await f.keywords.update(keyword.id, { connectionId: 'sc_one' }, manager);
  const bound = await f.keywords.get(keyword.id);
  assert.equal(bound.recordedSearchHistory.length, 0);
  assert.equal(bound.searchEvidence.length, 1);
  assert.equal(bound.searchEvidence[0].identitySnapshot.propertyId, '');
  await f.keywords.recordSearchObservation(keyword.id, input, author);
  const updated = await f.keywords.get(keyword.id);
  assert.equal(updated.recordedSearchHistory.length, 1);
  assert.equal(updated.searchEvidence.length, 2);
});

test('answer trends are prompt/model/context specific, cite real target URLs and retain immutable observations', async (t) => {
  const f = await fixture(t);
  const keyword = await f.create({
    answerPrompt: 'Which colleges in Chikmagalur offer integrated science preparation?',
  });
  const input = {
    provider: 'ChatGPT',
    model: 'Model shown by user',
    checkedAt: '2026-11-05T05:00:00Z',
    answerExcerpt: 'A recorded test answer mentions the school and includes its website.',
    mentioned: true,
    cited: true,
    citationUrls: ['https://school.example.org/admissions/'],
    notes: 'Recorded by a contributor after reviewing the actual answer.',
  };
  const first = await f.keywords.recordAnswerObservation(keyword.id, input, author, { via: 'mcp' });
  const repeat = await f.keywords.recordAnswerObservation(keyword.id, input, author, {
    via: 'mcp',
  });
  assert.equal(first.id, repeat.id);
  await f.keywords.recordAnswerObservation(
    keyword.id,
    {
      ...input,
      checkedAt: '2026-11-05T05:30:00Z',
      mentioned: false,
      cited: false,
      citationUrls: [],
    },
    author,
  );
  let saved = await f.keywords.get(keyword.id);
  assert.equal(saved.answerEvidence.length, 2);
  assert.equal(saved.answerSeries.length, 1);
  assert.deepEqual(saved.answerSeries[0].points, [
    { date: '2026-11-05', checks: 2, mentionRate: 50, citationRate: 50 },
  ]);
  await assert.rejects(
    () =>
      f.keywords.recordAnswerObservation(
        keyword.id,
        { ...input, citationUrls: ['https://another.example.org/'] },
        author,
      ),
    { code: 'citation_evidence_mismatch' },
  );
  await f.keywords.update(
    keyword.id,
    { answerPrompt: 'A different explicit question about commerce colleges.' },
    manager,
  );
  await f.keywords.recordAnswerObservation(
    keyword.id,
    { ...input, checkedAt: '2026-11-05T05:45:00Z' },
    author,
  );
  saved = await f.keywords.get(keyword.id);
  assert.equal(saved.answerSeries.length, 2);
  assert.equal(saved.answerEvidence[2].prompt, keyword.answerPrompt);
  assert.equal(
    saved.answerEvidence[0].prompt,
    'A different explicit question about commerce colleges.',
  );
  await assert.rejects(
    () =>
      f.keywords.recordAnswerObservation(
        keyword.id,
        { ...input, checkedAt: '2027-01-01T00:00:00Z' },
        author,
      ),
    { code: 'invalid_observation_time' },
  );
  assert.equal(f.calls.length, 0);
});

test('automatic workers are bounded, skip disabled tracks and do not issue duplicate concurrent queries', async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 5; index += 1)
    await f.create({ keyword: `tracked query ${index}`, autoSync: true });
  await f.create({ keyword: 'not automatic' });
  const first = await f.keywords.runDue({ limit: 100 });
  assert.equal(first.processed, 3);
  assert.equal(f.calls.length, 3);
  const second = await f.keywords.runDue();
  assert.equal(second.processed, 2);
  assert.equal(f.calls.length, 5);
  const third = await f.keywords.runDue();
  assert.equal(third.processed, 0);
  const another = await f.create({ keyword: 'concurrent claim', autoSync: true });
  let release;
  let requested;
  const started = new Promise((resolve) => {
    requested = resolve;
  });
  f.setFetch(
    (_url, input) =>
      new Promise((resolve) => {
        release = () => resolve(response({ rows: [reported(JSON.parse(input.body).endDate)] }));
        requested();
      }),
  );
  const pending = f.keywords.runDue();
  await started;
  assert.equal((await f.keywords.runDue()).processed, 0);
  release();
  assert.equal((await pending).processed, 1);
  assert.equal((await f.keywords.get(another.id)).status, 'ready');
});

test('expired worker leases are fenced and pausing in-flight work prevents a stale result being saved', async (t) => {
  const f = await fixture(t);
  const keyword = await f.create({ autoSync: true });
  let releaseOld;
  let started;
  const requested = new Promise((resolve) => {
    started = resolve;
  });
  f.setFetch(
    (_url, input) =>
      new Promise((resolve) => {
        releaseOld = () =>
          resolve(response({ rows: [reported(JSON.parse(input.body).endDate, 40)] }));
        started();
      }),
  );
  const old = f.keywords.runDue();
  await requested;
  f.advance(6 * 60000);
  f.setFetch((_url, input) => response({ rows: [reported(JSON.parse(input.body).endDate, 5)] }));
  assert.equal((await f.keywords.runDue()).processed, 1);
  releaseOld();
  assert.equal((await old).results[0].status, 'failed');
  assert.equal((await f.keywords.get(keyword.id)).movement.latest.position, 5);
  f.advance(86400000);
  let releasePaused;
  let startedPaused;
  const requestedPaused = new Promise((resolve) => {
    startedPaused = resolve;
  });
  f.setFetch(
    (_url, input) =>
      new Promise((resolve) => {
        releasePaused = () =>
          resolve(response({ rows: [reported(JSON.parse(input.body).endDate, 2)] }));
        startedPaused();
      }),
  );
  const pending = f.keywords.runDue();
  await requestedPaused;
  await f.keywords.update(keyword.id, { autoSync: false }, manager);
  releasePaused();
  assert.equal((await pending).results[0].status, 'failed');
  assert.equal((await f.keywords.get(keyword.id)).movement.latest.position, 5);
});

test('provider failures keep previous samples and delay the next automatic attempt', async (t) => {
  const f = await fixture(t);
  const keyword = await f.create({ autoSync: true });
  await f.keywords.sync(keyword.id, manager);
  f.advance(86400000);
  f.setFetch(() => response({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, 403));
  const failed = await f.keywords.runDue();
  assert.equal(failed.results[0].status, 'failed');
  const saved = await f.keywords.get(keyword.id);
  assert.equal(saved.searchHistory.length, 28);
  assert.equal(saved.movement.latest.position, 8);
  assert.match(saved.error, /quota/);
  assert.ok(saved.nextSyncAt > f.now().toISOString());
  assert.equal((await f.keywords.runDue()).processed, 0);
});

test('an account identity changed while a provider request is running cannot relabel saved history', async (t) => {
  const f = await fixture(t);
  const keyword = await f.create({ autoSync: true });
  let release;
  let started;
  const requested = new Promise((resolve) => {
    started = resolve;
  });
  f.setFetch(
    (_url, input) =>
      new Promise((resolve) => {
        release = () => resolve(response({ rows: [reported(JSON.parse(input.body).endDate)] }));
        started();
      }),
  );
  const pending = f.keywords.runDue();
  await requested;
  await f.db
    .prepare(
      "UPDATE service_connections SET account_id='sc-domain:changed.example.org' WHERE id='sc_one'",
    )
    .run();
  release();
  assert.equal((await pending).results[0].status, 'failed');
  assert.equal((await f.keywords.get(keyword.id)).searchHistory.length, 0);
  assert.equal((await f.keywords.get(keyword.id)).status, 'awaiting_connection');
  assert.equal((await f.keywords.runDue()).processed, 0);
});

test('the bounded API reader rejects an oversized streamed response and never follows a redirect', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(300 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const reader = createSearchConsoleReader({
    fetch: async (_url, input) => {
      assert.equal(input.redirect, 'error');
      return new Response(body, { headers: { 'Content-Type': 'application/json' } });
    },
  });
  await assert.rejects(
    () =>
      reader(
        {
          provider: 'search_console',
          account_id: 'sc-domain:school.example.org',
          institution: 'St. Mary’s ISC',
        },
        { accessToken: 'fixture-token' },
        {
          property_id: 'sc-domain:school.example.org',
          institution: 'St. Mary’s ISC',
          keyword: 'school',
          country: '',
          device: 'all',
          search_type: 'web',
          page_url: '',
        },
        { startDate: '2026-11-01', endDate: '2026-11-01' },
      ),
    { code: 'invalid_provider_response' },
  );
  assert.equal(cancelled, true);
});
