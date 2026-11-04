import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { verifySignature, validAssetPath, readLimitedBody } from './verify.mjs';

test('media broker binds signature to exact body, signing key and timestamp', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const body = JSON.stringify({ operation: 'signedUrl', path: 'assets/image_123.jpg' });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const message = `${timestamp}.${createHash('sha256').update(body).digest('hex')}`;
  const headers = new Headers({
    'x-marketing-timestamp': timestamp,
    'x-marketing-signature': sign(null, Buffer.from(message), privateKey).toString('base64url'),
  });
  const jwk = publicKey.export({ format: 'jwk' });
  assert.equal(await verifySignature(body, headers, jwk), true);
  assert.equal(await verifySignature(body.replace('123', '456'), headers, jwk), false);
  assert.equal(
    await verifySignature(
      body,
      headers,
      generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }),
    ),
    false,
  );
  assert.equal(await verifySignature(body, headers, jwk, Date.now() + 121000), false);
  assert.equal(await verifySignature(body, new Headers(), jwk), false);
});

test('media broker restricts paths and rejects oversized streamed bodies', async () => {
  assert.equal(validAssetPath('assets/media_1234.jpg'), true);
  for (const path of [
    '../private/key',
    'assets/../key.jpg',
    'assets/image.svg',
    'other/image_123.jpg',
    'assets/image_123.jpg?x',
  ])
    assert.equal(validAssetPath(path), false);
  const request = new Request('https://example.test', { method: 'POST', body: '123456' });
  await assert.rejects(readLimitedBody(request, 3), /body_too_large/);
});
