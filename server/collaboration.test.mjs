import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.mjs';

async function fixture(t) {
  const app = await createApp({
    demoMode: true,
    extensions: false,
    databaseUrl: '',
    databasePath: ':memory:',
    serveStatic: false,
    secureCookies: false,
  });
  const server = await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await app.locals.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '',
      csrf = '';
    return async (path, method = 'GET', body) => {
      const response = await fetch(url + path, {
        method,
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
          origin: url,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const value = await response.json();
      if (response.headers.getSetCookie()[0])
        cookie = response.headers.getSetCookie()[0].split(';')[0];
      if (value.csrfToken) csrf = value.csrfToken;
      return { status: response.status, value };
    };
  };
  const manager = client(),
    author = client();
  await manager('/api/bootstrap');
  await author('/api/bootstrap');
  await author('/api/auth/demo-role', 'POST', { role: 'contributor' });
  await author('/api/bootstrap');
  return { app, manager, author, anonymous: client() };
}
const input = {
  title: 'Notification review exercise',
  caption: 'Review this source-backed post.',
  platforms: ['instagram'],
  format: 'Post',
  institution: 'St. Mary’s ISC',
  scheduledAt: null,
  language: 'English',
  palette: 'violet',
  destinationIds: [],
};

test('notifications deliver between roles, persist read/preferences state and prevent another member marking them read', async (t) => {
  const { manager, author, anonymous } = await fixture(t);
  assert.equal((await anonymous('/api/notifications')).status, 401);
  const draft = await author('/api/posts', 'POST', input);
  assert.equal(draft.status, 201);
  const id = draft.value.id;
  assert.equal(
    (await author(`/api/posts/${id}/transition`, 'POST', { action: 'submit', revision: 1 })).status,
    200,
  );
  const inbox = await manager('/api/notifications');
  const submitted = inbox.value.notifications.find(
    (item) => item.entityId === id && item.kind === 'review_requested',
  );
  assert.ok(submitted);
  assert.equal(submitted.readAt, null);
  assert.ok(inbox.value.unreadCount > 0);
  assert.equal(
    (await author('/api/notifications')).value.notifications.some((item) => item.entityId === id),
    false,
    'authors do not receive their own actions',
  );
  assert.equal((await author(`/api/notifications/${submitted.id}/read`, 'POST', {})).status, 404);
  assert.equal((await manager(`/api/notifications/${submitted.id}/read`, 'POST', {})).status, 200);
  assert.ok(
    (await manager('/api/notifications')).value.notifications.find(
      (item) => item.id === submitted.id,
    ).readAt,
  );
  assert.equal(
    (
      await manager(`/api/posts/${id}/transition`, 'POST', {
        action: 'request_changes',
        revision: 1,
        feedback: 'Add the official source.',
      })
    ).status,
    200,
  );
  const feedback = (await author('/api/notifications')).value.notifications.find(
    (item) => item.entityId === id && item.kind === 'changes_requested',
  );
  assert.match(feedback.message, /Add the official source/);
  assert.equal(
    (await author('/api/notifications/preferences', 'PATCH', { sound: true, desktop: false }))
      .status,
    200,
  );
  assert.equal((await author('/api/notifications')).value.preferences.sound, true);
  assert.equal((await manager('/api/notifications')).value.preferences.sound, false);
  assert.equal((await author('/api/notifications/read-all', 'POST', {})).status, 200);
  assert.equal((await author('/api/notifications')).value.unreadCount, 0);
  assert.equal(
    (await author('/api/notifications/preferences', 'PATCH', { sound: 'yes' })).status,
    422,
  );
});

test('document blocks retain revision history and stale concurrent saves cannot overwrite another teammate', async (t) => {
  const { manager, author } = await fixture(t);
  const first = await manager('/api/documents', 'POST', {
    title: 'Campaign playbook',
    category: 'Marketing',
    content: 'Legacy text stays readable.',
  });
  assert.equal(first.status, 201);
  assert.equal(first.value.version, 1);
  const content = JSON.stringify({
    schema: 'stmarys.blocks',
    version: 1,
    blocks: [
      { id: 'heading', type: 'heading', text: 'Campaign launch' },
      { id: 'check', type: 'checklist', text: 'Manager approved', checked: false },
    ],
  });
  const saved = await author(`/api/documents/${first.value.id}`, 'PATCH', {
    content,
    expectedVersion: 1,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.value.version, 2);
  const conflict = await manager(`/api/documents/${first.value.id}`, 'PATCH', {
    content: 'stale overwrite',
    expectedVersion: 1,
  });
  assert.equal(conflict.status, 409);
  const history = await manager(`/api/documents/${first.value.id}/history`);
  assert.deepEqual(
    history.value.revisions.map((item) => item.version),
    [2, 1],
  );
  assert.equal(history.value.revisions[0].content, content);
  assert.equal(history.value.revisions[1].content, 'Legacy text stays readable.');
  assert.ok(
    (await manager('/api/notifications')).value.notifications.some(
      (item) => item.entityId === first.value.id && item.kind === 'document_updated',
    ),
  );
  const invalid = JSON.stringify({
    schema: 'stmarys.blocks',
    version: 1,
    blocks: [{ id: 'bad', type: 'html', text: '<script>bad</script>' }],
  });
  assert.equal(
    (
      await manager(`/api/documents/${first.value.id}`, 'PATCH', {
        content: invalid,
        expectedVersion: 2,
      })
    ).status,
    422,
  );
});

test('ordered media and YouTube declarations survive revisions and duplication; edits clear approval', async (t) => {
  const { manager } = await fixture(t);
  const publicationOptions = {
    youtubePrivacy: 'unlisted',
    madeForKids: false,
    containsSyntheticMedia: false,
  };
  const created = await manager('/api/posts', 'POST', {
    ...input,
    assetIds: ['asset_first', 'asset_second'],
    publicationOptions,
  });
  assert.equal(created.status, 201);
  assert.equal(created.value.assetId, 'asset_first');
  const id = created.value.id;
  await manager(`/api/posts/${id}/transition`, 'POST', { action: 'submit', revision: 1 });
  await manager(`/api/posts/${id}/transition`, 'POST', { action: 'approve', revision: 1 });
  const changed = await manager(`/api/posts/${id}`, 'PATCH', {
    revision: 1,
    assetIds: ['asset_second', 'asset_first'],
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.value.approvedRevision, null);
  assert.equal(changed.value.assetId, 'asset_second');
  const copy = await manager(`/api/posts/${id}/duplicate`, 'POST', {});
  assert.equal(copy.status, 201);
  assert.deepEqual(copy.value.assetIds, ['asset_second', 'asset_first']);
  assert.deepEqual(copy.value.publicationOptions, publicationOptions);
  const history = await manager(`/api/posts/${id}/history`);
  assert.equal(history.status, 200);
});
