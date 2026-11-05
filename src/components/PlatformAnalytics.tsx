import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  BarChart3,
  CircleAlert,
  Clock3,
  Link2,
  RefreshCw,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import { canReport, providerNames } from '../lib/providers';
import type { PlatformReport, ProviderId } from '../lib/types';
import { formatDate, formatNumber } from '../lib/utils';
import { Badge, Button, EmptyState } from './UI';
import '../styles/reporting.css';

const dateBefore = (days: number) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() - days * 86400000));
function metric(value: number, type?: string, currency?: string): string {
  if (!Number.isFinite(value)) return '—';
  if (type === 'currency')
    return currency
      ? new Intl.NumberFormat('en-IN', {
          style: 'currency',
          currency,
          maximumFractionDigits: 2,
        }).format(value)
      : `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value)} (currency not supplied)`;
  if (type === 'percent')
    return `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value)}%`;
  if (type === 'seconds' || type === 'minutes')
    return `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value)} ${type}`;
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);
}
function safeLink(value: unknown) {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export default function PlatformAnalytics({
  providers,
  title,
  description,
}: {
  providers: ProviderId[];
  title: string;
  description: string;
}) {
  const { data, selectedInstitution, mutate, navigate, toast } = useWorkspace();
  const accounts = useMemo(
    () =>
      data.connections.filter(
        (connection) =>
          providers.includes(connection.provider) &&
          canReport(connection.capabilities) &&
          connection.status !== 'disconnected' &&
          connection.accountId &&
          (selectedInstitution === 'all' || connection.institution === selectedInstitution),
      ),
    [data.connections, selectedInstitution, providers.join('|')],
  );
  const [connectionId, setConnectionId] = useState('');
  const [startDate, setStartDate] = useState(() => dateBefore(30));
  const [endDate, setEndDate] = useState(() => dateBefore(1));
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [localReport, setLocalReport] = useState<PlatformReport | null>(null);
  const [table, setTable] = useState('');
  useEffect(() => {
    if (!accounts.some((account) => account.id === connectionId)) {
      setConnectionId(accounts[0]?.id || '');
      setLocalReport(null);
    }
  }, [accounts, connectionId]);
  const connection = accounts.find((account) => account.id === connectionId);
  const report =
    localReport?.connectionId === connectionId
      ? localReport
      : data.platformAnalytics.find((item) => item.connectionId === connectionId);
  const selectedTable = report?.tables.find((item) => item.key === table) || report?.tables[0];
  const waitingForImport =
    !!report && (report.startDate !== startDate || report.endDate !== endDate);
  async function sync() {
    if (!connection) return;
    if (!startDate || !endDate || startDate > endDate) {
      setError('Choose a start date on or before the end date.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const imported = await mutate<PlatformReport>(`/connections/${connection.id}/sync`, 'POST', {
        startDate,
        endDate,
      });
      if (imported && Array.isArray(imported.summary)) setLocalReport(imported);
      setTable('');
      toast(`${providerNames[connection.provider]} report imported.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The report could not be imported.');
    } finally {
      setBusy(false);
    }
  }
  async function exportReport() {
    if (!report) return;
    setExporting(true);
    setError('');
    try {
      const response = await fetch(
        `/api/connections/${encodeURIComponent(report.connectionId)}/report.csv`,
        { credentials: 'same-origin' },
      );
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'The CSV export could not be generated.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `stmarys-${report.provider}-${report.startDate}-${report.endDate}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The report could not be exported.');
    } finally {
      setExporting(false);
    }
  }
  return (
    <section className="platform-analytics">
      <div className="report-section-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {report && (
          <Button disabled={exporting} onClick={() => void exportReport()}>
            <ArrowDownToLine size={16} />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        )}
      </div>
      {!accounts.length ? (
        <section className="panel">
          <EmptyState
            icon={<BarChart3 size={30} />}
            title="Connect an account to see its reports"
            description="Only authorized accounts with reporting access appear here. Select the right school, then connect a service in Settings."
            action={
              <Button variant="primary" onClick={() => navigate('settings')}>
                <Link2 size={16} />
                Open connections
              </Button>
            }
          />
        </section>
      ) : (
        <>
          <section className="panel report-controls">
            <label className="field">
              Account
              <select
                value={connectionId}
                onChange={(event) => {
                  setConnectionId(event.target.value);
                  setLocalReport(null);
                  setError('');
                  setTable('');
                }}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {providerNames[account.provider]} · {account.accountName} ·{' '}
                    {account.institution}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              From
              <input
                type="date"
                required
                value={startDate}
                max={endDate || dateBefore(0)}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </label>
            <label className="field">
              To
              <input
                type="date"
                required
                value={endDate}
                min={startDate}
                max={dateBefore(0)}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </label>
            <Button
              variant="primary"
              disabled={
                busy ||
                data.user.role !== 'manager' ||
                !connection ||
                connection.status !== 'connected'
              }
              onClick={() => void sync()}
            >
              <RefreshCw size={16} className={busy ? 'spin' : ''} />
              {busy ? 'Importing…' : 'Import report'}
            </Button>
          </section>
          {data.user.role !== 'manager' && (
            <p className="report-explanation">
              A manager imports reports. Your team can read the saved results.
            </p>
          )}
          {connection && connection.status !== 'connected' && (
            <div className="report-warning">
              <CircleAlert size={18} />
              <span>
                This connection needs attention.{' '}
                {connection.error || 'Test or reauthorize it in Settings before importing.'}
              </span>
              <Button size="sm" onClick={() => navigate('settings')}>
                Review connection
              </Button>
            </div>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {report ? (
            <>
              <div className="report-provenance">
                <div>
                  <Badge tone="green">Imported data</Badge>
                  <strong>{report.accountName}</strong>
                  <span>
                    {providerNames[report.provider]} · {report.institution}
                  </span>
                </div>
                <div>
                  <span>
                    {formatDate(report.startDate)}–{formatDate(report.endDate)}
                  </span>
                  <small>
                    <Clock3 size={14} />
                    Imported{' '}
                    {formatDate(report.importedAt, {
                      day: 'numeric',
                      month: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}{' '}
                    IST
                  </small>
                </div>
              </div>
              {waitingForImport && (
                <p className="report-pending-range">
                  The saved report covers {report.startDate} to {report.endDate}. Import again to
                  apply the dates selected above.
                </p>
              )}
              <div className="report-metrics">
                {report.summary.map((item) => (
                  <article className="panel report-metric" key={item.key}>
                    <span>{item.label}</span>
                    <strong>{metric(item.value, item.unit, report.currency)}</strong>
                    {item.unit === 'currency' && report.currency && (
                      <small>Account currency · {report.currency}</small>
                    )}
                  </article>
                ))}
              </div>
              {report.tables.length > 0 && (
                <section className="panel report-table-panel">
                  <div className="report-table-heading">
                    <div>
                      <h3>{selectedTable?.label}</h3>
                      <p>
                        {formatNumber(selectedTable?.rows.length || 0)} saved rows
                        {selectedTable?.truncated ? ' · Provider result limit reached' : ''}
                      </p>
                    </div>
                    {report.tables.length > 1 && (
                      <select
                        aria-label="Report table"
                        value={selectedTable?.key || ''}
                        onChange={(event) => setTable(event.target.value)}
                      >
                        {report.tables.map((item) => (
                          <option key={item.key} value={item.key}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div
                    className="report-table-scroll"
                    role="region"
                    aria-label={selectedTable?.label || 'Report data'}
                    tabIndex={0}
                  >
                    <table>
                      <caption className="sr-only">
                        {selectedTable?.label} for {report.accountName}, {report.startDate} to{' '}
                        {report.endDate}
                      </caption>
                      <thead>
                        <tr>
                          {selectedTable?.columns.map((column) => (
                            <th scope="col" key={column.key}>
                              {column.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedTable?.rows.map((row, index) => (
                          <tr key={index}>
                            {selectedTable.columns.map((column) => {
                              const value = row[column.key];
                              const url = column.type === 'url' ? safeLink(value) : null;
                              return (
                                <td key={column.key}>
                                  {url ? (
                                    <a href={url} target="_blank" rel="noreferrer">
                                      {String(value)} <ArrowUpRight size={13} />
                                    </a>
                                  ) : typeof value === 'number' ? (
                                    metric(value, column.type, report.currency)
                                  ) : value === null || value === undefined || value === '' ? (
                                    '—'
                                  ) : (
                                    String(value)
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!selectedTable?.rows.length && (
                    <p className="report-table-empty">
                      No rows were returned for this table and reporting period.
                    </p>
                  )}
                </section>
              )}
              {report.notes.length > 0 && (
                <section className="report-methodology">
                  <h3>How to read this report</h3>
                  <ul>
                    {report.notes.map((note, index) => (
                      <li key={index}>{note}</li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <section className="panel">
              <EmptyState
                icon={<RefreshCw size={27} />}
                title="This account is ready for its first report"
                description="Choose a reporting period and import it. Empty results are shown honestly; sample data is not substituted."
              />
            </section>
          )}
        </>
      )}
    </section>
  );
}
