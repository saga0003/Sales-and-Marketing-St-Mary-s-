import { useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  ChartNoAxesCombined,
  CheckCheck,
  CircleHelp,
  Globe,
  Link2,
  Megaphone,
  MousePointer2,
  Plus,
  Search,
  Sparkles,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import {
  Badge,
  Button,
  EmptyState,
  PageHeading,
  PlatformIcon,
  platformNames,
} from '../components/UI';
import { TrendChart } from '../components/Charts';
import { downloadCsv, errorMessage, formatCurrency, formatDate, formatNumber } from '../lib/utils';

export default function Performance() {
  const { data, navigate, mutate, toast } = useWorkspace();
  const [tab, setTab] = useState<'overview' | 'campaigns' | 'search'>('overview');
  const [period, setPeriod] = useState(30);
  const [metric, setMetric] = useState<'reach' | 'engagement' | 'enquiries'>('reach');
  const [showData, setShowData] = useState(false);
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [taskBusy, setTaskBusy] = useState(false);
  const points = data.analytics.points.slice(-period);
  const campaigns = data.analytics.campaigns.filter(
    (campaign) =>
      (campaignFilter === 'all' || campaign.platform === campaignFilter) &&
      campaign.name.toLowerCase().includes(query.toLowerCase()),
  );
  const sum = (key: 'reach' | 'engagement' | 'enquiries') =>
    points.reduce((total, point) => total + point[key], 0);
  const reach = sum('reach'),
    engagement = sum('engagement'),
    enquiries = sum('enquiries');
  const spend = campaigns.reduce((total, campaign) => total + campaign.spend, 0);
  const paidEnquiries = campaigns.reduce((total, campaign) => total + campaign.enquiries, 0);
  function exportData() {
    if (tab === 'search' || (!points.length && !campaigns.length)) {
      toast('There is no connected data to export yet.', 'info');
      return;
    }
    const label = data.analytics.sample
      ? 'Illustrative sample data — not live school results'
      : 'Connected analytics';
    const rows =
      tab === 'campaigns'
        ? [
            ['Data type', label],
            ['Campaign', 'Platform', 'Status', 'Spend (INR)', 'Impressions', 'Clicks', 'Enquiries'],
            ...campaigns.map((c) => [
              c.name,
              c.platform,
              c.status,
              c.spend,
              c.impressions,
              c.clicks,
              c.enquiries,
            ]),
          ]
        : [
            ['Data type', label],
            ['Date', 'Reach', 'Engagements', 'Enquiries'],
            ...points.map((point) => [point.date, point.reach, point.engagement, point.enquiries]),
          ];
    downloadCsv(`stmarys-${tab}-report.csv`, rows);
    toast('Report exported with its data-source label.');
  }
  async function createSearchTask() {
    setTaskBusy(true);
    try {
      const due = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      await mutate('/tasks', 'POST', {
        title: 'Review the ISC admissions page title, description and parent FAQs',
        owner: data.user.name,
        dueDate: due,
        status: 'todo',
        priority: 'medium',
      });
      toast('SEO review task added to your workspace.');
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setTaskBusy(false);
    }
  }
  return (
    <div className="performance-page">
      <PageHeading
        eyebrow="Insight that moves you forward"
        title="See the bigger picture."
        description="Bring your channels, campaigns and admissions into one clear view."
        actions={
          <>
            <Button onClick={() => navigate('settings')}>
              <Link2 size={15} />
              Data sources
            </Button>
            <Button variant="primary" onClick={exportData}>
              <ArrowDownToLine size={15} />
              Export report
            </Button>
          </>
        }
      />
      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Performance section">
          {(
            [
              { id: 'overview', label: 'Channel overview' },
              { id: 'campaigns', label: 'Ad campaigns' },
              { id: 'search', label: 'SEO & AI visibility' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={`tab ${tab === item.id ? 'active' : ''}`}
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {tab === 'overview' && (
          <select
            aria-label="Reporting period"
            className="select-compact"
            value={period}
            onChange={(e) => setPeriod(Number(e.target.value))}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        )}
      </div>
      {data.analytics.sample && tab !== 'search' && (
        <div className="perf-sample-note">
          <Sparkles size={14} />
          <p>
            You’re exploring sample analytics. Connect your accounts when you’re ready for your own
            numbers.
          </p>
          <button onClick={() => navigate('settings')}>
            View connections
            <ArrowRight size={12} />
          </button>
        </div>
      )}
      {tab === 'overview' && (
        <>
          <div className="perf-stats">
            <Stat
              label="Reported reach"
              value={points.length ? formatNumber(reach) : '—'}
              icon={<TrendingUp size={18} />}
              note="Sum of daily figures; people may repeat"
            />
            <Stat
              label="Engagements"
              value={points.length ? formatNumber(engagement) : '—'}
              icon={<MousePointer2 size={18} />}
              note={
                reach
                  ? `${((engagement / reach) * 100).toFixed(2)}% of summed reported reach`
                  : 'No source connected'
              }
            />
            <Stat
              label="Parent enquiries"
              value={points.length ? formatNumber(enquiries) : '—'}
              icon={<CheckCheck size={18} />}
              note={
                data.analytics.sample ? 'Sample · not joined to CRM' : 'Connect your admissions CRM'
              }
            />
            <Stat
              label="Connected sources"
              value={String(
                data.integrations.filter((i) => i.status === 'configured').length,
              ).padStart(2, '0')}
              icon={<Link2 size={18} />}
              note="Account connections are required"
            />
          </div>
          <section className="panel perf-trend-panel">
            <div className="panel-heading">
              <div>
                <h2>From everyday moments to meaningful progress</h2>
                <p>
                  {points.length
                    ? `${formatDate(points[0].date)} – ${formatDate(points.at(-1)!.date)}`
                    : 'Your performance trend will appear here'}
                </p>
              </div>
              <div className="tabs">
                {(['reach', 'engagement', 'enquiries'] as const).map((key) => (
                  <button
                    key={key}
                    className={`tab ${metric === key ? 'active' : ''}`}
                    onClick={() => setMetric(key)}
                  >
                    {key === 'engagement' ? 'Engagements' : key[0].toUpperCase() + key.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="perf-large-chart">
              <TrendChart points={points} metric={metric} />
            </div>
            <div className="chart-footer">
              <span className="chart-footer-dot" />
              {data.analytics.sample ? 'Illustrative data' : 'Connected data'}
              <button onClick={() => setShowData((value) => !value)}>
                {showData ? 'Hide data table' : 'View as a data table'}
              </button>
            </div>
            {showData && (
              <div className="perf-table-wrap">
                <table className="perf-table">
                  <caption className="sr-only">
                    Daily performance data, {data.analytics.sample ? 'sample' : 'live'}
                  </caption>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Reach</th>
                      <th>Engagements</th>
                      <th>Enquiries</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((p) => (
                      <tr key={p.date}>
                        <td>{formatDate(p.date)}</td>
                        <td>{formatNumber(p.reach)}</td>
                        <td>{formatNumber(p.engagement)}</td>
                        <td>{p.enquiries}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="panel perf-channels">
            <div className="panel-heading">
              <div>
                <h2>A place for every channel</h2>
                <p>
                  {data.analytics.sample
                    ? 'Sample channel snapshots · date filter applies to the trend above'
                    : 'Latest account snapshots · date filter applies to the trend above'}
                </p>
              </div>
              <Badge tone="gray">{data.analytics.channels.length} channels</Badge>
            </div>
            {data.analytics.channels.length ? (
              <div className="perf-table-wrap">
                <table className="perf-table">
                  <caption className="sr-only">Channel analytics snapshot</caption>
                  <thead>
                    <tr>
                      <th>Channel</th>
                      <th>Followers</th>
                      <th>Reach</th>
                      <th>Engagements</th>
                      <th>Data source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.analytics.channels.map((channel) => (
                      <tr key={channel.platform}>
                        <td>
                          <span className="perf-channel">
                            <PlatformIcon platform={channel.platform} size={17} />
                            {platformNames[channel.platform]}
                          </span>
                        </td>
                        <td>{formatNumber(channel.followers)}</td>
                        <td>{formatNumber(channel.reach)}</td>
                        <td>{formatNumber(channel.engagement)}</td>
                        <td>
                          <Badge tone="gray">
                            {data.analytics.sample ? 'Sample' : 'Connected'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={<ChartNoAxesCombined size={27} />}
                title="Your channels have a story to tell"
                description="Connect a reporting source to bring your real numbers into the workspace."
                action={
                  <Button onClick={() => navigate('settings')}>
                    View connections
                    <ArrowRight size={14} />
                  </Button>
                }
              />
            )}
          </section>
        </>
      )}
      {tab === 'campaigns' && (
        <>
          <div className="perf-stats perf-three-stats">
            <Stat
              label="Campaign spend"
              value={campaigns.length ? formatCurrency(spend) : '—'}
              icon={<Wallet size={18} />}
              note="Campaign snapshot totals"
            />
            <Stat
              label="Attributed enquiries"
              value={campaigns.length ? String(paidEnquiries) : '—'}
              icon={<Megaphone size={18} />}
              note="Platform-reported · not deduplicated admissions"
            />
            <Stat
              label="Cost per enquiry"
              value={paidEnquiries ? formatCurrency(spend / paidEnquiries) : '—'}
              icon={<MousePointer2 size={18} />}
              note="Spend ÷ attributed enquiries"
            />
          </div>
          <section className="panel perf-campaign-panel">
            <div className="panel-heading">
              <div>
                <h2>Know where your effort goes</h2>
                <p>Campaign-level results, kept in perspective.</p>
              </div>
            </div>
            <div className="perf-campaign-toolbar">
              <div className="search-field">
                <Search size={16} />
                <input
                  placeholder="Search campaigns…"
                  aria-label="Search campaigns"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <select
                className="select-compact"
                aria-label="Advertising platform"
                value={campaignFilter}
                onChange={(e) => setCampaignFilter(e.target.value)}
              >
                <option value="all">All platforms</option>
                <option>Meta Ads</option>
                <option>Google Ads</option>
              </select>
            </div>
            {campaigns.length ? (
              <div className="perf-table-wrap">
                <table className="perf-table">
                  <caption className="sr-only">Ad campaign performance, sample data</caption>
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Status</th>
                      <th>Spend</th>
                      <th>Impressions</th>
                      <th>Clicks</th>
                      <th>Enquiries</th>
                      <th>Cost / enquiry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((campaign) => (
                      <tr key={campaign.id}>
                        <td>
                          <span className="perf-campaign-name">{campaign.name}</span>
                          <span className="perf-campaign-platform">{campaign.platform}</span>
                        </td>
                        <td>
                          <Badge tone={campaign.status === 'active' ? 'green' : 'gray'}>
                            {campaign.status === 'active'
                              ? 'Active'
                              : campaign.status === 'paused'
                                ? 'Paused'
                                : 'Draft'}
                          </Badge>
                        </td>
                        <td>{formatCurrency(campaign.spend)}</td>
                        <td>{formatNumber(campaign.impressions)}</td>
                        <td>{formatNumber(campaign.clicks)}</td>
                        <td>{campaign.enquiries}</td>
                        <td>
                          {campaign.enquiries
                            ? formatCurrency(campaign.spend / campaign.enquiries)
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={<Megaphone size={28} />}
                title={
                  query ? 'No campaigns match that search' : 'Give your campaigns a clearer view'
                }
                description={
                  query
                    ? 'Try another name or platform.'
                    : 'Your ad accounts are not connected. Their real performance will appear after a reporting integration is configured.'
                }
                action={<Button onClick={() => navigate('settings')}>View connections</Button>}
              />
            )}
            <div className="perf-methodology">
              <CircleHelp size={15} />
              <p>
                Keep platform conversions separate from confirmed admissions. A parent may interact
                with more than one campaign.
              </p>
            </div>
          </section>
        </>
      )}
      {tab === 'search' && (
        <div className="perf-search">
          <section className="perf-search-intro">
            <span className="perf-search-orb">
              <Globe size={34} strokeWidth={1.3} />
            </span>
            <Badge tone="violet">Search & discovery</Badge>
            <h2>
              Be there when
              <br />
              parents are looking.
            </h2>
            <p>
              A clear view of search performance, website health and AI visibility. Connect your
              sources to start measuring.
            </p>
            <Button variant="primary" onClick={() => navigate('settings')}>
              <Link2 size={15} />
              View data sources
            </Button>
          </section>
          <div className="perf-search-cards">
            {[
              {
                title: 'Google Search Console',
                description: 'Search queries, page impressions, clicks and average position.',
                icon: Search,
              },
              {
                title: 'Website health',
                description: 'Technical issues, page performance and opportunities to improve.',
                icon: ChartNoAxesCombined,
              },
              {
                title: 'AI search visibility',
                description:
                  'Track a defined set of parent questions and the sources cited in sampled answers.',
                icon: Sparkles,
              },
            ].map(({ title, description, icon: Icon }) => (
              <div className="panel perf-search-card" key={title}>
                <span>
                  <Icon size={20} />
                </span>
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                  <Badge tone="gray">Not connected</Badge>
                </div>
                <button
                  className="icon-button"
                  aria-label={`View setup for ${title}`}
                  onClick={() => navigate('settings')}
                >
                  <ArrowUpRight size={16} />
                </button>
              </div>
            ))}
            <div className="perf-search-task">
              <div>
                <h3>Start with a useful next step.</h3>
                <p>Add an admissions-page review to your team’s task list.</p>
              </div>
              <Button size="sm" disabled={taskBusy} onClick={createSearchTask}>
                <Plus size={14} />
                {taskBusy ? 'Adding…' : 'Add review task'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  icon,
  note,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  note: string;
}) {
  return (
    <div className="panel perf-stat">
      <span className="perf-stat-icon">{icon}</span>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{note}</span>
    </div>
  );
}
