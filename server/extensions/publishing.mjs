import { transaction, getPost, audit } from '../database.mjs';
import { HttpError } from '../validation.mjs';
import { hash, opaqueId } from './crypto.mjs';
import { ProviderError } from './providers.mjs';

export function publicJob(row) {
  return {
    id: row.id,
    postId: row.post_id,
    revision: Number(row.revision),
    connectionId: row.connection_id,
    accountName: row.account_name,
    platform: 'instagram',
    status: row.status,
    scheduledAt: row.scheduled_at,
    attempts: Number(row.attempts),
    error: row.error,
    remoteId: row.remote_id,
    remoteUrl: row.remote_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function payloadFor(post, connection, asset) {
  return {
    postId: post.id,
    revision: post.revision,
    caption: post.caption,
    format: post.format,
    institution: post.institution,
    platform: 'instagram',
    connectionId: connection.id,
    accountId: connection.account_id,
    assetId: asset.id,
    assetHash: asset.sha256,
    approvedBy: post.approvedBy,
    approvedAt: post.approvedAt,
  };
}

export function createPublishing({
  db,
  now,
  enabled,
  storage,
  provider,
  loadConnectionCredentials,
  connectionSettings,
}) {
  const stamp = () => now().toISOString();
  async function activeLock(postId) {
    return db
      .prepare(
        "SELECT id, status FROM publication_jobs WHERE post_id = ? AND status IN ('processing','needs_reconciliation','published') LIMIT 1",
      )
      .get(postId);
  }
  async function assertUnlocked(postId) {
    const blocked = postId ? await activeLock(postId) : null;
    if (blocked?.status === 'published')
      throw new HttpError(
        409,
        'This content has already been published to a destination. Duplicate the draft to change it, and manage any remaining deliveries in Publications.',
        'publication_already_sent',
      );
    if (blocked)
      throw new HttpError(
        409,
        'A publication is running or needs reconciliation. Resolve that job before changing this post.',
        'publication_locked',
      );
  }
  async function validateDestinations(post, strict = false) {
    const ids = post.destinationIds ?? [];
    if (!ids.length) return [];
    const asset = post.assetId
      ? await db.prepare('SELECT * FROM media_assets WHERE id = ?').get(post.assetId)
      : null;
    if (strict && !asset)
      throw new HttpError(
        422,
        'Upload and select the exact image to be approved for publication.',
        'asset_required',
      );
    if (post.assetId && !asset)
      throw new HttpError(422, 'The selected image is unavailable.', 'asset_required');
    if (strict && (post.format !== 'Post' || !post.platforms.includes('instagram')))
      throw new HttpError(
        422,
        'Live Instagram publishing currently supports one image in Post format. Select Instagram as a platform.',
        'unsupported_publish_format',
      );
    if (strict && (post.caption.length > 2200 || !post.caption.trim()))
      throw new HttpError(
        422,
        'Instagram captions must contain between 1 and 2,200 characters.',
        'instagram_caption_limit',
      );
    if (
      strict &&
      asset &&
      (asset.mime_type !== 'image/jpeg' ||
        Number(asset.width) < 320 ||
        Number(asset.width) / Number(asset.height) < 0.8 ||
        Number(asset.width) / Number(asset.height) > 1.91)
    )
      throw new HttpError(
        422,
        'For this Instagram adapter, use an image at least 320 pixels wide with an aspect ratio from 4:5 to 1.91:1.',
        'instagram_image_ratio',
      );
    const destinations = [];
    for (const id of ids) {
      const connection = await db.prepare('SELECT * FROM service_connections WHERE id = ?').get(id);
      if (
        !connection ||
        connection.provider !== 'instagram' ||
        connection.institution !== post.institution ||
        !connection.account_id ||
        connection.status === 'disconnected'
      )
        throw new HttpError(
          422,
          'Choose an Instagram account connected to the same institution as this post.',
          'invalid_destination',
        );
      if (strict && connection.status !== 'connected')
        throw new HttpError(
          409,
          'Test or reconnect the Instagram destination before approving publication.',
          'destination_unhealthy',
        );
      destinations.push({ connection, asset });
    }
    return destinations;
  }
  async function enqueue(post, user, scheduledAt) {
    if (
      !['approved', 'scheduled'].includes(post.status) ||
      post.approvedRevision !== post.revision ||
      !post.approvedBy ||
      !post.approvedAt
    )
      throw new HttpError(
        409,
        'A manager must approve exactly this content, image and destination before queuing it.',
        'approval_required',
      );
    const destinations = await validateDestinations(post, true);
    if (!destinations.length) return [];
    const when = scheduledAt ?? post.scheduledAt ?? stamp();
    if (!Number.isFinite(Date.parse(when)))
      throw new HttpError(422, 'Choose a valid publication time.', 'invalid_schedule');
    for (const { connection, asset } of destinations) {
      const payload = JSON.stringify(payloadFor(post, connection, asset));
      const existing = await db
        .prepare(
          'SELECT * FROM publication_jobs WHERE post_id = ? AND revision = ? AND connection_id = ?',
        )
        .get(post.id, post.revision, connection.id);
      if (existing) {
        if (existing.payload_hash !== hash(payload))
          throw new HttpError(
            409,
            'The approved destination or image has changed. Create a new revision and obtain approval.',
            'approval_mismatch',
          );
        if (existing.status === 'cancelled' || existing.status === 'queued')
          await db
            .prepare(
              "UPDATE publication_jobs SET status = 'queued', scheduled_at = ?, error = NULL, updated_at = ? WHERE id = ? AND status IN ('cancelled','queued')",
            )
            .run(new Date(when).toISOString(), stamp(), existing.id);
        continue;
      }
      await db
        .prepare(
          `INSERT INTO publication_jobs(id, post_id, revision, connection_id, account_id, account_name, asset_id, approved_payload, payload_hash, status, scheduled_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?) ON CONFLICT(post_id, revision, connection_id) DO NOTHING`,
        )
        .run(
          opaqueId('pub'),
          post.id,
          post.revision,
          connection.id,
          connection.account_id,
          connection.account_name,
          asset.id,
          payload,
          hash(payload),
          new Date(when).toISOString(),
          stamp(),
          stamp(),
        );
    }
    return (
      await db
        .prepare(
          'SELECT * FROM publication_jobs WHERE post_id = ? AND revision = ? ORDER BY created_at',
        )
        .all(post.id, post.revision)
    ).map(publicJob);
  }
  async function cancelPending(postId, reason) {
    await db
      .prepare(
        "UPDATE publication_jobs SET status = 'cancelled', error = ?, updated_at = ? WHERE post_id = ? AND status IN ('queued','failed')",
      )
      .run(reason, stamp(), postId);
  }
  async function preflight(job, { lock = false } = {}) {
    const post = await getPost(db, job.post_id, { lock });
    if (
      !post ||
      !['approved', 'scheduled'].includes(post.status) ||
      post.revision !== Number(job.revision) ||
      post.approvedRevision !== post.revision ||
      !post.destinationIds.includes(job.connection_id) ||
      post.assetId !== job.asset_id
    )
      throw new HttpError(
        409,
        'This job no longer matches the approved post revision.',
        'approval_mismatch',
      );
    const connection = await db
      .prepare(`SELECT * FROM service_connections WHERE id = ?${lock ? db.lockSuffix : ''}`)
      .get(job.connection_id);
    const asset = await db.prepare('SELECT * FROM media_assets WHERE id = ?').get(job.asset_id);
    if (
      !connection ||
      connection.status !== 'connected' ||
      connection.account_id !== job.account_id ||
      connection.institution !== post.institution ||
      !asset ||
      hash(JSON.stringify(payloadFor(post, connection, asset))) !== job.payload_hash
    )
      throw new HttpError(
        409,
        'The destination, image or approval changed. Obtain a new approval.',
        'approval_mismatch',
      );
    const approver = await db
      .prepare("SELECT id FROM users WHERE id = ? AND role = 'manager' AND active = 1")
      .get(post.approvedBy);
    if (!approver)
      throw new HttpError(
        409,
        'The approving manager no longer has permission. Obtain a new approval.',
        'approver_unavailable',
      );
    return { post, connection, asset };
  }
  async function setOwned(job, updates, params = []) {
    const result = await db
      .prepare(
        `UPDATE publication_jobs SET ${updates}, updated_at = ? WHERE id = ? AND status = 'processing' AND lease_id = ?`,
      )
      .run(...params, stamp(), job.id, job.lease_id);
    if (result.changes !== 1)
      throw new HttpError(
        409,
        'The publication lease changed. Inspect the job before continuing.',
        'publication_lease_lost',
      );
  }
  async function finalize(job, remoteId, remoteUrl, actor = null) {
    await transaction(db, async () => {
      const post = await getPost(db, job.post_id, { lock: true });
      const current = await db
        .prepare(`SELECT * FROM publication_jobs WHERE id = ?${db.lockSuffix}`)
        .get(job.id);
      if (!current || !['processing', 'needs_reconciliation'].includes(current.status))
        throw new HttpError(
          409,
          'This job is no longer awaiting publication confirmation.',
          'invalid_state',
        );
      if (current.status === 'processing' && current.lease_id !== job.lease_id)
        throw new HttpError(409, 'The publication lease changed.', 'publication_lease_lost');
      await db
        .prepare(
          "UPDATE publication_jobs SET status = 'published', remote_id = ?, remote_url = ?, error = NULL, lease_id = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?",
        )
        .run(remoteId, remoteUrl, stamp(), job.id);
      const outstanding = await db
        .prepare(
          "SELECT id FROM publication_jobs WHERE post_id = ? AND revision = ? AND status <> 'published' LIMIT 1",
        )
        .get(job.post_id, job.revision);
      if (
        !outstanding &&
        post?.revision === Number(job.revision) &&
        post.approvedRevision === post.revision
      )
        await db
          .prepare(
            "UPDATE posts SET status = 'published', updated_at = ? WHERE id = ? AND revision = ?",
          )
          .run(stamp(), job.post_id, job.revision);
      await audit(
        db,
        actor,
        'Instagram publication confirmed',
        job.post_id,
        `Revision ${job.revision}; destination ${job.account_name}; provider ID ${remoteId}.`,
        stamp(),
      );
    });
  }
  async function claim() {
    // A crashed worker is never silently allowed to resend after media_publish.
    await db
      .prepare(
        "UPDATE publication_jobs SET status = CASE WHEN publish_started_at IS NULL THEN 'failed' ELSE 'needs_reconciliation' END, error = 'The worker stopped before recording completion. Inspect this job before retrying.', lease_id = NULL, lease_expires_at = NULL, updated_at = ? WHERE status = 'processing' AND lease_expires_at < ?",
      )
      .run(stamp(), stamp());
    const next = await db
      .prepare(
        "SELECT * FROM publication_jobs WHERE status = 'queued' AND scheduled_at <= ? ORDER BY scheduled_at, created_at LIMIT 1",
      )
      .get(stamp());
    if (!next) return null;
    return transaction(db, async () => {
      // Keep the lock order post -> connection -> job. Connection changes take
      // connection -> job, so they cannot deadlock a claim during disconnect.
      await getPost(db, next.post_id, { lock: true });
      try {
        await preflight(next, { lock: true });
      } catch (error) {
        await db
          .prepare(
            "UPDATE publication_jobs SET status = 'cancelled', error = ?, updated_at = ? WHERE id = ? AND status = 'queued'",
          )
          .run(
            error instanceof HttpError
              ? error.message
              : 'The approved publication could not be verified.',
            stamp(),
            next.id,
          );
        return null;
      }
      const job = await db
        .prepare(`SELECT * FROM publication_jobs WHERE id = ?${db.lockSuffix}`)
        .get(next.id);
      if (job?.status !== 'queued' || Date.parse(job.scheduled_at) > now().getTime()) return null;
      const lease = opaqueId('lease');
      const claimed = await db
        .prepare(
          "UPDATE publication_jobs SET status = 'processing', attempts = attempts + 1, lease_id = ?, lease_expires_at = ?, error = NULL, updated_at = ? WHERE id = ? AND status = 'queued' AND scheduled_at <= ?",
        )
        .run(
          lease,
          new Date(now().getTime() + 5 * 60 * 1000).toISOString(),
          stamp(),
          job.id,
          stamp(),
        );
      if (claimed.changes !== 1) return null;
      return { ...job, status: 'processing', lease_id: lease, attempts: Number(job.attempts) + 1 };
    });
  }
  async function run() {
    if (!enabled)
      throw new HttpError(
        409,
        'Live publishing is disabled for this deployment. Complete account setup and enable PUBLISHING_ENABLED before running jobs.',
        'publishing_disabled',
      );
    if (!storage.canDeliver)
      throw new HttpError(
        503,
        'Configure private cloud image storage before running publication jobs.',
        'media_delivery_required',
      );
    const job = await claim();
    if (!job) return { processed: 0, jobs: [] };
    let publishedId = null;
    let publishingStarted = false;
    try {
      const { post, connection, asset } = await preflight(job);
      const current = await loadConnectionCredentials(connection);
      const credentials = await connectionSettings('instagram');
      await storage.read(asset); // Full byte hash check before issuing delivery URL.
      let containerId = job.container_id;
      if (!containerId) {
        containerId = await provider.createContainer(
          connection.account_id,
          current,
          credentials,
          post.caption,
          await storage.signedUrl(asset),
        );
        await setOwned(job, 'container_id = ?', [containerId]);
      }
      const state = await provider.containerStatus(containerId, current, credentials);
      if (state === 'PUBLISHED')
        throw new ProviderError(
          'This container is already published. Reconcile its media ID before continuing.',
          'container_already_published',
          { ambiguous: true },
        );
      if (state === 'IN_PROGRESS') {
        await setOwned(
          job,
          "status = 'queued', scheduled_at = ?, lease_id = NULL, lease_expires_at = NULL",
          [new Date(now().getTime() + 60000).toISOString()],
        );
        return {
          processed: 1,
          jobs: [
            publicJob(await db.prepare('SELECT * FROM publication_jobs WHERE id = ?').get(job.id)),
          ],
        };
      }
      if (state !== 'FINISHED')
        throw new ProviderError(
          'Instagram could not process the approved image. Check the image and retry with a new container.',
          state === 'EXPIRED' ? 'container_expired' : 'container_failed',
        );
      await transaction(db, async () => {
        await preflight(job, { lock: true });
        await setOwned(job, 'publish_started_at = ?', [stamp()]);
      });
      publishingStarted = true;
      publishedId = await provider.publish(
        connection.account_id,
        containerId,
        current,
        credentials,
      );
      // Persist the authoritative remote ID before an optional permalink lookup.
      await setOwned(job, 'remote_id = ?', [publishedId]);
      let remoteUrl = null;
      try {
        const media = await provider.media(
          connection.account_id,
          publishedId,
          current,
          credentials,
        );
        remoteUrl = validatedPermalink(media.permalink);
      } catch {
        /* A confirmed publish ID remains authoritative when reads lag. */
      }
      await finalize(job, publishedId, remoteUrl);
    } catch (error) {
      const ambiguous = Boolean(
        publishedId ||
        (publishingStarted && (!(error instanceof ProviderError) || error.ambiguous)) ||
        error?.code === 'container_already_published',
      );
      const safeMessage =
        error instanceof HttpError || error instanceof ProviderError
          ? error.message
          : 'Publication stopped unexpectedly. Inspect the job before continuing.';
      await db
        .prepare(
          "UPDATE publication_jobs SET status = ?, error = ?, remote_id = COALESCE(?, remote_id), lease_id = NULL, lease_expires_at = NULL, publish_started_at = CASE WHEN ? = 'failed' THEN NULL ELSE publish_started_at END, container_id = CASE WHEN ? IN ('container_expired','container_failed') THEN NULL ELSE container_id END, updated_at = ? WHERE id = ? AND status = 'processing' AND lease_id = ?",
        )
        .run(
          ambiguous ? 'needs_reconciliation' : 'failed',
          safeMessage,
          publishedId,
          ambiguous ? 'needs_reconciliation' : 'failed',
          error?.code ?? '',
          stamp(),
          job.id,
          job.lease_id,
        );
      if (error?.reauthenticate)
        await db
          .prepare(
            "UPDATE service_connections SET status = 'needs_attention', error = ? WHERE id = ? AND status <> 'disconnected'",
          )
          .run(safeMessage, job.connection_id);
    }
    return {
      processed: 1,
      jobs: [
        publicJob(await db.prepare('SELECT * FROM publication_jobs WHERE id = ?').get(job.id)),
      ],
    };
  }
  async function changeJob(id, action, user) {
    return transaction(db, async () => {
      const first = await db.prepare('SELECT * FROM publication_jobs WHERE id = ?').get(id);
      if (!first) throw new HttpError(404, 'Publication job not found.', 'not_found');
      await getPost(db, first.post_id, { lock: true });
      const job = await db
        .prepare(`SELECT * FROM publication_jobs WHERE id = ?${db.lockSuffix}`)
        .get(id);
      if (!['queued', 'failed', 'cancelled'].includes(job.status))
        throw new HttpError(
          409,
          'Only a queued, failed or cancelled job can be changed. A potentially published job must be reconciled.',
          'publication_locked',
        );
      if (action === 'retry') {
        if (job.status === 'queued') return publicJob(job);
        await preflight(job);
        if (job.publish_started_at || job.remote_id)
          throw new HttpError(
            409,
            'This job may already be published. Reconcile it instead of retrying.',
            'reconciliation_required',
          );
      }
      await db
        .prepare(
          'UPDATE publication_jobs SET status = ?, scheduled_at = ?, error = ?, updated_at = ? WHERE id = ?',
        )
        .run(
          action === 'retry' ? 'queued' : 'cancelled',
          action === 'retry' ? stamp() : job.scheduled_at,
          action === 'retry' ? null : 'Cancelled by a manager.',
          stamp(),
          id,
        );
      await audit(
        db,
        user,
        action === 'retry' ? 'Publication retry queued' : 'Publication cancelled',
        job.post_id,
        `Revision ${job.revision}; destination ${job.account_name}.`,
        stamp(),
      );
      return publicJob(await db.prepare('SELECT * FROM publication_jobs WHERE id = ?').get(id));
    });
  }
  async function reconcile(id, remoteId, user) {
    const job = await db.prepare('SELECT * FROM publication_jobs WHERE id = ?').get(id);
    if (!job || job.status !== 'needs_reconciliation')
      throw new HttpError(409, 'This job does not need reconciliation.', 'invalid_state');
    const { connection } = await preflight(job);
    const current = await loadConnectionCredentials(connection);
    const media = await provider.media(
      connection.account_id,
      remoteId,
      current,
      await connectionSettings('instagram'),
    );
    const payload = JSON.parse(job.approved_payload);
    const timestamp = Date.parse(media.timestamp);
    const started = Date.parse(job.publish_started_at ?? job.updated_at);
    if (
      media.caption !== payload.caption ||
      !Number.isFinite(timestamp) ||
      timestamp < started - 5 * 60000 ||
      timestamp > started + 24 * 3600000 ||
      (job.remote_id && job.remote_id !== String(media.id))
    )
      throw new HttpError(
        422,
        'That Instagram post does not match this approved caption and publication time.',
        'reconciliation_mismatch',
      );
    await finalize(job, String(media.id), validatedPermalink(media.permalink), user);
    return publicJob(await db.prepare('SELECT * FROM publication_jobs WHERE id = ?').get(id));
  }
  return {
    enqueue,
    run,
    cancelPending,
    assertUnlocked,
    validateDestinations,
    changeJob,
    reconcile,
    preflight,
  };
}

function validatedPermalink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      ['instagram.com', 'www.instagram.com'].includes(url.hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
