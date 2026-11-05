import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { transaction, makeId, audit, getResource } from '../database.mjs';
import { HttpError, parse } from '../validation.mjs';
import { createRobotsReader, publicHttpsUrl } from './safe-fetch.mjs';
import { decodeText, elements, plainText, scanTags, stripSections } from './parse.mjs';
import { requireResearchManager } from './research-common.mjs';

export const PAGE_MONITOR_LIMITS = Object.freeze({
  maxMonitors: 20,
  minimumIntervalHours: 6,
  maxPerRun: 1,
  snapshotsPerMonitor: 30,
  snapshotCharacters: 60000,
  leaseMs: 90000,
  manualCooldownMs: 60000,
});
export const pageMonitorSchema = z
  .object({
    competitorId: z.string().min(1).max(200),
    url: z.string().trim().min(1).max(2048).optional(),
    intervalHours: z.number().int().min(6).max(168).default(24),
    active: z.boolean().default(true),
  })
  .strict();
export const pageMonitorPatchSchema = z
  .object({
    url: z.string().trim().min(1).max(2048).optional(),
    intervalHours: z.number().int().min(6).max(168).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide a monitor setting.');
const blockedDomains = [
  'facebook.com',
  'fb.com',
  'fb.me',
  'instagram.com',
  'linkedin.com',
  'youtube.com',
  'youtu.be',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'google.com',
  'google.co.in',
  'maps.app.goo.gl',
  'g.page',
];
export function publicPageUrl(value) {
  const url = publicHttpsUrl(value);
  if (
    blockedDomains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
  )
    throw new HttpError(
      422,
      'Use a public website page for automatic text monitoring. Social profiles and Google Maps require an authorized API or an assisted research request.',
      'assisted_research_required',
    );
  return url.href;
}
const hash = (value) => createHash('sha256').update(value).digest('hex');

export function normalizePublicPage(document) {
  const type = document.headers?.['content-type'] || '';
  if (type && !/text\/(?:html|plain)|application\/xhtml\+xml/i.test(type))
    throw new HttpError(
      422,
      'This monitor reads public HTML or plain text. Use a notice watch for links to PDFs and documents.',
      'unsupported_page_type',
    );
  const raw = document.text;
  const titleBlock = elements(raw, ['title'], 1)[0];
  const title = titleBlock
    ? plainText(raw.slice(titleBlock.payload, titleBlock.contentEnd), 240)
    : new URL(document.url).hostname;
  const main = elements(raw, ['main'], 1)[0];
  const body = main || elements(raw, ['body'], 1)[0];
  const scoped = body ? raw.slice(body.payload, body.contentEnd) : raw;
  const cleaned = stripSections(scoped, [
    'script',
    'style',
    'noscript',
    'svg',
    'template',
    'nav',
    'footer',
    'header',
    'form',
    'aside',
  ]);
  const pieces = [];
  let previous = 0;
  for (const token of scanTags(cleaned)) {
    pieces.push(cleaned.slice(previous, token.start));
    pieces.push(
      /^(?:p|div|section|article|li|h[1-6]|br|hr|tr|td|th|blockquote|dl|dt|dd)$/.test(token.tag)
        ? '\n'
        : ' ',
    );
    previous = token.end;
  }
  pieces.push(cleaned.slice(previous));
  const lines = decodeText(pieces.join(''))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const fullText = lines.filter((line, index) => line !== lines[index - 1]).join('\n');
  if (fullText.length < 30)
    throw new HttpError(
      422,
      'The returned page has too little readable content. It may require JavaScript or sign-in. Use assisted research for this page.',
      'page_content_unavailable',
    );
  const contentText = fullText.slice(0, PAGE_MONITOR_LIMITS.snapshotCharacters);
  return {
    title,
    contentText,
    contentHash: hash(`${title}\n${fullText}`),
    truncated: fullText.length > contentText.length,
    scope: main ? 'main' : body ? 'body' : 'document',
  };
}

function pageComparison(previous, current) {
  if (!previous)
    return {
      baseline: true,
      added: [],
      removed: [],
      addedCount: 0,
      removedCount: 0,
      titleChanged: false,
      truncated: current.truncated,
      scope: current.scope,
    };
  const before = new Set(previous.content_text.split('\n'));
  const after = new Set(current.contentText.split('\n'));
  const added = [...after].filter((line) => !before.has(line));
  const removed = [...before].filter((line) => !after.has(line));
  return {
    baseline: false,
    added: added.slice(0, 12).map((line) => line.slice(0, 800)),
    removed: removed.slice(0, 12).map((line) => line.slice(0, 800)),
    addedCount: added.length,
    removedCount: removed.length,
    titleChanged: previous.title !== current.title,
    truncated: current.truncated,
    scope: current.scope,
  };
}
const joined = `SELECT p.*, c.name, c.platform, (SELECT count(*) FROM intelligence_page_snapshots s WHERE s.monitor_id=p.id) AS snapshot_count FROM intelligence_page_monitors p JOIN competitors c ON c.id=p.competitor_id`;
function publicMonitor(row, at) {
  return {
    id: row.id,
    competitorId: row.competitor_id,
    name: row.name,
    platform: row.platform,
    url: row.url,
    intervalHours: Number(row.interval_hours),
    active: Number(row.active) === 1,
    generation: Number(row.generation),
    status:
      row.run_token && row.lease_until > at
        ? 'running'
        : Number(row.active) !== 1
          ? 'paused'
          : row.last_error
            ? 'error'
            : row.last_success_at
              ? 'ready'
              : 'awaiting_baseline',
    lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at,
    nextCheckAt: row.next_check_at,
    error: row.last_error,
    snapshotCount: Number(row.snapshot_count || 0),
    createdAt: row.created_at,
  };
}
function publicSnapshot(row) {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    generation: Number(row.generation),
    url: row.url,
    title: row.title,
    contentText: row.content_text,
    contentHash: row.content_hash,
    comparison: JSON.parse(row.comparison),
    baseline: Number(row.baseline) === 1,
    fetchedAt: row.fetched_at,
    verification: 'unverified',
  };
}

export function createPageMonitoringService({ db, now, read, automationEnabled = true }) {
  const stamp = () => now().toISOString();
  async function get(id) {
    const row = await db.prepare(`${joined} WHERE p.id=?`).get(id);
    if (!row)
      throw new HttpError(404, 'This webpage monitor was not found.', 'page_monitor_not_found');
    return row;
  }
  async function lock(id) {
    const row = await db
      .prepare(`SELECT * FROM intelligence_page_monitors WHERE id=?${db.lockSuffix}`)
      .get(id);
    if (!row)
      throw new HttpError(404, 'This webpage monitor was not found.', 'page_monitor_not_found');
    return row;
  }
  function assertIdle(row) {
    if (row.run_token && row.lease_until > stamp())
      throw new HttpError(
        409,
        'This page is already being checked. Wait for that check to finish.',
        'page_monitor_busy',
      );
  }
  async function listPageMonitors() {
    return (await db.prepare(`${joined} ORDER BY p.created_at DESC,p.id`).all()).map((row) =>
      publicMonitor(row, stamp()),
    );
  }
  async function pageSnapshots(id) {
    await get(id);
    return (
      await db
        .prepare(
          'SELECT * FROM intelligence_page_snapshots WHERE monitor_id=? ORDER BY fetched_at DESC,id DESC LIMIT 30',
        )
        .all(id)
    ).map(publicSnapshot);
  }
  async function createPageMonitor(raw, actor) {
    requireResearchManager(actor);
    const input = parse(pageMonitorSchema, raw);
    return transaction(db, async () => {
      if (db.kind === 'postgres')
        await db
          .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
          .get(`smis:${db.schema}:page-monitors`);
      const competitor = await getResource(db, 'competitors', input.competitorId);
      if (!competitor)
        throw new HttpError(
          404,
          'Save the competitor before creating a page monitor.',
          'competitor_not_found',
        );
      const url = publicPageUrl(input.url || competitor.url);
      if (
        await db
          .prepare('SELECT id FROM intelligence_page_monitors WHERE competitor_id=?')
          .get(competitor.id)
      )
        throw new HttpError(
          409,
          'This competitor already has a webpage monitor. Update its settings.',
          'page_monitor_exists',
        );
      if (
        Number(
          (await db.prepare('SELECT count(*) AS count FROM intelligence_page_monitors').get())
            .count,
        ) >= PAGE_MONITOR_LIMITS.maxMonitors
      )
        throw new HttpError(
          409,
          'This workspace supports 20 public-page monitors. Reuse or remove an unused monitor before adding another.',
          'page_monitor_limit',
        );
      const id = makeId('page_monitor'),
        timestamp = stamp();
      await db
        .prepare(
          'INSERT INTO intelligence_page_monitors(id,competitor_id,url,interval_hours,active,next_check_at,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          competitor.id,
          url,
          input.intervalHours,
          Number(input.active),
          timestamp,
          actor.id,
          timestamp,
          timestamp,
        );
      await audit(
        db,
        actor,
        'Webpage monitor created',
        id,
        `${competitor.name}: public text checks every ${input.intervalHours} hours when active; the first result is a baseline.`,
        timestamp,
      );
      return publicMonitor(await get(id), timestamp);
    });
  }
  async function updatePageMonitor(id, raw, actor) {
    requireResearchManager(actor);
    const input = parse(pageMonitorPatchSchema, raw);
    return transaction(db, async () => {
      const row = await lock(id);
      assertIdle(row);
      const url = input.url === undefined ? row.url : publicPageUrl(input.url);
      const changed = url !== row.url;
      const active = input.active ?? Number(row.active) === 1;
      await db
        .prepare(
          `UPDATE intelligence_page_monitors SET url=?,interval_hours=?,active=?,generation=?,last_success_at=?,next_check_at=?,last_error=NULL,failures=0,run_token=NULL,lease_until=NULL,updated_at=? WHERE id=?`,
        )
        .run(
          url,
          input.intervalHours ?? row.interval_hours,
          Number(active),
          Number(row.generation) + Number(changed),
          changed ? null : row.last_success_at,
          active ? stamp() : row.next_check_at,
          stamp(),
          id,
        );
      await audit(
        db,
        actor,
        'Webpage monitor updated',
        id,
        changed
          ? 'The monitored URL changed. Its next successful scan establishes a new baseline.'
          : active
            ? 'Public-page monitoring settings updated.'
            : 'Public-page monitoring paused.',
        stamp(),
      );
      return publicMonitor(await get(id), stamp());
    });
  }
  async function removePageMonitor(id, actor) {
    requireResearchManager(actor);
    return transaction(db, async () => {
      const row = await lock(id);
      assertIdle(row);
      await db.prepare('DELETE FROM intelligence_page_monitors WHERE id=?').run(id);
      await audit(
        db,
        actor,
        'Webpage monitor removed',
        id,
        'Removed this monitor and its bounded page snapshot history. The competitor profile remains.',
        stamp(),
      );
      return { removed: true };
    });
  }
  async function checkPage(id, { actor = null, dueOnly = false } = {}) {
    if (actor) requireResearchManager(actor);
    const token = randomBytes(24).toString('base64url');
    const claimed = await transaction(db, async () => {
      const row = await lock(id);
      if (dueOnly && (Number(row.active) !== 1 || row.next_check_at > stamp())) return null;
      if (row.run_token && row.lease_until > stamp()) {
        if (dueOnly) return null;
        assertIdle(row);
      }
      if (
        !dueOnly &&
        row.last_checked_at &&
        now().getTime() - Date.parse(row.last_checked_at) < PAGE_MONITOR_LIMITS.manualCooldownMs
      )
        throw new HttpError(
          429,
          'Wait one minute between manual checks of the same webpage.',
          'page_check_rate_limited',
        );
      await db
        .prepare(
          'UPDATE intelligence_page_monitors SET run_token=?,lease_until=?,updated_at=? WHERE id=?',
        )
        .run(
          token,
          new Date(now().getTime() + PAGE_MONITOR_LIMITS.leaseMs).toISOString(),
          stamp(),
          id,
        );
      return get(id);
    });
    if (!claimed)
      return { skipped: true, monitor: publicMonitor(await get(id), stamp()), changed: false };
    try {
      const reader = createRobotsReader(read);
      const document = await reader(publicPageUrl(claimed.url), {
        beforeRequest: (url) => publicPageUrl(url.href),
      });
      if (document.status !== 200)
        throw new HttpError(
          409,
          `The page returned HTTP ${document.status}. Previous snapshots remain available; use assisted research if access is restricted.`,
          'page_http_error',
        );
      publicPageUrl(document.url);
      const normalized = normalizePublicPage(document);
      const result = await transaction(db, async () => {
        const row = await lock(id);
        if (row.run_token !== token) return { skipped: true, changed: false };
        const previous = await db
          .prepare(
            'SELECT * FROM intelligence_page_snapshots WHERE monitor_id=? AND generation=? ORDER BY fetched_at DESC,id DESC LIMIT 1',
          )
          .get(id, row.generation);
        const baseline = !previous;
        const changed = !baseline && previous.content_hash !== normalized.contentHash;
        let snapshot = previous ? publicSnapshot(previous) : null;
        if (baseline || changed) {
          const snapshotId = makeId('page_snapshot'),
            comparison = pageComparison(previous, normalized);
          await db
            .prepare(
              'INSERT INTO intelligence_page_snapshots(id,monitor_id,generation,url,title,content_text,content_hash,comparison,baseline,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
            )
            .run(
              snapshotId,
              id,
              row.generation,
              document.url,
              normalized.title,
              normalized.contentText,
              normalized.contentHash,
              JSON.stringify(comparison),
              Number(baseline),
              stamp(),
            );
          snapshot = publicSnapshot(
            await db
              .prepare('SELECT * FROM intelligence_page_snapshots WHERE id=?')
              .get(snapshotId),
          );
          await db
            .prepare(
              'DELETE FROM intelligence_page_snapshots WHERE id IN (SELECT id FROM intelligence_page_snapshots WHERE monitor_id=? ORDER BY fetched_at DESC,id DESC LIMIT 1000 OFFSET 30)',
            )
            .run(id);
          await audit(
            db,
            actor,
            baseline ? 'Webpage baseline recorded' : 'Webpage change detected',
            id,
            baseline
              ? `${claimed.name}: saved the current readable page as a baseline, not a newly published update.`
              : `${claimed.name}: ${comparison.addedCount} added and ${comparison.removedCount} removed text blocks${comparison.titleChanged ? ', with a changed page title' : ''}. Inspect the saved comparison before making a claim.`,
            stamp(),
          );
        }
        await db
          .prepare(
            'UPDATE intelligence_page_monitors SET last_checked_at=?,last_success_at=?,next_check_at=?,last_error=NULL,failures=0,run_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND run_token=?',
          )
          .run(
            stamp(),
            stamp(),
            new Date(now().getTime() + Number(row.interval_hours) * 3600000).toISOString(),
            stamp(),
            id,
            token,
          );
        await db
          .prepare('UPDATE competitors SET last_checked_at=?,updated_at=? WHERE id=?')
          .run(stamp(), stamp(), row.competitor_id);
        return { baseline, changed, snapshot };
      });
      return { ...result, monitor: publicMonitor(await get(id), stamp()) };
    } catch (caught) {
      const error =
        caught instanceof HttpError
          ? caught
          : new HttpError(
              502,
              'The webpage check could not finish. Existing snapshots are retained.',
              'page_check_failed',
            );
      await transaction(db, async () => {
        const row = await lock(id);
        if (row.run_token !== token) return;
        const failures = Number(row.failures) + 1;
        const delay = Math.min(
          168,
          Math.max(Number(row.interval_hours), 6 * 2 ** Math.min(failures - 1, 5)),
        );
        await db
          .prepare(
            'UPDATE intelligence_page_monitors SET last_checked_at=?,next_check_at=?,last_error=?,failures=?,run_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND run_token=?',
          )
          .run(
            stamp(),
            new Date(now().getTime() + delay * 3600000).toISOString(),
            error.message.slice(0, 1000),
            failures,
            stamp(),
            id,
            token,
          );
        if (row.last_error !== error.message)
          await audit(
            db,
            actor,
            'Monitor needs attention',
            id,
            `${claimed.name}: ${error.message}`,
            stamp(),
          );
      });
      throw error;
    }
  }
  async function runDue({ limit = 1, actor = null } = {}) {
    if (!automationEnabled) return { enabled: false, checked: 0, results: [] };
    const candidates = await db
      .prepare(
        'SELECT id FROM intelligence_page_monitors WHERE active=1 AND next_check_at<=? AND (run_token IS NULL OR lease_until<=?) ORDER BY next_check_at,id LIMIT ?',
      )
      .all(
        stamp(),
        stamp(),
        Math.max(1, Math.min(PAGE_MONITOR_LIMITS.maxPerRun, Number(limit) || 1)),
      );
    const results = [];
    for (const item of candidates) {
      try {
        const result = await checkPage(item.id, { actor, dueOnly: true });
        results.push({
          id: item.id,
          ok: true,
          skipped: Boolean(result.skipped),
          changed: result.changed,
          baseline: result.baseline,
        });
      } catch (error) {
        results.push({
          id: item.id,
          ok: false,
          error: error instanceof HttpError ? error.message : 'This page check failed.',
        });
      }
    }
    return { enabled: true, checked: results.filter((item) => !item.skipped).length, results };
  }
  return {
    listPageMonitors,
    pageSnapshots,
    createPageMonitor,
    updatePageMonitor,
    removePageMonitor,
    checkPage,
    runDue,
  };
}
