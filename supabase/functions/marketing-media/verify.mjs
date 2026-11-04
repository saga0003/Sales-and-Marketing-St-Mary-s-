const encoder = new TextEncoder();

export function signatureHeadersValid(headers, now = Date.now()) {
  const timestamp = headers.get('x-marketing-timestamp') || '';
  const signature = headers.get('x-marketing-signature') || '';
  return (
    /^\d{10}$/.test(timestamp) &&
    /^[A-Za-z0-9_-]{86}$/.test(signature) &&
    Math.abs(Math.floor(now / 1000) - Number(timestamp)) <= 60
  );
}

export async function verifySignature(body, headers, jwk, now = Date.now()) {
  if (!signatureHeadersValid(headers, now)) return false;
  try {
    const timestamp = headers.get('x-marketing-timestamp');
    const signature = headers.get('x-marketing-signature');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(body)));
    const hex = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const decoded = Uint8Array.from(
      atob(signature.replace(/-/g, '+').replace(/_/g, '/') + '=='),
      (c) => c.charCodeAt(0),
    );
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify(
      'Ed25519',
      key,
      decoded,
      encoder.encode(`${timestamp}.${hex}`),
    );
  } catch {
    return false;
  }
}

export async function readLimitedBody(request, limit = 4_300_000) {
  if (Number(request.headers.get('content-length') || 0) > limit) throw new Error('body_too_large');
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error('body_too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export const validAssetPath = (path) =>
  typeof path === 'string' && /^assets\/[A-Za-z0-9_-]{6,160}\.jpg$/.test(path);
