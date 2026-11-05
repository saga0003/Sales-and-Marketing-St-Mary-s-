import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openDatabase, insertResource } from '../database.mjs';
import { createApp } from '../app.mjs';
import { createWatchService } from './watches.mjs';
import {
  createYoutubePushService,
  validateYoutubeDelivery,
  verifyYoutubeSignature,
  YOUTUBE_PUSH_LIMITS,
} from './youtube-push.mjs';

const actor = { id: 'push_manager', name: 'Push manager', role: 'manager' };
const editor = { id: 'push_editor', name: 'Push contributor', role: 'contributor' };
const channel = 'UCabcdefghijklmnopqrstuv';
const secondChannel = 'UCzyxwvutsrqponmlkjihgfe';
const video = 'AbCdEfGhI12';
const newVideo = 'KlMnOpQrS34';
const origin = 'https://workspace.example.org';
const topic = (id = channel) => `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${id}`;
const entry = ({
  id = video,
  title = 'Admissions questions answered',
  updated = '2026-11-05T00:00:00Z',
  description = 'Original video description',
  channelId = channel,
} = {}) =>
  `<entry><id>yt:video:${id}</id><yt:videoId>${id}</yt:videoId><yt:channelId>${channelId}</yt:channelId><title>${title}</title><link rel="alternate" href="https://www.youtube.com/watch?v=${id}"/><published>2026-11-04T00:00:00Z</published><updated>${updated}</updated>${description === null ? '' : `<media:description>${description}</media:description>`}</entry>`;
const atom = (entries = entry(), channelId = channel) =>
  `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/"><link rel="self" href="${topic(channelId)}"/>${entries}</feed>`;
const signature = (body, secret, algorithm = 'sha256') =>
  `${algorithm}=${createHmac(algorithm, secret).update(body).digest('hex')}`;

async function fixture(t, options = {}) {
  const db = await openDatabase(':memory:');
  let clock = Date.parse('2026-11-05T01:00:00Z');
  const now = () => new Date(clock);
  for (const user of [actor, editor])
    await db
      .prepare(
        'INSERT INTO users(id,name,email,role,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        user.id,
        user.name,
        `${user.id}@example.invalid`,
        user.role,
        'unused',
        now().toISOString(),
        now().toISOString(),
      );
  for (const file of ['schema.sql', 'migration-v2.sql', 'migration-v3.sql'])
    await db.exec(await readFile(new URL(file, import.meta.url), 'utf8'));
  let document = atom();
  const watches = createWatchService({
    db,
    now,
    read: async (url) => ({
      status: 200,
      url,
      text: url.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /' : document,
      headers: {
        'content-type': url.endsWith('/robots.txt') ? 'text/plain' : 'application/atom+xml',
      },
    }),
  });
  const requests = [];
  let hub = async () => new Response(null, { status: 202 });
  const service = createYoutubePushService({
    db,
    now,
    watches,
    publicOrigin: options.publicOrigin ?? origin,
    encryptionKey: options.noKey ? undefined : '83'.repeat(32),
    automationEnabled: options.automationEnabled ?? true,
    fetch: async (url, input) => {
      const form = new URLSearchParams(input.body);
      requests.push({ url, input, form });
      return hub(url, input);
    },
  });
  async function createWatch(channelId = channel, baseline = true) {
    const resource = await insertResource(
      db,
      'competitors',
      {
        name: `Test channel ${channelId}`,
        platform: 'youtube',
        url: `https://www.youtube.com/channel/${channelId}`,
        category: 'Education',
        notes: 'Local fixture only',
        monitoringStatus: 'manual',
      },
      now().toISOString(),
    );
    const watch = await watches.create(
      {
        kind: 'competitor',
        resourceId: resource.id,
        mode: 'youtube',
        url: resource.url,
        keywords: [],
        intervalHours: 6,
        active: true,
      },
      actor,
    );
    if (baseline) {
      document = atom(entry({ channelId }), channelId);
      await watches.run(watch.id, { actor });
    }
    return watch;
  }
  async function activate(id) {
    const state = await service.enable(id, actor);
    const request = requests.at(-1).form;
    const callbackId = new URL(request.get('hub.callback')).pathname.split('/').at(-1);
    const secret = request.get('hub.secret');
    const query = {
      'hub.mode': 'subscribe',
      'hub.topic': request.get('hub.topic'),
      'hub.challenge': 'hub_challenge-123',
      'hub.lease_seconds': '432000',
      'hub.verify_token': request.get('hub.verify_token'),
    };
    assert.equal(state.state, 'pending');
    assert.equal(await service.verify(callbackId, query), query['hub.challenge']);
    return { callbackId, secret, query };
  }
  const receive = (subscription, xml) => {
    const body = Buffer.from(xml);
    return service.receive(subscription.callbackId, body, signature(body, subscription.secret));
  };
  t.after(() => db.close());
  return {
    db,
    now,
    watches,
    service,
    requests,
    createWatch,
    activate,
    receive,
    advance: (milliseconds) => {
      clock += milliseconds;
    },
    setDocument: (value) => {
      document = value;
    },
    setHub: (value) => {
      hub = value;
    },
  };
}

test('push monitoring is opt-in, requires an actual manager and baseline, and generates callback secrets server-side', async (t) => {
  const f = await fixture(t);
  const watch = await f.createWatch(channel, false);
  assert.equal((await f.service.list()).subscriptions[0].state, 'disabled');
  await f.service.runDue();
  assert.equal(f.requests.length, 0);
  await assert.rejects(() => f.service.enable(watch.id, { ...editor, role: 'manager' }), {
    status: 403,
  });
  await assert.rejects(() => f.service.enable(watch.id, actor), {
    code: 'youtube_push_unavailable',
  });
  await f.watches.run(watch.id, { actor });
  const state = await f.service.enable(watch.id, actor);
  assert.equal(state.state, 'pending');
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, 'https://pubsubhubbub.appspot.com/subscribe');
  assert.equal(f.requests[0].input.redirect, 'error');
  assert.equal(f.requests[0].form.get('hub.topic'), topic());
  assert.match(
    f.requests[0].form.get('hub.callback'),
    /^https:\/\/workspace\.example\.org\/api\/intelligence\/youtube-push\/callback\/[A-Za-z0-9_-]{43}$/,
  );
  const stored = await f.db
    .prepare('SELECT encrypted_secret FROM intelligence_youtube_subscriptions WHERE watch_id=?')
    .get(watch.id);
  assert.ok(!stored.encrypted_secret.includes(f.requests[0].form.get('hub.secret')));
  assert.ok(!JSON.stringify(await f.service.list()).includes(f.requests[0].form.get('hub.secret')));
  assert.ok(!JSON.stringify(await f.service.list()).includes('callback_id'));
});

test('hub verification is bound to pending mode/topic/token and rejects script challenges', async (t) => {
  const f = await fixture(t);
  const watch = await f.createWatch();
  const sub = await f.activate(watch.id);
  const original = (await f.service.list()).subscriptions[0].leaseExpiresAt;
  f.advance(60000);
  await f.service.verify(sub.callbackId, sub.query);
  assert.equal((await f.service.list()).subscriptions[0].leaseExpiresAt, original);
  await assert.rejects(
    () => f.service.verify(sub.callbackId, { ...sub.query, 'hub.topic': topic(secondChannel) }),
    { status: 404 },
  );
  await assert.rejects(
    () => f.service.verify(sub.callbackId, { ...sub.query, 'hub.verify_token': 'incorrect' }),
    { status: 404 },
  );
  await assert.rejects(
    () => f.service.verify(sub.callbackId, { ...sub.query, 'hub.mode': 'unsubscribe' }),
    { status: 404 },
  );
  await assert.rejects(
    () =>
      f.service.verify(sub.callbackId, {
        ...sub.query,
        'hub.challenge': '<script>alert(1)</script>',
      }),
    { status: 422 },
  );
  f.advance(20 * 60000);
  await assert.rejects(() => f.service.verify(sub.callbackId, sub.query), { status: 404 });
});

test('signed uploads deduplicate and corrected metadata updates the existing notice and clears linked verification', async (t) => {
  const f = await fixture(t);
  const watch = await f.createWatch();
  const sub = await f.activate(watch.id);
  f.advance(2 * 60000);
  const xml = atom(
    entry({ id: newVideo, updated: f.now().toISOString(), title: 'New campus video' }),
  );
  assert.deepEqual(await f.receive(sub, xml), { added: 1, updated: 0 });
  assert.deepEqual(await f.receive(sub, xml), { duplicate: true });
  const notice = (await f.watches.notices()).find((item) => item.title === 'New campus video');
  assert.equal(notice.baseline, false);
  const brief = await f.watches.createBrief(
    notice.id,
    { audience: 'Parents', contentAngle: 'Review the linked video', priority: 'medium' },
    editor,
  );
  await f.db
    .prepare('UPDATE opportunities SET verified=1,verified_by=? WHERE id=?')
    .run(actor.id, brief.id);
  f.advance(60000);
  const correction = atom(
    entry({
      id: newVideo,
      updated: f.now().toISOString(),
      title: 'Revised campus video title',
      description: null,
    }),
  );
  assert.deepEqual(await f.receive(sub, correction), { added: 0, updated: 1 });
  const saved = (await f.watches.notices()).find((item) => item.id === notice.id);
  assert.equal(saved.title, 'Revised campus video title');
  assert.equal(saved.excerpt, 'Original video description');
  assert.equal(saved.changeKind, 'updated');
  assert.equal((await f.watches.notices()).length, 2);
  assert.equal(
    Number(
      (await f.db.prepare('SELECT verified FROM opportunities WHERE id=?').get(brief.id)).verified,
    ),
    0,
  );
  assert.equal(
    Number(
      (
        await f.db
          .prepare('SELECT COUNT(*) AS count FROM intelligence_notice_history WHERE notice_id=?')
          .get(notice.id)
      ).count,
    ),
    2,
  );
});

test('a signed description-change signal is reviewable even when the hub omits its text', async (t) => {
  const f = await fixture(t);
  const watch = await f.createWatch();
  const sub = await f.activate(watch.id);
  f.advance(2 * 60000);
  const xml = atom(entry({ updated: f.now().toISOString(), description: null }));
  assert.deepEqual(await f.receive(sub, xml), { added: 0, updated: 1 });
  assert.equal((await f.watches.notices())[0].excerpt, 'Original video description');
  assert.deepEqual(await f.receive(sub, xml), { duplicate: true });
  const changedSpace = xml.replace('<feed ', '<feed  ');
  assert.deepEqual(await f.receive(sub, changedSpace), { added: 0, updated: 0 });
});

test('out-of-order delivery and a stale polling snapshot cannot overwrite a newer signed revision', async (t) => {
  const f = await fixture(t);
  const watch = await f.createWatch();
  const sub = await f.activate(watch.id);
  f.advance(3 * 60000);
  await f.receive(sub, atom(entry({ updated: f.now().toISOString(), title: 'Latest title' })));
  const older = atom(entry({ updated: '2026-11-05T01:02:00Z', title: 'Older title' }));
  assert.deepEqual(await f.receive(sub, older), { added: 0, updated: 0 });
  f.setDocument(older);
  f.advance(60001);
  const polled = await f.watches.run(watch.id, { actor });
  assert.equal(polled.updated, 0);
  assert.equal((await f.watches.notices())[0].title, 'Latest title');
});

test('unsigned, wrong-channel, malformed XML and oversized notifications cannot change the inbox', async (t) => {
  const f = await fixture(t);
  const watch = await f.createWatch();
  const sub = await f.activate(watch.id);
  const body = Buffer.from(atom(entry({ id: newVideo })));
  await assert.rejects(() => f.service.receive(sub.callbackId, body, signature(body, 'wrong')), {
    status: 403,
  });
  await assert.rejects(() => f.receive(sub, atom(entry({ channelId: secondChannel }))), {
    code: 'invalid_youtube_entry',
  });
  await assert.rejects(() => f.receive(sub, atom(entry(), secondChannel)), {
    code: 'push_topic_mismatch',
  });
  await assert.rejects(() => f.receive(sub, '<!DOCTYPE x SYSTEM "file:///etc/passwd">' + atom()), {
    code: 'unsafe_xml',
  });
  await assert.rejects(() => f.receive(sub, atom().replace('</feed>', '')), {
    code: 'invalid_youtube_push',
  });
  await assert.rejects(() => f.receive(sub, 'x'.repeat(YOUTUBE_PUSH_LIMITS.payloadBytes + 1)), {
    status: 413,
  });
  assert.equal((await f.watches.notices()).length, 1);
  assert.equal(verifyYoutubeSignature(body, signature(body, sub.secret, 'sha1'), sub.secret), true);
  assert.equal(verifyYoutubeSignature(body, 'md5=0123', sub.secret), false);
});

test('pausing a watch or disabling push stops ingestion immediately without waiting for the hub', async (t) => {
  const f = await fixture(t);
  const watch = await f.createWatch();
  const sub = await f.activate(watch.id);
  f.advance(60001);
  await f.watches.update(watch.id, { active: false }, actor);
  const xml = atom(entry({ id: newVideo, updated: f.now().toISOString() }));
  assert.deepEqual(await f.receive(sub, xml), { ignored: true });
  await f.watches.update(watch.id, { active: true }, actor);
  await f.service.disable(watch.id, actor);
  assert.equal(f.requests.at(-1).form.get('hub.mode'), 'unsubscribe');
  assert.deepEqual(await f.receive(sub, xml), { ignored: true });
  assert.equal((await f.watches.notices()).length, 1);
  const query = {
    ...sub.query,
    'hub.mode': 'unsubscribe',
    'hub.verify_token': f.requests.at(-1).form.get('hub.verify_token'),
  };
  assert.equal(await f.service.verify(sub.callbackId, query), query['hub.challenge']);
  assert.equal((await f.service.list()).subscriptions[0].state, 'disabled');
});

test('subscription renewals are bounded, persisted and not duplicated by overlapping workers', async (t) => {
  const f = await fixture(t);
  const first = await f.createWatch();
  const second = await f.createWatch(secondChannel);
  await f.activate(first.id);
  await f.activate(second.id);
  f.advance(4 * 86400000 + 1);
  let release;
  let start;
  const started = new Promise((resolve) => {
    start = resolve;
  });
  f.setHub(
    () =>
      new Promise((resolve) => {
        release = () => resolve(new Response(null, { status: 202 }));
        start();
      }),
  );
  const pending = f.service.runDue();
  await started;
  const requestCount = f.requests.length;
  // Only the already-claimed track is excluded; the second worker may renew the other due track.
  const claimedTopic = f.requests.at(-1).form.get('hub.topic');
  await f.db
    .prepare('UPDATE intelligence_youtube_subscriptions SET renew_after=? WHERE topic<>?')
    .run(new Date(f.now().getTime() + 86400000).toISOString(), claimedTopic);
  assert.equal((await f.service.runDue()).processed, 0);
  assert.equal(f.requests.length, requestCount);
  release();
  assert.equal((await pending).processed, 1);
  assert.equal(f.requests.length, 3);
});

test('hub failures retain the polling baseline and schedule a bounded retry', async (t) => {
  const f = await fixture(t);
  const watch = await f.createWatch();
  f.setHub(async () => new Response(null, { status: 503 }));
  const state = await f.service.enable(watch.id, actor);
  assert.match(state.error, /retry/);
  assert.ok(state.renewAfter > f.now().toISOString());
  assert.equal((await f.watches.notices()).length, 1);
  assert.equal((await f.service.runDue()).processed, 0);
  f.advance(31 * 60000);
  assert.equal((await f.service.runDue()).processed, 1);
  assert.equal(f.requests.length, 2);
});

test('a missing vault or public HTTPS origin keeps the free local interface usable without subscribing', async (t) => {
  const f = await fixture(t, { noKey: true });
  const watch = await f.createWatch();
  assert.equal((await f.service.list()).available, false);
  await assert.rejects(() => f.service.enable(watch.id, actor), {
    code: 'youtube_push_unavailable',
  });
  assert.equal(f.requests.length, 0);
  const g = await fixture(t, { publicOrigin: 'http://localhost:3000' });
  await g.createWatch();
  assert.equal((await g.service.list()).available, false);
  assert.match((await g.service.list()).reason, /HTTPS/);
});

test('delivery validation checks every video identity and finite source update time', () => {
  const now = new Date('2026-11-05T01:00:00Z');
  assert.throws(() => validateYoutubeDelivery(Buffer.from(atom(entry() + entry())), topic(), now), {
    code: 'invalid_youtube_entry',
  });
  assert.throws(
    () => validateYoutubeDelivery(Buffer.from(atom(entry({ updated: 'invalid' }))), topic(), now),
    { code: 'invalid_youtube_entry' },
  );
  assert.throws(
    () =>
      validateYoutubeDelivery(
        Buffer.from(atom(entry({ updated: '2099-01-01T00:00:00Z' }))),
        topic(),
        now,
      ),
    { code: 'invalid_youtube_entry' },
  );
  assert.throws(
    () =>
      validateYoutubeDelivery(
        Buffer.from(
          atom(
            Array.from({ length: 41 }, (_, index) =>
              entry({ id: `${index}`.padStart(11, 'a') }),
            ).join(''),
          ),
        ),
        topic(),
        now,
      ),
    { code: 'push_entry_limit' },
  );
});

test('HTTP callback accepts signed raw Atom without a session while opt-in still requires manager CSRF', async (t) => {
  let requestForm;
  const clock = new Date('2026-11-05T01:00:00Z');
  const app = await createApp({
    databasePath: ':memory:',
    demoMode: true,
    secureCookies: false,
    serveStatic: false,
    registerExtensions: async () => ({}),
    now: () => clock,
    intelligenceOptions: {
      appOrigin: origin,
      encryptionKey: '83'.repeat(32),
      reader: async (url) => ({
        url,
        status: 200,
        text: url.endsWith('/robots.txt') ? '' : atom(),
        headers: {
          'content-type': url.endsWith('/robots.txt') ? 'text/plain' : 'application/atom+xml',
        },
      }),
      pushFetch: async (_url, input) => {
        requestForm = new URLSearchParams(input.body);
        return new Response(null, { status: 202 });
      },
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await app.locals.close();
  });
  const local = `http://127.0.0.1:${server.address().port}`;
  const boot = await fetch(`${local}/api/bootstrap`);
  const cookie = boot.headers.get('set-cookie').split(';')[0];
  const csrf = (await boot.json()).csrfToken;
  const post = (path, value, token = csrf) =>
    fetch(`${local}/api${path}`, {
      method: 'POST',
      headers: { cookie, origin: local, 'content-type': 'application/json', 'x-csrf-token': token },
      body: JSON.stringify(value),
    });
  const competitor = await (
    await post('/competitors', {
      name: 'Local push test',
      platform: 'youtube',
      url: `https://www.youtube.com/channel/${channel}`,
      category: 'Education',
    })
  ).json();
  const { watch } = await (
    await post('/intelligence/watches', {
      kind: 'competitor',
      resourceId: competitor.id,
      mode: 'youtube',
      active: true,
    })
  ).json();
  assert.equal((await post(`/intelligence/watches/${watch.id}/run`, {})).status, 200);
  assert.equal(
    (await post(`/intelligence/watches/${watch.id}/youtube-push`, { enabled: true }, '')).status,
    403,
  );
  assert.equal(
    (await post(`/intelligence/watches/${watch.id}/youtube-push`, { enabled: true })).status,
    200,
  );
  const path = new URL(requestForm.get('hub.callback')).pathname;
  const query = new URLSearchParams({
    'hub.mode': 'subscribe',
    'hub.topic': requestForm.get('hub.topic'),
    'hub.challenge': 'signed-hub-challenge',
    'hub.lease_seconds': '432000',
    'hub.verify_token': requestForm.get('hub.verify_token'),
  });
  const confirmed = await fetch(`${local}${path}?${query}`);
  assert.equal(confirmed.status, 200);
  assert.match(confirmed.headers.get('content-type'), /application\/octet-stream/);
  assert.equal(confirmed.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await confirmed.text(), 'signed-hub-challenge');
  const body = Buffer.from(atom(entry({ id: newVideo, updated: clock.toISOString() })));
  const delivered = await fetch(`${local}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/atom+xml',
      origin: 'https://pubsubhubbub.appspot.com',
      'sec-fetch-site': 'cross-site',
      'x-hub-signature': signature(body, requestForm.get('hub.secret')),
    },
    body,
  });
  assert.equal(delivered.status, 204);
  const invalid = await fetch(`${local}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/atom+xml' },
    body,
  });
  assert.equal(invalid.status, 403);
  assert.equal((await fetch(`${local}/api/intelligence/youtube-push`)).status, 401);
});
