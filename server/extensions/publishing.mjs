import { transaction, getPost, audit } from '../database.mjs';
import { HttpError } from '../validation.mjs';
import { hash, opaqueId } from './crypto.mjs';
import { ProviderError } from './providers.mjs';
import { PROVIDERS, platformFor } from './provider-definitions.mjs';

export function publicJob(row) {
  return {
    id: row.id,
    postId: row.post_id,
    revision: Number(row.revision),
    connectionId: row.connection_id,
    accountName: row.account_name,
    platform: JSON.parse(row.approved_payload).platform || 'instagram',
    status: row.status,
    scheduledAt: row.scheduled_at,
    attempts: Number(row.attempts),
    error: row.error,
    remoteId: row.remote_id,
    remoteUrl: row.remote_url,
    remoteVisibility: row.remote_visibility ?? null,
    providerStatus: row.provider_status ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function payloadFor(post, connection, assets, legacy = false) {
  if (legacy)
    return {
      postId: post.id,
      revision: post.revision,
      caption: post.caption,
      format: post.format,
      institution: post.institution,
      platform: 'instagram',
      connectionId: connection.id,
      accountId: connection.account_id,
      assetId: assets[0]?.id,
      assetHash: assets[0]?.sha256,
      approvedBy: post.approvedBy,
      approvedAt: post.approvedAt,
    };
  return {
    version: 2,
    postId: post.id,
    revision: post.revision,
    title: post.title,
    caption: post.caption,
    format: post.format,
    institution: post.institution,
    platform: platformFor(connection.provider),
    provider: connection.provider,
    connectionId: connection.id,
    accountId: connection.account_id,
    assets: assets.map((asset) => ({
      id: asset.id,
      sha256: asset.sha256,
      mimeType: asset.mime_type,
      width: Number(asset.width),
      height: Number(asset.height),
      duration:
        asset.duration === null || asset.duration === undefined ? null : Number(asset.duration),
    })),
    publicationOptions: post.publicationOptions ?? {},
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
  const postAssetIds = (post) =>
    post.assetIds?.length ? post.assetIds : post.assetId ? [post.assetId] : [];
  async function postAssets(post) {
    const result = [];
    for (const id of postAssetIds(post)) {
      const asset = await db.prepare('SELECT * FROM media_assets WHERE id = ?').get(id);
      if (!asset)
        throw new HttpError(
          422,
          'A selected media asset is unavailable. Upload it again and obtain approval.',
          'asset_required',
        );
      result.push(asset);
    }
    return result;
  }
  async function validateDestinations(post, strict = false) {
    const ids = post.destinationIds ?? [];
    if (!ids.length) return [];
    const assets = await postAssets(post);
    const imageOnly = assets.every((asset) => asset.mime_type === 'image/jpeg');
    const oneVideo = assets.length === 1 && assets[0].mime_type === 'video/mp4';
    const destinations = [];
    for (const id of ids) {
      const connection = await db.prepare('SELECT * FROM service_connections WHERE id = ?').get(id);
      const capabilities = connection ? JSON.parse(connection.capabilities) : [];
      if (
        !connection ||
        !PROVIDERS[connection.provider]?.capabilities.some((capability) =>
          capability.startsWith('publish:'),
        ) ||
        connection.institution !== post.institution ||
        !connection.account_id ||
        connection.status === 'disconnected'
      )
        throw new HttpError(
          422,
          'Choose a publishing account connected to the same institution as this post.',
          'invalid_destination',
        );
      if (strict) {
        if (connection.status !== 'connected')
          throw new HttpError(
            409,
            'Test or reconnect the destination before approving publication.',
            'destination_unhealthy',
          );
        if (!post.platforms.includes(platformFor(connection.provider)))
          throw new HttpError(
            422,
            'Include every destination’s platform in the approved post.',
            'unsupported_publish_format',
          );
        if (!post.caption.trim())
          throw new HttpError(422, 'Add the exact caption to be approved.', 'caption_required');
        const service = connection.provider;
        let capability;
        if (service === 'instagram') {
          if (post.caption.length > 2200)
            throw new HttpError(
              422,
              'Instagram captions must contain at most 2,200 characters.',
              'instagram_caption_limit',
            );
          if (post.format === 'Post' && assets.length === 1 && imageOnly)
            capability = 'publish:image';
          else if (
            post.format === 'Carousel' &&
            assets.length >= 2 &&
            assets.length <= 10 &&
            imageOnly
          )
            capability = 'publish:carousel';
          else if (post.format === 'Reel' && oneVideo) {
            const video = assets[0];
            if (
              Number(video.duration) < 3 ||
              Number(video.duration) > 600 ||
              Number(video.width) < 320 ||
              Math.abs(Number(video.width) / Number(video.height) - 9 / 16) > 0.02
            )
              throw new HttpError(
                422,
                'For this Instagram Reel adapter, use a 9:16 MP4 at least 320 pixels wide and 3–600 seconds long.',
                'instagram_video_format',
              );
            capability = 'publish:video';
          } else
            throw new HttpError(
              422,
              'Instagram supports one image in Post format, 2–10 images in Carousel format, or one MP4 in Reel format.',
              'unsupported_publish_format',
            );
          if (
            imageOnly &&
            assets.some(
              (asset) =>
                Number(asset.width) < 320 ||
                Number(asset.width) / Number(asset.height) < 0.8 ||
                Number(asset.width) / Number(asset.height) > 1.91,
            )
          )
            throw new HttpError(
              422,
              'Instagram images must be at least 320 pixels wide with a ratio from 4:5 to 1.91:1. Use a consistent ratio for carousel images.',
              'instagram_image_ratio',
            );
          if (
            post.format === 'Carousel' &&
            assets.some(
              (asset) =>
                Math.abs(
                  Number(asset.width) / Number(asset.height) -
                    Number(assets[0].width) / Number(assets[0].height),
                ) > 0.01,
            )
          )
            throw new HttpError(
              422,
              'Use the same aspect ratio for all approved carousel images so they are not cropped differently on Instagram.',
              'instagram_carousel_ratio',
            );
        } else if (service === 'youtube') {
          if (post.format !== 'Video' || !oneVideo)
            throw new HttpError(
              422,
              'YouTube uploads require Video format with one validated MP4.',
              'unsupported_publish_format',
            );
          const options = post.publicationOptions ?? {};
          if (
            !['private', 'unlisted', 'public'].includes(options.youtubePrivacy) ||
            typeof options.madeForKids !== 'boolean' ||
            typeof options.containsSyntheticMedia !== 'boolean'
          )
            throw new HttpError(
              422,
              'Choose YouTube visibility, the made-for-kids audience setting and the altered/synthetic-content declaration before approval.',
              'youtube_options_required',
            );
          if (post.title.length > 100 || /[<>]/.test(post.title) || post.caption.length > 5000)
            throw new HttpError(
              422,
              'YouTube titles must be at most 100 characters without angle brackets; descriptions at most 5,000 characters.',
              'youtube_text_limit',
            );
          capability = 'publish:video';
        } else {
          if (post.format !== 'Post' || assets.length > 1 || !imageOnly)
            throw new HttpError(
              422,
              'This destination supports Post format with text and, optionally, one image.',
              'unsupported_publish_format',
            );
          const limit =
            service === 'google_business' ? 1500 : service.startsWith('linkedin') ? 3000 : 5000;
          if (post.caption.length > limit)
            throw new HttpError(
              422,
              `This destination supports captions up to ${limit.toLocaleString('en-IN')} characters.`,
              'provider_caption_limit',
            );
          capability = assets.length ? 'publish:image' : 'publish:text';
        }
        if (!capabilities.includes(capability))
          throw new HttpError(
            422,
            'The selected authorization does not have permission for this format. Reconnect with the required access or select another account.',
            'destination_permission',
          );
      }
      destinations.push({ connection, assets });
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
    for (const { connection, assets } of destinations) {
      let payload = JSON.stringify(payloadFor(post, connection, assets));
      const existing = await db
        .prepare(
          'SELECT * FROM publication_jobs WHERE post_id = ? AND revision = ? AND connection_id = ?',
        )
        .get(post.id, post.revision, connection.id);
      if (existing) {
        if (!JSON.parse(existing.approved_payload).version)
          payload = JSON.stringify(payloadFor(post, connection, assets, true));
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
          assets[0]?.id ?? null,
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
      (postAssetIds(post)[0] ?? null) !== job.asset_id
    )
      throw new HttpError(
        409,
        'This job no longer matches the approved post revision.',
        'approval_mismatch',
      );
    const connection = await db
      .prepare(`SELECT * FROM service_connections WHERE id = ?${lock ? db.lockSuffix : ''}`)
      .get(job.connection_id);
    const assets = await postAssets(post);
    const legacy = !JSON.parse(job.approved_payload).version;
    if (
      !connection ||
      connection.status !== 'connected' ||
      connection.account_id !== job.account_id ||
      connection.institution !== post.institution ||
      (legacy && assets.length !== 1) ||
      hash(JSON.stringify(payloadFor(post, connection, assets, legacy))) !== job.payload_hash
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
    // Recheck format and authorization capabilities immediately before delivery.
    await validateDestinations({ ...post, destinationIds: [job.connection_id] }, true);
    return { post, connection, assets };
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
  async function finalize(job, remoteId, remoteUrl, actor = null, details = {}) {
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
          "UPDATE publication_jobs SET status = 'published', remote_id = ?, remote_url = ?, remote_visibility = ?, provider_status = ?, error = NULL, lease_id = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?",
        )
        .run(
          remoteId,
          remoteUrl,
          details.visibility ?? null,
          details.providerStatus ?? null,
          stamp(),
          job.id,
        );
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
        'Publication confirmed',
        job.post_id,
        `Revision ${job.revision}; destination ${job.account_name}; provider ID ${remoteId}.`,
        stamp(),
      );
    });
  }
  async function claim() {
    // A crashed worker never silently resends after a publication attempt.
    const expired = await db
      .prepare(
        "SELECT * FROM publication_jobs WHERE status = 'processing' AND lease_expires_at < ? LIMIT 20",
      )
      .all(stamp());
    for (const stale of expired) {
      await transaction(db, async () => {
        const result = await db
          .prepare(
            "UPDATE publication_jobs SET status = CASE WHEN publish_started_at IS NULL THEN 'failed' ELSE 'needs_reconciliation' END, error = 'The worker stopped before recording completion. Inspect this job before retrying.', lease_id = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'processing' AND lease_expires_at < ?",
          )
          .run(stamp(), stale.id, stamp());
        if (result.changes === 1)
          await audit(
            db,
            null,
            stale.publish_started_at ? 'Publication needs reconciliation' : 'Publication failed',
            stale.post_id,
            `Revision ${stale.revision}; destination ${stale.account_name}; worker completion was not confirmed.`,
            stamp(),
          );
      });
    }
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
      const { post, connection, assets } = await preflight(job);
      const service = connection.provider;
      const current = await loadConnectionCredentials(connection);
      const credentials = await connectionSettings(service);
      const media = [];
      for (const asset of assets) {
        const bytes = await storage.read(asset); // The immutable hash is checked before any provider write.
        media.push({
          asset,
          bytes,
          url: ['instagram', 'facebook', 'google_business'].includes(service)
            ? await storage.signedUrl(asset)
            : null,
        });
      }
      let containerId = job.container_id;
      const needsPreparation =
        service === 'instagram' || (service.startsWith('linkedin') && media.length > 0);
      if (needsPreparation && !containerId) {
        containerId = provider.preparePublication
          ? await provider.preparePublication(
              service,
              connection.account_id,
              current,
              credentials,
              post,
              media,
            )
          : await provider.createContainer(
              connection.account_id,
              current,
              credentials,
              post.caption,
              media[0].url,
            );
        await setOwned(job, 'container_id = ?', [containerId]);
        // LinkedIn does not offer synchronous image processing. Member scopes
        // cannot read image status, so allow a queue interval before creating a post.
        if (service.startsWith('linkedin')) {
          await setOwned(
            job,
            "status = 'queued', scheduled_at = ?, lease_id = NULL, lease_expires_at = NULL",
            [new Date(now().getTime() + 60000).toISOString()],
          );
          return {
            processed: 1,
            jobs: [
              publicJob(
                await db.prepare('SELECT * FROM publication_jobs WHERE id = ?').get(job.id),
              ),
            ],
          };
        }
      }
      const state = needsPreparation
        ? provider.preparedStatus
          ? await provider.preparedStatus(service, containerId, current, credentials)
          : await provider.containerStatus(containerId, current, credentials)
        : 'FINISHED';
      if (state === 'PUBLISHED')
        throw new ProviderError(
          'This container is already published. Reconcile its remote identifier before continuing.',
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
          'The provider could not process the approved media. Check the file and retry with a new container.',
          state === 'EXPIRED' ? 'container_expired' : 'container_failed',
        );
      await transaction(db, async () => {
        await preflight(job, { lock: true });
        await setOwned(job, 'publish_started_at = ?', [stamp()]);
      });
      publishingStarted = true;
      const result = provider.publishDirect
        ? await provider.publishDirect(
            service,
            connection.account_id,
            current,
            credentials,
            post,
            media,
            containerId,
          )
        : {
            id: await provider.publish(connection.account_id, containerId, current, credentials),
            url: null,
          };
      publishedId = result.id;
      // Persist the authoritative ID before optional read-back/permalink lookup.
      await setOwned(job, 'remote_id = ?, remote_visibility = ?, provider_status = ?', [
        publishedId,
        result.visibility ?? null,
        result.providerStatus ?? null,
      ]);
      let remoteUrl = validatedPermalink(result.url, service);
      let details = result;
      if (service !== 'linkedin_member') {
        try {
          const remote = provider.publication
            ? await provider.publication(
                service,
                connection.account_id,
                publishedId,
                current,
                credentials,
              )
            : await provider.media(connection.account_id, publishedId, current, credentials);
          remoteUrl = validatedPermalink(remote.permalink, service) || remoteUrl;
          details = {
            visibility: remote.visibility ?? result.visibility,
            providerStatus: remote.providerStatus ?? result.providerStatus,
          };
        } catch {
          /* A provider-confirmed ID remains authoritative when read access lags. */
        }
      }
      await finalize(job, publishedId, remoteUrl, null, details);
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
      const stopped = await db
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
      if (stopped.changes === 1)
        await audit(
          db,
          null,
          ambiguous ? 'Publication needs reconciliation' : 'Publication failed',
          job.post_id,
          `Revision ${job.revision}; destination ${job.account_name}; ${safeMessage}`,
          stamp(),
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
        action === 'retry' ? 'Publication retried' : 'Publication cancelled',
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
    const credentials = await connectionSettings(connection.provider);
    const media = provider.publication
      ? await provider.publication(
          connection.provider,
          connection.account_id,
          remoteId,
          current,
          credentials,
        )
      : await provider.media(connection.account_id, remoteId, current, credentials);
    const payload = JSON.parse(job.approved_payload);
    const timestamp = Date.parse(media.timestamp);
    const started = Date.parse(job.publish_started_at ?? job.updated_at);
    if (
      media.caption !== payload.caption ||
      !Number.isFinite(timestamp) ||
      timestamp < started - 5 * 60000 ||
      timestamp > started + 24 * 3600000 ||
      (job.remote_id && job.remote_id !== String(media.id)) ||
      (connection.provider === 'youtube' && media.title !== payload.title)
    )
      throw new HttpError(
        422,
        'That provider post does not match the approved account, content and publication time.',
        'reconciliation_mismatch',
      );
    await finalize(
      job,
      String(media.id),
      validatedPermalink(media.permalink, connection.provider),
      user,
      media,
    );
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

function validatedPermalink(value, service = 'instagram') {
  try {
    const url = new URL(value);
    const hosts =
      {
        instagram: ['instagram.com', 'www.instagram.com'],
        facebook: ['facebook.com', 'www.facebook.com'],
        linkedin: ['linkedin.com', 'www.linkedin.com'],
        linkedin_member: ['linkedin.com', 'www.linkedin.com'],
        youtube: ['youtube.com', 'www.youtube.com', 'youtu.be'],
        google_business: [
          'google.com',
          'www.google.com',
          'maps.google.com',
          'search.google.com',
          'g.page',
        ],
      }[service] || [];
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      hosts.includes(url.hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
