import { useMemo, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Check,
  Clock3,
  FileText,
  Globe2,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import type { IntelligenceNotice, IntelligenceWatch } from '../lib/types';
import { formatDate } from '../lib/utils';
import { Badge, Button, EmptyState, Modal } from './UI';
import { YoutubePushControl } from './YoutubePushControl';
import '../styles/monitoring.css';

const stamp = (value: string | null) =>
  value
    ? `${formatDate(value, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} IST`
    : 'Not checked yet';
const safeUrl = (value: string) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'The monitoring action could not be completed.';
export interface WatchTarget {
  kind: 'source' | 'competitor';
  resourceId: string;
}

export default function Monitoring({
  onOpenBrief,
  onAddReference,
  onOpenResearch,
}: {
  onOpenBrief: (id?: string) => void;
  onAddReference: (kind: 'source' | 'competitor') => void;
  onOpenResearch?: () => void;
}) {
  const { data, mutate, refresh, toast } = useWorkspace();
  const [section, setSection] = useState<'inbox' | 'watches' | 'catalog'>('inbox');
  const [status, setStatus] = useState('new');
  const [kind, setKind] = useState('all');
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<{ watch?: IntelligenceWatch } | null>(null);
  const [deleteWatch, setDeleteWatch] = useState<IntelligenceWatch | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const info = data.intelligence;
  const manager = data.user.role === 'manager';
  const notices = info.notices.filter(
    (item) =>
      (status === 'all' || item.status === status) &&
      (kind === 'all' || item.kind === kind) &&
      `${item.title} ${item.excerpt} ${item.watchName}`.toLowerCase().includes(query.toLowerCase()),
  );
  const newCount = info.notices.filter((item) => item.status === 'new').length;
  async function action(path: string, method: string, body?: unknown, success?: string) {
    setBusy(path);
    setError('');
    try {
      const result = await mutate(path, method, body);
      if (success) toast(success);
      return result;
    } catch (caught) {
      setError(message(caught));
      return null;
    } finally {
      setBusy('');
    }
  }
  async function run(watch: IntelligenceWatch) {
    const result = (await action(`/intelligence/watches/${watch.id}/run`, 'POST', {})) as {
      added: number;
      updated: number;
      baseline?: boolean;
      skipped?: boolean;
    } | null;
    if (result)
      toast(
        result.skipped
          ? 'This watch is already being checked or is not due yet.'
          : result.baseline
            ? `First scan saved ${result.added} existing items as a baseline.`
            : `Check complete: ${result.added} discovered and ${result.updated} updated items.`,
      );
  }
  async function brief(notice: IntelligenceNotice) {
    const result = (await action(`/intelligence/notices/${notice.id}/brief`, 'POST', {})) as {
      opportunity?: { id: string };
    } | null;
    if (result?.opportunity) {
      toast('Research brief created. Verify its source and facts before drafting.');
      onOpenBrief(result.opportunity.id);
    }
  }
  return (
    <div className="monitoring-page">
      <section className="monitoring-intro">
        <div>
          <span className="eyebrow">USEFUL UPDATES, WITH THEIR SOURCES</span>
          <h2>Watch what matters to your school.</h2>
          <p>
            Collect official notices and public channel uploads, then turn verified information into
            content your team can review.
          </p>
        </div>
        <div className="monitoring-intro-actions">
          {manager && (
            <Button onClick={() => setEditor({})}>
              <Plus size={16} />
              Add watch
            </Button>
          )}
          <Button
            disabled={!!busy}
            onClick={async () => {
              setBusy('refresh');
              try {
                await refresh();
              } catch (caught) {
                setError(message(caught));
              } finally {
                setBusy('');
              }
            }}
          >
            <RefreshCw size={16} className={busy === 'refresh' ? 'spin' : ''} />
            Refresh inbox
          </Button>
        </div>
      </section>
      <div className="monitoring-stats">
        <div>
          <strong>{newCount}</strong>
          <span>Items to review</span>
        </div>
        <div>
          <strong>{info.watches.filter((item) => item.active).length}</strong>
          <span>Active watches</span>
        </div>
        <div>
          <strong>{info.watches.filter((item) => item.status === 'error').length}</strong>
          <span>Need attention</span>
        </div>
        <div>
          <Badge tone={info.automation.enabled ? 'green' : 'amber'}>
            {info.automation.enabled ? 'Scheduled checks enabled' : 'Manual runs available'}
          </Badge>
          <small>Each watch uses its own interval</small>
        </div>
      </div>
      {onOpenResearch && (
        <div className="iv4-notice">
          <Globe2 size={20} />
          <div>
            <p>
              <strong>Track more than notice links.</strong> Compare public webpage text, request
              Google Business or social-profile research, and keep dated evidence in the research
              queue.
            </p>
            <Button size="sm" onClick={onOpenResearch}>
              Open research queue <ArrowRight size={15} />
            </Button>
          </div>
        </div>
      )}
      <div className="toolbar monitoring-toolbar">
        <div className="tabs" aria-label="Monitoring sections">
          {[
            { id: 'inbox', label: 'Notice inbox' },
            { id: 'watches', label: 'Your watches' },
            { id: 'catalog', label: 'Official source catalog' },
          ].map((item) => (
            <button
              type="button"
              key={item.id}
              className={`tab ${section === item.id ? 'active' : ''}`}
              aria-pressed={section === item.id}
              onClick={() => setSection(item.id as typeof section)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {section === 'watches' && manager && (
          <Button
            disabled={!!busy}
            size="sm"
            onClick={() =>
              void action(
                '/intelligence/run',
                'POST',
                {},
                'Due watches checked. Each run processes a small batch.',
              )
            }
          >
            <Play size={15} />
            Check due watches
          </Button>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {section === 'inbox' && (
        <>
          <div className="monitoring-filter-row">
            <label className="search-field">
              <Search size={17} />
              <input
                aria-label="Search detected notices"
                placeholder="Search exams, boards, colleges, or topics…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <select
              aria-label="Filter notices by source type"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="all">Sources & competitors</option>
              <option value="source">Official/source notices</option>
              <option value="competitor">Competitor uploads</option>
            </select>
            <select
              aria-label="Filter notices by status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="new">New to review</option>
              <option value="saved">Saved</option>
              <option value="dismissed">Dismissed</option>
              <option value="all">All notices</option>
            </select>
          </div>
          <p className="monitoring-evidence-note">
            <ShieldCheck size={16} />
            Detection is not verification. The first scan is a baseline; always check the original
            notice before using an exam date or seat count.
          </p>
          {notices.length ? (
            <div className="notice-list">
              {notices.map((notice) => (
                <article className="panel notice-card" key={notice.id}>
                  <div className="notice-meta">
                    <Badge tone={notice.kind === 'competitor' ? 'violet' : 'green'}>
                      {notice.kind === 'competitor' ? 'Competitor' : 'Source notice'}
                    </Badge>
                    <span>{notice.watchName}</span>
                    {notice.baseline ? (
                      <Badge>First-scan baseline</Badge>
                    ) : notice.changeKind === 'updated' ? (
                      <Badge tone="amber">Changed item</Badge>
                    ) : (
                      <Badge tone="violet">Newly detected</Badge>
                    )}
                  </div>
                  <h3>
                    <a href={safeUrl(notice.url)} target="_blank" rel="noreferrer">
                      {notice.title}
                      <ArrowUpRight size={17} />
                    </a>
                  </h3>
                  {notice.excerpt && <p>{notice.excerpt}</p>}
                  <div className="notice-dates">
                    <span>Detected {stamp(notice.detectedAt)}</span>
                    <span>
                      {notice.publishedAt
                        ? `Publisher date: ${stamp(notice.publishedAt)}`
                        : 'Publisher date not supplied'}
                    </span>
                  </div>
                  <div className="notice-actions">
                    <a
                      className="text-link"
                      href={safeUrl(notice.url)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open original source <ArrowUpRight size={15} />
                    </a>
                    <div>
                      {notice.opportunityId ? (
                        <Button size="sm" onClick={() => onOpenBrief(notice.opportunityId!)}>
                          <FileText size={15} />
                          Open research brief
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={!!busy}
                          onClick={() => void brief(notice)}
                        >
                          <Plus size={15} />
                          Create brief
                        </Button>
                      )}
                      <Button
                        size="sm"
                        disabled={!!busy}
                        onClick={() =>
                          void action(`/intelligence/notices/${notice.id}`, 'PATCH', {
                            status: notice.status === 'saved' ? 'new' : 'saved',
                          })
                        }
                      >
                        {notice.status === 'saved' ? <Check size={15} /> : <Bookmark size={15} />}
                        {notice.status === 'saved' ? 'Saved' : 'Save'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!!busy}
                        onClick={() =>
                          void action(`/intelligence/notices/${notice.id}`, 'PATCH', {
                            status: notice.status === 'dismissed' ? 'new' : 'dismissed',
                          })
                        }
                      >
                        {notice.status === 'dismissed' ? 'Restore' : 'Dismiss'}
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <section className="panel">
              <EmptyState
                icon={<Radio size={29} />}
                title={
                  info.watches.length
                    ? 'No notices match this view'
                    : 'Start with one useful source'
                }
                description={
                  info.watches.length
                    ? 'Try another filter, or check a watch to import its current notices. Failed sources show their reason under Your watches.'
                    : 'Add an official source from the catalog or configure a saved YouTube channel. The first scan records existing items as a baseline.'
                }
                action={
                  <Button onClick={() => setSection(info.watches.length ? 'watches' : 'catalog')}>
                    {info.watches.length ? 'View watches' : 'Browse official sources'}
                    <ArrowRight size={16} />
                  </Button>
                }
              />
            </section>
          )}
        </>
      )}
      {section === 'watches' && (
        <>
          <p className="monitoring-evidence-note">
            <Clock3 size={16} />
            Checks run at the watch’s interval. Busy sources, access restrictions, or provider
            limits can delay a run; the last successful check remains visible.
          </p>
          {info.watches.length ? (
            <div className="monitoring-watch-grid">
              {info.watches.map((watch) => (
                <article className="panel monitoring-watch" key={watch.id}>
                  <div className="monitoring-watch-heading">
                    <div>
                      <h3>{watch.name}</h3>
                      <p>
                        {watch.kind === 'competitor' ? 'Competitor' : 'Source'} ·{' '}
                        {watch.mode === 'youtube'
                          ? 'YouTube public uploads'
                          : watch.mode === 'rss'
                            ? 'RSS / Atom feed'
                            : 'Notice-page links'}
                      </p>
                    </div>
                    <Badge
                      tone={
                        watch.status === 'error'
                          ? 'red'
                          : watch.status === 'paused'
                            ? 'gray'
                            : watch.status === 'running'
                              ? 'amber'
                              : 'green'
                      }
                    >
                      {watch.status === 'ready'
                        ? 'Ready'
                        : watch.status === 'error'
                          ? 'Needs attention'
                          : watch.status === 'running'
                            ? 'Checking'
                            : 'Paused'}
                    </Badge>
                  </div>
                  <a
                    className="monitoring-url"
                    href={safeUrl(watch.url)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {watch.url}
                    <ArrowUpRight size={14} />
                  </a>
                  <div className="monitoring-keywords">
                    {watch.keywords.length ? (
                      watch.keywords.map((keyword) => <Badge key={keyword}>{keyword}</Badge>)
                    ) : (
                      <span>All detected items</span>
                    )}
                  </div>
                  <dl className="watch-facts">
                    <div>
                      <dt>Check interval</dt>
                      <dd>{watch.intervalHours} hours</dd>
                    </div>
                    <div>
                      <dt>Last checked</dt>
                      <dd>{stamp(watch.lastCheckedAt)}</dd>
                    </div>
                    <div>
                      <dt>Next due</dt>
                      <dd>{watch.active ? stamp(watch.nextCheckAt) : 'Paused'}</dd>
                    </div>
                    <div>
                      <dt>Saved notices</dt>
                      <dd>{watch.noticeCount}</dd>
                    </div>
                  </dl>
                  {watch.error && <p className="monitoring-watch-error">{watch.error}</p>}
                  {manager && (
                    <div className="monitoring-watch-actions">
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={!!busy || watch.status === 'running' || !watch.active}
                        onClick={() => void run(watch)}
                      >
                        <RefreshCw
                          size={15}
                          className={busy === `/intelligence/watches/${watch.id}/run` ? 'spin' : ''}
                        />
                        Check now
                      </Button>
                      <Button size="sm" disabled={!!busy} onClick={() => setEditor({ watch })}>
                        <Pencil size={14} />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!!busy}
                        onClick={() =>
                          void action(`/intelligence/watches/${watch.id}`, 'PATCH', {
                            active: !watch.active,
                          })
                        }
                      >
                        {watch.active ? <Pause size={14} /> : <Play size={14} />}
                        {watch.active ? 'Pause' : 'Resume'}
                      </Button>
                      <button
                        className="icon-button"
                        disabled={!!busy}
                        aria-label={`Remove watch for ${watch.name}`}
                        onClick={() => setDeleteWatch(watch)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                  {watch.mode === 'youtube' && <YoutubePushControl watch={watch} />}
                </article>
              ))}
            </div>
          ) : (
            <section className="panel">
              <EmptyState
                icon={<Globe2 size={30} />}
                title="No scheduled watches yet"
                description="Choose a source from the catalog, or add a watch for an existing source or YouTube competitor."
                action={
                  manager ? (
                    <Button variant="primary" onClick={() => setEditor({})}>
                      <Plus size={16} />
                      Add watch
                    </Button>
                  ) : undefined
                }
              />
            </section>
          )}
          <div className="monitoring-platform-note">
            <strong>Other social profiles</strong>
            <p>
              Instagram, Facebook, and LinkedIn competitor bookmarks stay available for manual
              review. A profile URL does not grant private analytics or unrestricted monitoring
              access.
            </p>
            <Button size="sm" onClick={() => onAddReference('competitor')}>
              Manage competitor profiles <ArrowRight size={15} />
            </Button>
          </div>
        </>
      )}
      {section === 'catalog' && (
        <div className="monitoring-catalog">
          <p className="monitoring-evidence-note">
            <ShieldCheck size={16} />
            Official starting points for exam, board, counselling, and medical-college notices.
            Verify the current notice and its applicability before making a claim.
          </p>
          <div className="monitoring-watch-grid">
            {info.sourceCatalog.map((source) => (
              <article className="panel monitoring-catalog-card" key={source.id}>
                <Badge tone="violet">{source.category}</Badge>
                <h3>{source.name}</h3>
                <p>{source.note}</p>
                <a
                  className="text-link"
                  href={safeUrl(source.url)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open source <ArrowUpRight size={15} />
                </a>
                {manager && (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!!busy}
                    onClick={async () => {
                      const result = await action(
                        `/intelligence/catalog/${source.id}`,
                        'POST',
                        {},
                        'Source and watch are ready. Run its first check under Your watches.',
                      );
                      if (result) setSection('watches');
                    }}
                  >
                    <Plus size={16} />
                    Add source & watch
                  </Button>
                )}
              </article>
            ))}
          </div>
          {!info.sourceCatalog.length && (
            <EmptyState
              icon={<Globe2 size={28} />}
              title="Source catalog is unavailable"
              description="You can still add your own official source and configure its feed or notices page."
              action={
                manager ? (
                  <Button onClick={() => onAddReference('source')}>Add a source</Button>
                ) : undefined
              }
            />
          )}
        </div>
      )}
      {editor && (
        <WatchConfigModal
          watch={editor.watch}
          onClose={() => setEditor(null)}
          onAdded={() => {
            setEditor(null);
            setSection('watches');
          }}
          onAddReference={onAddReference}
        />
      )}
      {deleteWatch && (
        <Modal title="Remove this watch?" onClose={() => !busy && setDeleteWatch(null)}>
          <p>
            Remove the watch for <strong>{deleteWatch.name}</strong> and its detected-notice inbox?
            Research briefs and posts already created from it stay in your workspace.
          </p>
          <div className="form-actions">
            <Button disabled={!!busy} onClick={() => setDeleteWatch(null)}>
              Keep watch
            </Button>
            <Button
              disabled={!!busy}
              variant="danger"
              onClick={async () => {
                const result = await action(
                  `/intelligence/watches/${deleteWatch.id}`,
                  'DELETE',
                  undefined,
                  'Watch removed.',
                );
                if (result !== null) setDeleteWatch(null);
              }}
            >
              Remove watch
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function WatchConfigModal({
  watch,
  target,
  onClose,
  onAdded,
  onAddReference,
}: {
  watch?: IntelligenceWatch;
  target?: WatchTarget;
  onClose: () => void;
  onAdded: () => void;
  onAddReference: (kind: 'source' | 'competitor') => void;
}) {
  const { data, mutate, toast } = useWorkspace();
  const [kind, setKind] = useState<'source' | 'competitor'>(
    watch?.kind || target?.kind || 'source',
  );
  const [resourceId, setResourceId] = useState(watch?.resourceId || target?.resourceId || '');
  const [mode, setMode] = useState<IntelligenceWatch['mode']>(
    watch?.mode || (target?.kind === 'competitor' ? 'youtube' : 'html'),
  );
  const resources = useMemo(
    () =>
      kind === 'source'
        ? data.sources
        : data.competitors.filter(
            (item) => item.platform === 'youtube' || item.platform === 'website',
          ),
    [kind, data.sources, data.competitors],
  );
  const resource = resources.find((item) => item.id === resourceId);
  const [url, setUrl] = useState(
    watch?.url || resources.find((item) => item.id === (target?.resourceId || ''))?.url || '',
  );
  const [keywords, setKeywords] = useState(watch?.keywords.join(', ') || '');
  const [intervalHours, setIntervalHours] = useState(watch?.intervalHours || 6);
  const [active, setActive] = useState(watch?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isYouTube = resource && 'platform' in resource && resource.platform === 'youtube';
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!resourceId) {
      setError('Choose a saved source or channel first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await mutate(
        watch ? `/intelligence/watches/${watch.id}` : '/intelligence/watches',
        watch ? 'PATCH' : 'POST',
        {
          ...(!watch
            ? { kind, resourceId, mode: isYouTube ? 'youtube' : mode === 'youtube' ? 'html' : mode }
            : {}),
          url: url.trim() || resource?.url,
          keywords: keywords
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
          intervalHours,
          active,
        },
      );
      toast(
        watch ? 'Watch updated.' : 'Watch created. Run a first check to establish its baseline.',
      );
      onAdded();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={watch ? `Watch settings: ${watch.name}` : 'Add a source or channel watch'}
      onClose={() => !busy && onClose()}
    >
      <form className="stack" onSubmit={save}>
        {!watch && (
          <>
            <label className="field">
              What would you like to watch?
              <select
                value={kind}
                onChange={(event) => {
                  const next = event.target.value as typeof kind;
                  setKind(next);
                  setResourceId('');
                  setUrl('');
                  setMode(next === 'source' ? 'html' : 'youtube');
                }}
              >
                <option value="source">Official/source notices</option>
                <option value="competitor">Competitor channel or website</option>
              </select>
            </label>
            <label className="field">
              Saved {kind === 'source' ? 'source' : 'channel or website'}
              <select
                required
                value={resourceId}
                onChange={(event) => {
                  setResourceId(event.target.value);
                  const selected = resources.find((item) => item.id === event.target.value);
                  setUrl(selected?.url || '');
                  setMode(
                    selected && 'platform' in selected && selected.platform === 'youtube'
                      ? 'youtube'
                      : 'html',
                  );
                }}
              >
                <option value="">Choose a saved reference…</option>
                {resources.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {!resources.length && (
              <div className="modal-note">
                <span>
                  Add a source or a supported competitor first, then return here to configure
                  automatic checks.
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    onClose();
                    onAddReference(kind);
                  }}
                >
                  Add reference
                </Button>
              </div>
            )}
          </>
        )}
        {!(isYouTube || watch?.mode === 'youtube') && !watch && (
          <label className="field">
            Check method
            <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
              <option value="html">Notice-page links</option>
              <option value="rss">RSS or Atom feed</option>
            </select>
          </label>
        )}
        <label className="field">
          {isYouTube || watch?.mode === 'youtube'
            ? 'Exact YouTube channel ID or channel URL'
            : mode === 'rss'
              ? 'Feed URL'
              : 'Public notice-page URL'}
          <input
            required
            value={url}
            maxLength={2000}
            placeholder={isYouTube ? 'UC… or https://www.youtube.com/channel/UC…' : 'https://'}
            onChange={(event) => setUrl(event.target.value)}
          />
          <small>
            {isYouTube || watch?.mode === 'youtube'
              ? 'Use the stable UC… channel ID. An @handle alone is not a channel ID. The watch reads the public upload feed.'
              : 'Use a direct feed or notices page. Login-protected pages and blocked sites cannot be checked.'}
          </small>
        </label>
        <label className="field">
          Topics to keep
          <input
            value={keywords}
            maxLength={1000}
            placeholder="NEET, counselling, seats, admissions"
            onChange={(event) => setKeywords(event.target.value)}
          />
          <small>Separate keywords with commas. Leave empty to keep all detected items.</small>
        </label>
        <div className="form-grid">
          <label className="field">
            Check every
            <select
              value={intervalHours}
              onChange={(event) => setIntervalHours(Number(event.target.value))}
            >
              {[1, 3, 6, 12, 24, 48, 168]
                .filter((value) => value >= data.intelligence.automation.minimumIntervalHours)
                .map((value) => (
                  <option key={value} value={value}>
                    {value} hours
                  </option>
                ))}
            </select>
          </label>
          <label className="monitoring-checkbox">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            Active watch
          </label>
        </div>
        <div className="modal-note">
          <ShieldCheck size={18} />
          <span>
            The first scan establishes a baseline. New notices become unverified research material;
            this watch never publishes them automatically.
          </span>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !resourceId}>
            {busy ? 'Saving…' : watch ? 'Save watch' : 'Create watch'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
