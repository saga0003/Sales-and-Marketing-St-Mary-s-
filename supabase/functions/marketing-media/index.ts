import publicKey from './public-key.json' with { type: 'json' };
import {
  readLimitedBody,
  signatureHeadersValid,
  validAssetPath,
  verifySignature,
} from './verify.mjs';

// This function intentionally verifies its own Ed25519 request signature. The
// corresponding private key stays in the application's server environment.
// No application user, browser, or repository receives a Supabase secret key.
const BUCKET = 'stmarys-marketing-private';
const MAX_BYTES = 3 * 1024 * 1024;
const PROJECT_URL = Deno.env.get('SUPABASE_URL')!;
const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
const STORAGE_KEY = secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function storage(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('apikey', STORAGE_KEY!);
  if (!STORAGE_KEY?.startsWith('sb_secret_')) headers.set('Authorization', `Bearer ${STORAGE_KEY}`);
  return await fetch(`${PROJECT_URL}/storage/v1${path}`, {
    ...options,
    headers,
    signal: AbortSignal.timeout(20000),
  });
}

async function ensureBucket() {
  const existing = await storage(`/bucket/${BUCKET}`);
  if (existing.ok) {
    const bucket = await existing.json();
    if (bucket.public !== false) throw new Error('bucket_not_private');
    return;
  }
  if (existing.status !== 404 && existing.status !== 400) throw new Error('storage_unavailable');
  const created = await storage('/bucket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: false,
      file_size_limit: MAX_BYTES,
      allowed_mime_types: ['image/jpeg'],
    }),
  });
  if (!created.ok) throw new Error('bucket_initialization_failed');
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!STORAGE_KEY || !signatureHeadersValid(request.headers))
    return json({ error: 'Unauthorized.' }, 401);
  try {
    const raw = await readLimitedBody(request);
    if (!(await verifySignature(raw, request.headers, publicKey)))
      return json({ error: 'Unauthorized.' }, 401);
    const body = JSON.parse(raw);
    if (body.operation === 'init') {
      await ensureBucket();
      return json({ ready: true, access: 'private', maxBytes: MAX_BYTES });
    }
    if (!validAssetPath(body.path)) return json({ error: 'Invalid media path.' }, 400);
    const path = body.path.split('/').map(encodeURIComponent).join('/');
    if (body.operation === 'put') {
      if (
        body.contentType !== 'image/jpeg' ||
        typeof body.dataBase64 !== 'string' ||
        body.dataBase64.length > 4_194_304 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(body.dataBase64)
      )
        return json({ error: 'Unsupported image.' }, 400);
      const bytes = Uint8Array.from(atob(body.dataBase64), (c) => c.charCodeAt(0));
      if (
        !bytes.length ||
        bytes.length > MAX_BYTES ||
        bytes[0] !== 0xff ||
        bytes[1] !== 0xd8 ||
        bytes[2] !== 0xff
      )
        return json({ error: 'Invalid image.' }, 400);
      const response = await storage(`/object/${BUCKET}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'false', 'Cache-Control': '3600' },
        body: bytes,
      });
      if (!response.ok)
        return json({ error: 'Image could not be stored.' }, response.status === 409 ? 409 : 502);
      return json({ path: body.path });
    }
    if (body.operation === 'read') {
      const response = await storage(`/object/authenticated/${BUCKET}/${path}`);
      if (!response.ok)
        return json({ error: 'Image unavailable.' }, response.status === 404 ? 404 : 502);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > MAX_BYTES) return json({ error: 'Image exceeds workspace limit.' }, 413);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      return json({ dataBase64: btoa(binary), contentType: 'image/jpeg' });
    }
    if (body.operation === 'signedUrl') {
      const expiresIn = Number(body.expiresIn || 300);
      if (!Number.isInteger(expiresIn) || expiresIn < 30 || expiresIn > 3600)
        return json({ error: 'Invalid expiry.' }, 400);
      const response = await storage(`/object/sign/${BUCKET}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn }),
      });
      if (!response.ok) return json({ error: 'Image link unavailable.' }, 502);
      const result = await response.json();
      const relative = result.signedURL || result.signedUrl;
      if (typeof relative !== 'string' || !relative.startsWith('/object/sign/'))
        return json({ error: 'Image link unavailable.' }, 502);
      return json({ url: `${PROJECT_URL}/storage/v1${relative}` });
    }
    return json({ error: 'Unknown operation.' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'storage_error';
    return json(
      {
        error:
          message === 'body_too_large'
            ? 'Upload too large.'
            : 'Media operation could not be completed.',
      },
      message === 'body_too_large' ? 413 : 502,
    );
  }
});
