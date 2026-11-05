import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { transaction, makeId, audit } from '../database.mjs';
import { HttpError, parse } from '../validation.mjs';
import { ProviderError } from '../extensions/providers.mjs';
import { publicHttpsUrl } from '../intelligence/safe-fetch.mjs';
import {
  RANKING_LIMITS,
  calendarDate,
  moveDate,
  isDate,
  searchRange,
  createSearchConsoleReader,
  positionChange,
} from './search-console.mjs';

const short = (length) => z.string().trim().min(1).max(length);
const identifier = short(200);
const urlInput = z.string().trim().max(2048);
const createSchema = z
  .object({
    keyword: short(200),
    institution: short(180),
    connectionId: identifier.nullable().default(null),
    country: z
      .string()
      .trim()
      .regex(/^(?:[A-Za-z]{3})?$/)
      .default(''),
    device: z.enum(['all', 'DESKTOP', 'MOBILE', 'TABLET']).default('all'),
    searchType: z.enum(['web', 'image', 'video', 'news']).default('web'),
    pageUrl: urlInput.default(''),
    answerPrompt: z.string().trim().max(2000).default(''),
    answerTargetUrl: urlInput.default(''),
    answerLocale: short(180).default('Chikmagalur, Karnataka, India'),
    answerLanguage: short(80).default('English'),
    autoSync: z.boolean().default(false),
  })
  .strict();
const patchSchema = z
  .object({
    connectionId: identifier.nullable().optional(),
    active: z.boolean().optional(),
    autoSync: z.boolean().optional(),
    answerPrompt: short(2000).optional(),
    answerTargetUrl: urlInput.optional(),
    answerLocale: short(180).optional(),
    answerLanguage: short(80).optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'Choose a setting to update.');
const observationDate = z.string().refine(isDate, 'Use a valid date in YYYY-MM-DD format.');
const searchEvidenceSchema = z
  .object({
    date: observationDate,
    position: z.number().finite().min(1).max(1000000),
    clicks: z.number().finite().nonnegative().max(1e15).nullable().default(null),
    impressions: z.number().finite().nonnegative().max(1e15).nullable().default(null),
    evidenceUrl: short(2048),
    notes: z.string().trim().min(5).max(2000),
  })
  .strict();
const answerEvidenceSchema = z
  .object({
    provider: short(100),
    model: short(120),
    checkedAt: z
      .string()
      .datetime({ offset: true })
      .transform((value) => new Date(value).toISOString()),
    answerExcerpt: short(4000),
    mentioned: z.boolean(),
    cited: z.boolean(),
    citationUrls: z.array(short(2048)).max(20).default([]),
    evidenceUrl: urlInput.default(''),
    notes: z.string().trim().max(2000).default(''),
  })
  .strict();

export { createSchema as keywordCreateSchema, searchEvidenceSchema, answerEvidenceSchema };

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function reference(value) {
  const url = publicHttpsUrl(value);
  for (const key of url.searchParams.keys()) {
    if (
      /^(?:access_token|refresh_token|id_token|token|secret|client_secret|password|api_key|key|code)$/i.test(
        key,
      )
    )
      throw new HttpError(
        422,
        'Do not put access tokens or private setup links in evidence URLs.',
        'unsafe_evidence_url',
      );
  }
  return url.href;
}
function identity(row) {
  return {
    keyword: row.keyword,
    institution: row.institution,
    propertyId: row.property_id,
    country: row.country,
    device: row.device,
    searchType: row.search_type,
    pageUrl: row.page_url,
  };
}
function toSample(row) {
  return {
    date: row.date,
    position: row.position === null ? null : Number(row.position),
    clicks: row.clicks === null ? null : Number(row.clicks),
    impressions: row.impressions === null ? null : Number(row.impressions),
    ctr: row.ctr === null ? null : Number(row.ctr),
    availability: row.availability,
    importedAt: row.imported_at,
  };
}
function toSearchEvidence(row) {
  return {
    id: row.id,
    date: row.date,
    position: Number(row.position),
    clicks: row.clicks === null ? null : Number(row.clicks),
    impressions: row.impressions === null ? null : Number(row.impressions),
    provenance: row.provenance,
    evidenceUrl: row.evidence_url,
    notes: row.notes,
    identitySnapshot: JSON.parse(row.identity_snapshot),
    recordedBy: row.recorded_name || 'Former team member',
    createdAt: row.created_at,
  };
}
function publicKeyword(row) {
  return {
    id: row.id,
    ...identity(row),
    connectionId: row.connection_id,
    propertyName: row.property_name,
    answerPrompt: row.answer_prompt,
    answerTargetUrl: row.answer_target_url,
    answerLocale: row.answer_locale,
    answerLanguage: row.answer_language,
    active: Number(row.active) === 1,
    autoSync: Number(row.auto_sync) === 1,
    nextSyncAt: row.next_sync_at,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    error: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createRankingService({
  db,
  now,
  withSearchConsole,
  fetch: fetchImpl,
  readSearch,
  automationEnabled = true,
}) {
  const stamp = () => now().toISOString();
  const reader = readSearch ?? createSearchConsoleReader({ fetch: fetchImpl });
  const hasAdapter = typeof withSearchConsole === 'function';
  const lock = async () => {
    if (db.kind === 'postgres')
      await db
        .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
        .get(`smis:${db.schema}:keywords`);
  };
  async function assertActor(actor, manager = false) {
    const user = actor?.id
      ? await db.prepare('SELECT active,role FROM users WHERE id = ?').get(actor.id)
      : null;
    if (!user || Number(user.active) !== 1)
      throw new HttpError(
        401,
        'Sign in to the workspace before recording keyword research.',
        'unauthenticated',
      );
    if (manager && user.role !== 'manager')
      throw new HttpError(
        403,
        'A manager must change keyword tracking or run provider imports.',
        'forbidden',
      );
  }
  async function raw(id, forUpdate = false) {
    const row = await db
      .prepare(`SELECT * FROM ranking_keywords WHERE id = ?${forUpdate ? db.lockSuffix : ''}`)
      .get(id);
    if (!row) throw new HttpError(404, 'This tracked keyword was not found.', 'keyword_not_found');
    return row;
  }
  async function connection(id, institution, propertyId = '') {
    const row = id
      ? await db.prepare('SELECT * FROM service_connections WHERE id = ?').get(id)
      : null;
    if (
      !row ||
      row.provider !== 'search_console' ||
      row.status !== 'connected' ||
      !row.account_id ||
      !JSON.parse(row.capabilities).includes('analytics:read')
    )
      throw new HttpError(
        409,
        'Connect and test a Search Console property before enabling daily imports.',
        'search_connection_required',
      );
    if (row.institution !== institution || (propertyId && row.account_id !== propertyId))
      throw new HttpError(
        409,
        'Choose the same school and Search Console property. Create a separate keyword track for a different property.',
        'keyword_identity_mismatch',
      );
    return row;
  }
  async function list({ keywordId = null, historyDays = RANKING_LIMITS.chartDays } = {}) {
    return transaction(db, async () => {
      const rows = await db
        .prepare(
          `SELECT * FROM ranking_keywords${keywordId ? ' WHERE id = ?' : ''} ORDER BY created_at DESC,id`,
        )
        .all(...(keywordId ? [keywordId] : []));
      const cutoff = moveDate(
        calendarDate(now()),
        1 - Math.min(RANKING_LIMITS.historyDays, Math.max(1, historyDays)),
      );
      const samples = await db
        .prepare(
          `SELECT * FROM ranking_search_samples WHERE date >= ?${keywordId ? ' AND keyword_id = ?' : ''} ORDER BY date`,
        )
        .all(cutoff, ...(keywordId ? [keywordId] : []));
      const evidence = await db
        .prepare(
          `SELECT e.id,e.keyword_id,e.date,e.position,e.provenance,e.created_at,e.identity_snapshot FROM ranking_search_evidence e WHERE date >= ?${keywordId ? ' AND keyword_id = ?' : ''} ORDER BY date,created_at,id`,
        )
        .all(cutoff, ...(keywordId ? [keywordId] : []));
      const contexts = await db
        .prepare(
          `SELECT * FROM ranking_answer_contexts${keywordId ? ' WHERE keyword_id = ?' : ''} ORDER BY created_at DESC,id`,
        )
        .all(...(keywordId ? [keywordId] : []));
      const daily = await db
        .prepare(
          `SELECT o.context_id,o.observation_date AS date,COUNT(*) AS checks,SUM(o.mentioned) AS mentions,SUM(o.cited) AS citations
        FROM ranking_answer_observations o JOIN ranking_answer_contexts c ON c.id=o.context_id
        WHERE o.observation_date >= ?${keywordId ? ' AND c.keyword_id = ?' : ''} GROUP BY o.context_id,o.observation_date ORDER BY o.observation_date`,
        )
        .all(cutoff, ...(keywordId ? [keywordId] : []));
      const accounts = await db
        .prepare(
          "SELECT id,account_id,account_name,institution,status FROM service_connections WHERE provider='search_console' AND status<>'disconnected'",
        )
        .all();
      return rows.map((row) => {
        const history = samples.filter((sample) => sample.keyword_id === row.id).map(toSample);
        const dailyEvidence = new Map();
        for (const item of evidence.filter(
          (item) =>
            item.keyword_id === row.id &&
            digest(JSON.parse(item.identity_snapshot)) === row.identity_key,
        ))
          dailyEvidence.set(item.date, {
            id: item.id,
            date: item.date,
            position: Number(item.position),
            provenance: item.provenance,
          });
        const linked = accounts.find(
          (account) =>
            account.id === row.connection_id &&
            account.account_id === row.property_id &&
            account.institution === row.institution,
        );
        return {
          ...publicKeyword(row),
          status: !Number(row.active)
            ? 'paused'
            : !linked || linked.status !== 'connected'
              ? 'awaiting_connection'
              : row.last_error
                ? 'needs_attention'
                : !row.last_success_at
                  ? 'awaiting_data'
                  : history.some((sample) => sample.position !== null)
                    ? 'ready'
                    : 'no_query_rows',
          canSync: hasAdapter && linked?.status === 'connected',
          searchHistory: history,
          movement: positionChange(history),
          recordedSearchHistory: [...dailyEvidence.values()],
          answerSeries: contexts
            .filter((context) => context.keyword_id === row.id)
            .map((context) => ({
              id: context.id,
              provider: context.provider,
              model: context.model,
              prompt: context.prompt,
              targetUrl: context.target_url,
              locale: context.locale,
              language: context.language,
              points: daily
                .filter((point) => point.context_id === context.id)
                .map((point) => ({
                  date: point.date,
                  checks: Number(point.checks),
                  mentionRate:
                    Math.round((Number(point.mentions) / Number(point.checks)) * 10000) / 100,
                  citationRate:
                    Math.round((Number(point.citations) / Number(point.checks)) * 10000) / 100,
                })),
            })),
        };
      });
    });
  }
  async function get(id) {
    const keyword = (await list({ keywordId: id, historyDays: RANKING_LIMITS.historyDays }))[0];
    if (!keyword)
      throw new HttpError(404, 'This tracked keyword was not found.', 'keyword_not_found');
    const searchEvidence = (
      await db
        .prepare(
          `SELECT e.*,u.name AS recorded_name FROM ranking_search_evidence e LEFT JOIN users u ON u.id=e.recorded_by WHERE e.keyword_id=? ORDER BY date DESC,created_at DESC,id DESC LIMIT 200`,
        )
        .all(id)
    ).map(toSearchEvidence);
    const answerEvidence = (
      await db
        .prepare(
          `SELECT o.*,c.provider,c.model,c.prompt,c.target_url,c.locale,c.language,u.name AS recorded_name FROM ranking_answer_observations o JOIN ranking_answer_contexts c ON c.id=o.context_id LEFT JOIN users u ON u.id=o.recorded_by WHERE c.keyword_id=? ORDER BY o.checked_at DESC,o.id DESC LIMIT 200`,
        )
        .all(id)
    ).map((row) => ({
      id: row.id,
      contextId: row.context_id,
      checkedAt: row.checked_at,
      date: row.observation_date,
      provider: row.provider,
      model: row.model,
      prompt: row.prompt,
      targetUrl: row.target_url,
      locale: row.locale,
      language: row.language,
      mentioned: Number(row.mentioned) === 1,
      cited: Number(row.cited) === 1,
      citationUrls: JSON.parse(row.citation_urls),
      answerExcerpt: row.answer_excerpt,
      evidenceUrl: row.evidence_url,
      notes: row.notes,
      provenance: row.provenance,
      recordedBy: row.recorded_name || 'Former team member',
      createdAt: row.created_at,
    }));
    return { ...keyword, searchEvidence, answerEvidence };
  }
  async function create(input, actor) {
    await assertActor(actor, true);
    const value = parse(createSchema, input);
    return transaction(db, async () => {
      await lock();
      const count = Number(
        (await db.prepare('SELECT COUNT(*) AS count FROM ranking_keywords').get()).count,
      );
      if (count >= RANKING_LIMITS.maxKeywords)
        throw new HttpError(
          409,
          `This workspace can track ${RANKING_LIMITS.maxKeywords} keyword/property combinations. Remove an unused track before adding another.`,
          'keyword_limit',
        );
      const account = value.connectionId
        ? await connection(value.connectionId, value.institution)
        : null;
      if (value.autoSync && (!account || !hasAdapter || !automationEnabled))
        throw new HttpError(
          409,
          'Connect a Search Console property before enabling daily checks.',
          'search_connection_required',
        );
      const row = {
        keyword: value.keyword,
        institution: value.institution,
        property_id: account?.account_id ?? '',
        country: value.country.toLowerCase(),
        device: value.device,
        search_type: value.searchType,
        page_url: value.pageUrl ? reference(value.pageUrl) : '',
      };
      const identityKey = digest(identity(row));
      if (await db.prepare('SELECT id FROM ranking_keywords WHERE identity_key=?').get(identityKey))
        throw new HttpError(
          409,
          'This exact keyword, property and filter combination is already tracked.',
          'duplicate_keyword',
        );
      const id = makeId('keyword');
      await db
        .prepare(
          `INSERT INTO ranking_keywords(id,identity_key,keyword,institution,connection_id,property_id,property_name,country,device,search_type,page_url,answer_prompt,answer_target_url,answer_locale,answer_language,auto_sync,next_sync_at,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          identityKey,
          row.keyword,
          row.institution,
          account?.id ?? null,
          row.property_id,
          account?.account_name ?? '',
          row.country,
          row.device,
          row.search_type,
          row.page_url,
          value.answerPrompt || row.keyword,
          value.answerTargetUrl ? reference(value.answerTargetUrl) : '',
          value.answerLocale,
          value.answerLanguage,
          value.autoSync ? 1 : 0,
          value.autoSync ? stamp() : null,
          actor.id,
          stamp(),
          stamp(),
        );
      await audit(
        db,
        actor,
        'Keyword tracking created',
        id,
        `Saved ${row.keyword}. Provider history starts after an authorized import; no AI request was made.`,
        stamp(),
      );
      return (await list({ keywordId: id }))[0];
    });
  }
  async function update(id, input, actor) {
    await assertActor(actor, true);
    const value = parse(patchSchema, input);
    return transaction(db, async () => {
      await lock();
      const row = await raw(id, true);
      let account = null;
      if (value.connectionId)
        account = await connection(value.connectionId, row.institution, row.property_id);
      const connectionId =
        value.connectionId === undefined ? row.connection_id : value.connectionId;
      const propertyId = account?.account_id ?? row.property_id;
      const active = value.active ?? Number(row.active) === 1;
      const autoSync = value.autoSync ?? Number(row.auto_sync) === 1;
      if (autoSync && active) {
        await connection(connectionId, row.institution, propertyId);
        if (!automationEnabled || !hasAdapter)
          throw new HttpError(
            409,
            'Daily keyword imports are currently unavailable.',
            'keyword_automation_disabled',
          );
      }
      const identityKey = digest(identity({ ...row, property_id: propertyId }));
      const duplicate = await db
        .prepare('SELECT id FROM ranking_keywords WHERE identity_key=? AND id<>?')
        .get(identityKey, id);
      if (duplicate)
        throw new HttpError(
          409,
          'This keyword/property combination already has a track.',
          'duplicate_keyword',
        );
      const next =
        active && autoSync
          ? !Number(row.active) || !Number(row.auto_sync) || value.connectionId !== undefined
            ? stamp()
            : row.next_sync_at || stamp()
          : null;
      await db
        .prepare(
          `UPDATE ranking_keywords SET connection_id=?,property_id=?,property_name=?,identity_key=?,active=?,auto_sync=?,next_sync_at=?,answer_prompt=?,answer_target_url=?,answer_locale=?,answer_language=?,last_error=?,run_token=NULL,lease_until=NULL,updated_at=? WHERE id=?`,
        )
        .run(
          connectionId,
          propertyId,
          account?.account_name ?? row.property_name,
          identityKey,
          active ? 1 : 0,
          autoSync ? 1 : 0,
          next,
          value.answerPrompt ?? row.answer_prompt,
          value.answerTargetUrl === undefined
            ? row.answer_target_url
            : value.answerTargetUrl
              ? reference(value.answerTargetUrl)
              : '',
          value.answerLocale ?? row.answer_locale,
          value.answerLanguage ?? row.answer_language,
          value.connectionId !== undefined ? null : row.last_error,
          stamp(),
          id,
        );
      await audit(
        db,
        actor,
        'Keyword tracking updated',
        id,
        'Changed tracking settings. Earlier API history and recorded evidence retain their original identity.',
        stamp(),
      );
      return (await list({ keywordId: id }))[0];
    });
  }
  async function remove(id, actor) {
    await assertActor(actor, true);
    return transaction(db, async () => {
      const row = await raw(id, true);
      await db.prepare('DELETE FROM ranking_keywords WHERE id=?').run(id);
      await audit(
        db,
        actor,
        'Keyword tracking removed',
        id,
        `${row.keyword}; this track and its saved history were removed. Connected accounts are unchanged.`,
        stamp(),
      );
      return { removed: true };
    });
  }
  async function claim(id, automatic) {
    return transaction(db, async () => {
      const row = await raw(id, true);
      if (
        automatic &&
        (!Number(row.active) ||
          !Number(row.auto_sync) ||
          !row.next_sync_at ||
          row.next_sync_at > stamp())
      )
        return null;
      if (row.run_token && row.lease_until > stamp()) {
        if (automatic) return null;
        throw new HttpError(409, 'This keyword is already being checked.', 'keyword_check_running');
      }
      if (
        !automatic &&
        row.last_attempt_at &&
        now().getTime() - Date.parse(row.last_attempt_at) <
          RANKING_LIMITS.manualCooldownMinutes * 60000
      )
        throw new HttpError(
          429,
          'Wait five minutes between manual checks of the same keyword.',
          'keyword_check_cooldown',
        );
      if (!hasAdapter)
        throw new HttpError(
          503,
          'Search Console imports are not configured on this deployment.',
          'keyword_adapter_unavailable',
        );
      await connection(row.connection_id, row.institution, row.property_id);
      const token = makeId('keyword_run');
      await db
        .prepare(
          'UPDATE ranking_keywords SET run_token=?,lease_until=?,last_attempt_at=? WHERE id=?',
        )
        .run(token, new Date(now().getTime() + 5 * 60000).toISOString(), stamp(), id);
      const hasHistory = Boolean(
        await db
          .prepare('SELECT keyword_id FROM ranking_search_samples WHERE keyword_id=? LIMIT 1')
          .get(id),
      );
      return { row, token, range: searchRange(now(), hasHistory) };
    });
  }
  async function execute(id, actor, automatic) {
    const work = await claim(id, automatic);
    if (!work) return null;
    const { row, token, range } = work;
    try {
      const samples = await withSearchConsole(
        row.connection_id,
        { accountId: row.property_id, institution: row.institution },
        (account, current) => reader(account, current, row, range),
      );
      // The default reader validates each row; injected readers remain subject
      // to this bounded shape check before anything can enter saved history.
      const expectedDays =
        Math.round((Date.parse(range.endDate) - Date.parse(range.startDate)) / 86400000) + 1;
      if (
        !Array.isArray(samples) ||
        samples.length !== expectedDays ||
        samples.length > RANKING_LIMITS.initialDays ||
        new Set(samples.map((sample) => sample.date)).size !== samples.length
      )
        throw new HttpError(
          502,
          'The daily keyword import was incomplete.',
          'invalid_keyword_samples',
        );
      for (const sample of samples) {
        const numbers = ['position', 'clicks', 'impressions', 'ctr'].map((key) => sample[key]);
        const valid =
          sample.availability === 'no_row'
            ? numbers.every((value) => value === null)
            : sample.availability === 'reported' &&
              numbers.every((value) => typeof value === 'number' && Number.isFinite(value)) &&
              sample.position >= 1 &&
              sample.clicks >= 0 &&
              sample.impressions > 0 &&
              sample.ctr >= 0 &&
              sample.ctr <= 1;
        if (!valid)
          throw new HttpError(
            502,
            'The provider returned invalid keyword metrics.',
            'invalid_keyword_samples',
          );
      }
      return await transaction(db, async () => {
        const latest = await raw(id, true);
        if (
          latest.run_token !== token ||
          latest.connection_id !== row.connection_id ||
          latest.identity_key !== row.identity_key
        )
          throw new HttpError(
            409,
            'Tracking changed while this import was running. Its result was not saved.',
            'keyword_check_superseded',
          );
        await connection(latest.connection_id, latest.institution, latest.property_id);
        let changed = 0;
        let reported = 0;
        for (const sample of samples) {
          if (!isDate(sample.date) || sample.date < range.startDate || sample.date > range.endDate)
            throw new HttpError(
              502,
              'The provider returned a sample outside the requested dates.',
              'invalid_keyword_samples',
            );
          const previous = await db
            .prepare('SELECT * FROM ranking_search_samples WHERE keyword_id=? AND date=?')
            .get(id, sample.date);
          if (
            !previous ||
            ['position', 'clicks', 'impressions', 'ctr', 'availability'].some(
              (key) => previous[key] !== sample[key],
            )
          )
            changed += 1;
          if (sample.position !== null) reported += 1;
          await db
            .prepare(
              `INSERT INTO ranking_search_samples(keyword_id,date,position,clicks,impressions,ctr,availability,imported_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(keyword_id,date) DO UPDATE SET position=excluded.position,clicks=excluded.clicks,impressions=excluded.impressions,ctr=excluded.ctr,availability=excluded.availability,imported_at=excluded.imported_at`,
            )
            .run(
              id,
              sample.date,
              sample.position,
              sample.clicks,
              sample.impressions,
              sample.ctr,
              sample.availability,
              stamp(),
            );
        }
        await db
          .prepare('DELETE FROM ranking_search_samples WHERE keyword_id=? AND date<?')
          .run(id, moveDate(calendarDate(now()), 1 - RANKING_LIMITS.historyDays));
        const next =
          Number(latest.active) && Number(latest.auto_sync)
            ? new Date(now().getTime() + 24 * 3600000).toISOString()
            : null;
        await db
          .prepare(
            'UPDATE ranking_keywords SET last_success_at=?,last_error=NULL,failures=0,next_sync_at=?,run_token=NULL,lease_until=NULL WHERE id=? AND run_token=?',
          )
          .run(stamp(), next, id, token);
        if (changed)
          await audit(
            db,
            actor,
            'Keyword positions updated',
            id,
            `${row.keyword}; ${range.startDate}–${range.endDate}; ${reported} days with finalized Search Console query rows. Missing rows remain gaps.`,
            stamp(),
          );
        return {
          keyword: (await list({ keywordId: id }))[0],
          range,
          changedDays: changed,
          reportedDays: reported,
        };
      });
    } catch (error) {
      await transaction(db, async () => {
        const latest = await db
          .prepare(`SELECT * FROM ranking_keywords WHERE id=?${db.lockSuffix}`)
          .get(id);
        if (latest?.run_token !== token) return;
        const message =
          error instanceof HttpError || error instanceof ProviderError
            ? error.message
            : 'This keyword could not be checked. Earlier history is preserved.';
        const failures = Number(latest.failures) + 1;
        const delay = Math.min(24 * 3600000, 30 * 60000 * 2 ** Math.min(failures - 1, 6));
        const next =
          Number(latest.active) && Number(latest.auto_sync)
            ? new Date(now().getTime() + delay).toISOString()
            : null;
        await db
          .prepare(
            'UPDATE ranking_keywords SET last_error=?,failures=?,next_sync_at=?,run_token=NULL,lease_until=NULL WHERE id=? AND run_token=?',
          )
          .run(message, failures, next, id, token);
        if (!latest.last_error || latest.last_error !== message)
          await audit(
            db,
            actor,
            'Keyword tracking needs attention',
            id,
            `${row.keyword}; ${message}`,
            stamp(),
          );
      });
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        error?.code === 'provider_rate_limited' ? 429 : 502,
        'Search Console could not complete this keyword check. See the tracking status and reconnect if needed.',
        error?.code ?? 'keyword_check_failed',
      );
    }
  }
  async function sync(id, actor) {
    await assertActor(actor, true);
    return execute(id, actor, false);
  }
  async function runDue({ limit = RANKING_LIMITS.maxPerRun } = {}) {
    if (!automationEnabled || !hasAdapter) return { processed: 0, results: [], enabled: false };
    const take = Math.max(
      0,
      Math.min(
        RANKING_LIMITS.maxPerRun,
        Number.isFinite(limit) ? Math.floor(limit) : RANKING_LIMITS.maxPerRun,
      ),
    );
    if (!take) return { processed: 0, results: [], enabled: true };
    const due = await db
      .prepare(
        `SELECT k.id FROM ranking_keywords k JOIN service_connections c ON c.id=k.connection_id WHERE k.active=1 AND k.auto_sync=1 AND k.next_sync_at<=? AND (k.run_token IS NULL OR k.lease_until<=?) AND c.status='connected' AND c.provider='search_console' AND c.account_id=k.property_id AND c.institution=k.institution ORDER BY k.next_sync_at,k.id LIMIT 12`,
      )
      .all(stamp(), stamp());
    const results = [];
    for (const item of due) {
      try {
        const result = await execute(item.id, null, true);
        if (!result) continue;
        results.push({
          keywordId: item.id,
          status: 'imported',
          range: result.range,
          reportedDays: result.reportedDays,
        });
      } catch (error) {
        results.push({
          keywordId: item.id,
          status: 'failed',
          error: error instanceof HttpError ? error.message : 'Keyword import failed.',
        });
      }
      if (results.length >= take) break;
    }
    return { processed: results.length, results, enabled: true };
  }
  function provenance(options) {
    const value = options?.via ?? 'manual';
    if (!['manual', 'mcp'].includes(value))
      throw new HttpError(422, 'Choose an actual evidence source.', 'invalid_provenance');
    return value;
  }
  async function recordSearchObservation(id, input, actor, options = {}) {
    await assertActor(actor);
    const value = parse(searchEvidenceSchema, input);
    if (value.date < '2000-01-01' || value.date > calendarDate(now(), 'Asia/Kolkata'))
      throw new HttpError(
        422,
        'Use the actual source date, today or earlier.',
        'invalid_observation_time',
      );
    const evidenceUrl = reference(value.evidenceUrl);
    return transaction(db, async () => {
      const row = await raw(id, true);
      const dedupeKey = digest({
        keywordId: id,
        identity: identity(row),
        ...value,
        evidenceUrl,
        provenance: provenance(options),
      });
      const duplicate = await db
        .prepare(
          'SELECT e.*,u.name AS recorded_name FROM ranking_search_evidence e LEFT JOIN users u ON u.id=e.recorded_by WHERE e.dedupe_key=?',
        )
        .get(dedupeKey);
      if (duplicate) return { ...toSearchEvidence(duplicate), duplicate: true };
      const count = Number(
        (
          await db
            .prepare('SELECT COUNT(*) AS count FROM ranking_search_evidence WHERE keyword_id=?')
            .get(id)
        ).count,
      );
      if (count >= RANKING_LIMITS.maxEvidencePerKeyword)
        throw new HttpError(
          409,
          'This keyword has reached its 200 recorded-search evidence limit. Export and review older research before expanding retention.',
          'keyword_evidence_limit',
        );
      const evidenceId = makeId('keyword_search_evidence');
      await db
        .prepare(
          'INSERT INTO ranking_search_evidence(id,dedupe_key,keyword_id,date,position,clicks,impressions,provenance,evidence_url,notes,identity_snapshot,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          evidenceId,
          dedupeKey,
          id,
          value.date,
          value.position,
          value.clicks,
          value.impressions,
          provenance(options),
          evidenceUrl,
          value.notes,
          JSON.stringify(identity(row)),
          actor.id,
          stamp(),
        );
      await audit(
        db,
        actor,
        'Keyword search evidence recorded',
        id,
        `${row.keyword}; ${value.date}; ${provenance(options)} evidence. Kept separate from authorized Search Console API history.`,
        stamp(),
      );
      return toSearchEvidence(
        await db
          .prepare(
            'SELECT e.*,u.name AS recorded_name FROM ranking_search_evidence e LEFT JOIN users u ON u.id=e.recorded_by WHERE e.id=?',
          )
          .get(evidenceId),
      );
    });
  }
  async function recordAnswerObservation(id, input, actor, options = {}) {
    await assertActor(actor);
    const value = parse(answerEvidenceSchema, input);
    if (
      Date.parse(value.checkedAt) > now().getTime() + 5 * 60000 ||
      Date.parse(value.checkedAt) < Date.UTC(2000, 0, 1)
    )
      throw new HttpError(
        422,
        'Use the actual time of the answer check, not a future time.',
        'invalid_observation_time',
      );
    const citations = [...new Set(value.citationUrls.map(reference))];
    return transaction(db, async () => {
      const row = await raw(id, true);
      if (!row.answer_target_url)
        throw new HttpError(
          422,
          'Set the school target website in keyword settings before recording answer citations.',
          'answer_target_required',
        );
      const host = (url) => new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      const cited = citations.some((url) => host(url) === host(row.answer_target_url));
      if (value.cited !== cited)
        throw new HttpError(
          422,
          'The cited checkbox must match a citation URL on the target school website.',
          'citation_evidence_mismatch',
        );
      const context = {
        provider: value.provider.toLowerCase(),
        model: value.model,
        prompt: row.answer_prompt,
        targetUrl: row.answer_target_url,
        locale: row.answer_locale,
        language: row.answer_language,
      };
      const evidenceUrl = value.evidenceUrl ? reference(value.evidenceUrl) : '';
      const dedupeKey = digest({
        keywordId: id,
        context,
        ...value,
        citationUrls: [...citations].sort(),
        evidenceUrl,
        provenance: provenance(options),
      });
      const duplicate = await db
        .prepare(
          'SELECT id,context_id,checked_at,mentioned,cited,provenance FROM ranking_answer_observations WHERE dedupe_key=?',
        )
        .get(dedupeKey);
      if (duplicate)
        return {
          id: duplicate.id,
          contextId: duplicate.context_id,
          checkedAt: duplicate.checked_at,
          mentioned: Number(duplicate.mentioned) === 1,
          cited: Number(duplicate.cited) === 1,
          provenance: duplicate.provenance,
          duplicate: true,
        };
      const count = Number(
        (
          await db
            .prepare(
              'SELECT COUNT(*) AS count FROM ranking_answer_observations o JOIN ranking_answer_contexts c ON c.id=o.context_id WHERE c.keyword_id=?',
            )
            .get(id)
        ).count,
      );
      if (count >= RANKING_LIMITS.maxAnswerObservationsPerKeyword)
        throw new HttpError(
          409,
          'This keyword has reached its 200 answer-evidence limit. Export and review older research before expanding retention.',
          'answer_evidence_limit',
        );
      const key = digest(context);
      let saved = await db
        .prepare('SELECT * FROM ranking_answer_contexts WHERE keyword_id=? AND context_key=?')
        .get(id, key);
      if (!saved) {
        const contexts = Number(
          (
            await db
              .prepare('SELECT COUNT(*) AS count FROM ranking_answer_contexts WHERE keyword_id=?')
              .get(id)
          ).count,
        );
        if (contexts >= RANKING_LIMITS.maxAnswerContextsPerKeyword)
          throw new HttpError(
            409,
            'This keyword already has 20 prompt/model contexts. Create a distinct track for a new research question.',
            'answer_context_limit',
          );
        const contextId = makeId('keyword_answer_context');
        await db
          .prepare(
            'INSERT INTO ranking_answer_contexts(id,keyword_id,context_key,provider,model,prompt,target_url,locale,language,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
          )
          .run(
            contextId,
            id,
            key,
            context.provider,
            context.model,
            context.prompt,
            context.targetUrl,
            context.locale,
            context.language,
            stamp(),
          );
        saved = { id: contextId };
      }
      const observationId = makeId('keyword_answer_observation');
      await db
        .prepare(
          'INSERT INTO ranking_answer_observations(id,dedupe_key,context_id,checked_at,observation_date,mentioned,cited,citation_urls,answer_excerpt,evidence_url,notes,provenance,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          observationId,
          dedupeKey,
          saved.id,
          value.checkedAt,
          calendarDate(new Date(value.checkedAt), 'Asia/Kolkata'),
          value.mentioned ? 1 : 0,
          cited ? 1 : 0,
          JSON.stringify(citations),
          value.answerExcerpt,
          evidenceUrl,
          value.notes,
          provenance(options),
          actor.id,
          stamp(),
        );
      await audit(
        db,
        actor,
        'Keyword answer evidence recorded',
        id,
        `${row.keyword}; ${context.provider} / ${context.model}; ${context.locale}, ${context.language}. Recorded evidence; no billable AI request was made.`,
        stamp(),
      );
      return {
        id: observationId,
        contextId: saved.id,
        checkedAt: value.checkedAt,
        mentioned: value.mentioned,
        cited,
        provenance: provenance(options),
      };
    });
  }
  return {
    list,
    get,
    create,
    update,
    remove,
    sync,
    runDue,
    recordSearchObservation,
    recordAnswerObservation,
  };
}

export async function registerRankings(app, context) {
  const { db, config, now, requireAuth, requireManager, options = {} } = context;
  const marker = () =>
    db.prepare("SELECT value FROM workspace_metadata WHERE key='rankings_schema_version'").get();
  if (config.migrate !== false) {
    await transaction(db, async () => {
      if (db.kind === 'postgres')
        await db
          .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
          .get(`smis:${db.schema}:migrations`);
      if ((await marker())?.value !== '1')
        await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    });
  } else if ((await marker())?.value !== '1')
    throw new Error(
      'Keyword-tracking migration required. Apply server/rankings/schema.sql before deploying this release.',
    );
  const automationEnabled =
    options.automationEnabled ?? process.env.KEYWORD_AUTOMATION_ENABLED !== 'false';
  const keywords = createRankingService({ db, now, ...options, automationEnabled });
  async function data() {
    return {
      keywords: await keywords.list(),
      limits: RANKING_LIMITS,
      automation: {
        enabled: automationEnabled && typeof options.withSearchConsole === 'function',
        intervalHours: 24,
        reportingTimeZone: 'America/Los_Angeles',
        answerTimeZone: 'Asia/Kolkata',
        paidAiEnabled: false,
      },
    };
  }
  app.get('/api/rankings', requireAuth, async (_request, response) => response.json(await data()));
  app.get('/api/rankings/keywords/:id', requireAuth, async (request, response) =>
    response.json({ keyword: await keywords.get(request.params.id) }),
  );
  app.post('/api/rankings/keywords', requireAuth, requireManager, async (request, response) =>
    response.status(201).json({ keyword: await keywords.create(request.body, request.auth.user) }),
  );
  app.patch('/api/rankings/keywords/:id', requireAuth, requireManager, async (request, response) =>
    response.json({
      keyword: await keywords.update(request.params.id, request.body, request.auth.user),
    }),
  );
  app.delete('/api/rankings/keywords/:id', requireAuth, requireManager, async (request, response) =>
    response.json(await keywords.remove(request.params.id, request.auth.user)),
  );
  app.post(
    '/api/rankings/keywords/:id/sync',
    requireAuth,
    requireManager,
    async (request, response) => {
      parse(z.object({}).strict(), request.body ?? {});
      response.json(await keywords.sync(request.params.id, request.auth.user));
    },
  );
  app.post(
    '/api/rankings/keywords/:id/search-observations',
    requireAuth,
    async (request, response) =>
      response.status(201).json({
        observation: await keywords.recordSearchObservation(
          request.params.id,
          request.body,
          request.auth.user,
        ),
      }),
  );
  app.post(
    '/api/rankings/keywords/:id/answer-observations',
    requireAuth,
    async (request, response) =>
      response.status(201).json({
        observation: await keywords.recordAnswerObservation(
          request.params.id,
          request.body,
          request.auth.user,
        ),
      }),
  );
  return {
    services: { keywords },
    runDue: keywords.runDue,
    bootstrap: async () => ({
      keywordTracking: {
        count: Number(
          (await db.prepare('SELECT COUNT(*) AS count FROM ranking_keywords').get()).count,
        ),
        paidAiEnabled: false,
      },
    }),
  };
}
