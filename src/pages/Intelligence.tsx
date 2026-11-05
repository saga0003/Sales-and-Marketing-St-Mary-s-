import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  ArrowRight,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileCheck2,
  Globe2,
  Lightbulb,
  Newspaper,
  Radio,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import type { Competitor, Opportunity, Platform, Source } from '../lib/types';
import { Badge, Button, Modal, PlatformIcon } from '../components/UI';
import '../styles/intelligence.css';
import Monitoring, { WatchConfigModal, type WatchTarget } from '../components/Monitoring';

type ResearchTab = 'monitoring' | 'discover' | 'competitors' | 'sources';
const readResearchTab = (): ResearchTab => {
  const value = new URLSearchParams(window.location.hash.split('?')[1]).get('tab');
  return value === 'opportunities'
    ? 'discover'
    : value === 'discover' || value === 'competitors' || value === 'sources'
      ? value
      : 'monitoring';
};
type OpportunityFilter = 'all' | 'saved' | 'unverified' | 'drafted' | 'dismissed';
type WatchEditor = { kind: 'competitor'; item?: Competitor } | { kind: 'source'; item?: Source };
type DeleteTarget = { kind: 'competitor' | 'source'; id: string; name: string };
type ManualBriefInput = Pick<
  Opportunity,
  | 'title'
  | 'summary'
  | 'source'
  | 'sourceUrl'
  | 'category'
  | 'audience'
  | 'contentAngle'
  | 'priority'
> & {
  sourceKind: 'official' | 'competitor';
  publishedAt?: string;
};

const platformLabels: Record<Platform | 'website', string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  google_business: 'Google Business',
  website: 'Website',
};
const categories = ['Exam update', 'Board update', 'Medical seats', 'Competitor', 'Content idea'];

function safeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function displayDate(value?: string | null) {
  if (!value) return 'Not reviewed yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      });
}

function hostname(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return 'Source link unavailable';
  }
}

function SourceLink({
  url,
  children,
  className = '',
}: {
  url: string;
  children: ReactNode;
  className?: string;
}) {
  const href = safeUrl(url);
  return href ? (
    <a
      className={`int-source-link ${className}`}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
      <ExternalLink size={13} aria-hidden="true" />
    </a>
  ) : (
    <span className="muted">Invalid source URL</span>
  );
}

export default function Intelligence() {
  const { data, mutate, toast, navigate } = useWorkspace();
  const [tab, setTab] = useState<ResearchTab>(readResearchTab);
  const [watchTarget, setWatchTarget] = useState<WatchTarget | null>(null);
  useEffect(() => {
    const changed = () => setTab(readResearchTab());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<OpportunityFilter>('all');
  const [category, setCategory] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [briefEditorOpen, setBriefEditorOpen] = useState(false);
  const [editor, setEditor] = useState<WatchEditor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const selected = data.opportunities.find((item) => item.id === selectedId);
  const isManager = data.user.role === 'manager';

  const visibleOpportunities = useMemo(
    () =>
      data.opportunities.filter((item) => {
        const matchesFilter =
          filter === 'all'
            ? item.status !== 'dismissed'
            : filter === 'unverified'
              ? !item.verified && item.status !== 'dismissed'
              : item.status === filter;
        return (
          matchesFilter &&
          (category === 'all' || item.category === category) &&
          `${item.title} ${item.summary} ${item.source} ${item.audience}`
            .toLowerCase()
            .includes(query.toLowerCase())
        );
      }),
    [data.opportunities, filter, category, query],
  );
  const visibleCompetitors = useMemo(
    () =>
      data.competitors.filter((item) =>
        `${item.name} ${item.platform} ${item.category} ${item.notes}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [data.competitors, query],
  );
  const visibleSources = useMemo(
    () =>
      data.sources.filter((item) =>
        `${item.name} ${item.category} ${item.url}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [data.sources, query],
  );
  const savedCount = data.opportunities.filter((item) => item.status === 'saved').length;
  const reviewCount = data.opportunities.filter(
    (item) => !item.verified && !['dismissed', 'drafted'].includes(item.status),
  ).length;

  function changeTab(next: ResearchTab) {
    setTab(next);
    window.location.hash = `intelligence?tab=${next}`;
    setQuery('');
  }
  function reportError(error: unknown) {
    toast(
      error instanceof Error ? error.message : 'Something went wrong. Please try again.',
      'error',
    );
  }

  async function updateOpportunity(
    item: Opportunity,
    change: Partial<Pick<Opportunity, 'status' | 'verified'>>,
  ) {
    if (busy) return;
    setBusy(item.id);
    try {
      await mutate(`/opportunities/${encodeURIComponent(item.id)}`, 'PATCH', change);
      if ('verified' in change)
        toast(
          change.verified ? 'Source marked as verified.' : 'Source needs review again.',
          'success',
        );
      else if (change.status === 'saved') toast('Saved to your ideas.', 'success');
      else if (change.status === 'dismissed') {
        setSelectedId(null);
        toast('Update dismissed. Find it in the Dismissed filter.', 'info');
      } else toast('Update moved to your research inbox.', 'success');
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(null);
    }
  }

  async function createDraft(item: Opportunity) {
    if (busy) return;
    setBusy(`draft-${item.id}`);
    try {
      await mutate(`/opportunities/${encodeURIComponent(item.id)}/draft`, 'POST', {});
      setSelectedId(null);
      toast('Content draft created. It is ready for your team to edit.', 'success');
      navigate('content');
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(null);
    }
  }

  async function removeWatch() {
    if (!deleteTarget || busy) return;
    setBusy('delete');
    try {
      await mutate(
        `/${deleteTarget.kind === 'source' ? 'sources' : 'competitors'}/${encodeURIComponent(deleteTarget.id)}`,
        'DELETE',
      );
      toast(`${deleteTarget.kind === 'source' ? 'Source' : 'Competitor'} removed.`, 'success');
      setDeleteTarget(null);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="int-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">LISTEN. LEARN. CREATE.</p>
          <h1 className="page-title">Intelligence</h1>
          <p className="page-description">Useful updates, fresh ideas, and a little perspective.</p>
        </div>
        {tab === 'discover' ? (
          <div className="int-page-actions">
            <div className="int-mode">
              <span className="int-status-dot" />
              Source-linked briefs
            </div>
            <Button variant="primary" onClick={() => setBriefEditorOpen(true)}>
              <Plus size={17} aria-hidden="true" />
              Add brief
            </Button>
          </div>
        ) : tab === 'monitoring' ? (
          <Button variant="primary" onClick={() => setBriefEditorOpen(true)}>
            <Plus size={17} />
            Add research brief
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() => setEditor({ kind: tab === 'sources' ? 'source' : 'competitor' })}
          >
            <Plus size={17} aria-hidden="true" />
            Add {tab === 'sources' ? 'source' : 'competitor'}
          </Button>
        )}
      </div>

      <div className="int-tabs-row">
        <div className="tabs" aria-label="Intelligence sections">
          {(
            [
              ['monitoring', 'Monitoring', Radio],
              ['discover', 'Research briefs', Lightbulb],
              ['competitors', 'Competitors', Users],
              ['sources', 'Sources', Globe2],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              className={`tab ${tab === key ? 'active' : ''}`}
              aria-pressed={tab === key}
              onClick={() => changeTab(key)}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
              {key === 'competitors' && (
                <span className="int-tab-count">{data.competitors.length}</span>
              )}
            </button>
          ))}
        </div>
        <p className="int-tabs-note">
          <ShieldCheck size={14} aria-hidden="true" />
          Evidence before publishing
        </p>
      </div>

      {tab === 'monitoring' ? (
        <Monitoring
          onOpenBrief={(id) => {
            changeTab('discover');
            if (id) setSelectedId(id);
          }}
          onAddReference={(kind) => {
            changeTab(kind === 'source' ? 'sources' : 'competitors');
            setEditor({ kind });
          }}
        />
      ) : tab === 'discover' ? (
        <>
          <div className="int-summary-grid">
            <div className="int-summary-card">
              <span className="int-summary-icon int-tint-violet">
                <Newspaper size={21} aria-hidden="true" />
              </span>
              <div>
                <span className="int-summary-number">{reviewCount}</span>
                <span className="int-summary-label">Updates to review</span>
              </div>
              <span className="int-summary-caption">Your next content starting point</span>
            </div>
            <div className="int-summary-card">
              <span className="int-summary-icon int-tint-peach">
                <Bookmark size={21} aria-hidden="true" />
              </span>
              <div>
                <span className="int-summary-number">{savedCount}</span>
                <span className="int-summary-label">Saved ideas</span>
              </div>
              <span className="int-summary-caption">Keep the promising ones close</span>
            </div>
            <div className="int-summary-card">
              <span className="int-summary-icon int-tint-sage">
                <Globe2 size={21} aria-hidden="true" />
              </span>
              <div>
                <span className="int-summary-number">{data.sources.length}</span>
                <span className="int-summary-label">Research sources</span>
              </div>
              <span className="int-summary-caption">A collection for your team</span>
            </div>
          </div>

          <div className="int-discover-layout">
            <section className="panel int-feed" aria-labelledby="research-inbox-heading">
              <div className="int-section-heading">
                <div>
                  <h2 id="research-inbox-heading">Your research inbox</h2>
                  <p>Find a useful update. Make it relevant to your community.</p>
                </div>
                <span className="int-result-count">
                  {visibleOpportunities.length}{' '}
                  {visibleOpportunities.length === 1 ? 'update' : 'updates'}
                </span>
              </div>
              <div className="int-filter-tabs" aria-label="Filter research updates">
                {(
                  [
                    ['all', 'All updates'],
                    ['saved', 'Saved'],
                    ['unverified', 'Needs review'],
                    ['drafted', 'Drafted'],
                    ['dismissed', 'Dismissed'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    className={filter === key ? 'active' : ''}
                    aria-pressed={filter === key}
                    key={key}
                    onClick={() => setFilter(key)}
                  >
                    {label}
                    {key === 'saved' && savedCount > 0 && <span>{savedCount}</span>}
                  </button>
                ))}
              </div>
              <div className="int-search-row">
                <label className="int-search">
                  <Search size={17} aria-hidden="true" />
                  <input
                    aria-label="Search updates"
                    placeholder="Search topics, exams, or sources…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button onClick={() => setQuery('')} aria-label="Clear search">
                      <X size={14} aria-hidden="true" />
                    </button>
                  )}
                </label>
                <select
                  className="select int-category-select"
                  aria-label="Filter by update category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="all">All topics</option>
                  {categories.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </div>
              <div className="int-opportunity-list">
                {visibleOpportunities.map((item) => (
                  <article className="int-opportunity" key={item.id}>
                    <div
                      className={`int-opportunity-icon ${item.category === 'Medical seats' ? 'int-tint-sage' : item.category === 'Content idea' ? 'int-tint-peach' : 'int-tint-violet'}`}
                    >
                      {item.category === 'Content idea' ? (
                        <Lightbulb size={21} aria-hidden="true" />
                      ) : item.category === 'Competitor' ? (
                        <Users size={21} aria-hidden="true" />
                      ) : (
                        <Newspaper size={21} aria-hidden="true" />
                      )}
                    </div>
                    <div className="int-opportunity-body">
                      <div className="int-opportunity-meta">
                        <span>{item.category}</span>
                        <span className="int-meta-dot">·</span>
                        <span>{displayDate(item.publishedAt)}</span>
                        {item.sourceKind === 'sample' && <Badge tone="gray">Example</Badge>}
                        {item.priority === 'high' && (
                          <span
                            className="int-priority-dot"
                            title="High priority"
                            aria-label="High priority"
                          />
                        )}
                      </div>
                      <button
                        className="int-opportunity-title"
                        onClick={() => setSelectedId(item.id)}
                      >
                        {item.title}
                      </button>
                      <p>{item.summary}</p>
                      <div className="int-opportunity-footer">
                        <span className="int-source-name">
                          <Globe2 size={12} aria-hidden="true" />
                          {item.source}
                        </span>
                        <span className={`int-verification ${item.verified ? 'is-verified' : ''}`}>
                          {item.verified ? (
                            <CheckCircle2 size={12} aria-hidden="true" />
                          ) : (
                            <FileCheck2 size={12} aria-hidden="true" />
                          )}
                          {item.verified ? 'Verified by team' : 'Needs source review'}
                        </span>
                        {item.status === 'drafted' && <Badge tone="violet">Draft created</Badge>}
                      </div>
                    </div>
                    <div className="int-opportunity-actions">
                      {['new', 'saved'].includes(item.status) && (
                        <button
                          className={`icon-button int-save ${item.status === 'saved' ? 'is-saved' : ''}`}
                          aria-label={
                            item.status === 'saved' ? `Unsave ${item.title}` : `Save ${item.title}`
                          }
                          aria-pressed={item.status === 'saved'}
                          disabled={!!busy}
                          onClick={() =>
                            updateOpportunity(item, {
                              status: item.status === 'saved' ? 'new' : 'saved',
                            })
                          }
                        >
                          <Bookmark
                            size={17}
                            aria-hidden="true"
                            fill={item.status === 'saved' ? 'currentColor' : 'none'}
                          />
                        </button>
                      )}
                      <button
                        className="icon-button"
                        aria-label={`View details for ${item.title}`}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <ChevronRight size={18} aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                ))}
                {visibleOpportunities.length === 0 && (
                  <div className="int-empty">
                    <Search size={29} aria-hidden="true" />
                    <h3>
                      {data.opportunities.length === 0
                        ? 'Start your research inbox'
                        : query || category !== 'all'
                          ? 'No matching updates'
                          : filter === 'saved'
                            ? 'A place for promising ideas'
                            : 'You’re all caught up'}
                    </h3>
                    <p>
                      {data.opportunities.length === 0
                        ? 'Read an original notice or public post, then add your own summary and source link for the team to review.'
                        : filter === 'saved'
                          ? 'Save an update with the bookmark button to keep it here.'
                          : 'Try a different filter or search term.'}
                    </p>
                    {data.opportunities.length === 0 && (
                      <Button variant="primary" size="sm" onClick={() => setBriefEditorOpen(true)}>
                        <Plus size={15} aria-hidden="true" />
                        Add your first brief
                      </Button>
                    )}
                    {(query || category !== 'all' || filter !== 'all') && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setQuery('');
                          setCategory('all');
                          setFilter('all');
                        }}
                      >
                        Clear filters
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </section>

            <aside className="int-sidebar">
              <div className="int-editorial-card">
                <span className="int-editorial-label">
                  <Sparkles size={15} aria-hidden="true" />A LITTLE DIRECTION
                </span>
                <h2>
                  Good content starts
                  <br />
                  with a useful insight.
                </h2>
                <p>
                  A verified exam update can become a reassuring reminder, a parent’s checklist, or
                  a helpful conversation.
                </p>
                <span className="int-editorial-divider" />
                <div className="int-editorial-bottom">
                  <span>
                    Be useful.
                    <br />
                    <strong>Build trust.</strong>
                  </span>
                  <span className="int-orbit">
                    <Lightbulb size={27} aria-hidden="true" />
                  </span>
                </div>
              </div>
              <div className="panel int-process-card">
                <h3>From source to story</h3>
                <ol>
                  <li>
                    <span>1</span>
                    <div>
                      <strong>Check the original</strong>
                      <p>Read the notice, date and any corrections.</p>
                    </div>
                  </li>
                  <li>
                    <span>2</span>
                    <div>
                      <strong>Verify the details</strong>
                      <p>A manager marks the evidence as reviewed.</p>
                    </div>
                  </li>
                  <li>
                    <span>3</span>
                    <div>
                      <strong>Create your draft</strong>
                      <p>Your team edits. You approve before it is posted.</p>
                    </div>
                  </li>
                </ol>
              </div>
              <div className="int-manual-note">
                <span className="int-status-dot" />
                <p>
                  <strong>Research is manual for now.</strong> Sources and profiles are saved for
                  review. Automatic monitoring starts only after a worker is connected.
                </p>
              </div>
            </aside>
          </div>
        </>
      ) : (
        <>
          <div className="panel int-watch-banner">
            <div className="int-summary-icon int-tint-violet">
              {tab === 'competitors' ? (
                <Users size={22} aria-hidden="true" />
              ) : (
                <ShieldCheck size={22} aria-hidden="true" />
              )}
            </div>
            <div>
              <h2>
                {tab === 'competitors'
                  ? 'Keep your reference points close.'
                  : 'Start with the original source.'}
              </h2>
              <p>
                {tab === 'competitors'
                  ? 'Collect channels, profiles and websites your team wants to review.'
                  : 'Build a reliable collection of exam, board and counselling authorities.'}{' '}
                Configure a supported watch to check for updates automatically. Other profiles
                remain available for manual review.
              </p>
            </div>
            <Button size="sm" onClick={() => changeTab('monitoring')}>
              Open monitoring <ArrowRight size={15} />
            </Button>
          </div>
          <section
            className="panel int-watch-panel"
            aria-label={
              tab === 'competitors' ? 'Competitor watchlist' : 'Official source collection'
            }
          >
            <div className="int-watch-toolbar">
              <div>
                <h2>{tab === 'competitors' ? 'Your watchlist' : 'Source collection'}</h2>
                <p>
                  {tab === 'competitors'
                    ? `${data.competitors.length} profiles and channels`
                    : `${data.sources.length} research sources`}
                </p>
              </div>
              <label className="int-search">
                <Search size={17} aria-hidden="true" />
                <input
                  aria-label={tab === 'competitors' ? 'Search competitors' : 'Search sources'}
                  placeholder={tab === 'competitors' ? 'Search your watchlist…' : 'Search sources…'}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </div>
            {tab === 'competitors' ? (
              <div className="int-watch-grid">
                {visibleCompetitors.map((item) => (
                  <article className="int-watch-card" key={item.id}>
                    <div className="int-watch-top">
                      <span className="int-watch-avatar">
                        {item.platform === 'website' ? (
                          <Globe2 size={21} aria-hidden="true" />
                        ) : (
                          <PlatformIcon platform={item.platform} size={22} />
                        )}
                      </span>
                      <div className="int-watch-actions">
                        <button
                          className="icon-button"
                          aria-label={`Edit ${item.name}`}
                          onClick={() => setEditor({ kind: 'competitor', item })}
                        >
                          <Pencil size={15} aria-hidden="true" />
                        </button>
                        <button
                          className="icon-button int-delete-icon"
                          aria-label={`Remove ${item.name}`}
                          onClick={() =>
                            setDeleteTarget({ kind: 'competitor', id: item.id, name: item.name })
                          }
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    <h3>{item.name}</h3>
                    <div className="int-watch-subtitle">
                      {platformLabels[item.platform]}
                      <span>·</span>
                      {item.category || 'General'}
                      {item.sample && <Badge tone="gray">Example</Badge>}
                    </div>
                    <p className="int-watch-notes">
                      {item.notes ||
                        'Add notes about the topics, formats or audience you want to learn from.'}
                    </p>
                    <SourceLink url={item.url}>
                      Open {item.platform === 'website' ? 'website' : 'profile'}
                    </SourceLink>
                    {isManager && ['youtube', 'website'].includes(item.platform) && (
                      <Button
                        size="sm"
                        onClick={() => setWatchTarget({ kind: 'competitor', resourceId: item.id })}
                      >
                        <Radio size={15} />
                        {data.intelligence.watches.some((watch) => watch.resourceId === item.id)
                          ? 'Watch settings'
                          : 'Configure monitoring'}
                      </Button>
                    )}
                    <div className="int-watch-bottom">
                      <Badge
                        tone={
                          data.intelligence.watches.some(
                            (watch) => watch.resourceId === item.id && watch.active,
                          )
                            ? 'green'
                            : 'gray'
                        }
                      >
                        {data.intelligence.watches.some(
                          (watch) => watch.resourceId === item.id && watch.active,
                        )
                          ? 'Watch configured'
                          : 'Manual review'}
                      </Badge>
                      <span>
                        {item.lastCheckedAt
                          ? `Reviewed ${displayDate(item.lastCheckedAt)}`
                          : 'No review recorded'}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="int-sources-list">
                {visibleSources.map((item) => (
                  <article className="int-source-row" key={item.id}>
                    <span className="int-source-row-icon">
                      <Globe2 size={20} aria-hidden="true" />
                    </span>
                    <div className="int-source-row-main">
                      <h3>{item.name}</h3>
                      <SourceLink url={item.url}>{hostname(item.url)}</SourceLink>
                    </div>
                    <span className="int-source-category">{item.category}</span>
                    <Badge
                      tone={
                        data.intelligence.watches.some(
                          (watch) => watch.resourceId === item.id && watch.active,
                        )
                          ? 'green'
                          : 'gray'
                      }
                    >
                      {data.intelligence.watches.some(
                        (watch) => watch.resourceId === item.id && watch.active,
                      )
                        ? 'Watch configured'
                        : 'Manual review'}
                    </Badge>
                    {isManager && (
                      <Button
                        size="sm"
                        onClick={() => setWatchTarget({ kind: 'source', resourceId: item.id })}
                      >
                        <Radio size={15} />
                        Watch
                      </Button>
                    )}
                    <div className="int-watch-actions">
                      <button
                        className="icon-button"
                        aria-label={`Edit ${item.name}`}
                        onClick={() => setEditor({ kind: 'source', item })}
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                      <button
                        className="icon-button int-delete-icon"
                        aria-label={`Remove ${item.name}`}
                        onClick={() =>
                          setDeleteTarget({ kind: 'source', id: item.id, name: item.name })
                        }
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {(tab === 'competitors' ? visibleCompetitors.length : visibleSources.length) === 0 && (
              <div className="int-empty">
                <Globe2 size={30} aria-hidden="true" />
                <h3>
                  {query
                    ? 'No matches found'
                    : tab === 'competitors'
                      ? 'Build your first watchlist'
                      : 'Add your first research source'}
                </h3>
                <p>
                  {query
                    ? 'Try a different name, topic or platform.'
                    : 'Save a public URL and give your team a starting point.'}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    query
                      ? setQuery('')
                      : setEditor({ kind: tab === 'competitors' ? 'competitor' : 'source' })
                  }
                >
                  {query ? 'Clear search' : tab === 'competitors' ? 'Add competitor' : 'Add source'}
                </Button>
              </div>
            )}
          </section>
        </>
      )}

      {selected && (
        <Modal
          title="Review an insight"
          onClose={() => setSelectedId(null)}
          className="int-detail-modal"
        >
          <div className="int-detail">
            <div className="int-detail-badges">
              <Badge tone="violet">{selected.category}</Badge>
              <Badge tone={selected.verified ? 'green' : 'amber'}>
                {selected.verified ? 'Verified by team' : 'Needs source review'}
              </Badge>
              {selected.sourceKind === 'sample' && <Badge tone="gray">Example content</Badge>}
            </div>
            <h2>{selected.title}</h2>
            <p className="int-detail-summary">{selected.summary}</p>
            <div className="int-evidence">
              <div className="int-evidence-heading">
                <ShieldCheck size={18} aria-hidden="true" />
                <strong>Source evidence</strong>
              </div>
              <dl>
                <div>
                  <dt>Publisher</dt>
                  <dd>{selected.source}</dd>
                </div>
                <div>
                  <dt>Source / reference date</dt>
                  <dd>{displayDate(selected.publishedAt)}</dd>
                </div>
                <div>
                  <dt>Source classification</dt>
                  <dd>
                    {selected.sourceKind === 'official'
                      ? 'Official source'
                      : selected.sourceKind === 'competitor'
                        ? 'Competitor source'
                        : 'Illustrative example'}
                  </dd>
                </div>
                <div>
                  <dt>Audience</dt>
                  <dd>{selected.audience}</dd>
                </div>
              </dl>
              <SourceLink url={selected.sourceUrl}>Read the original source</SourceLink>
              <p className="int-evidence-note">
                {selected.category === 'Medical seats'
                  ? 'Confirm the academic year, approval status, course and counselling round. Proposed colleges or seats are not approved additions.'
                  : 'Check the original notice and any revised dates or corrections before marking this update as verified.'}
              </p>
            </div>
            <div className="int-angle">
              <Lightbulb size={20} aria-hidden="true" />
              <div>
                <h3>A useful content angle</h3>
                <p>{selected.contentAngle}</p>
              </div>
            </div>
            <div className="int-verify-control">
              {isManager ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => updateOpportunity(selected, { verified: !selected.verified })}
                >
                  <CheckCircle2 size={15} aria-hidden="true" />
                  {selected.verified ? 'Mark for review' : 'Mark source as verified'}
                </Button>
              ) : (
                <p>
                  <ShieldCheck size={16} aria-hidden="true" />A manager can verify this source.
                </p>
              )}
              <span>Verification records a human review.</span>
            </div>
            <div className="int-detail-footer">
              <div>
                {['new', 'saved'].includes(selected.status) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!!busy}
                    onClick={() =>
                      updateOpportunity(selected, {
                        status: selected.status === 'saved' ? 'new' : 'saved',
                      })
                    }
                  >
                    <Bookmark size={16} aria-hidden="true" />
                    {selected.status === 'saved' ? 'Unsave' : 'Save idea'}
                  </Button>
                )}
                {selected.status !== 'drafted' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!!busy}
                    onClick={() =>
                      updateOpportunity(selected, {
                        status: selected.status === 'dismissed' ? 'new' : 'dismissed',
                      })
                    }
                  >
                    {selected.status === 'dismissed' ? 'Restore' : 'Dismiss'}
                  </Button>
                )}
              </div>
              <Button
                variant="primary"
                disabled={!!busy || selected.status === 'drafted'}
                onClick={() => createDraft(selected)}
              >
                {selected.status === 'drafted' ? (
                  <Check size={16} aria-hidden="true" />
                ) : (
                  <Plus size={16} aria-hidden="true" />
                )}
                {busy === `draft-${selected.id}`
                  ? 'Creating draft…'
                  : selected.status === 'drafted'
                    ? 'Draft created'
                    : 'Create content draft'}
                {selected.status !== 'drafted' && <ArrowRight size={15} aria-hidden="true" />}
              </Button>
            </div>
            <p className="int-draft-note">
              A draft still needs editing and manager approval before publishing.
            </p>
          </div>
        </Modal>
      )}

      {briefEditorOpen && (
        <BriefEditorModal
          onClose={() => setBriefEditorOpen(false)}
          onSave={async (body) => {
            const created = await mutate<Opportunity>('/opportunities', 'POST', body);
            setBriefEditorOpen(false);
            setTab('discover');
            setQuery('');
            setCategory('all');
            setFilter('all');
            setSelectedId(created.id);
            toast(
              'Brief added. Review the original source before marking it as verified.',
              'success',
            );
          }}
        />
      )}
      {watchTarget && (
        <WatchConfigModal
          target={watchTarget}
          watch={data.intelligence.watches.find(
            (watch) =>
              watch.resourceId === watchTarget.resourceId && watch.kind === watchTarget.kind,
          )}
          onClose={() => setWatchTarget(null)}
          onAdded={() => {
            setWatchTarget(null);
            changeTab('monitoring');
          }}
          onAddReference={(kind) => {
            setWatchTarget(null);
            setEditor({ kind });
          }}
        />
      )}
      {editor && (
        <WatchEditorModal
          key={`${editor.kind}-${editor.item?.id || 'new'}`}
          editor={editor}
          onClose={() => setEditor(null)}
          onSave={async (body) => {
            const base = editor.kind === 'competitor' ? '/competitors' : '/sources';
            await mutate(
              editor.item ? `${base}/${encodeURIComponent(editor.item.id)}` : base,
              editor.item ? 'PATCH' : 'POST',
              body,
            );
            toast(
              `${editor.kind === 'competitor' ? 'Competitor' : 'Source'} ${editor.item ? 'updated' : 'added'}.`,
              'success',
            );
            setEditor(null);
          }}
          onError={reportError}
        />
      )}
      {deleteTarget && (
        <Modal
          title={`Remove ${deleteTarget.kind}?`}
          onClose={() => !busy && setDeleteTarget(null)}
        >
          <p className="int-confirm-copy">
            Remove <strong>{deleteTarget.name}</strong> from your{' '}
            {deleteTarget.kind === 'source' ? 'source collection' : 'watchlist'}? Existing content
            drafts will stay in your workspace.
          </p>
          <div className="int-modal-actions">
            <Button variant="secondary" disabled={!!busy} onClick={() => setDeleteTarget(null)}>
              Keep it
            </Button>
            <Button variant="danger" disabled={!!busy} onClick={removeWatch}>
              {busy === 'delete' ? 'Removing…' : 'Remove'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function BriefEditorModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (body: ManualBriefInput) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [source, setSource] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceKind, setSourceKind] = useState<ManualBriefInput['sourceKind']>('official');
  const [category, setCategory] = useState<Opportunity['category']>('Exam update');
  const [priority, setPriority] = useState<Opportunity['priority']>('medium');
  const [sourceDate, setSourceDate] = useState('');
  const [audience, setAudience] = useState('');
  const [contentAngle, setContentAngle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError('');
    if ([title, summary, source, audience, contentAngle].some((value) => !value.trim())) {
      setError('Add a title, your summary, the publisher, the audience and a content angle.');
      return;
    }
    const validUrl = safeUrl(sourceUrl.trim());
    if (!validUrl) {
      setError('Add a complete https:// or http:// source URL without embedded credentials.');
      return;
    }
    let publishedAt: string | undefined;
    if (sourceDate) {
      const date = new Date(`${sourceDate}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== sourceDate) {
        setError('Choose a valid source date, or leave it blank to use today as a reference.');
        return;
      }
      publishedAt = date.toISOString();
    }
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        summary: summary.trim(),
        source: source.trim(),
        sourceUrl: validUrl,
        sourceKind,
        category,
        priority,
        audience: audience.trim(),
        contentAngle: contentAngle.trim(),
        ...(publishedAt ? { publishedAt } : {}),
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not save this brief. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Add a research brief"
      onClose={() => !saving && onClose()}
      className="int-brief-modal"
    >
      <form className="int-watch-form int-brief-form" onSubmit={submit}>
        <div className="int-form-note int-brief-intro">
          <FileCheck2 size={18} aria-hidden="true" />
          <p>
            Read the original source, then write your own brief. Saving it does not fetch the page,
            generate a summary or verify the facts.
          </p>
        </div>
        <label className="field">
          <span>Brief title</span>
          <input
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What should the team pay attention to?"
            required
            maxLength={180}
            autoFocus
          />
        </label>
        <label className="field">
          <span>Your summary</span>
          <textarea
            className="input"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="Describe what the source says, who it affects and any dates or details that need checking."
            required
            rows={4}
            maxLength={6000}
          />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Publisher or source name</span>
            <input
              className="input"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="e.g. National Testing Agency"
              required
              maxLength={180}
            />
          </label>
          <label className="field">
            <span>Source type</span>
            <select
              className="select"
              value={sourceKind}
              onChange={(event) =>
                setSourceKind(event.target.value as ManualBriefInput['sourceKind'])
              }
              aria-describedby="int-source-classification-note"
            >
              <option value="official">Official source</option>
              <option value="competitor">Competitor source</option>
            </select>
          </label>
        </div>
        <p id="int-source-classification-note" className="int-brief-helper">
          This is your classification. Every new brief starts unverified and awaits a manager’s
          source review.
        </p>
        <label className="field">
          <span>Original source URL</span>
          <input
            className="input"
            type="url"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="https://"
            required
            maxLength={2048}
          />
          <small>Link directly to the notice, PDF or public post you read.</small>
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Topic</span>
            <select
              className="select"
              value={category}
              onChange={(event) => setCategory(event.target.value as Opportunity['category'])}
            >
              {categories.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Priority</span>
            <select
              className="select"
              value={priority}
              onChange={(event) => setPriority(event.target.value as Opportunity['priority'])}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>Audience</span>
            <input
              className="input"
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
              placeholder="e.g. Grade 12 students and parents"
              required
              maxLength={300}
            />
          </label>
          <label className="field">
            <span>
              Source date <span className="int-brief-optional">(optional)</span>
            </span>
            <input
              className="input"
              type="date"
              value={sourceDate}
              onChange={(event) => setSourceDate(event.target.value)}
              aria-describedby="int-source-date-note"
            />
          </label>
        </div>
        <p id="int-source-date-note" className="int-brief-helper">
          Use the date on the original source. If unknown, leave it blank; today will be used as the
          brief’s reference date, not a confirmed publication date.
        </p>
        <label className="field">
          <span>Suggested content angle</span>
          <textarea
            className="input"
            value={contentAngle}
            onChange={(event) => setContentAngle(event.target.value)}
            placeholder="How could this help your school community? For example, a parent checklist or a reminder to check the official notice."
            required
            rows={3}
            maxLength={2000}
          />
        </label>
        {category === 'Medical seats' && (
          <div className="int-form-note">
            <ShieldCheck size={17} aria-hidden="true" />
            <p>
              Separate proposed seats from approved intake and counselling-round availability.
              Record the academic year and course in your summary.
            </p>
          </div>
        )}
        {error && (
          <p className="int-form-error int-brief-error" role="alert">
            {error}
          </p>
        )}
        <div className="int-modal-actions">
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={saving}>
            <Plus size={16} aria-hidden="true" />
            {saving ? 'Saving brief…' : 'Save brief for review'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function WatchEditorModal({
  editor,
  onClose,
  onSave,
  onError,
}: {
  editor: WatchEditor;
  onClose: () => void;
  onSave: (body: unknown) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState(editor.item?.name || '');
  const [url, setUrl] = useState(editor.item?.url || '');
  const [category, setCategory] = useState(
    editor.item?.category || (editor.kind === 'source' ? 'Exam updates' : 'Education'),
  );
  const [platform, setPlatform] = useState<Platform | 'website'>(
    editor.kind === 'competitor' ? editor.item?.platform || 'instagram' : 'website',
  );
  const [notes, setNotes] = useState(editor.kind === 'competitor' ? editor.item?.notes || '' : '');
  const [paused, setPaused] = useState(
    editor.kind === 'competitor'
      ? editor.item?.monitoringStatus === 'paused'
      : editor.item?.status === 'paused',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!name.trim() || !safeUrl(url.trim())) {
      setError('Add a name and a valid public https:// or http:// URL.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({
        name: name.trim(),
        url: url.trim(),
        category: category.trim(),
        ...(editor.kind === 'competitor'
          ? { platform, notes: notes.trim(), monitoringStatus: paused ? 'paused' : 'manual' }
          : { status: paused ? 'paused' : 'manual' }),
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not save this entry. Please try again.',
      );
      onError(caught);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={`${editor.item ? 'Edit' : 'Add'} ${editor.kind === 'competitor' ? 'competitor' : 'source'}`}
      onClose={() => !saving && onClose()}
    >
      <form className="int-watch-form" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              editor.kind === 'source' ? 'e.g. NTA public notices' : 'School or channel name'
            }
            required
            maxLength={150}
            autoFocus
          />
        </label>
        <label className="field">
          <span>Public URL</span>
          <input
            className="input"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            required
            maxLength={2000}
          />
          <small className="muted">
            Use a direct link to the profile, channel or notices page.
          </small>
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Category</span>
            <input
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Board updates"
              maxLength={80}
              required={editor.kind === 'source'}
            />
          </label>
          {editor.kind === 'competitor' && (
            <label className="field">
              <span>Platform</span>
              <select
                className="select"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as Platform | 'website')}
              >
                {Object.entries(platformLabels).map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {editor.kind === 'competitor' && (
          <label className="field">
            <span>What should your team look for?</span>
            <textarea
              className="input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Topics, creative formats, parent questions…"
            />
          </label>
        )}
        {editor.item && (
          <label className="int-checkbox">
            <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
            <span>
              Pause this {editor.kind === 'source' ? 'source' : 'profile'} in the review list
            </span>
          </label>
        )}
        <div className="int-form-note">
          <Globe2 size={16} aria-hidden="true" />
          <p>
            This saves the reference. A manager can configure supported automatic checks from its
            Watch button or the Monitoring tab.
          </p>
        </div>
        {error && (
          <p className="int-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="int-modal-actions">
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : editor.item ? 'Save changes' : `Add ${editor.kind}`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
