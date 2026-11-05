import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Clock3,
  ExternalLink,
  FileSearch,
  Globe2,
  History,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import type { Competitor } from '../lib/types';
import { Badge, Button, EmptyState, Modal } from './UI';
import {
  EvidenceLink,
  intelligenceError,
  lines,
  localInputNow,
  OpenResearchChatGPT,
  researchStamp,
} from './IntelligenceV4Shared';
import type {
  CompetitorObservation,
  MonitoringData,
  ObservationMetrics,
  PageMonitor,
  PageSnapshot,
  RecentItem,
  ResearchNowResult,
  ResearchRequest,
} from './intelligence-v4-types';
import '../styles/intelligence-v4.css';

export type ResearchFocus = { competitorId?: string; requestId?: string };
const metricLabels: Record<string, string> = {
  followers: 'Followers',
  reviewCount: 'Reviews',
  rating: 'Rating',
  postCount: 'Posts',
};
export function researchResultMessage(result: ResearchNowResult) {
  if (result.mode === 'assisted')
    return result.existing
      ? 'A research request is already pending. Open it to inspect the sources or continue in ChatGPT.'
      : 'Research requested. This profile still needs to be inspected by your team or a connected ChatGPT session.';
  if (result.result?.skipped) return 'This source is already being checked or is not due yet.';
  if (result.result?.baseline)
    return 'The first successful scan was saved as a baseline. Existing content is not labelled as a new update.';
  if (result.mode === 'youtube')
    return `Channel check complete: ${result.result?.added || 0} new and ${result.result?.updated || 0} updated items.`;
  return result.result?.changed
    ? 'A webpage change was detected. Open the saved comparison to review it.'
    : 'The readable webpage matches the previous snapshot.';
}

export default function CompetitorResearch({
  focus,
  onAddCompetitor,
}: {
  focus?: ResearchFocus;
  onAddCompetitor: () => void;
}) {
  const { data, request, mutate, toast } = useWorkspace();
  const [section, setSection] = useState<'queue' | 'pages' | 'evidence'>(
    focus?.competitorId && !focus.requestId ? 'evidence' : 'queue',
  );
  const [info, setInfo] = useState<MonitoringData | null>(null),
    [filter, setFilter] = useState('pending'),
    [query, setQuery] = useState('');
  const [profileId, setProfileId] = useState(focus?.competitorId || data.competitors[0]?.id || '');
  const [selectedRequest, setSelectedRequest] = useState<ResearchRequest | null>(null);
  const [observationTarget, setObservationTarget] = useState<{
    competitor: Competitor;
    requestId?: string;
  } | null>(null);
  const [pageEditor, setPageEditor] = useState<{ monitor?: PageMonitor } | null>(null),
    [history, setHistory] = useState<PageMonitor | null>(null),
    [removePage, setRemovePage] = useState<PageMonitor | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const manager = data.user.role === 'manager';
  const profile = data.competitors.find((item) => item.id === profileId);
  const readVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++readVersion.current;
    try {
      const [monitoring, research] = await Promise.all([
        request<MonitoringData>('/intelligence/monitoring'),
        request<{ requests: ResearchRequest[] }>(
          `/intelligence/research-requests${filter === 'all' ? '' : `?status=${filter}`}`,
        ),
      ]);
      if (version !== readVersion.current) return;
      setInfo({ ...monitoring, researchRequests: research.requests });
      setError('');
      setRefreshVersion((version) => version + 1);
    } catch (caught) {
      if (version === readVersion.current) setError(intelligenceError(caught));
    }
  }, [request, filter]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (focus?.competitorId) setProfileId(focus.competitorId);
    if (focus?.requestId) {
      setSection('queue');
      let active = true;
      void request<{ request: ResearchRequest }>(
        `/intelligence/research-requests/${encodeURIComponent(focus.requestId)}`,
      )
        .then((value) => {
          if (active) setSelectedRequest(value.request);
        })
        .catch((caught) => {
          if (active) setError(intelligenceError(caught));
        });
      return () => {
        active = false;
      };
    }
    if (focus?.competitorId) setSection('evidence');
  }, [focus?.competitorId, focus?.requestId, request]);
  const requests = (info?.researchRequests || []).filter((item) =>
    `${item.targetName} ${item.question} ${item.platform}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  async function action<T>(path: string, method: string, body?: unknown): Promise<T | null> {
    if (busy) return null;
    setBusy(path);
    setError('');
    try {
      const result = await mutate<T>(path, method, body);
      await load();
      return result;
    } catch (caught) {
      setError(intelligenceError(caught));
      return null;
    } finally {
      setBusy('');
    }
  }
  async function research(competitor: Competitor) {
    const result = await action<ResearchNowResult>(
      `/intelligence/competitors/${competitor.id}/research`,
      'POST',
      {},
    );
    if (!result) return;
    toast(researchResultMessage(result));
    if (result.request) {
      setSelectedRequest(result.request);
      setSection('queue');
    }
    if (result.mode === 'webpage') setSection('pages');
  }
  return (
    <div className="iv4-page">
      <section className="iv4-intro">
        <div>
          <span className="eyebrow">CHANGES YOU CAN TRACE</span>
          <h2>Keep the evidence with the insight.</h2>
          <p>
            Compare public webpage snapshots, request social or Google Business research, and keep
            dated observations for each competitor.
          </p>
        </div>
        <div className="iv4-intro-metric">
          <strong>{info?.pageMonitors.filter((item) => item.active).length || 0}</strong>
          <span>active webpage monitors</span>
          <Badge tone={data.intelligence.automation.enabled ? 'green' : 'amber'}>
            {data.intelligence.automation.enabled
              ? 'Scheduled checks enabled'
              : 'Manual checks available'}
          </Badge>
          <small>Checks follow the workspace scheduler</small>
        </div>
      </section>
      <div className="iv4-toolbar">
        <div className="tabs" aria-label="Competitor research sections">
          {(
            [
              { id: 'queue', label: 'Research queue', icon: FileSearch },
              { id: 'pages', label: 'Webpage changes', icon: Globe2 },
              { id: 'evidence', label: 'Profile evidence', icon: History },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              className={`tab ${section === id ? 'active' : ''}`}
              aria-pressed={section === id}
              key={id}
              onClick={() => setSection(id)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
        <Button disabled={!!busy} onClick={() => void load()}>
          <RefreshCw size={16} />
          Refresh
        </Button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!info && !error && <p role="status">Loading research and saved evidence…</p>}
      {section === 'queue' && (
        <>
          <div className="iv4-notice">
            <FileSearch size={20} />
            <p>
              <strong>“Needs research” means the source has not been checked yet.</strong> Open a
              request, inspect the public sources and record cited evidence. “Open research in
              ChatGPT” needs the workspace MCP app connected first. A queued request does not start
              a background ChatGPT session.
            </p>
          </div>
          <div className="iv4-filters">
            <label className="search-field">
              <Search size={17} />
              <input
                aria-label="Search research requests"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search competitors, exams, or questions…"
              />
            </label>
            <select
              aria-label="Filter research request status"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="pending">Needs research</option>
              <option value="completed">Research recorded</option>
              <option value="cancelled">Cancelled</option>
              <option value="all">All recent requests</option>
            </select>
            <Button onClick={() => setSection('evidence')}>
              <Plus size={16} />
              Research a profile
            </Button>
          </div>
          {requests.length ? (
            <div className="iv4-request-list">
              {requests.map((item) => (
                <article className="iv4-card" key={item.id}>
                  <div className="iv4-badges">
                    <Badge
                      tone={
                        item.status === 'pending'
                          ? 'amber'
                          : item.status === 'completed'
                            ? 'violet'
                            : 'gray'
                      }
                    >
                      {item.displayStatus}
                    </Badge>
                    <Badge>
                      {item.targetType === 'exam'
                        ? 'Exam'
                        : item.platform === 'google_business'
                          ? 'Google Business'
                          : item.platform || 'Competitor'}
                    </Badge>
                    {item.status === 'completed' && <Badge tone="amber">Needs source review</Badge>}
                  </div>
                  <h3>{item.targetName}</h3>
                  <p className="iv4-clamp">{item.question}</p>
                  <div className="iv4-card-meta">
                    <span>Requested {researchStamp(item.requestedAt)}</span>
                    <span>By {item.requestedBy}</span>
                    {item.observedAt && (
                      <span>Source observed {researchStamp(item.observedAt)}</span>
                    )}
                  </div>
                  <div className="iv4-actions">
                    <Button size="sm" onClick={() => setSelectedRequest(item)}>
                      {item.status === 'pending' ? 'Open request' : 'View result'}
                      <ArrowRight size={15} />
                    </Button>
                    {item.status === 'pending' && <OpenResearchChatGPT request={item} />}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            info && (
              <EmptyState
                icon={<FileSearch size={28} />}
                title={filter === 'pending' ? 'No research waiting' : 'No matching requests'}
                description="Use Research now on a saved competitor or Request research on an exam. Supported public sources can be checked immediately; other profiles create a request with a clear next step."
                action={
                  <Button onClick={() => setSection('evidence')}>
                    Choose a profile
                    <ArrowRight size={16} />
                  </Button>
                }
              />
            )
          )}
          <p className="iv4-help">
            Showing up to 100 recent requests in this view. Submitted research stays unverified
            until the relevant guide or content is reviewed.
          </p>
        </>
      )}
      {section === 'pages' && (
        <>
          <div className="iv4-toolbar">
            <p className="iv4-help">
              Readable text checks ignore common navigation and page scripts. The first scan is a
              baseline; later meaningful text changes notify the team. Pages requiring sign-in or
              JavaScript need assisted research.
            </p>
            {manager && (
              <Button variant="primary" onClick={() => setPageEditor({})}>
                <Plus size={16} />
                Monitor webpage
              </Button>
            )}
          </div>
          <div className="iv4-notice">
            <Clock3 size={20} />
            <p>
              <strong>Scheduled checks, not instant alerts.</strong> The default interval is 24
              hours, with a 6-hour minimum. The workspace scheduler determines when due checks
              actually run; one webpage is processed per sweep to keep work bounded.
            </p>
          </div>
          {info?.pageMonitors.length ? (
            <div className="iv4-card-grid">
              {info.pageMonitors.map((item) => (
                <article className="iv4-card" key={item.id}>
                  <div className="iv4-badges">
                    <Badge tone={item.error ? 'amber' : item.status === 'ready' ? 'green' : 'gray'}>
                      {item.error ? 'Needs attention' : item.status.replaceAll('_', ' ')}
                    </Badge>
                    <Badge>Every {item.intervalHours}h</Badge>
                  </div>
                  <h3>{item.name}</h3>
                  <EvidenceLink url={item.url}>Monitored page</EvidenceLink>
                  <dl className="iv4-facts">
                    <div>
                      <dt>Last successful check</dt>
                      <dd>{researchStamp(item.lastSuccessAt)}</dd>
                    </div>
                    <div>
                      <dt>Last attempted check</dt>
                      <dd>{researchStamp(item.lastCheckedAt)}</dd>
                    </div>
                    <div>
                      <dt>Next eligible check</dt>
                      <dd>{item.active ? researchStamp(item.nextCheckAt) : 'Paused'}</dd>
                    </div>
                    <div>
                      <dt>Saved snapshots</dt>
                      <dd>{item.snapshotCount} of 30 retained</dd>
                    </div>
                  </dl>
                  {item.error && <p className="form-error">{item.error}</p>}
                  <div className="iv4-actions">
                    <Button size="sm" onClick={() => setHistory(item)}>
                      <History size={15} />
                      Compare changes
                    </Button>
                    {manager && (
                      <>
                        <Button
                          size="sm"
                          disabled={!!busy || item.status === 'running'}
                          onClick={async () => {
                            const result = await action<NonNullable<ResearchNowResult['result']>>(
                              `/intelligence/page-monitors/${item.id}/run`,
                              'POST',
                              {},
                            );
                            if (result) toast(researchResultMessage({ mode: 'webpage', result }));
                          }}
                        >
                          <RefreshCw size={15} />
                          Check now
                        </Button>
                        <Button size="sm" onClick={() => setPageEditor({ monitor: item })}>
                          <Pencil size={15} />
                          Settings
                        </Button>
                        <Button
                          size="sm"
                          disabled={!!busy || item.status === 'running'}
                          onClick={() =>
                            void action(`/intelligence/page-monitors/${item.id}`, 'PATCH', {
                              active: !item.active,
                            })
                          }
                        >
                          {item.active ? <Pause size={15} /> : <Play size={15} />}
                          {item.active ? 'Pause' : 'Resume'}
                        </Button>
                        <Button
                          size="sm"
                          aria-label={`Remove ${item.name} page monitor`}
                          onClick={() => setRemovePage(item)}
                        >
                          <Trash2 size={15} />
                        </Button>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            info && (
              <EmptyState
                icon={<Globe2 size={28} />}
                title="Compare a competitor’s public webpage"
                description="Save the website in Competitors, choose the page that matters, and establish its first baseline. We keep up to 30 changed snapshots per monitor."
                action={
                  manager ? (
                    <Button variant="primary" onClick={() => setPageEditor({})}>
                      <Plus size={16} />
                      Monitor webpage
                    </Button>
                  ) : undefined
                }
              />
            )
          )}
        </>
      )}
      {section === 'evidence' && (
        <>
          <div className="iv4-notice">
            <Users size={20} />
            <p>
              <strong>Each profile has its own observation history.</strong> Google Business,
              Instagram, Facebook and LinkedIn competitor research uses cited observations from your
              team or a connected ChatGPT session. This workspace does not have unrestricted
              background access to those profiles.
            </p>
          </div>
          <div className="iv4-toolbar">
            <label className="field iv4-profile-select">
              <span>Competitor profile</span>
              <select value={profileId} onChange={(event) => setProfileId(event.target.value)}>
                <option value="">Choose a saved profile</option>
                {data.competitors.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ·{' '}
                    {item.platform === 'google_business' ? 'Google Business' : item.platform}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={onAddCompetitor}>
              <Plus size={16} />
              Add competitor
            </Button>
          </div>
          {profile ? (
            <>
              <div className="iv4-profile-heading">
                <div>
                  <h3>{profile.name}</h3>
                  <EvidenceLink url={profile.url}>Open public reference</EvidenceLink>
                  <p>{profile.notes}</p>
                </div>
                <div className="iv4-actions">
                  <Button
                    variant="primary"
                    disabled={!!busy}
                    onClick={() => void research(profile)}
                  >
                    <Search size={16} />
                    {profile.platform === 'google_business' ? 'Research GMB' : 'Research now'}
                  </Button>
                  <Button onClick={() => setObservationTarget({ competitor: profile })}>
                    <Plus size={16} />
                    Record evidence
                  </Button>
                </div>
              </div>
              <ObservationHistory competitorId={profile.id} refreshVersion={refreshVersion} />
            </>
          ) : (
            <EmptyState
              icon={<Users size={28} />}
              title="Choose a competitor to start"
              description="Add the exact public profile or website URL. You can save and compare separate observations for as many different references as your watchlist contains."
              action={
                <Button variant="primary" onClick={onAddCompetitor}>
                  <Plus size={16} />
                  Add competitor
                </Button>
              }
            />
          )}
        </>
      )}
      {selectedRequest && (
        <ResearchRequestModal
          record={selectedRequest}
          onClose={() => setSelectedRequest(null)}
          onSaved={async () => {
            setSelectedRequest(null);
            await load();
          }}
          onObservation={(competitor, requestId) => {
            setSelectedRequest(null);
            setObservationTarget({ competitor, requestId });
          }}
        />
      )}
      {observationTarget && (
        <ObservationEditor
          competitor={observationTarget.competitor}
          requestId={observationTarget.requestId}
          onClose={() => setObservationTarget(null)}
          onSaved={async () => {
            setObservationTarget(null);
            setProfileId(observationTarget.competitor.id);
            setSection('evidence');
            await load();
          }}
        />
      )}
      {pageEditor && (
        <PageMonitorEditor
          monitor={pageEditor.monitor}
          monitors={info?.pageMonitors || []}
          onClose={() => setPageEditor(null)}
          onSaved={async () => {
            setPageEditor(null);
            await load();
          }}
          onAddCompetitor={() => {
            setPageEditor(null);
            onAddCompetitor();
          }}
        />
      )}
      {history && <PageHistory monitor={history} onClose={() => setHistory(null)} />}
      {removePage && (
        <Modal
          title="Remove webpage monitor?"
          onClose={() => {
            if (!busy) setRemovePage(null);
          }}
        >
          <p>
            This removes the monitor for <strong>{removePage.name}</strong> and its saved webpage
            comparisons. The competitor profile and manually recorded evidence remain.
          </p>
          <div className="form-actions">
            <Button disabled={!!busy} onClick={() => setRemovePage(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={!!busy}
              onClick={async () => {
                const result = await action(
                  `/intelligence/page-monitors/${removePage.id}`,
                  'DELETE',
                );
                if (result) {
                  setRemovePage(null);
                  toast('Webpage monitor removed.');
                }
              }}
            >
              Remove monitor
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ResearchRequestModal({
  record,
  onClose,
  onSaved,
  onObservation,
}: {
  record: ResearchRequest;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onObservation: (competitor: Competitor, requestId: string) => void;
}) {
  const { data, mutate, toast } = useWorkspace();
  const [summary, setSummary] = useState(''),
    [urls, setUrls] = useState(record.targetUrl || ''),
    [observedAt, setObservedAt] = useState(localInputNow),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const competitor = data.competitors.find(
    (item) => record.targetType === 'competitor' && item.id === record.targetId,
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await mutate(`/intelligence/research-requests/${record.id}/result`, 'POST', {
        summary,
        evidenceUrls: lines(urls),
        observedAt: new Date(observedAt).toISOString(),
        expectedRevision: record.revision,
      });
      toast('Source-linked research saved for review.');
      await onSaved();
    } catch (caught) {
      setError(intelligenceError(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Research request"
      className="iv4-wide-modal"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="iv4-detail">
        <div className="iv4-badges">
          <Badge tone={record.status === 'pending' ? 'amber' : 'violet'}>
            {record.displayStatus}
          </Badge>
          {record.status === 'completed' && <Badge tone="amber">Needs source review</Badge>}
        </div>
        <h2>{record.targetName}</h2>
        <p className="iv4-preserve">{record.question}</p>
        <EvidenceLink url={record.targetUrl}>Open reference</EvidenceLink>
        <dl className="iv4-facts">
          <div>
            <dt>Requested</dt>
            <dd>{researchStamp(record.requestedAt)}</dd>
          </div>
          <div>
            <dt>Source observed</dt>
            <dd>{researchStamp(record.observedAt)}</dd>
          </div>
          <div>
            <dt>Result recorded</dt>
            <dd>{researchStamp(record.completedAt)}</dd>
          </div>
        </dl>
        {record.status === 'pending' ? (
          <>
            <div className="iv4-notice">
              <ExternalLink size={20} />
              <div>
                <strong>Continue with your team or ChatGPT</strong>
                <p>
                  Connect the workspace MCP app in ChatGPT first. This link prepares a request for
                  your active conversation. It cannot run ChatGPT in the background or guarantee
                  access to restricted profiles.
                </p>
                <OpenResearchChatGPT request={record} />
              </div>
            </div>
            {competitor ? (
              <>
                <p>
                  Record actual observed metrics, reviews or recent post links to compare them with
                  earlier observations. Your first observation establishes the baseline.
                </p>
                <Button variant="primary" onClick={() => onObservation(competitor, record.id)}>
                  <Plus size={16} />
                  Record profile evidence
                </Button>
              </>
            ) : (
              <form className="iv4-form" onSubmit={submit}>
                <label className="field">
                  <span>What the sources show *</span>
                  <textarea
                    required
                    minLength={10}
                    maxLength={8000}
                    rows={5}
                    value={summary}
                    onChange={(event) => setSummary(event.target.value)}
                    placeholder="Include current notices, corrections, dates and any uncertainty. Saving research does not change the exam guide automatically."
                  />
                </label>
                <label className="field">
                  <span>Sources inspected, one URL per line *</span>
                  <textarea
                    required
                    rows={3}
                    maxLength={41000}
                    value={urls}
                    onChange={(event) => setUrls(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>When the source was observed (your local time) *</span>
                  <input
                    required
                    type="datetime-local"
                    value={observedAt}
                    onChange={(event) => setObservedAt(event.target.value)}
                  />
                </label>
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="form-actions">
                  <Button type="submit" variant="primary" disabled={busy}>
                    {busy ? 'Saving…' : 'Save research for review'}
                  </Button>
                </div>
              </form>
            )}
            {data.user.role === 'manager' && (
              <div className="iv4-secondary-actions">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await mutate(
                        `/intelligence/research-requests/${record.id}/cancel`,
                        'POST',
                        {},
                      );
                      await onSaved();
                    } catch (caught) {
                      setError(intelligenceError(caught));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Cancel request
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <h3>Recorded findings</h3>
            <p className="iv4-preserve">{record.resultSummary || 'No result was recorded.'}</p>
            <div className="iv4-links">
              {record.evidenceUrls.map((url) => (
                <EvidenceLink url={url} key={url} />
              ))}
            </div>
            <p className="iv4-help">
              Research results are evidence drafts. Review sources before adding claims to public
              content or marking an exam guide as reviewed.
            </p>
          </>
        )}
        {error && competitor && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function ObservationHistory({
  competitorId,
  refreshVersion,
}: {
  competitorId: string;
  refreshVersion: number;
}) {
  const { request } = useWorkspace();
  const [observations, setObservations] = useState<CompetitorObservation[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void request<{ observations: CompetitorObservation[] }>(
      `/intelligence/competitors/${competitorId}/observations`,
    )
      .then((result) => {
        if (active) setObservations(result.observations);
      })
      .catch((caught) => {
        if (active) setError(intelligenceError(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [competitorId, refreshVersion, request]);
  if (error)
    return (
      <p className="form-error" role="alert">
        {error}
      </p>
    );
  if (loading) return <p role="status">Loading profile observations…</p>;
  if (!observations.length)
    return (
      <EmptyState
        icon={<History size={26} />}
        title="No evidence recorded yet"
        description="Inspect this profile and record a dated observation with its source links. The first entry becomes a baseline; later entries show changes in the same measured values."
      />
    );
  return (
    <div className="iv4-timeline">
      {observations.map((item) => (
        <article className="iv4-card" key={item.id}>
          <div className="iv4-badges">
            <Badge tone={item.comparison.baseline ? 'gray' : 'violet'}>
              {item.comparison.baseline
                ? 'First observed baseline'
                : 'Compared with earlier evidence'}
            </Badge>
            {item.comparison.historical && <Badge>Historical entry</Badge>}
            <Badge tone="amber">Needs source review</Badge>
          </div>
          <h3>Observed {researchStamp(item.observedAt)}</h3>
          <p className="iv4-preserve">{item.summary}</p>
          {Object.keys(item.metrics).length > 0 && (
            <div className="iv4-metrics">
              {Object.entries(item.metrics).map(([key, value]) => {
                const change = item.comparison.metricChanges.find((change) => change.key === key);
                return (
                  <div key={key}>
                    <span>{metricLabels[key] || key}</span>
                    <strong>{value?.toLocaleString('en-IN')}</strong>
                    <small>
                      {change
                        ? `${change.delta > 0 ? '+' : ''}${change.delta.toLocaleString('en-IN')} from ${change.previous.toLocaleString('en-IN')}`
                        : item.comparison.baseline
                          ? 'Baseline value'
                          : 'No comparable change recorded'}
                    </small>
                  </div>
                );
              })}
            </div>
          )}
          {item.comparison.newItems.length > 0 && (
            <p className="iv4-help">
              {item.comparison.newItems.length} newly observed link
              {item.comparison.newItems.length === 1 ? '' : 's'} compared with the prior sample.
              Observation time does not establish a publication date.
            </p>
          )}
          {item.recentItems.length > 0 && (
            <div className="iv4-item-links">
              {item.recentItems.map((post, index) => (
                <div key={`${post.url}-${index}`}>
                  <EvidenceLink url={post.url}>{post.title}</EvidenceLink>
                  <small>
                    {post.publishedAt
                      ? `Source publication date ${researchStamp(post.publishedAt)}`
                      : 'Publication date not recorded'}
                  </small>
                </div>
              ))}
            </div>
          )}
          <div className="iv4-links">
            {item.evidenceUrls.map((url) => (
              <EvidenceLink url={url} key={url} />
            ))}
          </div>
          <p className="iv4-help">
            Recorded {researchStamp(item.recordedAt)} by {item.recordedBy}. Missing posts in a
            sample are not treated as deleted.
          </p>
        </article>
      ))}
    </div>
  );
}

function ObservationEditor({
  competitor,
  requestId,
  onClose,
  onSaved,
}: {
  competitor: Competitor;
  requestId?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { mutate, toast } = useWorkspace();
  const [observedAt, setObservedAt] = useState(localInputNow),
    [summary, setSummary] = useState(''),
    [urls, setUrls] = useState(competitor.url);
  const [metrics, setMetrics] = useState<Record<string, string>>({
      followers: '',
      reviewCount: '',
      rating: '',
      postCount: '',
    }),
    [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  const [key] = useState(
      () =>
        `ui-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join('')}`,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const values = Object.fromEntries(
        Object.entries(metrics)
          .filter(([, value]) => value.trim() !== '')
          .map(([name, value]) => [name, Number(value)]),
      ) as ObservationMetrics;
      await mutate(`/intelligence/competitors/${competitor.id}/observations`, 'POST', {
        observedAt: new Date(observedAt).toISOString(),
        summary,
        evidenceUrls: lines(urls),
        metrics: values,
        recentItems: recentItems.map((item) => ({
          ...item,
          publishedAt: item.publishedAt ? new Date(item.publishedAt).toISOString() : undefined,
        })),
        ...(requestId ? { requestId } : {}),
        idempotencyKey: key,
      });
      toast(
        'Dated evidence saved. Compare the observations and review sources before using the findings.',
      );
      await onSaved();
    } catch (caught) {
      setError(intelligenceError(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Record evidence · ${competitor.name}`}
      className="iv4-wide-modal"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="iv4-form" onSubmit={submit}>
        <p className="iv4-help">
          Save what you actually observed. Leave unavailable numbers blank; zero means you observed
          zero. Your first entry creates a baseline and does not imply a new change today.
        </p>
        <label className="field">
          <span>When you observed the source (your local time) *</span>
          <input
            required
            type="datetime-local"
            value={observedAt}
            onChange={(event) => setObservedAt(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Findings and access limitations *</span>
          <textarea
            required
            minLength={10}
            maxLength={6000}
            rows={4}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="What changed, what was visible, and what could not be confirmed?"
          />
        </label>
        <label className="field">
          <span>Sources inspected, one URL per line *</span>
          <textarea
            required
            rows={3}
            maxLength={41000}
            value={urls}
            onChange={(event) => setUrls(event.target.value)}
          />
        </label>
        <fieldset className="iv4-fieldset">
          <legend>Observed metrics (optional)</legend>
          <div className="form-grid">
            {Object.keys(metrics).map((name) => (
              <label className="field" key={name}>
                <span>{metricLabels[name]}</span>
                <input
                  type="number"
                  min={name === 'rating' ? 1 : 0}
                  max={name === 'rating' ? 5 : name === 'followers' ? 1e12 : 1e9}
                  step={name === 'rating' ? 0.01 : 1}
                  value={metrics[name]}
                  onChange={(event) => setMetrics({ ...metrics, [name]: event.target.value })}
                  placeholder="Not observed"
                />
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="iv4-fieldset">
          <legend>Recent post, review or update links</legend>
          {recentItems.map((item, index) => (
            <div className="iv4-repeat-block" key={index}>
              <div className="iv4-repeat-heading">
                <strong>Observed item {index + 1}</strong>
                <Button
                  size="sm"
                  aria-label={`Remove observed item ${index + 1}`}
                  onClick={() => setRecentItems(recentItems.filter((_, at) => at !== index))}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
              <label className="field">
                <span>Brief title *</span>
                <input
                  required
                  maxLength={300}
                  value={item.title}
                  onChange={(event) =>
                    setRecentItems(
                      recentItems.map((value, at) =>
                        at === index ? { ...value, title: event.target.value } : value,
                      ),
                    )
                  }
                />
              </label>
              <label className="field">
                <span>Exact item URL *</span>
                <input
                  required
                  type="url"
                  maxLength={2048}
                  value={item.url}
                  onChange={(event) =>
                    setRecentItems(
                      recentItems.map((value, at) =>
                        at === index ? { ...value, url: event.target.value } : value,
                      ),
                    )
                  }
                />
              </label>
              <label className="field">
                <span>Source publication time, if shown (your local time)</span>
                <input
                  type="datetime-local"
                  value={item.publishedAt || ''}
                  onChange={(event) =>
                    setRecentItems(
                      recentItems.map((value, at) =>
                        at === index ? { ...value, publishedAt: event.target.value } : value,
                      ),
                    )
                  }
                />
              </label>
            </div>
          ))}
          <Button
            size="sm"
            disabled={recentItems.length >= 20}
            onClick={() => setRecentItems([...recentItems, { title: '', url: '' }])}
          >
            <Plus size={15} />
            Add observed item
          </Button>
        </fieldset>
        <p className="iv4-help">
          This records unverified evidence. A manager must review any resulting content before
          publishing. {requestId ? 'Saving will also complete the linked research request.' : ''}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save evidence'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PageMonitorEditor({
  monitor,
  monitors,
  onClose,
  onSaved,
  onAddCompetitor,
}: {
  monitor?: PageMonitor;
  monitors: PageMonitor[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onAddCompetitor: () => void;
}) {
  const { data, mutate, toast } = useWorkspace();
  const available = data.competitors.filter(
    (item) =>
      item.platform === 'website' &&
      !monitors.some((value) => value.competitorId === item.id && value.id !== monitor?.id),
  );
  const [competitorId, setCompetitorId] = useState(monitor?.competitorId || available[0]?.id || ''),
    [url, setUrl] = useState(monitor?.url || available[0]?.url || ''),
    [interval, setInterval] = useState(monitor?.intervalHours || 24),
    [active, setActive] = useState(monitor?.active ?? true),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await mutate(
        monitor ? `/intelligence/page-monitors/${monitor.id}` : '/intelligence/page-monitors',
        monitor ? 'PATCH' : 'POST',
        { ...(!monitor ? { competitorId } : {}), url, intervalHours: interval, active },
      );
      toast(
        monitor
          ? 'Webpage settings saved.'
          : 'Webpage monitor saved. Its first successful check will establish a baseline.',
      );
      await onSaved();
    } catch (caught) {
      setError(intelligenceError(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={monitor ? 'Webpage monitor settings' : 'Monitor a public webpage'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {!monitor && !available.length ? (
        <EmptyState
          icon={<Globe2 size={26} />}
          title="Add a website to your watchlist"
          description="Each saved website can have one text-change monitor. Add a competitor with Website as its platform, or adjust an existing monitor."
          action={
            <Button variant="primary" onClick={onAddCompetitor}>
              Add competitor website
            </Button>
          }
        />
      ) : (
        <form className="iv4-form" onSubmit={submit}>
          <label className="field">
            <span>Saved competitor website</span>
            <select
              required
              disabled={!!monitor}
              value={competitorId}
              onChange={(event) => {
                setCompetitorId(event.target.value);
                setUrl(available.find((item) => item.id === event.target.value)?.url || '');
              }}
            >
              {monitor && !available.some((item) => item.id === monitor.competitorId) && (
                <option value={monitor.competitorId}>{monitor.name}</option>
              )}
              {available.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Public HTTPS page URL *</span>
            <input
              required
              type="url"
              maxLength={2048}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            <small>
              Choose the admissions, notice or news page you want to compare. Social and Google Maps
              pages use assisted research.
            </small>
          </label>
          <label className="field">
            <span>Minimum time between scheduled checks</span>
            <select value={interval} onChange={(event) => setInterval(Number(event.target.value))}>
              {[6, 12, 24, 48, 168].map((hours) => (
                <option key={hours} value={hours}>
                  {hours === 24
                    ? 'Every 24 hours (recommended)'
                    : hours === 168
                      ? 'Every week'
                      : `Every ${hours} hours`}
                </option>
              ))}
            </select>
          </label>
          <label className="iv4-check">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            Enable scheduled checks
          </label>
          <p className="iv4-help">
            The scheduler processes due pages in small batches. Checks respect public access
            restrictions and robots rules; they do not run page JavaScript. Changing the URL creates
            a fresh baseline.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <Button disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save monitor'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function PageHistory({ monitor, onClose }: { monitor: PageMonitor; onClose: () => void }) {
  const { request } = useWorkspace();
  const [snapshots, setSnapshots] = useState<PageSnapshot[]>([]),
    [selectedId, setSelectedId] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void request<{ snapshots: PageSnapshot[] }>(
      `/intelligence/page-monitors/${monitor.id}/snapshots`,
    )
      .then((result) => {
        if (active) {
          setSnapshots(result.snapshots);
          setSelectedId(result.snapshots[0]?.id || '');
        }
      })
      .catch((caught) => {
        if (active) setError(intelligenceError(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [monitor.id, request]);
  const selected = snapshots.find((item) => item.id === selectedId);
  return (
    <Modal title={`Webpage history · ${monitor.name}`} className="iv4-wide-modal" onClose={onClose}>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading saved comparisons…</p>}
      {!loading && !error && !snapshots.length && (
        <EmptyState
          icon={<History size={28} />}
          title="The first scan is still pending"
          description="Use Check now or wait for this active monitor’s scheduled turn. The first successful scan becomes your baseline."
        />
      )}
      {selected && (
        <div className="iv4-detail">
          <label className="field">
            <span>Saved snapshot</span>
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              {snapshots.map((item) => (
                <option key={item.id} value={item.id}>
                  {researchStamp(item.fetchedAt)} ·{' '}
                  {item.baseline
                    ? 'Baseline'
                    : `${item.comparison.addedCount} added / ${item.comparison.removedCount} removed`}
                </option>
              ))}
            </select>
          </label>
          <div className="iv4-badges">
            <Badge tone={selected.baseline ? 'gray' : 'violet'}>
              {selected.baseline ? 'Baseline' : 'Text change detected'}
            </Badge>
            <Badge tone="amber">Needs source review</Badge>
            <Badge>URL version {selected.generation}</Badge>
          </div>
          <h3>{selected.title}</h3>
          <EvidenceLink url={selected.url}>Open original page</EvidenceLink>
          <p className="iv4-help">
            Fetched {researchStamp(selected.fetchedAt)}. This is when the page was inspected, not a
            publication date.{' '}
            {selected.comparison.titleChanged ? 'The page title also changed. ' : ''}
            {selected.comparison.truncated ? 'The saved text is truncated to its size limit. ' : ''}
            Compared readable {selected.comparison.scope} text; common scripts, navigation and
            footers are excluded.
          </p>
          {selected.baseline ? (
            <p>
              This is the first saved snapshot for this URL version. It does not mean this content
              was newly published.
            </p>
          ) : (
            <div className="iv4-diff">
              <section className="iv4-diff-added">
                <h3>Added text · {selected.comparison.addedCount}</h3>
                {selected.comparison.added.map((line, index) => (
                  <p key={index}>{line}</p>
                ))}
                {!selected.comparison.added.length && <p>No added text blocks.</p>}
              </section>
              <section className="iv4-diff-removed">
                <h3>Removed text · {selected.comparison.removedCount}</h3>
                {selected.comparison.removed.map((line, index) => (
                  <p key={index}>{line}</p>
                ))}
                {!selected.comparison.removed.length && <p>No removed text blocks.</p>}
              </section>
            </div>
          )}
          <details className="iv4-snapshot-text">
            <summary>Read saved text</summary>
            <pre>{selected.contentText}</pre>
          </details>
          <p className="iv4-help">
            Up to 12 text blocks per side are shown. A changed webpage can include presentation or
            rotating content; inspect the original before using a change as a marketing claim.
          </p>
        </div>
      )}
    </Modal>
  );
}
