import express from 'express';
import { z } from 'zod';
import { HttpError, parse } from './validation.mjs';
import { opaqueId } from './extensions/crypto.mjs';
import { publicAsset } from './extensions/storage.mjs';
import { MAX_VIDEO_BYTES, MAX_MEDIA_BYTES, inspectMp4 } from './video.mjs';

export function registerAdvancedMedia(app, { db, config, now, storage }) {
  const stamp = () => now().toISOString();
  async function uploadFor(id, userId, { lock = false } = {}) {
    const upload = await db
      .prepare(
        `SELECT * FROM media_uploads WHERE id = ? AND owner_id = ? AND mime_type = 'video/mp4'${lock ? db.lockSuffix : ''}`,
      )
      .get(id, userId);
    if (!upload) throw new HttpError(404, 'This upload was not found.', 'not_found');
    if (upload.status !== 'completed' && upload.expires_at <= stamp())
      throw new HttpError(410, 'This upload link expired. Start a new upload.', 'upload_expired');
    return upload;
  }
  app.post('/api/media/uploads', async (request, response) => {
    if (!storage.canUploadVideo)
      throw new HttpError(
        503,
        'Private video uploads are not configured for this deployment.',
        'video_storage_required',
      );
    const input = parse(
      z
        .object({
          name: z.string().trim().min(1).max(200),
          mimeType: z.literal('video/mp4'),
          size: z.number().int().min(32).max(MAX_VIDEO_BYTES),
        })
        .strict(),
      request.body,
    );
    const id = opaqueId('asset');
    const expiresAt = new Date(now().getTime() + 2 * 60 * 60 * 1000).toISOString();
    const path = `assets/${id}.mp4`;
    await db.transaction(async () => {
      if (db.kind === 'postgres')
        await db
          .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
          .get(`smis:${db.schema}:media-quota`);
      const recent = await db
        .prepare(
          "SELECT COUNT(*) AS count FROM media_uploads WHERE owner_id = ? AND mime_type = 'video/mp4' AND created_at > ?",
        )
        .get(request.auth.user.id, new Date(now().getTime() - 86400000).toISOString());
      if (Number(recent.count) >= 20)
        throw new HttpError(
          429,
          'The daily video upload limit is 20 per member. Try again tomorrow.',
          'video_rate_limit',
        );
      const current = await db
        .prepare('SELECT COUNT(*) AS count, COALESCE(SUM(size),0) AS bytes FROM media_assets')
        .get();
      const reserved = await db
        .prepare(
          "SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN mime_type='video/mp4' THEN 41943040 ELSE expected_size END),0) AS bytes FROM media_uploads WHERE status <> 'completed'",
        )
        .get();
      if (
        Number(current.count) + Number(reserved.count) >= 200 ||
        Number(current.bytes) + Number(reserved.bytes) + MAX_VIDEO_BYTES > MAX_MEDIA_BYTES
      )
        throw new HttpError(
          409,
          'The media library limit is 200 items and 512 MiB, including unfinished uploads. Finish pending uploads or wait for abandoned-upload cleanup before adding more.',
          'media_quota',
        );
      await db
        .prepare(
          "INSERT INTO media_uploads(id,owner_id,name,mime_type,expected_size,storage_path,status,created_at,expires_at) VALUES(?,?,?,?,?,?,'pending',?,?)",
        )
        .run(
          id,
          request.auth.user.id,
          input.name,
          input.mimeType,
          input.size,
          path,
          stamp(),
          expiresAt,
        );
    });
    try {
      const prepared = await storage.prepareVideoUpload(id);
      response.status(201).json({
        uploadId: id,
        uploadUrl: prepared.uploadUrl ?? `/api/media/uploads/${id}/content`,
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4', 'x-upsert': 'false' },
        expiresAt,
      });
    } catch (error) {
      await db
        .prepare("UPDATE media_uploads SET status='failed',error=? WHERE id=?")
        .run('The upload link could not be created.', id);
      throw error;
    }
  });
  app.put(
    '/api/media/uploads/:id/content',
    express.raw({ type: 'video/mp4', limit: MAX_VIDEO_BYTES }),
    async (request, response) => {
      if (storage.kind !== 'local' || process.env.VERCEL === '1')
        throw new HttpError(
          409,
          'Upload this video directly using its private upload URL.',
          'direct_upload_required',
        );
      const upload = await uploadFor(request.params.id, request.auth.user.id);
      if (upload.status === 'completed')
        throw new HttpError(409, 'This upload is already complete.', 'upload_complete');
      if (!Buffer.isBuffer(request.body) || request.body.length !== Number(upload.expected_size))
        throw new HttpError(
          422,
          'The file size does not match the prepared upload.',
          'upload_size_mismatch',
        );
      await storage.putVideo(upload.id, request.body);
      response.json({ uploaded: true });
    },
  );
  app.post('/api/media/uploads/:id/complete', async (request, response) => {
    parse(z.object({}).strict(), request.body ?? {});
    const lease = opaqueId('upload');
    const upload = await db.transaction(async () => {
      const item = await uploadFor(request.params.id, request.auth.user.id, { lock: true });
      if (item.status === 'completed') return item;
      if (item.status === 'checking' && item.lease_expires_at > stamp())
        throw new HttpError(
          409,
          'This video is already being checked. Wait a moment and try again.',
          'upload_checking',
        );
      await db
        .prepare(
          "UPDATE media_uploads SET status='checking',lease_id=?,lease_expires_at=?,error=NULL WHERE id=?",
        )
        .run(lease, new Date(now().getTime() + 120000).toISOString(), item.id);
      return item;
    });
    if (upload.status === 'completed')
      return response.json(
        publicAsset(await db.prepare('SELECT * FROM media_assets WHERE id = ?').get(upload.id)),
      );
    try {
      const bytes = await storage.readVideoUpload(upload.storage_path);
      if (bytes.length !== Number(upload.expected_size))
        throw new HttpError(
          422,
          'The uploaded file size changed. Start a new upload with the correct file.',
          'upload_size_mismatch',
        );
      const asset = inspectMp4(bytes, upload.name);
      await db.transaction(async () => {
        const current = await uploadFor(upload.id, request.auth.user.id, { lock: true });
        if (current.lease_id !== lease)
          throw new HttpError(
            409,
            'This upload is being checked by another request. Retry confirmation shortly.',
            'upload_checking',
          );
        await db
          .prepare(
            'INSERT INTO media_assets(id,name,mime_type,size,sha256,width,height,storage_kind,storage_path,storage_url,owner_id,created_at,kind,duration) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .run(
            upload.id,
            asset.name,
            asset.mimeType,
            asset.size,
            asset.sha256,
            asset.width,
            asset.height,
            storage.kind,
            upload.storage_path,
            null,
            request.auth.user.id,
            stamp(),
            'video',
            asset.duration,
          );
        await db
          .prepare(
            "UPDATE media_uploads SET status='completed',lease_id=NULL,lease_expires_at=NULL,error=NULL WHERE id=?",
          )
          .run(upload.id);
      });
      response
        .status(201)
        .json(
          publicAsset(await db.prepare('SELECT * FROM media_assets WHERE id = ?').get(upload.id)),
        );
    } catch (error) {
      await db
        .prepare(
          "UPDATE media_uploads SET status='failed',lease_id=NULL,lease_expires_at=NULL,error=? WHERE id=? AND lease_id=?",
        )
        .run(
          error instanceof HttpError
            ? error.message
            : 'The video could not be checked. Please try again.',
          upload.id,
          lease,
        );
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        503,
        'The video could not be checked. Finish uploading and try confirmation again.',
        'video_check_unavailable',
      );
    }
  });
  return {
    async cleanupExpiredUploads() {
      const cutoff = new Date(now().getTime() - 5 * 60 * 1000).toISOString();
      const expired = await db
        .prepare(
          "SELECT media_uploads.id,storage_path FROM media_uploads WHERE status <> 'completed' AND expires_at < ? AND (lease_expires_at IS NULL OR lease_expires_at < ?) AND NOT EXISTS(SELECT 1 FROM media_assets WHERE media_assets.id=media_uploads.id) ORDER BY expires_at LIMIT 5",
        )
        .all(cutoff, stamp());
      let removed = 0;
      for (const row of expired) {
        await storage.removeUploadedPath(row.storage_path);
        const result = await db
          .prepare(
            "DELETE FROM media_uploads WHERE id = ? AND status <> 'completed' AND expires_at < ? AND NOT EXISTS(SELECT 1 FROM media_assets WHERE media_assets.id=media_uploads.id)",
          )
          .run(row.id, cutoff);
        removed += Number(result.changes);
      }
      return { removed };
    },
  };
}
