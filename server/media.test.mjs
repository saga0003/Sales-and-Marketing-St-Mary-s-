import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from './app.mjs';
import { MAX_VIDEO_BYTES } from './video.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'smis-video-'));
  const app = await createApp({
    demoMode: true,
    intelligence: false,
    databaseUrl: '',
    databasePath: join(dir, 'workspace.sqlite'),
    serveStatic: false,
    secureCookies: false,
    extensionOptions: { mediaDirectory: join(dir, 'media') },
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await app.locals.close();
    await rm(dir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '',
      csrf = '';
    return async (path, method = 'GET', body, contentType = 'application/json') => {
      const response = await fetch(url + path, {
        method,
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
          origin: url,
          ...(body === undefined ? {} : { 'Content-Type': contentType }),
        },
        ...(body === undefined
          ? {}
          : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }),
      });
      if (response.headers.getSetCookie()[0])
        cookie = response.headers.getSetCookie()[0].split(';')[0];
      const data = response.headers.get('content-type')?.includes('application/json')
        ? await response.json()
        : Buffer.from(await response.arrayBuffer());
      if (data.csrfToken) csrf = data.csrfToken;
      return { status: response.status, data };
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

test('video preparation, private upload, validation and idempotent completion work without exposing another member’s upload', async (t) => {
  const { manager, author, anonymous, app } = await fixture(t);
  const bytes = await readFile(new URL('./fixtures/review-video.mp4', import.meta.url));
  const prepared = await manager('/api/media/uploads', 'POST', {
    name: 'review-video.mp4',
    mimeType: 'video/mp4',
    size: bytes.length,
  });
  assert.equal(prepared.status, 201, JSON.stringify(prepared.data));
  const id = prepared.data.uploadId;
  assert.equal((await anonymous(`/api/media/uploads/${id}/complete`, 'POST', {})).status, 401);
  assert.equal((await author(`/api/media/uploads/${id}/complete`, 'POST', {})).status, 404);
  assert.equal((await manager(prepared.data.uploadUrl, 'PUT', bytes, 'video/mp4')).status, 200);
  const completed = await manager(`/api/media/uploads/${id}/complete`, 'POST', {});
  assert.equal(completed.status, 201, JSON.stringify(completed.data));
  assert.equal(completed.data.kind, 'video');
  assert.equal(completed.data.duration, 1);
  assert.equal(completed.data.width, 320);
  assert.equal((await manager(`/api/media/uploads/${id}/complete`, 'POST', {})).status, 200);
  assert.equal(
    (
      await app.locals.database
        .prepare('SELECT COUNT(*) AS count FROM media_assets WHERE id=?')
        .get(id)
    ).count,
    1,
  );
  assert.deepEqual((await manager(completed.data.url)).data, bytes);
  assert.equal((await author(completed.data.url)).status, 403);
  assert.equal(
    (await manager(prepared.data.uploadUrl, 'PUT', bytes, 'video/mp4')).status,
    409,
    'committed files cannot be replaced',
  );
});

test('invalid video bytes cannot become media and concurrent reservations enforce the shared library limit', async (t) => {
  const { manager } = await fixture(t);
  const bytes = Buffer.alloc(64, 97);
  const prepared = await manager('/api/media/uploads', 'POST', {
    name: 'fake.mp4',
    mimeType: 'video/mp4',
    size: bytes.length,
  });
  await manager(prepared.data.uploadUrl, 'PUT', bytes, 'video/mp4');
  assert.equal(
    (await manager(`/api/media/uploads/${prepared.data.uploadId}/complete`, 'POST', {})).status,
    422,
  );
  const reservations = await Promise.all(
    Array.from({ length: 14 }, () =>
      manager('/api/media/uploads', 'POST', {
        name: 'quota.mp4',
        mimeType: 'video/mp4',
        size: MAX_VIDEO_BYTES,
      }),
    ),
  );
  assert.equal(
    reservations.filter((result) => result.status === 201).length,
    11,
    'even a 64-byte declaration reserves the full signed-upload allowance until cleanup',
  );
  assert.ok(
    reservations.filter((result) => result.status !== 201).every((result) => result.status === 409),
  );
  assert.equal(
    (
      await manager('/api/media/uploads', 'POST', {
        name: 'oversized.mp4',
        mimeType: 'video/mp4',
        size: MAX_VIDEO_BYTES + 1,
      })
    ).status,
    422,
  );
});
