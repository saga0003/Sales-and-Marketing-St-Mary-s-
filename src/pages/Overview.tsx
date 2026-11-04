import { useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  Eye,
  FileCheck2,
  Lightbulb,
  MessageCircle,
  Plus,
  Radar,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Modal,
  PageHeading,
  PlatformIcon,
} from '../components/UI';
import { MiniBars, Sparkline, TrendChart } from '../components/Charts';
import PostPreview from '../components/PostPreview';
import type { Post } from '../lib/types';
import { downloadCsv, formatDate, formatNumber } from '../lib/utils';

export default function Overview() {
  const { data, navigate, openComposer, toast, selectedInstitution } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [period, setPeriod] = useState(7);
  const [metric, setMetric] = useState<'reach' | 'engagement' | 'enquiries'>('reach');
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date()),
  );
  const greeting =
    hour < 12 ? 'Good morning, team.' : hour < 17 ? 'Good afternoon, team.' : 'Good evening, team.';
  const scopedPosts = data.posts.filter(
    (p) => selectedInstitution === 'all' || p.institution === selectedInstitution,
  );
  const scopedConnections = data.connections.filter(
    (connection) => selectedInstitution === 'all' || connection.institution === selectedInstitution,
  );
  const connected = scopedConnections.filter((connection) => connection.status === 'connected');
  const pending = scopedPosts.filter((p) => p.status === 'in_review');
  const selected = pending.find((p) => p.id === selectedId) || pending[0];
  const reviewing = data.posts.find((p) => p.id === reviewId);
  const points = data.analytics.points.slice(-period);
  const reach = points.reduce((sum, p) => sum + p.reach, 0);
  const engagements = points.reduce((sum, p) => sum + p.engagement, 0);
  const enquiries = points.reduce((sum, p) => sum + p.enquiries, 0);
  const upcoming = scopedPosts
    .filter(
      (p) =>
        p.scheduledAt &&
        new Date(p.scheduledAt).getTime() >= Date.now() &&
        !['published', 'rejected'].includes(p.status),
    )
    .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))
    .slice(0, 3);
  const news = data.opportunities.filter((item) => item.status !== 'dismissed').slice(0, 3);
  const done = data.tasks.filter((task) => task.status === 'done').length;
  function exportReport() {
    if (!points.length) {
      toast('Connect an analytics source to export a report.', 'info');
      return;
    }
    downloadCsv('stmarys-workspace-report.csv', [
      [
        'Data type',
        data.analytics.sample
          ? 'Illustrative sample data — not live school results'
          : 'Live analytics',
      ],
      ['Date', 'Reach', 'Engagements', 'Enquiries'],
      ...points.map((p) => [p.date, p.reach, p.engagement, p.enquiries]),
    ]);
    toast('Your report is ready. Sample data is clearly labelled.');
  }
  function openContent() {
    navigate('content');
    window.location.hash = 'content?tab=approvals';
  }
  return (
    <div className="overview-page">
      <PageHeading
        eyebrow="A clear view. A confident next step."
        title={greeting}
        description="Your ideas, your channels, your next move. All in one place."
        actions={
          <>
            <Button onClick={exportReport}>
              <ArrowDownToLine size={15} />
              Export report
            </Button>
            <Button variant="primary" onClick={() => openComposer()}>
              <Plus size={16} />
              Create post
            </Button>
          </>
        }
      />
      <div className="overview-context">
        <div className="overview-scope">
          <span className="scope-symbol">
            <Users size={13} />
          </span>
          <span>{selectedInstitution === 'all' ? 'All institutions' : selectedInstitution}</span>
          <span className="context-divider" />
          <span>Admissions & community</span>
        </div>
        <label className="overview-period">
          <CalendarDays size={13} />
          <select
            aria-label="Overview reporting period"
            value={period}
            onChange={(e) => setPeriod(Number(e.target.value))}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </label>
      </div>
      <div className="workspace-setup-strip">
        <div>
          <strong>
            {connected.length
              ? `${connected.length} account${connected.length === 1 ? '' : 's'} connected`
              : 'Bring your accounts into the workspace'}
          </strong>
          <p>
            {connected.length
              ? 'Open Connections to check access, import website reports or manage publishing destinations.'
              : 'Authorize Google Analytics and an eligible Instagram account when you are ready. Your team can start drafting and reviewing now.'}
          </p>
        </div>
        <Button onClick={() => navigate('settings')}>
          {connected.length ? 'Manage connections' : 'Set up connections'}
          <ArrowRight size={14} />
        </Button>
      </div>
      <div className="metric-grid">
        <div className="metric-card">
          <div className="metric-label">
            Reported reach
            <span className="metric-icon metric-icon-violet">
              <Eye size={16} />
            </span>
          </div>
          <div className="metric-value">
            {points.length ? formatNumber(reach) : '—'}
            <span className="metric-unit">reported</span>
          </div>
          <p className="metric-caption">
            {data.analytics.sample ? (
              <>
                <span className="soft-dot" />
                Sum of daily figures · sample
              </>
            ) : (
              'Across your connected channels'
            )}
          </p>
          <Sparkline values={points.map((p) => p.reach)} filled />
        </div>
        <div className="metric-card">
          <div className="metric-label">
            Engagements / reach
            <span className="metric-icon metric-icon-peach">
              <TrendingUp size={16} />
            </span>
          </div>
          <div className="metric-value">
            {reach ? ((engagements / reach) * 100).toFixed(1) : '—'}
            <span className="metric-unit">{reach ? '%' : ''}</span>
          </div>
          <p className="metric-caption">
            {points.length
              ? `${formatNumber(engagements)} interactions ÷ summed reach`
              : 'Your first insights start with a connection'}
          </p>
          <MiniBars values={points.map((p) => p.engagement)} />
        </div>
        <div className="metric-card">
          <div className="metric-label">
            Parent enquiries
            <span className="metric-icon metric-icon-green">
              <MessageCircle size={16} />
            </span>
          </div>
          <div className="metric-value">
            {points.length ? formatNumber(enquiries) : '—'}
            <span className="metric-unit">enquiries</span>
          </div>
          <p className="metric-caption">
            {data.analytics.sample
              ? 'Sample enquiries · CRM not connected'
              : 'Connect your admissions CRM'}
          </p>
          <Sparkline values={points.map((p) => p.enquiries)} color="#80b9a1" filled />
        </div>
        <button className="metric-card metric-review" onClick={openContent}>
          <div className="metric-label">
            Waiting for your review
            <span className="metric-icon metric-icon-violet">
              <FileCheck2 size={16} />
            </span>
          </div>
          <div className="metric-value">
            {String(pending.length).padStart(2, '0')}
            <span className="metric-unit">posts</span>
          </div>
          <p className="metric-caption">
            {pending.length
              ? 'A little feedback goes a long way.'
              : 'A clear queue. A fresh start.'}
          </p>
          <div className="metric-review-bottom">
            <div className="avatar-group">
              {data.users.slice(0, 3).map((user) => (
                <Avatar key={user.id} name={user.name} size="sm" />
              ))}
            </div>
            <span>
              Open approvals
              <ArrowUpRight size={15} />
            </span>
          </div>
        </button>
      </div>
      <section className="review-stage" aria-labelledby="review-stage-title">
        <div className="review-stage-heading">
          <div>
            <div className="review-eyebrow">
              <span />
              YOUR TEAM’S NEXT CHAPTER
            </div>
            <h2 id="review-stage-title">Good ideas. Ready for your green light.</h2>
          </div>
          <button className="review-see-all" onClick={openContent}>
            Open review queue
            <ArrowUpRight size={16} />
          </button>
        </div>
        {selected ? (
          <div className="review-stage-body">
            <div className="review-queue">
              <div className="review-queue-heading">
                <span>Awaiting approval</span>
                <span>{pending.length}</span>
              </div>
              {pending.slice(0, 4).map((post) => (
                <button
                  key={post.id}
                  className={`review-queue-item ${post.id === selected.id ? 'selected' : ''}`}
                  onClick={() => setSelectedId(post.id)}
                  aria-pressed={post.id === selected.id}
                >
                  <div className={`review-thumb review-thumb-${post.palette}`}>
                    <span>{post.format === 'Reel' ? '▶' : 'M'}</span>
                  </div>
                  <div>
                    <strong>{post.title}</strong>
                    <span>
                      {post.format}
                      <i />
                      {post.institution.replace('St. Mary’s ', '')}
                    </span>
                  </div>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
            <div className={`review-feature review-feature-${selected.palette}`}>
              <div className="review-feature-top">
                <span className="review-feature-pill">
                  <Clock3 size={11} />
                  Ready for review
                </span>
                <span className="review-revision">v{selected.revision}</span>
              </div>
              <div className="review-feature-content">
                <div>
                  <h3>{selected.title}</h3>
                  <p>
                    {selected.caption.slice(0, 185)}
                    {selected.caption.length > 185 ? '…' : ''}
                  </p>
                  <div className="review-feature-platforms">
                    {selected.platforms.map((p) => (
                      <PlatformIcon key={p} platform={p} size={13} />
                    ))}
                    <span>{selected.language}</span>
                  </div>
                </div>
                <div className="review-feature-art" aria-hidden="true">
                  <div className="feature-art-orbit" />
                  <span>ST. MARY’S</span>
                  <strong>
                    Every great
                    <br />
                    future starts
                    <br />
                    <em>with a story.</em>
                  </strong>
                  <div className="feature-art-footer">
                    {selected.format.toUpperCase()}
                    <ArrowUpRight size={13} />
                  </div>
                </div>
              </div>
              <div className="review-feature-bottom">
                <div>
                  <Avatar name={selected.ownerName} size="sm" />
                  <span>
                    Prepared by <strong>{selected.ownerName}</strong>
                  </span>
                </div>
                <Button className="review-primary" onClick={() => setReviewId(selected.id)}>
                  Review draft
                  <ArrowRight size={14} />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="review-clear">
            <CheckCheck size={32} />
            <div>
              <h3>Your review queue is clear.</h3>
              <p>Create a draft or explore a new content opportunity.</p>
            </div>
            <Button className="review-primary" onClick={() => openComposer()}>
              <Plus size={14} />
              Create a draft
            </Button>
          </div>
        )}
      </section>
      <div className="overview-lower-grid">
        <section className="panel reach-panel">
          <div className="panel-heading">
            <div>
              <h2>A little progress, every day.</h2>
              <p>
                {data.analytics.sample
                  ? 'Sample performance · connect accounts for live results'
                  : 'Performance across your selected period'}
              </p>
            </div>
            <button
              className="icon-button"
              aria-label="Open performance dashboard"
              onClick={() => navigate('performance')}
            >
              <ArrowUpRight size={16} />
            </button>
          </div>
          <div className="chart-tabs" role="tablist" aria-label="Performance metric">
            {(['reach', 'engagement', 'enquiries'] as const).map((item) => (
              <button
                key={item}
                role="tab"
                aria-selected={metric === item}
                className={metric === item ? 'active' : ''}
                onClick={() => setMetric(item)}
              >
                <span />
                {item === 'engagement' ? 'Engagements' : item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          <div className="overview-chart">
            <TrendChart points={points} metric={metric} />
          </div>
          <div className="chart-footer">
            <span className="chart-footer-dot" />
            {points.length
              ? `${points.length} days of ${data.analytics.sample ? 'illustrative' : 'available'} data`
              : 'No analytics source connected'}
            <button onClick={() => navigate('performance')}>
              Explore analytics
              <ArrowRight size={12} />
            </button>
          </div>
        </section>
        <section className="panel upcoming-panel">
          <div className="panel-heading">
            <div>
              <h2>Coming up next</h2>
              <p>Your team’s content plan</p>
            </div>
            <CalendarDays size={17} className="muted" />
          </div>
          <div className="upcoming-list">
            {upcoming.length ? (
              upcoming.map((post) => (
                <button
                  key={post.id}
                  className="upcoming-item"
                  onClick={() => setReviewId(post.id)}
                >
                  <div className="upcoming-date">
                    <strong>
                      {formatDate(post.scheduledAt!, { day: '2-digit', month: undefined })}
                    </strong>
                    <span>{formatDate(post.scheduledAt!, { month: 'short', day: undefined })}</span>
                  </div>
                  <div>
                    <h3>{post.title}</h3>
                    <span>
                      {post.platforms.slice(0, 2).map((p) => (
                        <PlatformIcon platform={p} size={11} key={p} />
                      ))}
                      {formatDate(post.scheduledAt!, {
                        day: undefined,
                        month: undefined,
                        hour: 'numeric',
                        minute: '2-digit',
                      })}{' '}
                      IST
                    </span>
                  </div>
                  <ArrowUpRight size={13} />
                </button>
              ))
            ) : (
              <EmptyState
                title="Make space for a great story"
                description="Add a planned date to a draft to see it here."
              />
            )}
          </div>
          <div className="upcoming-note">
            <span />
            {connected.some((connection) => connection.provider === 'instagram')
              ? 'Only approved revisions with a publishing job are sent automatically'
              : 'Content plan · connect Instagram to publish approved posts'}
          </div>
          <button
            className="upcoming-calendar"
            onClick={() => {
              navigate('content');
              window.location.hash = 'content?tab=calendar';
            }}
          >
            Open content calendar
            <ArrowRight size={13} />
          </button>
        </section>
      </div>
      <div className="overview-bottom-grid">
        <section className="panel opportunities-panel">
          <div className="panel-heading">
            <div>
              <h2>Something worth talking about</h2>
              <p>Ideas and updates for your next piece of content</p>
            </div>
            <button className="text-link" onClick={() => navigate('intelligence')}>
              Explore
              <ArrowUpRight size={13} />
            </button>
          </div>
          <div className="opportunity-mini-list">
            {news.length ? (
              news.map((item) => (
                <button
                  key={item.id}
                  onClick={() => navigate('intelligence')}
                  className="opportunity-mini"
                >
                  <span
                    className={`opportunity-mini-icon ${item.category === 'Medical seats' ? 'sage' : ''}`}
                  >
                    {item.category === 'Medical seats' ? (
                      <Radar size={19} />
                    ) : (
                      <Lightbulb size={19} />
                    )}
                  </span>
                  <div>
                    <Badge tone={item.sourceKind === 'sample' ? 'gray' : 'violet'}>
                      {item.sourceKind === 'sample' ? 'Sample brief' : item.category}
                    </Badge>
                    <h3>{item.title}</h3>
                    <p>
                      {item.source} · {item.audience}
                    </p>
                  </div>
                  <ArrowUpRight size={16} />
                </button>
              ))
            ) : (
              <EmptyState
                icon={<Sparkles size={25} />}
                title="Your next idea is out there"
                description="Add your official sources and competitor profiles to get organised."
                action={
                  <Button onClick={() => navigate('intelligence')}>Explore intelligence</Button>
                }
              />
            )}
          </div>
        </section>
        <section className="team-card">
          <div className="team-card-top">
            <span className="team-card-icon">
              <Users size={21} />
            </span>
            <span>BETTER, TOGETHER</span>
          </div>
          <h2>
            A shared space.
            <br />A stronger team.
          </h2>
          <p>Keep your ideas, tasks and school knowledge close at hand.</p>
          <div className="team-progress">
            <span>
              <Check size={12} />
              {done} of {data.tasks.length} tasks complete
            </span>
            <div>
              <i
                style={{ width: `${data.tasks.length ? (done / data.tasks.length) * 100 : 0}%` }}
              />
            </div>
          </div>
          <button onClick={() => navigate('workspace')}>
            Visit your workspace
            <ArrowUpRight size={15} />
          </button>
        </section>
      </div>
      {reviewing && (
        <Modal
          title="Review this draft"
          className="overview-review-modal"
          onClose={() => setReviewId(null)}
        >
          <PostPreview
            post={reviewing as Post}
            onEdit={() => {
              setReviewId(null);
              openComposer(reviewing);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
