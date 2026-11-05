import { transaction, audit } from '../database.mjs';
import { HttpError } from '../validation.mjs';
import { opaqueId } from './crypto.mjs';
import { PROVIDERS } from './provider-definitions.mjs';

const day = 86400000;

export function createReporting({ db, now, provider, withProvider, requireConnection }) {
  const stamp = () => now().toISOString();
  const nextRun = (row) =>
    Number(row.auto_sync) === 1
      ? new Date(now().getTime() + Number(row.sync_interval_hours || 24) * 3600000).toISOString()
      : null;
  function dates(input = {}, days = 30, lagDays = 1) {
    const endDate =
      input.endDate ?? new Date(now().getTime() - lagDays * day).toISOString().slice(0, 10);
    const startDate =
      input.startDate ??
      new Date(Date.parse(`${endDate}T00:00:00Z`) - (days - 1) * day).toISOString().slice(0, 10);
    if (
      endDate < startDate ||
      endDate > now().toISOString().slice(0, 10) ||
      Date.parse(endDate) - Date.parse(startDate) > 89 * day
    )
      throw new HttpError(
        422,
        'Choose a valid date range of at most 90 days ending today or earlier.',
        'invalid_date_range',
      );
    return { startDate, endDate };
  }
  async function claim(id, automatic) {
    return transaction(db, async () => {
      const connection = await requireConnection(id, { connected: true, lock: true });
      if (!JSON.parse(connection.capabilities).includes('analytics:read'))
        throw new HttpError(
          422,
          'This authorization does not include report access.',
          'analytics_not_supported',
        );
      if (
        automatic &&
        (Number(connection.auto_sync) !== 1 ||
          connection.status !== 'connected' ||
          !connection.next_sync_at ||
          connection.next_sync_at > stamp())
      )
        return null;
      if (connection.sync_lease_id && connection.sync_lease_expires_at > stamp()) {
        if (automatic) return null;
        throw new HttpError(
          409,
          'A report import is already running for this account. Try again shortly.',
          'report_import_running',
        );
      }
      const leaseId = opaqueId('report');
      await db
        .prepare(
          'UPDATE service_connections SET sync_lease_id = ?, sync_lease_expires_at = ? WHERE id = ?',
        )
        .run(leaseId, new Date(now().getTime() + 5 * 60000).toISOString(), id);
      return { connection, leaseId };
    });
  }
  async function syncOne(id, input = {}, actor = null, { automatic = false } = {}) {
    // UTC yesterday can still be the current reporting day in western time
    // zones. A two-date lag excludes an unfinished day without guessing the
    // account's time zone; providers may still revise delayed attribution.
    const range = dates(input, automatic ? 28 : 30, automatic ? 2 : 1);
    const work = await claim(id, automatic);
    if (!work) return null;
    const { connection, leaseId } = work;
    try {
      const data = await withProvider(
        connection,
        (current, credentials) =>
          connection.provider === 'google'
            ? provider.report(connection.account_id, current, range.startDate, range.endDate)
            : provider.platformReport(
                connection.provider,
                connection.account_id,
                current,
                credentials,
                range.startDate,
                range.endDate,
              ),
        { reportLeaseId: leaseId },
      );
      const report = {
        connectionId: connection.id,
        accountName: connection.account_name,
        institution: connection.institution,
        provider: connection.provider === 'google' ? 'ga4' : connection.provider,
        ...range,
        importedAt: stamp(),
        ...data,
      };
      await transaction(db, async () => {
        const latest = await requireConnection(id, { lock: true });
        if (latest.account_id !== connection.account_id || latest.sync_lease_id !== leaseId)
          throw new HttpError(
            409,
            'This account changed during import. Try again.',
            'connection_changed',
          );
        await db
          .prepare(
            `INSERT INTO ${connection.provider === 'google' ? 'website_reports' : 'platform_reports'}(connection_id, report_json, imported_at) VALUES (?, ?, ?) ON CONFLICT(connection_id) DO UPDATE SET report_json = excluded.report_json, imported_at = excluded.imported_at`,
          )
          .run(id, JSON.stringify(report), report.importedAt);
        await db
          .prepare(
            "UPDATE service_connections SET status = 'connected', error = NULL, last_sync_at = ?, next_sync_at = ?, sync_lease_id = NULL, sync_lease_expires_at = NULL WHERE id = ? AND sync_lease_id = ?",
          )
          .run(report.importedAt, nextRun(latest), id, leaseId);
        await audit(
          db,
          actor,
          connection.provider === 'google'
            ? 'Website analytics imported'
            : 'Platform report imported',
          id,
          `${connection.account_name}; ${range.startDate} to ${range.endDate}; ${automatic ? 'scheduled' : 'manual'} read-only ${PROVIDERS[connection.provider].name} data.`,
          stamp(),
        );
      });
      return report;
    } catch (error) {
      await transaction(db, async () => {
        const latest = await db
          .prepare(`SELECT * FROM service_connections WHERE id = ?${db.lockSuffix}`)
          .get(id);
        if (latest?.sync_lease_id === leaseId) {
          await db
            .prepare(
              'UPDATE service_connections SET next_sync_at = ?, sync_lease_id = NULL, sync_lease_expires_at = NULL WHERE id = ? AND sync_lease_id = ?',
            )
            .run(latest.status === 'disconnected' ? null : nextRun(latest), id, leaseId);
          if (automatic)
            await audit(
              db,
              null,
              'Scheduled report import failed',
              id,
              'Review this connection before the next report import.',
              stamp(),
            );
        }
      });
      throw error;
    }
  }
  async function saveSettings(id, input, actor) {
    return transaction(db, async () => {
      const connection = await requireConnection(id, { connected: true, lock: true });
      if (!JSON.parse(connection.capabilities).includes('analytics:read'))
        throw new HttpError(
          422,
          'This account does not include report access.',
          'analytics_not_supported',
        );
      if (input.autoSync && connection.status !== 'connected')
        throw new HttpError(
          409,
          'Test or reconnect this account before enabling automatic imports.',
          'connection_unhealthy',
        );
      const interval = input.syncIntervalHours ?? Number(connection.sync_interval_hours || 24);
      await db
        .prepare(
          'UPDATE service_connections SET auto_sync = ?, sync_interval_hours = ?, next_sync_at = ? WHERE id = ?',
        )
        .run(input.autoSync ? 1 : 0, interval, input.autoSync ? stamp() : null, id);
      await audit(
        db,
        actor,
        'Report schedule changed',
        id,
        input.autoSync
          ? `Import a 28-day window with a two-day reporting lag every ${interval} hours.`
          : 'Automatic report imports disabled.',
        stamp(),
      );
      return requireConnection(id);
    });
  }
  async function syncDueReports({ limit = 1 } = {}) {
    // Read-only calls still consume provider quota. A run claims at most one
    // account; a durable lease also excludes manual and concurrent cron runs.
    const take = Math.min(1, Math.max(0, Number.isFinite(limit) ? Math.floor(limit) : 1));
    if (!take) return { processed: 0, results: [] };
    const due = await db
      .prepare(
        "SELECT id FROM service_connections WHERE auto_sync = 1 AND status = 'connected' AND next_sync_at <= ? AND (sync_lease_id IS NULL OR sync_lease_expires_at <= ?) ORDER BY next_sync_at, id LIMIT 3",
      )
      .all(stamp(), stamp());
    const results = [];
    for (const row of due) {
      try {
        const report = await syncOne(row.id, {}, null, { automatic: true });
        if (!report) continue;
        results.push({ connectionId: row.id, status: 'imported', importedAt: report.importedAt });
      } catch (error) {
        results.push({
          connectionId: row.id,
          status: 'failed',
          error:
            error instanceof HttpError
              ? error.message
              : 'The scheduled report import could not be completed.',
        });
      }
      if (results.length >= take) break;
    }
    return { processed: results.length, results };
  }
  return { syncOne, saveSettings, syncDueReports };
}
