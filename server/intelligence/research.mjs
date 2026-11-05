import { createHash } from 'node:crypto';
import { z } from 'zod';
import { transaction, makeId, audit, getResource } from '../database.mjs';
import { HttpError, parse } from '../validation.mjs';
import {
  observedAtSchema,
  evidenceUrls,
  referenceUrl,
  requireResearcher,
  requireResearchManager,
  checkObservedAt,
  requireRevision,
} from './research-common.mjs';

export const researchRequestSchema = z
  .object({
    targetType: z.enum(['competitor', 'exam']),
    targetId: z.string().min(1).max(200),
    question: z.string().trim().max(3000).default(''),
  })
  .strict();
export const researchResultSchema = z
  .object({
    summary: z.string().trim().min(10).max(8000),
    evidenceUrls: z.array(z.string().trim().min(1).max(2048)).min(1).max(20),
    observedAt: observedAtSchema,
    expectedRevision: z.number().int().min(1),
  })
  .strict();
export const competitorObservationSchema = z
  .object({
    observedAt: observedAtSchema,
    summary: z.string().trim().min(10).max(6000),
    evidenceUrls: z.array(z.string().trim().min(1).max(2048)).min(1).max(20),
    metrics: z
      .object({
        followers: z.number().int().min(0).max(1e12).optional(),
        reviewCount: z.number().int().min(0).max(1e9).optional(),
        rating: z.number().min(1).max(5).optional(),
        postCount: z.number().int().min(0).max(1e9).optional(),
      })
      .strict()
      .default({}),
    recentItems: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(300),
            url: z.string().trim().min(1).max(2048),
            publishedAt: observedAtSchema.optional(),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    requestId: z.string().min(1).max(200).optional(),
    idempotencyKey: z
      .string()
      .regex(/^[A-Za-z0-9_.:-]{8,120}$/)
      .optional(),
  })
  .strict();
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const requestJoined = `SELECT r.*, COALESCE(c.name,e.name,'Removed reference') AS target_name, c.url AS target_url, c.platform, e.reference_links AS exam_links, u.name AS requested_name FROM intelligence_research_requests r LEFT JOIN competitors c ON r.target_type='competitor' AND c.id=r.target_id LEFT JOIN intelligence_exams e ON r.target_type='exam' AND e.id=r.target_id LEFT JOIN users u ON u.id=r.requested_by`;
function publicRequest(row) {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    targetName: row.target_name,
    targetUrl: row.target_url || (row.exam_links ? JSON.parse(row.exam_links)[0]?.url : '') || '',
    platform: row.platform || null,
    question: row.question,
    status: row.status,
    displayStatus:
      row.status === 'pending'
        ? 'Needs research'
        : row.status === 'completed'
          ? 'Research recorded'
          : 'Cancelled',
    revision: Number(row.revision),
    requestedAt: row.requested_at,
    requestedBy: row.requested_name || 'Former team member',
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    observedAt: row.observed_at,
    resultSummary: row.result_summary,
    evidenceUrls: JSON.parse(row.evidence_urls),
    verification: 'unverified',
  };
}
const publicObservation = (row) => ({
  id: row.id,
  competitorId: row.competitor_id,
  observedAt: row.observed_at,
  summary: row.summary,
  evidenceUrls: JSON.parse(row.evidence_urls),
  metrics: JSON.parse(row.metrics),
  recentItems: JSON.parse(row.recent_items),
  comparison: JSON.parse(row.comparison),
  requestId: row.request_id,
  recordedBy: row.recorded_name || 'Former team member',
  recordedAt: row.recorded_at,
  verification: 'unverified',
});

export function compareObservations(previous, value, historical = false) {
  if (!previous)
    return {
      baseline: true,
      historical,
      comparedWithId: null,
      metricChanges: [],
      newItems: [],
      summaryChanged: false,
    };
  const before = JSON.parse(previous.metrics),
    previousItems = new Set(JSON.parse(previous.recent_items).map((item) => item.url));
  const metricChanges = Object.keys(value.metrics)
    .filter((key) => typeof before[key] === 'number' && value.metrics[key] !== before[key])
    .map((key) => ({
      key,
      previous: before[key],
      current: value.metrics[key],
      delta: Number((value.metrics[key] - before[key]).toFixed(4)),
    }));
  return {
    baseline: false,
    historical,
    comparedWithId: previous.id,
    metricChanges,
    newItems: value.recentItems.filter((item) => !previousItems.has(item.url)),
    summaryChanged: previous.summary !== value.summary,
  };
}

export function createResearchService({ db, now, pages, watches, education }) {
  const stamp = () => now().toISOString();
  async function target(type, id) {
    if (type === 'exam') return education.getExam(id);
    const competitor = await getResource(db, 'competitors', id);
    if (!competitor)
      throw new HttpError(404, 'This competitor profile no longer exists.', 'competitor_not_found');
    return competitor;
  }
  async function getRequest(id, lock = false) {
    const row = await db
      .prepare(
        `SELECT * FROM intelligence_research_requests WHERE id=?${lock ? db.lockSuffix : ''}`,
      )
      .get(id);
    if (!row)
      throw new HttpError(404, 'This research request was not found.', 'research_not_found');
    return row;
  }
  async function requestView(id) {
    const row = await db.prepare(`${requestJoined} WHERE r.id=?`).get(id);
    if (!row)
      throw new HttpError(404, 'This research request was not found.', 'research_not_found');
    return publicRequest(row);
  }
  async function researchRequests({ status, limit = 100 } = {}) {
    if (status !== undefined && !['pending', 'completed', 'cancelled'].includes(status))
      throw new HttpError(422, 'Choose a valid research status.', 'invalid_research_status');
    return (
      await db
        .prepare(
          `${requestJoined}${status ? ' WHERE r.status=?' : ''} ORDER BY r.updated_at DESC,r.id DESC LIMIT ?`,
        )
        .all(...(status ? [status] : []), Math.max(1, Math.min(200, Number(limit) || 100)))
    ).map(publicRequest);
  }
  async function observations(competitorId) {
    await target('competitor', competitorId);
    return (
      await db
        .prepare(
          'SELECT o.*,u.name AS recorded_name FROM intelligence_competitor_observations o LEFT JOIN users u ON u.id=o.recorded_by WHERE o.competitor_id=? ORDER BY o.observed_at DESC,o.recorded_at DESC,o.id DESC LIMIT 100',
        )
        .all(competitorId)
    ).map(publicObservation);
  }
  async function researchContext(id) {
    const request = await requestView(id),
      resource = await target(request.targetType, request.targetId);
    return {
      request,
      target: resource,
      previousObservations:
        request.targetType === 'competitor'
          ? (await observations(request.targetId)).slice(0, 5)
          : [],
      instructions:
        'Research publicly available or authorized sources and cite the URLs actually inspected. Compare only like-for-like observed metrics and dates. Missing items in a sample do not establish deletion. Record uncertainty and access restrictions; do not bypass logins, CAPTCHAs or robots rules. Saved research remains unverified and cannot publish or approve content.',
    };
  }
  async function requestResearch(raw, actor) {
    requireResearcher(actor);
    const input = parse(researchRequestSchema, raw);
    return transaction(db, async () => {
      if (db.kind === 'postgres')
        await db
          .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
          .get(`smis:${db.schema}:research-requests`);
      const resource = await target(input.targetType, input.targetId);
      const existing = await db
        .prepare(
          "SELECT id FROM intelligence_research_requests WHERE target_type=? AND target_id=? AND status='pending'",
        )
        .get(input.targetType, input.targetId);
      if (existing) return { request: await requestView(existing.id), existing: true };
      if (
        Number(
          (
            await db
              .prepare(
                "SELECT count(*) AS count FROM intelligence_research_requests WHERE status='pending'",
              )
              .get()
          ).count,
        ) >= 100
      )
        throw new HttpError(
          409,
          'Complete or cancel an existing research request before adding more. The workspace allows 100 pending requests.',
          'research_request_limit',
        );
      const question =
        input.question ||
        (input.targetType === 'competitor'
          ? `Review publicly available changes for ${resource.name}: recent posts or updates, review count/rating where visible, and useful themes. Compare with saved observations, cite every source, and distinguish a first baseline from new changes.`
          : `Check the official reference sources for ${resource.name}. Record current notices, dates, eligibility and entry-route changes for the applicable academic year. Cite the originals and flag anything not verified.`);
      const id = makeId('research'),
        timestamp = stamp();
      await db
        .prepare(
          'INSERT INTO intelligence_research_requests(id,target_type,target_id,question,requested_by,requested_at,updated_at) VALUES(?,?,?,?,?,?,?)',
        )
        .run(id, input.targetType, input.targetId, question, actor.id, timestamp, timestamp);
      await audit(
        db,
        actor,
        input.targetType === 'competitor'
          ? 'Competitor research requested'
          : 'Exam research requested',
        id,
        `${resource.name}: research is queued for a team member or a connected ChatGPT session. No source has been inspected by this request alone.`,
        timestamp,
      );
      return { request: await requestView(id), existing: false };
    });
  }
  async function cancelResearch(id, actor) {
    requireResearcher(actor);
    return transaction(db, async () => {
      const row = await getRequest(id, true);
      if (row.requested_by !== actor.id) requireResearchManager(actor);
      if (row.status !== 'pending')
        throw new HttpError(
          409,
          'Only a pending research request can be cancelled.',
          'research_not_pending',
        );
      await db
        .prepare(
          "UPDATE intelligence_research_requests SET status='cancelled',revision=revision+1,updated_at=? WHERE id=?",
        )
        .run(stamp(), id);
      return requestView(id);
    });
  }
  async function recordResearchResult(id, raw, actor) {
    requireResearcher(actor);
    const input = parse(researchResultSchema, raw);
    const value = {
        summary: input.summary,
        evidenceUrls: evidenceUrls(input.evidenceUrls),
        observedAt: checkObservedAt(input.observedAt, now),
      },
      contentHash = digest(value);
    return transaction(db, async () => {
      const row = await getRequest(id, true);
      await target(row.target_type, row.target_id);
      if (row.status === 'completed' && row.result_hash === contentHash) return requestView(id);
      requireRevision(row, input.expectedRevision);
      if (row.status !== 'pending')
        throw new HttpError(
          409,
          'This research request has already been completed or cancelled.',
          'research_not_pending',
        );
      await db
        .prepare(
          "UPDATE intelligence_research_requests SET status='completed',revision=revision+1,completed_at=?,completed_by=?,observed_at=?,result_summary=?,evidence_urls=?,result_hash=?,updated_at=? WHERE id=?",
        )
        .run(
          stamp(),
          actor.id,
          value.observedAt,
          value.summary,
          JSON.stringify(value.evidenceUrls),
          contentHash,
          stamp(),
          id,
        );
      await audit(
        db,
        actor,
        'Research result recorded',
        id,
        'Source-linked research was recorded as unverified. A manager must review the claims before public content is prepared.',
        stamp(),
      );
      return requestView(id);
    });
  }
  async function recordObservation(competitorId, raw, actor) {
    requireResearcher(actor);
    const input = parse(competitorObservationSchema, raw);
    const value = {
      observedAt: checkObservedAt(input.observedAt, now),
      summary: input.summary,
      evidenceUrls: evidenceUrls(input.evidenceUrls),
      metrics: input.metrics,
      recentItems: input.recentItems.map((item) => ({
        ...item,
        url: referenceUrl(item.url),
        ...(item.publishedAt ? { publishedAt: checkObservedAt(item.publishedAt, now) } : {}),
      })),
    };
    const contentHash = digest(value);
    return transaction(db, async () => {
      const competitor = await target('competitor', competitorId);
      // One row lock serializes comparisons and idempotency checks per profile.
      await db.prepare(`SELECT id FROM competitors WHERE id=?${db.lockSuffix}`).get(competitorId);
      const duplicate = input.idempotencyKey
        ? await db
            .prepare(
              'SELECT * FROM intelligence_competitor_observations WHERE competitor_id=? AND idempotency_key=?',
            )
            .get(competitorId, input.idempotencyKey)
        : await db
            .prepare(
              'SELECT * FROM intelligence_competitor_observations WHERE competitor_id=? AND content_hash=? AND observed_at=? ORDER BY recorded_at LIMIT 1',
            )
            .get(competitorId, contentHash, value.observedAt);
      if (duplicate) {
        if (duplicate.content_hash !== contentHash)
          throw new HttpError(
            409,
            'This evidence request key already belongs to different content. Use a new key for a new observation.',
            'idempotency_conflict',
          );
        return { observation: publicObservation(duplicate), existing: true };
      }
      let request;
      if (input.requestId) {
        request = await getRequest(input.requestId, true);
        if (request.target_type !== 'competitor' || request.target_id !== competitorId)
          throw new HttpError(
            422,
            'The research request belongs to a different reference.',
            'research_target_mismatch',
          );
        if (request.status !== 'pending')
          throw new HttpError(
            409,
            'This research request is no longer pending.',
            'research_not_pending',
          );
      }
      const latest = await db
        .prepare(
          'SELECT * FROM intelligence_competitor_observations WHERE competitor_id=? ORDER BY observed_at DESC,recorded_at DESC,id DESC LIMIT 1',
        )
        .get(competitorId);
      const historical = Boolean(latest && value.observedAt <= latest.observed_at);
      const previous = historical
        ? await db
            .prepare(
              'SELECT * FROM intelligence_competitor_observations WHERE competitor_id=? AND observed_at<? ORDER BY observed_at DESC,recorded_at DESC,id DESC LIMIT 1',
            )
            .get(competitorId, value.observedAt)
        : latest;
      const comparison = compareObservations(previous, value, historical),
        id = makeId('competitor_observation');
      await db
        .prepare(
          'INSERT INTO intelligence_competitor_observations(id,competitor_id,observed_at,summary,evidence_urls,metrics,recent_items,comparison,content_hash,idempotency_key,request_id,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          competitorId,
          value.observedAt,
          value.summary,
          JSON.stringify(value.evidenceUrls),
          JSON.stringify(value.metrics),
          JSON.stringify(value.recentItems),
          JSON.stringify(comparison),
          contentHash,
          input.idempotencyKey ?? null,
          input.requestId ?? null,
          actor.id,
          stamp(),
        );
      if (!historical)
        await db
          .prepare('UPDATE competitors SET last_checked_at=?,updated_at=? WHERE id=?')
          .run(value.observedAt, stamp(), competitorId);
      if (request) {
        const requestHash = digest({
          summary: value.summary,
          evidenceUrls: value.evidenceUrls,
          observedAt: value.observedAt,
        });
        await db
          .prepare(
            "UPDATE intelligence_research_requests SET status='completed',revision=revision+1,completed_at=?,completed_by=?,observed_at=?,result_summary=?,evidence_urls=?,result_hash=?,updated_at=? WHERE id=?",
          )
          .run(
            stamp(),
            actor.id,
            value.observedAt,
            value.summary,
            JSON.stringify(value.evidenceUrls),
            requestHash,
            stamp(),
            request.id,
          );
      }
      const changed =
        !comparison.baseline &&
        !historical &&
        (comparison.metricChanges.length > 0 ||
          comparison.newItems.length > 0 ||
          comparison.summaryChanged);
      await audit(
        db,
        actor,
        changed ? 'Competitor changes recorded' : 'Competitor evidence recorded',
        id,
        `${competitor.name}: ${historical ? 'historical evidence saved' : comparison.baseline ? 'first observed baseline saved' : changed ? 'new cited observations are ready for source review' : 'an unchanged observation was recorded'}. All observations remain unverified; sampled missing posts do not establish deletion.`,
        stamp(),
      );
      if (request && !changed)
        await audit(
          db,
          actor,
          'Research result recorded',
          request.id,
          `${competitor.name}: the requested evidence was recorded and awaits source review.`,
          stamp(),
        );
      const saved = await db
        .prepare(
          'SELECT o.*,u.name AS recorded_name FROM intelligence_competitor_observations o LEFT JOIN users u ON u.id=o.recorded_by WHERE o.id=?',
        )
        .get(id);
      return { observation: publicObservation(saved), existing: false };
    });
  }
  async function researchCompetitor(id, raw, actor) {
    requireResearcher(actor);
    const { question } = parse(
      z.object({ question: z.string().trim().max(3000).default('') }).strict(),
      raw ?? {},
    );
    const resource = await target('competitor', id);
    if (actor.role === 'manager' && resource.platform === 'website') {
      try {
        let monitor = (await pages.listPageMonitors()).find((item) => item.competitorId === id);
        if (!monitor)
          monitor = await pages.createPageMonitor({ competitorId: id, active: false }, actor);
        return { mode: 'webpage', result: await pages.checkPage(monitor.id, { actor }) };
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        if (['page_check_rate_limited', 'page_monitor_busy'].includes(error.code)) throw error;
        return {
          mode: 'assisted',
          reason: error.message,
          ...(await requestResearch({ targetType: 'competitor', targetId: id, question }, actor)),
        };
      }
    }
    if (actor.role === 'manager' && resource.platform === 'youtube') {
      const watch = (await watches.list()).find(
        (item) => item.kind === 'competitor' && item.resourceId === id && item.mode === 'youtube',
      );
      if (watch) return { mode: 'youtube', result: await watches.run(watch.id, { actor }) };
    }
    return {
      mode: 'assisted',
      reason:
        resource.platform === 'google_business'
          ? 'Competitor Google Business research needs a public-source review. No billable Places API or unrestricted review scraper is configured.'
          : 'This profile needs a team member or a connected ChatGPT session to inspect public or authorized sources.',
      ...(await requestResearch({ targetType: 'competitor', targetId: id, question }, actor)),
    };
  }
  return {
    researchRequests,
    researchContext,
    requestResearch,
    recordResearchResult,
    cancelResearch,
    observations,
    recordObservation,
    researchCompetitor,
  };
}
