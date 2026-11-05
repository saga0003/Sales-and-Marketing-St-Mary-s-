import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectMp4, readVideoResponse, MAX_VIDEO_BYTES } from './video.mjs';

test('real H.264/AAC MP4 metadata is validated and bytes have an immutable hash', async () => {
  const bytes = await readFile(new URL('./fixtures/review-video.mp4', import.meta.url));
  const asset = inspectMp4(bytes, 'folder/Preview.mp4');
  assert.equal(asset.name, 'Preview.mp4');
  assert.equal(asset.width, 320);
  assert.equal(asset.height, 568);
  assert.equal(asset.duration, 1);
  assert.equal(asset.kind, 'video');
  assert.match(asset.sha256, /^[0-9a-f]{64}$/);
  assert.throws(() => inspectMp4(Buffer.from('<svg><script>bad</script></svg>')));
  assert.throws(() => inspectMp4(bytes.subarray(0, bytes.length - 2)), /H.264/);
  const malformed = Buffer.from(bytes);
  malformed.writeUInt32BE(bytes.length + 100, 0);
  assert.throws(() => inspectMp4(malformed), /H.264/);
  const unsupported = Buffer.from(bytes);
  const codec = unsupported.indexOf(Buffer.from('avc1'), unsupported.indexOf(Buffer.from('stsd')));
  assert.ok(codec > 0);
  unsupported.write('hev1', codec, 'ascii');
  assert.throws(() => inspectMp4(unsupported), /H.264/);
});

test('video reads enforce declared and streamed size limits before materializing an oversized file', async () => {
  await assert.rejects(
    () =>
      readVideoResponse(
        new Response('small', { headers: { 'Content-Length': String(MAX_VIDEO_BYTES + 1) } }),
      ),
    /exceeds/,
  );
  await assert.rejects(() => readVideoResponse(new Response(Buffer.alloc(33)), 32), /exceeds/);
  assert.equal(
    (await readVideoResponse(new Response(Buffer.from('bounded')), 32)).toString(),
    'bounded',
  );
});
