import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPrivateKey, sign } from 'node:crypto';
import sharp from 'sharp';
import { HttpError } from '../validation.mjs';
import { hash } from './crypto.mjs';
import { MAX_VIDEO_BYTES, readVideoResponse } from '../video.mjs';

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function imageSignature(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  return null;
}

export async function normalizeImage(bytes, contentType, inputName) {
  if (!IMAGE_TYPES.includes(contentType))
    throw new HttpError(415, 'Only JPEG, PNG and WebP images are supported.', 'unsupported_image');
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_IMAGE_BYTES)
    throw new HttpError(413, 'Choose an image smaller than 3 MB.', 'image_too_large');
  if (imageSignature(bytes) !== contentType)
    throw new HttpError(
      415,
      'Only genuine JPEG, PNG and WebP images are accepted. SVG and renamed files are not supported.',
      'unsupported_image',
    );
  let output;
  try {
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 24000000, animated: false });
    const metadata = await image.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width > 12000 ||
      metadata.height > 12000 ||
      (metadata.pages ?? 1) !== 1
    )
      throw new Error();
    output = await image
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: 2160, height: 2160, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new HttpError(
      422,
      'This image could not be safely decoded. Upload a non-animated image of at most 24 megapixels.',
      'invalid_image',
    );
  }
  if (output.data.length > MAX_IMAGE_BYTES)
    throw new HttpError(
      413,
      'The processed image exceeds 3 MB. Resize it and upload again.',
      'image_too_large',
    );
  const stem =
    String(inputName || 'school-image')
      .split(/[\\/]/)
      .at(-1)
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/\.[^.]+$/, '')
      .slice(0, 160) || 'school-image';
  return {
    bytes: output.data,
    name: `${stem}.jpg`,
    mimeType: 'image/jpeg',
    size: output.data.length,
    width: output.info.width,
    height: output.info.height,
    sha256: hash(output.data),
  };
}

export function publicAsset(row) {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    size: Number(row.size),
    sha256: row.sha256,
    width: Number(row.width),
    height: Number(row.height),
    kind: row.kind ?? (row.mime_type === 'video/mp4' ? 'video' : 'image'),
    duration: row.duration == null ? null : Number(row.duration),
    url: `/api/media/${encodeURIComponent(row.id)}/content`,
    ownerId: row.owner_id,
    createdAt: row.created_at,
  };
}

export function createStorageBroker({
  url,
  privateKey,
  fetch: fetchImpl = globalThis.fetch,
  now = () => new Date(),
}) {
  const endpoint = new URL(url);
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error('MEDIA_BROKER_URL must be a complete trusted HTTPS endpoint.');
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519')
    throw new Error('MEDIA_BROKER_PRIVATE_KEY must be an Ed25519 PEM private key.');
  const call = async (command) => {
    const rawBody = JSON.stringify(command);
    const timestamp = String(Math.floor(now().getTime() / 1000));
    const signature = sign(null, Buffer.from(`${timestamp}.${hash(rawBody)}`), key).toString(
      'base64url',
    );
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(25000),
        headers: {
          'Content-Type': 'application/json',
          'x-marketing-timestamp': timestamp,
          'x-marketing-signature': signature,
        },
        body: rawBody,
      });
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_IMAGE_BYTES * 1.4 + 8192) throw new Error();
      const data = JSON.parse(Buffer.from(buffer).toString('utf8'));
      if (!response.ok || data.error) throw new Error();
      return data;
    } catch {
      throw new HttpError(
        503,
        'Private image storage is unavailable. Try again, or ask a manager to check the storage connection.',
        'storage_unavailable',
      );
    }
  };
  call.origin = endpoint.origin;
  return call;
}

export function createStorage({
  localDirectory,
  blobToken,
  blobStoreId,
  vercel = false,
  broker,
  fetch: fetchImpl = globalThis.fetch,
  now = () => new Date(),
} = {}) {
  const localRoot = resolve(localDirectory ?? 'data/media');
  const kind = broker
    ? 'broker'
    : blobToken || blobStoreId
      ? 'blob'
      : vercel
        ? 'unconfigured'
        : 'local';
  const blobOptions = {
    ...(blobToken ? { token: blobToken } : {}),
    ...(blobStoreId ? { storeId: blobStoreId } : {}),
  };
  function safePath(path) {
    if (!/^assets\/asset_[A-Za-z0-9_-]{24}\.(?:jpg|mp4)$/.test(path))
      throw new Error('Invalid media storage path.');
    return path;
  }
  return {
    kind,
    configured: kind !== 'unconfigured',
    canDeliver: ['broker', 'blob'].includes(kind),
    canUploadVideo: ['broker', 'local'].includes(kind),
    async removeUploadedPath(path) {
      safePath(path);
      if (kind === 'broker') {
        await broker({ operation: 'removeExpiredUpload', path });
        return;
      }
      if (kind === 'local' && !vercel) {
        try {
          await unlink(resolve(localRoot, path));
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        return;
      }
      throw new HttpError(
        503,
        'Abandoned-upload cleanup requires the private storage connection.',
        'storage_unavailable',
      );
    },
    async prepareVideoUpload(id) {
      const path = safePath(`assets/${id}.mp4`);
      if (kind === 'local') return { kind, path, uploadUrl: null };
      if (kind !== 'broker')
        throw new HttpError(
          503,
          'Direct video uploads require the workspace’s private Supabase storage connection.',
          'video_storage_required',
        );
      const result = await broker({ operation: 'prepareVideoUpload', path });
      const target = new URL(result.url);
      if (
        target.origin !== broker.origin ||
        !target.pathname.startsWith('/storage/v1/object/upload/sign/') ||
        !target.pathname.endsWith(`/${path}`) ||
        !target.searchParams.get('token')
      )
        throw new Error('Invalid signed video upload URL.');
      return { kind, path, uploadUrl: target.toString() };
    },
    async putVideo(id, bytes) {
      if (kind !== 'local' || vercel)
        throw new HttpError(
          409,
          'Use the direct private upload URL for this video.',
          'direct_upload_required',
        );
      const path = safePath(`assets/${id}.mp4`);
      if (!Buffer.isBuffer(bytes) || bytes.length > MAX_VIDEO_BYTES)
        throw new HttpError(413, 'Choose a video of at most 40 MiB.', 'video_too_large');
      await mkdir(resolve(localRoot, 'assets'), { recursive: true, mode: 0o700 });
      try {
        await writeFile(resolve(localRoot, path), bytes, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const old = await readFile(resolve(localRoot, path));
        if (hash(old) !== hash(bytes))
          throw new HttpError(
            409,
            'This upload already contains different bytes. Start a new upload.',
            'upload_exists',
          );
      }
      return { kind, path, url: null };
    },
    async readVideoUpload(path) {
      safePath(path);
      if (!path.endsWith('.mp4')) throw new Error('Invalid video path.');
      if (kind === 'local' && !vercel) return await readFile(resolve(localRoot, path));
      if (kind !== 'broker')
        throw new HttpError(503, 'Video storage is unavailable.', 'storage_unavailable');
      const result = await broker({ operation: 'signedUrl', path, expiresIn: 300 });
      const target = new URL(result.url);
      if (
        target.origin !== broker.origin ||
        !target.pathname.startsWith('/storage/v1/object/sign/') ||
        !target.pathname.endsWith(`/${path}`)
      )
        throw new Error('Invalid signed video read URL.');
      return await readVideoResponse(
        await fetchImpl(target, { redirect: 'error', signal: AbortSignal.timeout(45000) }),
      );
    },
    async put(id, bytes) {
      const path = safePath(`assets/${id}.jpg`);
      if (kind === 'unconfigured')
        throw new HttpError(
          503,
          'Private image storage has not been configured for this deployment.',
          'storage_required',
        );
      if (kind === 'broker') {
        const stored = await broker({
          operation: 'put',
          path,
          dataBase64: bytes.toString('base64'),
          contentType: 'image/jpeg',
        });
        if (stored.path !== path) throw new Error('Storage did not confirm the uploaded path.');
        return { kind, path, url: null };
      }
      if (kind === 'blob') {
        const { put } = await import('@vercel/blob');
        const stored = await put(path, bytes, {
          ...blobOptions,
          access: 'private',
          contentType: 'image/jpeg',
          addRandomSuffix: false,
          allowOverwrite: false,
        });
        return { kind, path: stored.pathname, url: stored.url };
      }
      await mkdir(resolve(localRoot, 'assets'), { recursive: true, mode: 0o700 });
      await writeFile(resolve(localRoot, path), bytes, { flag: 'wx', mode: 0o600 });
      return { kind, path, url: null };
    },
    async read(asset) {
      const path = safePath(asset.storage_path);
      let bytes;
      if (asset.storage_kind === 'broker' && broker) {
        if (asset.mime_type === 'video/mp4') {
          bytes = await this.readVideoUpload(path);
        } else {
          const result = await broker({ operation: 'read', path });
          if (
            result.contentType !== 'image/jpeg' ||
            typeof result.dataBase64 !== 'string' ||
            result.dataBase64.length > MAX_IMAGE_BYTES * 1.4
          )
            throw new Error('Invalid private image response.');
          bytes = Buffer.from(result.dataBase64, 'base64');
        }
      } else if (asset.storage_kind === 'blob' && (blobToken || blobStoreId)) {
        const { get } = await import('@vercel/blob');
        const result = await get(path, { ...blobOptions, access: 'private', useCache: false });
        if (!result?.stream || result.statusCode !== 200)
          throw new HttpError(404, 'The stored image could not be found.', 'image_not_found');
        bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
      } else if (asset.storage_kind === 'local' && !vercel) {
        bytes = await readFile(resolve(localRoot, path));
      } else
        throw new HttpError(
          503,
          'This image storage connection is unavailable.',
          'storage_unavailable',
        );
      if (bytes.length !== Number(asset.size) || hash(bytes) !== asset.sha256)
        throw new HttpError(
          409,
          'The stored image no longer matches the reviewed image. Upload it again and obtain a new approval.',
          'asset_integrity_failed',
        );
      return bytes;
    },
    async signedUrl(asset) {
      const path = safePath(asset.storage_path);
      if (asset.storage_kind === 'broker' && broker) {
        const result = await broker({ operation: 'signedUrl', path, expiresIn: 3600 });
        const target = typeof result.url === 'string' ? new URL(result.url) : null;
        if (
          !target ||
          target.protocol !== 'https:' ||
          target.origin !== broker.origin ||
          !target.pathname.startsWith('/storage/v1/object/sign/') ||
          !target.pathname.endsWith(`/${path}`) ||
          target.username ||
          target.password
        )
          throw new Error('Storage did not return a secure media delivery URL.');
        return result.url;
      }
      if (asset.storage_kind === 'blob' && (blobToken || blobStoreId)) {
        const { issueSignedToken, presignUrl } = await import('@vercel/blob');
        const validUntil = now().getTime() + 60 * 60 * 1000;
        const scoped = await issueSignedToken({
          ...blobOptions,
          pathname: path,
          operations: ['get'],
          validUntil,
        });
        return (
          await presignUrl(scoped, {
            operation: 'get',
            pathname: path,
            access: 'private',
            validUntil,
            useCache: false,
          })
        ).presignedUrl;
      }
      throw new HttpError(
        503,
        'Live publication requires configured private cloud image storage.',
        'media_delivery_required',
      );
    },
  };
}
