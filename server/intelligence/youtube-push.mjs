import express from 'express';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { transaction, audit } from '../database.mjs';
import { HttpError, parse } from '../validation.mjs';
import { createVault, secretEqual } from '../extensions/crypto.mjs';
import { publicHttpsUrl } from './safe-fetch.mjs';
import { attributes, elements, plainText, scanTags, youtubeFeed } from './parse.mjs';

const HUB = 'https://pubsubhubbub.appspot.com/subscribe';
export const YOUTUBE_PUSH_LIMITS = Object.freeze({
  payloadBytes: 256 * 1024,
  entriesPerDelivery: 40,
  requestedLeaseSeconds: 5 * 24 * 3600,
  pendingMinutes: 15,
  manualCooldownSeconds: 60,
  renewalsPerRun: 1,
  receiptsPerWatch: 200,
  revisionsPerWatch: 1000,
});
const hash = (value) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const scalar = z.string().min(1).max(2048);
const verificationSchema = z.object({
  'hub.mode': z.enum(['subscribe', 'unsubscribe']),
  'hub.topic': scalar,
  'hub.challenge': z.string().regex(/^[A-Za-z0-9+/.=_-]{1,512}$/),
  'hub.lease_seconds': z
    .string()
    .regex(/^\d{1,8}$/)
    .optional(),
  'hub.verify_token': z.string().max(200).optional(),
});

export function verifyYoutubeSignature(body, signature, secret) {
  if (!Buffer.isBuffer(body) || typeof signature !== 'string' || signature.length > 600)
    return false;
  return signature
    .split(',')
    .slice(0, 4)
    .some((value) => {
      const match = value.trim().match(/^(sha1|sha256|sha384|sha512)=([a-f0-9]+)$/i);
      if (!match) return false;
      const actual = Buffer.from(match[2], 'hex');
      const expected = createHmac(match[1].toLowerCase(), secret).update(body).digest();
      return (
        match[2].length === expected.length * 2 &&
        actual.length === expected.length &&
        timingSafeEqual(actual, expected)
      );
    });
}

function elementText(source, name) {
  const found = elements(source, [name], 2);
  if (found.length !== 1) return '';
  return plainText(source.slice(found[0].payload, found[0].contentEnd), 200);
}

// The existing feed parser extracts inert metadata. This adds signed-topic and
// per-entry channel checks before that parser is allowed to write any notice.
export function validateYoutubeDelivery(body, topic, now) {
  if (!Buffer.isBuffer(body) || !body.length || body.length > YOUTUBE_PUSH_LIMITS.payloadBytes)
    throw new HttpError(
      413,
      'The YouTube notification exceeds the payload limit.',
      'push_payload_limit',
    );
  const text = body.toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new HttpError(422, 'Custom XML declarations are not supported.', 'unsafe_xml');
  const feeds = elements(text, ['feed'], 2);
  if (feeds.length !== 1)
    throw new HttpError(422, 'A complete YouTube Atom feed is required.', 'invalid_youtube_push');
  const expectedFeed = youtubeFeed(topic);
  const channelId = new URL(expectedFeed).searchParams.get('channel_id');
  let self = null;
  for (const tag of scanTags(text.slice(feeds[0].payload, feeds[0].contentEnd))) {
    if (tag.tag !== 'link' || tag.closing) continue;
    const fragment = text.slice(feeds[0].payload, feeds[0].contentEnd);
    const values = attributes(fragment.slice(tag.start, tag.end));
    if (values.rel === 'self') {
      if (self)
        throw new HttpError(
          422,
          'The notification has conflicting topic links.',
          'push_topic_mismatch',
        );
      self = values.href;
    }
  }
  if (!self || ![topic, expectedFeed].includes(self))
    throw new HttpError(
      422,
      'The notification topic does not match this channel.',
      'push_topic_mismatch',
    );
  const entries = elements(text, ['entry'], YOUTUBE_PUSH_LIMITS.entriesPerDelivery + 1);
  if (!entries.length || entries.length > YOUTUBE_PUSH_LIMITS.entriesPerDelivery)
    throw new HttpError(
      422,
      'The notification must contain 1 to 40 video entries.',
      'push_entry_limit',
    );
  const videos = new Set();
  for (const entry of entries) {
    const fragment = text.slice(entry.payload, entry.contentEnd);
    const videoId = elementText(fragment, 'yt:videoId');
    const updated = elementText(fragment, 'updated');
    if (
      elementText(fragment, 'yt:channelId') !== channelId ||
      !/^[A-Za-z0-9_-]{11}$/.test(videoId) ||
      !elementText(fragment, 'title') ||
      videos.has(videoId) ||
      !updated ||
      !Number.isFinite(new Date(updated).getTime()) ||
      new Date(updated).getTime() > now.getTime() + 5 * 60000
    )
      throw new HttpError(
        422,
        'A video identity or update time does not match this channel.',
        'invalid_youtube_entry',
      );
    videos.add(videoId);
  }
  return { text, topic, channelId };
}

export function createYoutubePushService({
  db,
  now,
  watches,
  publicOrigin,
  encryptionKey,
  fetch: fetchImpl = globalThis.fetch,
  automationEnabled = true,
}) {
  const vault = createVault(encryptionKey);
  let origin = null;
  try {
    origin = publicHttpsUrl(publicOrigin).origin;
  } catch {
    /* Local previews cannot receive a public hub callback. */
  }
  const ready = Boolean(vault && origin && automationEnabled);
  const stamp = () => now().toISOString();
  const purpose = (watchId) => `youtube-push:${watchId}`;
  const callback = (id) => `${origin}/api/intelligence/youtube-push/callback/${id}`;
  const setupReason = !automationEnabled
    ? 'Automatic monitoring is disabled by the workspace owner.'
    : !vault
      ? 'The workspace owner must enable server-side credential encryption.'
      : !origin
        ? 'A stable public HTTPS app address is required to receive YouTube updates.'
        : null;
  async function manager(actor) {
    const user = actor?.id
      ? await db.prepare('SELECT active,role FROM users WHERE id=?').get(actor.id)
      : null;
    if (!user || Number(user.active) !== 1 || user.role !== 'manager')
      throw new HttpError(
        403,
        'A manager must change YouTube push monitoring.',
        'manager_required',
      );
  }
  async function watch(id) {
    const row = await db.prepare('SELECT * FROM intelligence_watches WHERE id=?').get(id);
    if (!row || row.mode !== 'youtube')
      throw new HttpError(
        404,
        'Choose an existing YouTube channel watch.',
        'youtube_watch_not_found',
      );
    return row;
  }
  const get = (id, lock = false) =>
    db
      .prepare(
        `SELECT * FROM intelligence_youtube_subscriptions WHERE watch_id=?${lock ? db.lockSuffix : ''}`,
      )
      .get(id);
  function eligibleReason(row) {
    return (
      setupReason ||
      (Number(row.active) !== 1
        ? 'Resume this channel watch before enabling push updates.'
        : !row.last_success_at
          ? 'Run the first channel check to record a baseline, then enable push updates.'
          : null)
    );
  }
  function publicState(row, sub) {
    const identityMatches = !sub || youtubeFeed(row.url) === youtubeFeed(sub.topic);
    const reason =
      eligibleReason(row) ||
      (!identityMatches
        ? 'This watch now points to a different channel. Enable push again for the current channel.'
        : null);
    const state =
      !sub || !Number(sub.enabled)
        ? 'disabled'
        : reason
          ? 'paused'
          : sub.lease_expires_at && sub.lease_expires_at > stamp()
            ? 'active'
            : sub.pending_until > stamp() && sub.requested_mode === 'subscribe'
              ? 'pending'
              : 'needs_attention';
    return {
      watchId: row.id,
      enabled: Boolean(sub && Number(sub.enabled)),
      state,
      canEnable: !eligibleReason(row),
      reason,
      error: sub?.last_error ?? null,
      leaseExpiresAt: sub?.lease_expires_at ?? null,
      renewAfter: sub?.renew_after ?? null,
      lastDeliveryAt: sub?.last_delivery_at ?? null,
      lastAttemptAt: sub?.last_attempt_at ?? null,
    };
  }
  async function list() {
    const rows = await db
      .prepare("SELECT * FROM intelligence_watches WHERE mode='youtube' ORDER BY created_at,id")
      .all();
    const subscriptions = await db
      .prepare('SELECT * FROM intelligence_youtube_subscriptions')
      .all();
    return {
      available: ready,
      reason: setupReason,
      subscriptions: rows.map((row) =>
        publicState(
          row,
          subscriptions.find((sub) => sub.watch_id === row.id),
        ),
      ),
      limits: YOUTUBE_PUSH_LIMITS,
    };
  }
  async function failRequest(id, requestToken, message) {
    await transaction(db, async () => {
      const row = await get(id, true);
      if (!row || row.request_token !== requestToken || row.verified_token === requestToken) return;
      const failures = Number(row.failures) + 1;
      const retry = new Date(
        now().getTime() + Math.min(24 * 3600000, 30 * 60000 * 2 ** Math.min(failures - 1, 6)),
      ).toISOString();
      await db
        .prepare(
          `UPDATE intelligence_youtube_subscriptions SET status=?,last_error=?,failures=?,renew_after=?,updated_at=? WHERE watch_id=? AND request_token=?`,
        )
        .run(
          Number(row.enabled) ? 'needs_attention' : 'disabled',
          message,
          failures,
          retry,
          stamp(),
          id,
          requestToken,
        );
      if (row.last_error !== message)
        await audit(db, null, 'Monitor needs attention', id, message, stamp());
    });
  }
  async function requestSubscription(id, mode, { actor = null, automatic = false } = {}) {
    if (!ready && mode === 'subscribe')
      throw new HttpError(409, setupReason, 'youtube_push_unavailable');
    const requestToken = token();
    const claimed = await transaction(db, async () => {
      const row = await get(id, true);
      if (!row) return null;
      const currentWatch = await watch(id);
      if (
        mode === 'subscribe' &&
        (eligibleReason(currentWatch) ||
          !Number(row.enabled) ||
          youtubeFeed(currentWatch.url) !== youtubeFeed(row.topic))
      )
        return null;
      if (
        automatic &&
        (!row.renew_after ||
          row.renew_after > stamp() ||
          (row.pending_until > stamp() && row.verified_token !== row.request_token))
      )
        return null;
      if (
        !automatic &&
        row.last_attempt_at &&
        now().getTime() - new Date(row.last_attempt_at).getTime() <
          YOUTUBE_PUSH_LIMITS.manualCooldownSeconds * 1000 &&
        row.requested_mode === mode
      )
        throw new HttpError(
          429,
          'Wait one minute before retrying this subscription.',
          'youtube_push_rate_limited',
        );
      const pending = new Date(
        now().getTime() + YOUTUBE_PUSH_LIMITS.pendingMinutes * 60000,
      ).toISOString();
      await db
        .prepare(
          `UPDATE intelligence_youtube_subscriptions SET requested_mode=?,request_token=?,pending_until=?,renew_after=?,last_attempt_at=?,status=?,updated_at=? WHERE watch_id=?`,
        )
        .run(
          mode,
          requestToken,
          pending,
          pending,
          stamp(),
          mode === 'subscribe' ? 'pending' : 'disabled',
          stamp(),
          id,
        );
      return { ...row, request_token: requestToken };
    });
    if (!claimed) return { skipped: true };
    if (!vault || !origin) {
      await failRequest(
        id,
        requestToken,
        'Push delivery is stopped locally. Restore the server configuration to confirm the remote unsubscribe.',
      );
      return { pending: false };
    }
    try {
      const secret = vault.open(claimed.encrypted_secret, purpose(id));
      const form = new URLSearchParams({
        'hub.callback': callback(claimed.callback_id),
        'hub.mode': mode,
        'hub.topic': claimed.topic,
        'hub.verify': 'async',
        'hub.verify_token': requestToken,
        'hub.secret': secret.hmac,
        'hub.lease_seconds': String(YOUTUBE_PUSH_LIMITS.requestedLeaseSeconds),
      });
      const result = await fetchImpl(HUB, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      await result.body?.cancel();
      if (!result.ok) throw new Error('hub_request_failed');
      if (actor)
        await audit(
          db,
          actor,
          mode === 'subscribe' ? 'YouTube push requested' : 'YouTube push disabled',
          id,
          mode === 'subscribe'
            ? 'The channel subscription awaits hub verification. Callback details were generated by the server.'
            : 'Push delivery is stopped locally. The hub was asked to unsubscribe.',
          stamp(),
        );
    } catch {
      await failRequest(
        id,
        requestToken,
        mode === 'subscribe'
          ? 'YouTube could not confirm the subscription request. Scheduled feed checks remain available; the worker will retry.'
          : 'Push delivery is stopped locally. The hub unsubscribe will be retried.',
      );
    }
    return { pending: true };
  }
  async function enable(id, actor) {
    await manager(actor);
    const currentWatch = await watch(id);
    const reason = eligibleReason(currentWatch);
    if (reason) throw new HttpError(409, reason, 'youtube_push_unavailable');
    const canonical = youtubeFeed(currentWatch.url);
    const topic = canonical.replace('/feeds/', '/xml/feeds/');
    const channelId = new URL(canonical).searchParams.get('channel_id');
    await transaction(db, async () => {
      const previous = await get(id, true);
      if (previous && previous.topic === topic) {
        await db
          .prepare(
            'UPDATE intelligence_youtube_subscriptions SET enabled=1,updated_at=? WHERE watch_id=?',
          )
          .run(stamp(), id);
      } else {
        const encrypted = vault.seal({ hmac: token() }, purpose(id));
        await db
          .prepare(
            `INSERT INTO intelligence_youtube_subscriptions(watch_id,callback_id,channel_id,topic,encrypted_secret,enabled,status,created_by,created_at,updated_at)
           VALUES(?,?,?,?,?,1,'pending',?,?,?) ON CONFLICT(watch_id) DO UPDATE SET callback_id=excluded.callback_id,channel_id=excluded.channel_id,
           topic=excluded.topic,encrypted_secret=excluded.encrypted_secret,enabled=1,status='pending',requested_mode=NULL,request_token=NULL,
           verified_token=NULL,pending_until=NULL,lease_expires_at=NULL,renew_after=NULL,last_attempt_at=NULL,last_delivery_at=NULL,last_error=NULL,failures=0,updated_at=excluded.updated_at`,
          )
          .run(id, token(), channelId, topic, encrypted, actor.id, stamp(), stamp());
      }
    });
    await requestSubscription(id, 'subscribe', { actor });
    return publicState(await watch(id), await get(id));
  }
  async function disable(id, actor) {
    await manager(actor);
    const currentWatch = await watch(id);
    const sub = await get(id);
    if (!sub) return publicState(currentWatch, null);
    await db
      .prepare(
        "UPDATE intelligence_youtube_subscriptions SET enabled=0,status='disabled',updated_at=? WHERE watch_id=?",
      )
      .run(stamp(), id);
    await requestSubscription(id, 'unsubscribe', { actor });
    return publicState(await watch(id), await get(id));
  }
  async function verify(callbackId, input) {
    const value = parse(verificationSchema, input);
    return transaction(db, async () => {
      const row = await db
        .prepare(
          `SELECT * FROM intelligence_youtube_subscriptions WHERE callback_id=?${db.lockSuffix}`,
        )
        .get(callbackId);
      if (
        !row ||
        !vault ||
        row.topic !== value['hub.topic'] ||
        row.requested_mode !== value['hub.mode'] ||
        !row.pending_until ||
        row.pending_until <= stamp() ||
        (value['hub.mode'] === 'subscribe') !== Boolean(Number(row.enabled))
      )
        throw new HttpError(
          404,
          'No matching subscription intent is pending.',
          'push_intent_not_found',
        );
      if (value['hub.verify_token'] && !secretEqual(value['hub.verify_token'], row.request_token))
        throw new HttpError(
          404,
          'No matching subscription intent is pending.',
          'push_intent_not_found',
        );
      if (value['hub.mode'] === 'subscribe') {
        const currentWatch = await watch(row.watch_id);
        if (
          !ready ||
          eligibleReason(currentWatch) ||
          youtubeFeed(currentWatch.url) !== youtubeFeed(row.topic)
        )
          throw new HttpError(
            404,
            'The channel watch is no longer eligible.',
            'push_intent_not_found',
          );
      }
      if (row.verified_token !== row.request_token) {
        const leaseSeconds = Number(value['hub.lease_seconds']);
        if (
          value['hub.mode'] === 'subscribe' &&
          (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 31536000)
        )
          throw new HttpError(422, 'The subscription needs a finite lease.', 'invalid_push_lease');
        const subscribed = value['hub.mode'] === 'subscribe';
        const expiry = subscribed
          ? new Date(now().getTime() + leaseSeconds * 1000).toISOString()
          : null;
        const renewal = subscribed
          ? new Date(
              now().getTime() +
                Math.max(1000, leaseSeconds * 1000 - Math.min(86400000, leaseSeconds * 500)),
            ).toISOString()
          : null;
        await db
          .prepare(
            `UPDATE intelligence_youtube_subscriptions SET status=?,verified_token=request_token,lease_expires_at=?,renew_after=?,last_error=NULL,failures=0,updated_at=? WHERE watch_id=?`,
          )
          .run(subscribed ? 'active' : 'disabled', expiry, renewal, stamp(), row.watch_id);
      }
      return value['hub.challenge'];
    });
  }
  async function receive(callbackId, body, signature) {
    if (!Buffer.isBuffer(body) || !body.length || body.length > YOUTUBE_PUSH_LIMITS.payloadBytes)
      throw new HttpError(
        413,
        'The YouTube notification exceeds the payload limit.',
        'push_payload_limit',
      );
    const row = await db
      .prepare('SELECT * FROM intelligence_youtube_subscriptions WHERE callback_id=?')
      .get(callbackId);
    if (!row || !vault)
      throw new HttpError(404, 'This push callback is unavailable.', 'push_not_found');
    const secret = vault.open(row.encrypted_secret, purpose(row.watch_id));
    if (!verifyYoutubeSignature(body, signature, secret.hmac))
      throw new HttpError(403, 'The YouTube signature is invalid.', 'invalid_push_signature');
    if (!ready || !Number(row.enabled) || !row.lease_expires_at || row.lease_expires_at <= stamp())
      return { ignored: true };
    const payload = validateYoutubeDelivery(body, row.topic, now());
    const payloadHash = hash(body);
    return transaction(db, async () => {
      const current = await get(row.watch_id, true);
      if (
        !current ||
        current.callback_id !== callbackId ||
        !Number(current.enabled) ||
        !current.lease_expires_at ||
        current.lease_expires_at <= stamp()
      )
        return { ignored: true };
      const currentWatch = await watch(row.watch_id);
      if (
        Number(currentWatch.active) !== 1 ||
        youtubeFeed(currentWatch.url) !== youtubeFeed(current.topic)
      )
        return { ignored: true };
      if (
        await db
          .prepare(
            'SELECT payload_hash FROM intelligence_youtube_push_receipts WHERE watch_id=? AND payload_hash=?',
          )
          .get(row.watch_id, payloadHash)
      )
        return { duplicate: true };
      const result = await watches.ingestYoutubePush(row.watch_id, payload);
      await db
        .prepare(
          'INSERT INTO intelligence_youtube_push_receipts(watch_id,payload_hash,received_at) VALUES(?,?,?)',
        )
        .run(row.watch_id, payloadHash, stamp());
      await db
        .prepare(
          'UPDATE intelligence_youtube_subscriptions SET last_delivery_at=?,updated_at=? WHERE watch_id=?',
        )
        .run(stamp(), stamp(), row.watch_id);
      await db
        .prepare(
          `DELETE FROM intelligence_youtube_push_receipts WHERE watch_id=? AND payload_hash NOT IN
         (SELECT payload_hash FROM intelligence_youtube_push_receipts WHERE watch_id=? ORDER BY received_at DESC,payload_hash DESC LIMIT ?)`,
        )
        .run(row.watch_id, row.watch_id, YOUTUBE_PUSH_LIMITS.receiptsPerWatch);
      await db
        .prepare(
          `DELETE FROM intelligence_youtube_push_items WHERE watch_id=? AND item_key NOT IN
         (SELECT item_key FROM intelligence_youtube_push_items WHERE watch_id=? ORDER BY received_at DESC,item_key DESC LIMIT ?)`,
        )
        .run(row.watch_id, row.watch_id, YOUTUBE_PUSH_LIMITS.revisionsPerWatch);
      return { added: result.added, updated: result.updated };
    });
  }
  async function runDue() {
    if (!ready) return { enabled: false, processed: 0 };
    const rows = await db
      .prepare(
        `SELECT s.* FROM intelligence_youtube_subscriptions s JOIN intelligence_watches w ON w.id=s.watch_id
       WHERE s.renew_after<=? AND (s.enabled=0 OR (w.active=1 AND w.mode='youtube'))
       ORDER BY s.renew_after,s.watch_id LIMIT 4`,
      )
      .all(stamp());
    for (const row of rows) {
      if (
        !Number(row.enabled) &&
        (!row.lease_expires_at || row.lease_expires_at <= stamp()) &&
        row.pending_until <= stamp()
      ) {
        await db
          .prepare(
            'UPDATE intelligence_youtube_subscriptions SET renew_after=NULL WHERE watch_id=?',
          )
          .run(row.watch_id);
        continue;
      }
      const result = await requestSubscription(
        row.watch_id,
        Number(row.enabled) ? 'subscribe' : 'unsubscribe',
        { automatic: true },
      );
      if (!result.skipped) return { enabled: true, processed: 1 };
    }
    return { enabled: true, processed: 0 };
  }
  return { list, enable, disable, verify, receive, runDue };
}

export function registerYoutubePushRoutes(app, context, service) {
  const { requireAuth, requireManager } = context;
  app.get('/api/intelligence/youtube-push', requireAuth, async (_request, response) =>
    response.json(await service.list()),
  );
  app.post(
    '/api/intelligence/watches/:id/youtube-push',
    requireAuth,
    requireManager,
    async (request, response) => {
      const { enabled } = parse(z.object({ enabled: z.boolean() }).strict(), request.body);
      response.json({
        subscription: await service[enabled ? 'enable' : 'disable'](
          request.params.id,
          request.auth.user,
        ),
      });
    },
  );
  app.get('/api/intelligence/youtube-push/callback/:id', async (request, response) => {
    const challenge = await service.verify(request.params.id, request.query);
    response
      .set({
        'Content-Type': 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      })
      .status(200)
      .send(challenge);
  });
  app.post(
    '/api/intelligence/youtube-push/callback/:id',
    express.raw({
      type: ['application/atom+xml', 'application/xml', 'text/xml'],
      limit: YOUTUBE_PUSH_LIMITS.payloadBytes,
      inflate: false,
    }),
    async (request, response) => {
      if (!Buffer.isBuffer(request.body))
        throw new HttpError(415, 'A raw Atom XML body is required.', 'unsupported_push_type');
      await service.receive(request.params.id, request.body, request.get('x-hub-signature'));
      response.status(204).end();
    },
  );
}
