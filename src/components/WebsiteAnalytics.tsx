import { useState } from 'react';
import { ArrowDownToLine, ArrowRight, Globe, RefreshCw } from 'lucide-react';
import { Badge, Button, EmptyState } from './UI';
import { useWorkspace } from '../lib/workspace';
import { downloadCsv, errorMessage, formatDate, formatNumber } from '../lib/utils';

const formatExact = (value: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 20 }).format(value);
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

export default function WebsiteAnalytics() {
  const { data, navigate, request, refresh, toast, selectedInstitution } = useWorkspace();
  const [selectedId, setSelectedId] = useState('');
  const [startDate, setStartDate] = useState(() => day(-28));
  const [endDate, setEndDate] = useState(() => day(-1));
  const [busy, setBusy] = useState(false);
  const connections = data.connections.filter(
    (connection) =>
      connection.provider === 'google' &&
      connection.accountId &&
      (selectedInstitution === 'all' || connection.institution === selectedInstitution),
  );
  const selected = connections.find((connection) => connection.id === selectedId) ?? connections[0];
  const report = [...data.websiteAnalytics]
    .filter((item) => item.connectionId === selected?.id)
    .sort((a, b) => b.importedAt.localeCompare(a.importedAt))[0];
  const stale = report && Date.now() - new Date(report.importedAt).getTime() > 86400000;
  const maximum = Math.max(1, ...(report?.daily.map((item) => item.sessions) ?? []));
  async function importReport() {
    if (!selected) return;
    if (!startDate || !endDate || startDate > endDate) {
      toast('Choose a valid reporting date range.', 'error');
      return;
    }
    setBusy(true);
    try {
      await request(`/connections/${selected.id}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate }),
      });
      await refresh();
      toast('Website report imported from Google Analytics.');
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  function exportReport() {
    if (!report) return;
    downloadCsv('stmarys-ga4-website-report.csv', [
      ['Source', 'Google Analytics 4'],
      ['Property', report.accountName],
      ['Institution', report.institution],
      ['Reporting period', `${report.startDate} to ${report.endDate}`],
      ['Imported at', report.importedAt],
      ['Metric', 'Period total'],
      ['Users', report.totals.users],
      ['Sessions', report.totals.sessions],
      ['Views', report.totals.views],
      ['Key events', report.totals.keyEvents],
      [],
      ['Date', 'Users', 'Sessions', 'Views', 'Key events'],
      ...report.daily.map((item) => [
        item.date,
        item.users,
        item.sessions,
        item.views,
        item.keyEvents,
      ]),
      [],
      ['Page path', 'Sessions', 'Views', 'Key events'],
      ...report.pages.map((item) => [item.path, item.sessions, item.views, item.keyEvents]),
      [],
      ['Session source / medium', 'Sessions', 'Key events'],
      ...report.sources.map((item) => [item.source, item.sessions, item.keyEvents]),
    ]);
    toast('GA4 report exported with property, dates and import time.');
  }
  if (!connections.length)
    return (
      <section className="panel website-empty">
        <EmptyState
          icon={<Globe size={30} />}
          title="Your website, with real numbers"
          description="Connect a Google Analytics 4 property for this institution to see visitors, sessions, pages and key events. Your manager can authorize access in Connections."
          action={
            <Button variant="primary" onClick={() => navigate('settings')}>
              Set up Google Analytics <ArrowRight size={15} />
            </Button>
          }
        />
        <p className="website-footnote">
          Website reports are separate from social reach, advertising results and confirmed
          admissions.
        </p>
      </section>
    );
  return (
    <div className="website-analytics">
      <section className="panel website-controls" aria-label="Google Analytics report controls">
        <label className="field">
          Google Analytics property
          <select
            value={selected?.id ?? ''}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.accountName} · {connection.institution}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          From
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>
        <label className="field">
          Through
          <input
            type="date"
            value={endDate}
            min={startDate}
            max={day(0)}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>
        {data.user.role === 'manager' && (
          <Button
            variant="primary"
            disabled={busy || selected?.status !== 'connected'}
            onClick={() => void importReport()}
          >
            <RefreshCw size={15} className={busy ? 'spinning' : ''} />
            {busy ? 'Importing…' : 'Import report'}
          </Button>
        )}
      </section>
      {selected?.status !== 'connected' && (
        <div className="website-source-note" role="status">
          <Badge tone="amber">Connection needs attention</Badge>
          <p>
            {selected?.error ||
              'Reconnect this property in Settings before importing a new report.'}
          </p>
          <Button onClick={() => navigate('settings')}>Manage connection</Button>
        </div>
      )}
      {report ? (
        <>
          <div className="website-source-note">
            <Badge tone="green">Imported from GA4</Badge>
            <p>
              <strong>
                {formatDate(report.startDate)} – {formatDate(report.endDate)}
              </strong>
              <span>
                {report.accountName} · Imported{' '}
                {formatDate(report.importedAt, {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}{' '}
                IST{stale ? ' · Refresh for newer data' : ''}
              </span>
            </p>
            <Button onClick={exportReport}>
              <ArrowDownToLine size={15} />
              Export CSV
            </Button>
          </div>
          <div className="perf-stats">
            {[
              ['Users', report.totals.users, 'Period total reported by GA4'],
              ['Sessions', report.totals.sessions, 'Visits during this reporting window'],
              ['Views', report.totals.views, 'Page and screen views'],
              ['Key events', report.totals.keyEvents, 'Events configured in your GA4 property'],
            ].map(([label, value, note]) => (
              <section className="panel website-stat" key={label}>
                <span>{label}</span>
                <strong>{formatNumber(Number(value))}</strong>
                <p>{note}</p>
              </section>
            ))}
          </div>
          <section className="panel website-trend">
            <div className="panel-heading">
              <div>
                <h2>Website visits over time</h2>
                <p>Sessions per day · {report.institution}</p>
              </div>
            </div>
            {report.daily.length ? (
              <>
                <div
                  className="website-bars"
                  role="img"
                  aria-label="Daily sessions. Exact figures are available in the table below."
                >
                  {report.daily.map((item) => (
                    <div
                      className="website-bar-slot"
                      key={item.date}
                      title={`${formatDate(item.date)}: ${formatExact(item.sessions)} sessions`}
                    >
                      <span
                        style={{
                          height: `${Math.max(item.sessions ? 2 : 0, (item.sessions / maximum) * 100)}%`,
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="website-axis">
                  <span>{formatDate(report.daily[0].date)}</span>
                  <span>{formatDate(report.daily.at(-1)!.date)}</span>
                </div>
                <details className="website-daily">
                  <summary>View exact daily figures</summary>
                  <div className="perf-table-wrap">
                    <table className="perf-table">
                      <caption className="sr-only">Daily GA4 website results</caption>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Users</th>
                          <th>Sessions</th>
                          <th>Views</th>
                          <th>Key events</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.daily.map((item) => (
                          <tr key={item.date}>
                            <td>{formatDate(item.date)}</td>
                            <td>{formatExact(item.users)}</td>
                            <td>{formatExact(item.sessions)}</td>
                            <td>{formatExact(item.views)}</td>
                            <td>{formatExact(item.keyEvents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            ) : (
              <EmptyState
                title="No visits reported for this period"
                description="The imported report contains no daily rows. Try a different date range."
              />
            )}
          </section>
          <div className="website-detail-grid">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Pages people explore</h2>
                  <p>Top page paths by views</p>
                </div>
              </div>
              <div className="perf-table-wrap">
                <table className="perf-table">
                  <caption className="sr-only">Top website pages</caption>
                  <thead>
                    <tr>
                      <th>Page</th>
                      <th>Views</th>
                      <th>Sessions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.pages.map((item) => (
                      <tr key={item.path}>
                        <td className="website-path">{item.path}</td>
                        <td>{formatExact(item.views)}</td>
                        <td>{formatExact(item.sessions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!report.pages.length && <p className="website-footnote">No page rows reported.</p>}
              </div>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>How visitors find you</h2>
                  <p>Session source and medium</p>
                </div>
              </div>
              <div className="perf-table-wrap">
                <table className="perf-table">
                  <caption className="sr-only">Website traffic sources</caption>
                  <thead>
                    <tr>
                      <th>Source / medium</th>
                      <th>Sessions</th>
                      <th>Key events</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.sources.map((item) => (
                      <tr key={item.source}>
                        <td className="website-path">{item.source}</td>
                        <td>{formatExact(item.sessions)}</td>
                        <td>{formatExact(item.keyEvents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!report.sources.length && (
                  <p className="website-footnote">No traffic source rows reported.</p>
                )}
              </div>
            </section>
          </div>
          <p className="website-footnote">
            Users are reported for the whole period and are not calculated by adding daily users.
            Key events depend on your GA4 configuration; they do not necessarily represent unique
            enquiries or admissions. Page and source tables show the rows returned by Google.
          </p>
        </>
      ) : (
        <section className="panel">
          <EmptyState
            icon={<Globe size={28} />}
            title="Connected. Ready for your first report."
            description="Choose your date range and import a report to bring this property's real website data into the workspace."
          />
        </section>
      )}
    </div>
  );
}
