import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  transaction,
  makeId,
  audit,
  toOpportunity,
  getResource,
  insertResource,
} from '../database.mjs';
import { HttpError, parse } from '../validation.mjs';
import { SOURCE_CATALOG, INTELLIGENCE_LIMITS } from './catalog.mjs';
import { publicHttpsUrl, createRobotsReader } from './safe-fetch.mjs';
import { parseSource, youtubeFeed } from './parse.mjs';

const {
  minimumIntervalHours,
  leaseMs,
  minManualIntervalMs,
  maxWatches,
  maxWatchesPerRun,
  maxItemsPerScan,
} = INTELLIGENCE_LIMITS;
const keywords = z.array(z.string().trim().min(1).max(80)).max(12);
const intervalHours = z.number().int().min(minimumIntervalHours).max(168);
const createSchema = z
  .object({
    kind: z.enum(['source', 'competitor']),
    resourceId: z.string().min(1).max(200),
    mode: z.enum(['rss', 'html', 'youtube']),
    url: z.string().trim().max(2048).optional(),
    keywords: keywords.default([]),
    intervalHours: intervalHours.default(12),
    active: z.boolean().default(true),
  })
  .strict();
const patchSchema = z
  .object({
    url: z.string().trim().min(1).max(2048).optional(),
    keywords: keywords.optional(),
    intervalHours: intervalHours.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one watch setting.');
const briefSchema = z
  .object({
    audience: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .default('Students and parents following this examination or education topic'),
    contentAngle: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .default(
        'Explain the verified update, its effective year, who it applies to, and the practical next step. Add the original official source.',
      ),
    priority: z.enum(['high', 'medium', 'low']).default('medium'),
  })
  .strict();
const joined = `SELECT w.*, COALESCE(s.name, c.name) AS name, c.platform,
 COALESCE(s.category, c.category) AS category,
 (SELECT count(*) FROM intelligence_notices n WHERE n.watch_id = w.id) AS notice_count
 FROM intelligence_watches w LEFT JOIN sources s ON s.id = w.source_id
 LEFT JOIN competitors c ON c.id = w.competitor_id`;
const socialDomains = [
  'facebook.com',
  'fb.com',
  'instagram.com',
  'linkedin.com',
  'youtube.com',
  'youtu.be',
  'twitter.com',
  'x.com',
  'tiktok.com',
];

function verifyWatchUrl(url, mode) {
  const target = publicHttpsUrl(url);
  if (mode === 'youtube') {
    const expected = youtubeFeed(url);
    if (target.href !== expected && target.href !== expected.replace('/feeds/', '/xml/feeds/'))
      throw new HttpError(
        422,
        'YouTube watches may only fetch the channel’s public video feed.',
        'invalid_youtube_feed',
      );
  } else if (
    socialDomains.some(
      (domain) => target.hostname === domain || target.hostname.endsWith(`.${domain}`),
    )
  ) {
    throw new HttpError(
      422,
      'This social platform requires its official API or manual profile review. Use YouTube feed mode for public YouTube uploads; profile-page scraping is not supported.',
      'manual_social_review_required',
    );
  }
  return target.href;
}

export function publicWatch(row, at) {
  return {
    id: row.id,
    kind: row.kind,
    resourceId: row.source_id ?? row.competitor_id,
    name: row.name || 'Removed source',
    platform: row.platform || null,
    mode: row.mode,
    url: row.url,
    keywords: JSON.parse(row.keywords),
    intervalHours: Number(row.interval_hours),
    active: Number(row.active) === 1,
    status:
      row.run_token && row.lease_until > at
        ? 'running'
        : Number(row.active) !== 1
          ? 'paused'
          : row.last_error
            ? 'error'
            : 'ready',
    lastCheckedAt: row.last_checked_at,
    nextCheckAt: row.next_check_at,
    error: row.last_error,
    lastNewCount: Number(row.last_new_count),
    noticeCount: Number(row.notice_count || 0),
    createdAt: row.created_at,
  };
}

function publicNotice(row) {
  return {
    id: row.id,
    watchId: row.watch_id,
    watchName: row.watch_name,
    kind: row.kind,
    title: row.title,
    url: row.url,
    excerpt: row.excerpt,
    publishedAt: row.published_at,
    detectedAt: row.detected_at,
    updatedAt: row.updated_at,
    changeKind: row.change_kind,
    baseline: Number(row.baseline) === 1,
    status: row.status,
    opportunityId: row.opportunity_id,
    contentHash: row.content_hash,
  };
}

export function createWatchService({ db, now, read, notify, automationEnabled = true }) {
  const stamp = () => now().toISOString();
  async function get(id) {
    const row = await db.prepare(`${joined} WHERE w.id = ?`).get(id);
    if (!row) throw new HttpError(404, 'This watch could not be found.', 'watch_not_found');
    return row;
  }
  async function list() {
    return (await db.prepare(`${joined} ORDER BY w.created_at DESC, w.id`).all()).map((row) =>
      publicWatch(row, stamp()),
    );
  }
  async function notices() {
    return (
      await db
        .prepare(
          `SELECT n.*, w.kind, COALESCE(s.name, c.name) AS watch_name
      FROM intelligence_notices n JOIN intelligence_watches w ON w.id = n.watch_id
      LEFT JOIN sources s ON s.id = w.source_id LEFT JOIN competitors c ON c.id = w.competitor_id
      ORDER BY n.updated_at DESC, n.id DESC LIMIT 200`,
        )
        .all()
    ).map(publicNotice);
  }
  async function lockWatch(id) {
    const row = await db
      .prepare(`SELECT * FROM intelligence_watches WHERE id = ?${db.lockSuffix}`)
      .get(id);
    if (!row) throw new HttpError(404, 'This watch could not be found.', 'watch_not_found');
    return row;
  }
  function assertIdle(row) {
    if (row.run_token && row.lease_until > stamp())
      throw new HttpError(
        409,
        'This watch is already checking its source. Wait for the current check to finish.',
        'watch_busy',
      );
  }
  async function setResourceStatus(row, active) {
    const table = row.kind === 'source' ? 'sources' : 'competitors';
    const column = row.kind === 'source' ? 'status' : 'monitoring_status';
    const id = row.source_id ?? row.competitor_id;
    await db
      .prepare(`UPDATE ${table} SET ${column} = ?, updated_at = ? WHERE id = ?`)
      .run(active ? 'ready' : 'paused', stamp(), id);
  }
  async function create(input, actor) {
    return transaction(db, async () => {
      // Serialize limits and one-watch-per-resource checks across serverless instances.
      if (db.kind === 'postgres')
        await db
          .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
          .get(`smis:${db.schema}:intelligence-watches`);
      const resource = await getResource(
        db,
        input.kind === 'source' ? 'sources' : 'competitors',
        input.resourceId,
      );
      if (!resource)
        throw new HttpError(
          404,
          'Save the source or competitor before enabling its watch.',
          'resource_not_found',
        );
      const existing = await db
        .prepare(
          `SELECT id FROM intelligence_watches WHERE ${input.kind === 'source' ? 'source_id' : 'competitor_id'} = ?`,
        )
        .get(resource.id);
      if (existing)
        throw new HttpError(
          409,
          'This source already has a watch. Edit the existing watch instead.',
          'watch_exists',
        );
      const count = await db.prepare('SELECT count(*) AS count FROM intelligence_watches').get();
      if (Number(count.count) >= maxWatches)
        throw new HttpError(
          409,
          `This workspace supports up to ${maxWatches} watches. Remove unused watches first.`,
          'watch_limit',
        );
      if (
        input.mode === 'youtube' &&
        !(input.kind === 'competitor' && resource.platform === 'youtube')
      )
        throw new HttpError(
          422,
          'YouTube feed mode requires a saved YouTube competitor.',
          'invalid_watch_mode',
        );
      if (input.kind === 'competitor' && !['youtube', 'website'].includes(resource.platform))
        throw new HttpError(
          422,
          'Automatic competitor watches currently support YouTube public feeds and public website feeds/notices. Other social profiles remain manual.',
          'manual_social_review_required',
        );
      if (
        input.kind === 'competitor' &&
        resource.platform === 'youtube' &&
        input.mode !== 'youtube'
      )
        throw new HttpError(
          422,
          'Use YouTube feed mode for a YouTube competitor.',
          'invalid_watch_mode',
        );
      const rawUrl = input.url || resource.url;
      const url = verifyWatchUrl(
        input.mode === 'youtube' ? youtubeFeed(rawUrl) : rawUrl,
        input.mode,
      );
      const timestamp = stamp();
      const id = makeId('watch');
      await db
        .prepare(
          `INSERT INTO intelligence_watches
        (id, kind, source_id, competitor_id, mode, url, keywords, interval_hours, active, next_check_at, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.kind,
          input.kind === 'source' ? resource.id : null,
          input.kind === 'competitor' ? resource.id : null,
          input.mode,
          url,
          JSON.stringify([...new Set(input.keywords)]),
          input.intervalHours,
          input.active ? 1 : 0,
          timestamp,
          actor.id,
          timestamp,
          timestamp,
        );
      const row = await get(id);
      await setResourceStatus(row, input.active);
      await audit(
        db,
        actor,
        'Source watch created',
        id,
        `${resource.name}: ${input.mode} checks every ${input.intervalHours} hours. Initial results are a baseline, not newly published news.`,
        timestamp,
      );
      return publicWatch(row, timestamp);
    });
  }
  async function update(id, input, actor) {
    return transaction(db, async () => {
      const row = await lockWatch(id);
      assertIdle(row);
      const url =
        input.url === undefined
          ? row.url
          : verifyWatchUrl(row.mode === 'youtube' ? youtubeFeed(input.url) : input.url, row.mode);
      const changedSource = url !== row.url;
      const active = input.active === undefined ? Number(row.active) === 1 : input.active;
      const timestamp = stamp();
      await db
        .prepare(
          `UPDATE intelligence_watches SET url = ?, keywords = ?, interval_hours = ?, active = ?,
        next_check_at = ?, last_error = NULL, failures = 0, run_token = NULL, lease_until = NULL,
        last_success_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          url,
          JSON.stringify(input.keywords ?? JSON.parse(row.keywords)),
          input.intervalHours ?? row.interval_hours,
          active ? 1 : 0,
          active ? timestamp : row.next_check_at,
          changedSource ? null : row.last_success_at,
          timestamp,
          id,
        );
      await setResourceStatus(row, active);
      await audit(
        db,
        actor,
        'Source watch updated',
        id,
        active ? 'Monitoring settings updated.' : 'Automatic monitoring paused.',
        timestamp,
      );
      return publicWatch(await get(id), timestamp);
    });
  }
  async function remove(id, actor) {
    await transaction(db, async () => {
      const row = await lockWatch(id);
      assertIdle(row);
      const table = row.kind === 'source' ? 'sources' : 'competitors';
      const column = row.kind === 'source' ? 'status' : 'monitoring_status';
      await db
        .prepare(`UPDATE ${table} SET ${column} = 'manual', updated_at = ? WHERE id = ?`)
        .run(stamp(), row.source_id ?? row.competitor_id);
      await db.prepare('DELETE FROM intelligence_watches WHERE id = ?').run(id);
      await audit(
        db,
        actor,
        'Source watch removed',
        id,
        'The source remains available for manual checking; existing research briefs and posts were retained.',
        stamp(),
      );
    });
  }
  async function run(id, { actor = null, dueOnly = false } = {}) {
    const token = randomBytes(24).toString('base64url');
    const claimed = await transaction(db, async () => {
      const row = await lockWatch(id);
      if (dueOnly && (Number(row.active) !== 1 || row.next_check_at > stamp())) return null;
      if (row.run_token && row.lease_until > stamp()) {
        if (dueOnly) return null;
        assertIdle(row);
      }
      if (
        !dueOnly &&
        row.last_checked_at &&
        now().getTime() - new Date(row.last_checked_at).getTime() < minManualIntervalMs
      )
        throw new HttpError(
          429,
          'Wait at least one minute between manual checks of this source.',
          'watch_rate_limited',
        );
      await db
        .prepare(
          'UPDATE intelligence_watches SET run_token = ?, lease_until = ?, updated_at = ? WHERE id = ?',
        )
        .run(token, new Date(now().getTime() + leaseMs).toISOString(), stamp(), id);
      return await get(id);
    });
    if (!claimed)
      return {
        skipped: true,
        watch: publicWatch(await get(id), stamp()),
        added: 0,
        updated: 0,
        baseline: false,
      };
    const baseline = !claimed.last_success_at;
    try {
      verifyWatchUrl(claimed.url, claimed.mode);
      const reader = createRobotsReader(read);
      const document = await reader(claimed.url, {
        beforeRequest: (url) => verifyWatchUrl(url.href, claimed.mode),
      });
      if (document.status !== 200)
        throw new HttpError(
          409,
          document.status === 403 || document.status === 401
            ? 'This source requires access that the automatic reader does not have. Check it manually or use an allowed public feed.'
            : `The source returned HTTP ${document.status}. Previous results are retained; try again later.`,
          'source_http_error',
        );
      const contentType = document.headers?.['content-type'] || '';
      if (
        contentType &&
        !/text\/(?:html|xml|plain)|application\/(?:rss\+xml|atom\+xml|xml|xhtml\+xml)/i.test(
          contentType,
        )
      )
        throw new HttpError(
          422,
          'Monitor the HTML notice page or RSS/Atom feed that links to a document. PDF and binary documents are retained as links, not read as pages.',
          'unsupported_source_type',
        );
      const entries = parseSource(document.text, document.url, claimed.mode, {
        keywords: JSON.parse(claimed.keywords),
        limit: maxItemsPerScan,
      });
      const counts = await transaction(db, async () => {
        const row = await lockWatch(id);
        if (row.run_token !== token) return null;
        const timestamp = stamp();
        let added = 0;
        let updated = 0;
        let changedBriefs = 0;
        for (const entry of entries) {
          const previous = await db
            .prepare('SELECT * FROM intelligence_notices WHERE watch_id = ? AND item_key = ?')
            .get(id, entry.key);
          if (previous?.content_hash === entry.hash) continue;
          const noticeId = previous?.id || makeId('notice');
          if (previous) {
            await db
              .prepare(
                `UPDATE intelligence_notices SET title = ?, url = ?, excerpt = ?, published_at = ?, updated_at = ?,
              content_hash = ?, change_kind = 'updated', baseline = 0, status = 'new' WHERE id = ?`,
              )
              .run(
                entry.title,
                entry.url,
                entry.excerpt,
                entry.publishedAt,
                timestamp,
                entry.hash,
                noticeId,
              );
            updated += 1;
            if (previous.opportunity_id) {
              await db
                .prepare(
                  'UPDATE opportunities SET verified = 0, verified_by = NULL, updated_at = ? WHERE id = ?',
                )
                .run(timestamp, previous.opportunity_id);
              await audit(
                db,
                null,
                'Research source changed',
                previous.opportunity_id,
                'The linked source title or feed metadata changed. Verification was cleared; review the new notice and any existing draft before publication.',
                timestamp,
              );
              changedBriefs += 1;
            }
          } else {
            await db
              .prepare(
                `INSERT INTO intelligence_notices
              (id, watch_id, item_key, title, url, excerpt, published_at, detected_at, updated_at, content_hash, change_kind, baseline)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'discovered', ?)`,
              )
              .run(
                noticeId,
                id,
                entry.key,
                entry.title,
                entry.url,
                entry.excerpt,
                entry.publishedAt,
                timestamp,
                timestamp,
                entry.hash,
                baseline ? 1 : 0,
              );
            added += 1;
          }
          await db
            .prepare(
              `INSERT INTO intelligence_notice_history(id, notice_id, snapshot, content_hash, recorded_at)
            VALUES (?, ?, ?, ?, ?) ON CONFLICT (notice_id, content_hash) DO NOTHING`,
            )
            .run(
              makeId('notice_history'),
              noticeId,
              JSON.stringify({
                title: entry.title,
                url: entry.url,
                excerpt: entry.excerpt,
                publishedAt: entry.publishedAt,
              }),
              entry.hash,
              timestamp,
            );
        }
        await db
          .prepare(
            `UPDATE intelligence_watches SET last_checked_at = ?, last_success_at = ?, next_check_at = ?,
          last_new_count = ?, last_error = NULL, failures = 0, run_token = NULL, lease_until = NULL, updated_at = ? WHERE id = ? AND run_token = ?`,
          )
          .run(
            timestamp,
            timestamp,
            new Date(now().getTime() + Number(row.interval_hours) * 3600000).toISOString(),
            added + updated,
            timestamp,
            id,
            token,
          );
        const table = row.kind === 'source' ? 'sources' : 'competitors';
        await db
          .prepare(`UPDATE ${table} SET last_checked_at = ?, updated_at = ? WHERE id = ?`)
          .run(timestamp, timestamp, row.source_id ?? row.competitor_id);
        await audit(
          db,
          actor,
          baseline
            ? 'Source baseline recorded'
            : added + updated > 0
              ? 'New notices detected'
              : 'Source check completed',
          id,
          `${claimed.name}: ${added} links discovered, ${updated} metadata changes.${baseline ? ' Initial links are a baseline; their publication dates may be older.' : ''}`,
          timestamp,
        );
        return { added, updated, changedBriefs };
      });
      if (!counts)
        return {
          skipped: true,
          watch: publicWatch(await get(id), stamp()),
          added: 0,
          updated: 0,
          baseline,
        };
      if ((!baseline && counts.added + counts.updated > 0) || counts.changedBriefs > 0) {
        try {
          await notify?.({
            kind: counts.changedBriefs ? 'research_changed' : 'research_discovered',
            title: counts.changedBriefs
              ? 'A research source changed'
              : 'New research items to review',
            message: `${claimed.name}: ${counts.added} new links and ${counts.updated} metadata updates.${counts.changedBriefs ? ` ${counts.changedBriefs} linked brief(s) need verification again.` : ''}`,
            entityType: 'intelligence',
            entityId: id,
            href: '#intelligence',
            actor,
            managerOnly: true,
          });
        } catch {
          // The durable notice inbox is authoritative if optional alert delivery fails.
        }
      }
      return {
        watch: publicWatch(await get(id), stamp()),
        added: counts.added,
        updated: counts.updated,
        baseline,
      };
    } catch (error) {
      const failure =
        error instanceof HttpError
          ? error
          : new HttpError(
              502,
              'The source check could not finish. Previous results have been retained.',
              'source_check_failed',
            );
      await transaction(db, async () => {
        const row = await lockWatch(id);
        if (row.run_token !== token) return;
        const failures = Number(row.failures) + 1;
        const delayHours = Math.min(
          168,
          Math.max(Number(row.interval_hours), 6 * 2 ** Math.min(failures - 1, 5)),
        );
        await db
          .prepare(
            `UPDATE intelligence_watches SET last_checked_at = ?, next_check_at = ?, last_error = ?, failures = ?,
          run_token = NULL, lease_until = NULL, updated_at = ? WHERE id = ? AND run_token = ?`,
          )
          .run(
            stamp(),
            new Date(now().getTime() + delayHours * 3600000).toISOString(),
            failure.message.slice(0, 1000),
            failures,
            stamp(),
            id,
            token,
          );
        await audit(
          db,
          actor,
          row.last_error === failure.message ? 'Source check deferred' : 'Monitor needs attention',
          id,
          failure.message.slice(0, 1000),
          stamp(),
        );
      });
      throw failure;
    }
  }
  async function runDue({ limit = maxWatchesPerRun, actor = null } = {}) {
    if (!automationEnabled) return { enabled: false, checked: 0, results: [] };
    const candidates = await db
      .prepare(
        `SELECT id FROM intelligence_watches WHERE active = 1 AND next_check_at <= ?
      AND (run_token IS NULL OR lease_until <= ?) ORDER BY next_check_at, id LIMIT ?`,
      )
      .all(stamp(), stamp(), Math.max(1, Math.min(maxWatchesPerRun, Number(limit) || 1)));
    const results = [];
    for (const candidate of candidates) {
      try {
        const result = await run(candidate.id, { actor, dueOnly: true });
        results.push({
          id: candidate.id,
          ok: true,
          added: result.added,
          updated: result.updated,
          baseline: result.baseline,
          skipped: Boolean(result.skipped),
        });
      } catch (error) {
        results.push({
          id: candidate.id,
          ok: false,
          error: error instanceof HttpError ? error.message : 'The source check failed.',
        });
      }
    }
    return { enabled: true, checked: results.filter((result) => !result.skipped).length, results };
  }
  async function fromCatalog(catalogId, actor) {
    const definition = SOURCE_CATALOG.find((item) => item.id === catalogId);
    if (!definition)
      throw new HttpError(
        404,
        'This source template could not be found.',
        'source_template_not_found',
      );
    return transaction(db, async () => {
      if (db.kind === 'postgres')
        await db
          .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
          .get(`smis:${db.schema}:intelligence-watches`);
      let source = await db
        .prepare('SELECT id FROM sources WHERE url = ? ORDER BY created_at LIMIT 1')
        .get(definition.url);
      if (source) source = await getResource(db, 'sources', source.id);
      else
        source = await insertResource(
          db,
          'sources',
          {
            name: definition.name,
            url: definition.url,
            category: definition.category,
            status: 'manual',
          },
          stamp(),
        );
      const existing = await db
        .prepare('SELECT id FROM intelligence_watches WHERE source_id = ?')
        .get(source.id);
      const watch = existing
        ? publicWatch(await get(existing.id), stamp())
        : await create(
            {
              kind: 'source',
              resourceId: source.id,
              mode: definition.mode,
              url: definition.url,
              keywords: definition.keywords,
              intervalHours: 12,
              active: true,
            },
            actor,
          );
      return { watch, source: await getResource(db, 'sources', source.id) };
    });
  }
  async function createBrief(id, input, actor) {
    return transaction(db, async () => {
      const notice = await db
        .prepare(`SELECT * FROM intelligence_notices WHERE id = ?${db.lockSuffix}`)
        .get(id);
      if (!notice) throw new HttpError(404, 'This notice could not be found.', 'notice_not_found');
      if (notice.opportunity_id)
        return toOpportunity(
          await db.prepare('SELECT * FROM opportunities WHERE id = ?').get(notice.opportunity_id),
        );
      const watch = await get(notice.watch_id);
      const timestamp = stamp();
      const opportunityId = makeId('opportunity');
      const category =
        watch.kind === 'competitor'
          ? 'Competitor'
          : ['Exam update', 'Board update', 'Medical seats', 'Content idea'].includes(
                watch.category,
              )
            ? watch.category
            : 'Exam update';
      const summary = `${notice.title}\n\n${notice.excerpt ? `${notice.excerpt}\n\n` : ''}Publisher date: ${notice.published_at || 'not supplied by this source'}. First detected: ${notice.detected_at}.${Number(notice.baseline) ? ' This link was already present during the initial baseline scan.' : ''}\n\nVerification pending. Open the original notice, check the effective examination year and any corrections, and confirm each claim before preparing public content. Only source-link/feed metadata was collected; document contents and seat counts have not been verified.`;
      await db
        .prepare(
          `INSERT INTO opportunities(id, title, summary, source, source_url, category, published_at,
        verified, verified_by, status, priority, audience, content_angle, source_kind, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, 'new', ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          opportunityId,
          notice.title.slice(0, 180),
          summary,
          watch.name.slice(0, 180),
          notice.url,
          category,
          notice.published_at || notice.detected_at,
          input.priority,
          input.audience,
          input.contentAngle,
          watch.kind === 'competitor' ? 'competitor' : 'official',
          timestamp,
          timestamp,
        );
      await db
        .prepare(
          "UPDATE intelligence_notices SET opportunity_id = ?, status = 'saved' WHERE id = ?",
        )
        .run(opportunityId, id);
      await audit(
        db,
        actor,
        'Research brief created from source',
        opportunityId,
        'Saved the source URL, publisher/detection dates and verification warning. No public post was created or approved.',
        timestamp,
      );
      return toOpportunity(
        await db.prepare('SELECT * FROM opportunities WHERE id = ?').get(opportunityId),
      );
    });
  }
  return { list, notices, create, update, remove, run, runDue, fromCatalog, createBrief };
}

export function registerWatchRoutes(app, context, service) {
  const { db, now, requireAuth, requireManager } = context;
  const manager = [requireAuth, requireManager];
  app.get('/api/intelligence/watches', requireAuth, async (_request, response) =>
    response.json({ watches: await service.list() }),
  );
  app.post('/api/intelligence/watches', ...manager, async (request, response) =>
    response
      .status(201)
      .json({ watch: await service.create(parse(createSchema, request.body), request.auth.user) }),
  );
  app.patch('/api/intelligence/watches/:id', ...manager, async (request, response) =>
    response.json({
      watch: await service.update(
        request.params.id,
        parse(patchSchema, request.body),
        request.auth.user,
      ),
    }),
  );
  app.delete('/api/intelligence/watches/:id', ...manager, async (request, response) => {
    await service.remove(request.params.id, request.auth.user);
    response.json({ removed: true });
  });
  app.post('/api/intelligence/watches/:id/run', ...manager, async (request, response) =>
    response.json(await service.run(request.params.id, { actor: request.auth.user })),
  );
  app.post('/api/intelligence/run', ...manager, async (request, response) =>
    response.json(await service.runDue({ actor: request.auth.user })),
  );
  app.post('/api/intelligence/catalog/:id', ...manager, async (request, response) =>
    response.status(201).json(await service.fromCatalog(request.params.id, request.auth.user)),
  );
  app.get('/api/intelligence/notices', requireAuth, async (_request, response) =>
    response.json({ notices: await service.notices() }),
  );
  app.patch('/api/intelligence/notices/:id', requireAuth, async (request, response) => {
    const { status } = parse(
      z.object({ status: z.enum(['new', 'saved', 'dismissed']) }).strict(),
      request.body,
    );
    const changed = await db
      .prepare('UPDATE intelligence_notices SET status = ? WHERE id = ?')
      .run(status, request.params.id);
    if (changed.changes !== 1)
      throw new HttpError(404, 'This notice could not be found.', 'notice_not_found');
    response.json({ saved: true });
  });
  app.get('/api/intelligence/notices/:id/history', requireAuth, async (request, response) => {
    if (
      !(await db.prepare('SELECT id FROM intelligence_notices WHERE id = ?').get(request.params.id))
    )
      throw new HttpError(404, 'This notice could not be found.', 'notice_not_found');
    const history = (
      await db
        .prepare(
          'SELECT snapshot, content_hash, recorded_at FROM intelligence_notice_history WHERE notice_id = ? ORDER BY recorded_at DESC LIMIT 30',
        )
        .all(request.params.id)
    ).map((row) => ({
      ...JSON.parse(row.snapshot),
      contentHash: row.content_hash,
      recordedAt: row.recorded_at,
    }));
    response.json({ history });
  });
  app.post('/api/intelligence/notices/:id/brief', requireAuth, async (request, response) => {
    const opportunity = await service.createBrief(
      request.params.id,
      parse(briefSchema, request.body || {}),
      request.auth.user,
    );
    response.status(201).json({ opportunity });
  });
}
