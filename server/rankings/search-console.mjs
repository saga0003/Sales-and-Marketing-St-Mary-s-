import { ProviderError } from '../extensions/providers.mjs';

const DAY = 86400000;
export const RANKING_LIMITS = Object.freeze({
  maxKeywords: 60,
  maxPerRun: 3,
  dailyIntervalHours: 24,
  initialDays: 28,
  refreshDays: 7,
  reportingLagDays: 3,
  historyDays: 400,
  chartDays: 90,
  maxEvidencePerKeyword: 200,
  maxAnswerContextsPerKeyword: 20,
  maxAnswerObservationsPerKeyword: 200,
  manualCooldownMinutes: 5,
  responseBytes: 256 * 1024,
});

export function calendarDate(value, timeZone = 'America/Los_Angeles') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const field = (name) => parts.find((part) => part.type === name).value;
  return `${field('year')}-${field('month')}-${field('day')}`;
}

export function moveDate(value, days) {
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

export function isDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

export function searchRange(now, hasHistory) {
  const endDate = moveDate(calendarDate(now), -RANKING_LIMITS.reportingLagDays);
  return {
    startDate: moveDate(
      endDate,
      1 - (hasHistory ? RANKING_LIMITS.refreshDays : RANKING_LIMITS.initialDays),
    ),
    endDate,
  };
}

export function searchQuery(keyword, range) {
  const filters = [{ dimension: 'query', operator: 'equals', expression: keyword.keyword }];
  if (keyword.country)
    filters.push({ dimension: 'country', operator: 'equals', expression: keyword.country });
  if (keyword.device !== 'all')
    filters.push({ dimension: 'device', operator: 'equals', expression: keyword.device });
  if (keyword.page_url)
    filters.push({ dimension: 'page', operator: 'equals', expression: keyword.page_url });
  return {
    ...range,
    dimensions: ['date'],
    dimensionFilterGroups: [{ groupType: 'and', filters }],
    type: keyword.search_type,
    dataState: 'final',
    aggregationType: keyword.page_url ? 'byPage' : 'byProperty',
    rowLimit: RANKING_LIMITS.initialDays,
    startRow: 0,
  };
}

function invalid() {
  return new ProviderError(
    'Search Console returned an unexpected daily-query response. Earlier history is preserved.',
    'invalid_provider_response',
  );
}

export function normalizeSearchRows(data, range) {
  if (!data || (data.rows !== undefined && !Array.isArray(data.rows))) throw invalid();
  const rows = data.rows ?? [];
  if (rows.length > RANKING_LIMITS.initialDays) throw invalid();
  const byDate = new Map();
  for (const row of rows) {
    const date = row.keys?.[0];
    if (
      !Array.isArray(row.keys) ||
      row.keys.length !== 1 ||
      !isDate(date) ||
      date < range.startDate ||
      date > range.endDate ||
      byDate.has(date)
    )
      throw invalid();
    const values = ['position', 'clicks', 'impressions', 'ctr'].map((key) => row[key]);
    if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value)))
      throw invalid();
    if (row.clicks < 0 || row.impressions < 0 || row.ctr < 0 || row.ctr > 1) throw invalid();
    if (row.impressions > 0 && row.position < 1) throw invalid();
    byDate.set(
      date,
      row.impressions > 0
        ? {
            date,
            position: row.position,
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            availability: 'reported',
          }
        : null,
    );
  }
  const samples = [];
  for (let date = range.startDate; date <= range.endDate; date = moveDate(date, 1)) {
    if (samples.length >= RANKING_LIMITS.initialDays) throw invalid();
    samples.push(
      byDate.get(date) ?? {
        date,
        position: null,
        clicks: null,
        impressions: null,
        ctr: null,
        availability: 'no_row',
      },
    );
  }
  return samples;
}

export function positionChange(samples) {
  const usable = samples.filter((sample) => sample.position !== null);
  const latest = usable.at(-1) ?? null;
  const previous = usable.at(-2) ?? null;
  return {
    latest,
    previous,
    improvement:
      latest && previous ? Math.round((previous.position - latest.position) * 100) / 100 : null,
    latestCheckedDate: samples.at(-1)?.date ?? null,
  };
}

async function readJson(response) {
  const length = response.headers.get('content-length');
  if (length && Number(length) > RANKING_LIMITS.responseBytes) {
    await response.body?.cancel().catch(() => {});
    throw invalid();
  }
  if (!response.body) throw invalid();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RANKING_LIMITS.responseBytes) {
        await reader.cancel();
        throw invalid();
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw invalid();
  } finally {
    reader.releaseLock();
  }
}

export function createSearchConsoleReader({ fetch: fetchImpl = globalThis.fetch } = {}) {
  return async (connection, current, keyword, range) => {
    if (
      connection.provider !== 'search_console' ||
      connection.account_id !== keyword.property_id ||
      connection.institution !== keyword.institution ||
      !current.accessToken
    )
      throw new ProviderError(
        'This keyword belongs to a different property.',
        'connection_changed',
      );
    let response;
    try {
      // The only outbound origin is fixed. A property identifier is one escaped
      // path segment, never a caller-selected network destination.
      response = await fetchImpl(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(keyword.property_id)}/searchAnalytics/query`,
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(20000),
          headers: {
            Authorization: `Bearer ${current.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchQuery(keyword, range)),
        },
      );
    } catch {
      throw new ProviderError(
        'Search Console could not be reached. The daily check will retry later.',
        'provider_unreachable',
      );
    }
    const data = await readJson(response);
    if (!response.ok || data.error) {
      const reasons = JSON.stringify(data.error?.errors ?? []).toLowerCase();
      const limited = response.status === 429 || /ratelimit|quota/.test(reasons);
      const revoked = response.status === 401;
      const denied = response.status === 403 && !limited;
      throw new ProviderError(
        limited
          ? 'Search Console quota was reached. This check will retry with a delay.'
          : revoked || denied
            ? 'Search Console access needs attention. Reconnect or check the property permissions.'
            : 'Search Console rejected this keyword query. Check the selected property and filters.',
        limited
          ? 'provider_rate_limited'
          : revoked
            ? 'reauthorization_required'
            : denied
              ? 'permission_denied'
              : 'provider_rejected',
        { reauthenticate: revoked, httpStatus: response.status },
      );
    }
    return normalizeSearchRows(data, range);
  };
}
