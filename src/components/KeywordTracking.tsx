import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  CircleAlert,
  Copy,
  Download,
  LineChart,
  Link2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import { institutions } from '../lib/types';
import type { KeywordData, KeywordDetail, KeywordTrack, SearchSample } from '../lib/rankings';
import { formatDate } from '../lib/utils';
import { Badge, Button, EmptyState, Modal } from './UI';
import '../styles/keywords.css';

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'This keyword action could not be completed.';
const numberText = (value: number | null | undefined, decimals = 1) =>
  value == null ? '—' : value.toLocaleString('en-IN', { maximumFractionDigits: decimals });
const dateText = (value: string | null | undefined) =>
  value
    ? formatDate(`${value.slice(0, 10)}T12:00:00Z`, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : 'No sample yet';
const timeText = (value: string | null) =>
  value
    ? `${formatDate(value, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} IST`
    : 'Not checked yet';
const localParts = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const field = (key: string) => parts.find((part) => part.type === key)?.value || '';
  return `${field('year')}-${field('month')}-${field('day')}T${field('hour')}:${field('minute')}`;
};
const currentKeywordId = () =>
  new URLSearchParams(window.location.hash.split('?')[1]).get('keyword');
const labels: Record<KeywordTrack['status'], string> = {
  paused: 'Paused',
  awaiting_connection: 'Choose a property',
  needs_attention: 'Needs attention',
  awaiting_data: 'Awaiting first import',
  ready: 'History available',
  no_query_rows: 'No reported query rows',
};

type PlotPoint = { date: string; value: number | null };
function KeywordLine({
  points,
  label,
  percentage = false,
  color = '#7452d9',
}: {
  points: PlotPoint[];
  label: string;
  percentage?: boolean;
  color?: string;
}) {
  const id = useId();
  const valid = points.filter((point) => point.value !== null);
  if (!valid.length)
    return (
      <div className="keyword-empty-chart">
        <LineChart size={22} />
        <span>No dated samples yet</span>
      </div>
    );
  const width = 300,
    left = 34,
    right = 290,
    top = 13,
    bottom = 76;
  const first = Date.parse(`${points[0].date}T00:00:00Z`),
    last = Date.parse(`${points.at(-1)?.date}T00:00:00Z`);
  const minimum = percentage ? 0 : 1;
  const maximum = percentage
    ? 100
    : Math.max(10, Math.ceil(Math.max(...valid.map((point) => point.value!)) / 10) * 10);
  const position = (point: PlotPoint) => ({
    x:
      left +
      ((Date.parse(`${point.date}T00:00:00Z`) - first) / (last - first || 1)) * (right - left),
    y: percentage
      ? bottom - ((point.value! - minimum) / (maximum - minimum)) * (bottom - top)
      : top + ((point.value! - minimum) / (maximum - minimum)) * (bottom - top),
  });
  const segments: string[][] = [];
  let segment: string[] = [];
  let previousDate: number | null = null;
  for (const point of points) {
    const currentDate = Date.parse(`${point.date}T00:00:00Z`);
    if (point.value === null || (previousDate !== null && currentDate - previousDate > 86400000)) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (point.value !== null) {
      const p = position(point);
      segment.push(`${p.x},${p.y}`);
    }
    previousDate = currentDate;
  }
  if (segment.length) segments.push(segment);
  return (
    <svg
      className="keyword-line"
      viewBox={`0 0 ${width} 108`}
      role="img"
      aria-labelledby={`${id}-title ${id}-desc`}
    >
      <title id={`${id}-title`}>{label}</title>
      <desc id={`${id}-desc`}>
        {valid.length} observed dates.{' '}
        {percentage
          ? 'Higher percentages mean more observed visibility.'
          : 'A lower average position is better and appears higher on this graph.'}{' '}
        Missing dates remain gaps. Values are available in the evidence table.
      </desc>
      {[top, bottom].map((y) => (
        <line key={y} x1={left} x2={right} y1={y} y2={y} stroke="#e8e1f3" strokeDasharray="3 5" />
      ))}
      <text x="3" y={top + 4}>
        {percentage ? '100' : minimum}
      </text>
      <text x="3" y={bottom + 4}>
        {percentage ? '0' : maximum}
      </text>
      {segments.map((part, index) => (
        <polyline
          key={index}
          points={part.join(' ')}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {valid.map((point) => {
        const p = position(point);
        return (
          <circle key={point.date} cx={p.x} cy={p.y} r={valid.length > 35 ? 2 : 3} fill={color}>
            <title>
              {dateText(point.date)}: {numberText(point.value)}
              {percentage ? '%' : ''}
            </title>
          </circle>
        );
      })}
      <text x={left} y="101">
        {dateText(points[0].date).replace(/ \d{4}$/, '')}
      </text>
      <text x={right} y="101" textAnchor="end">
        {dateText(points.at(-1)?.date).replace(/ \d{4}$/, '')}
      </text>
    </svg>
  );
}

function Movement({ value, previousDate }: { value: number | null; previousDate?: string }) {
  if (value === null)
    return <span className="keyword-movement">A second reported date establishes movement.</span>;
  return (
    <span className={`keyword-movement ${value > 0 ? 'improved' : value < 0 ? 'declined' : ''}`}>
      {value > 0 ? (
        <ArrowUpRight size={16} />
      ) : value < 0 ? (
        <ArrowDownRight size={16} />
      ) : (
        <Check size={16} />
      )}
      {value === 0
        ? 'Unchanged'
        : `${value > 0 ? 'Improved' : 'Down'} ${numberText(Math.abs(value))}`}
      {previousDate && <small>vs {dateText(previousDate)}</small>}
    </span>
  );
}

function KeywordCard({
  keyword,
  mode,
  manager,
  busy,
  onDetail,
  onEdit,
  onRecord,
  onSync,
  onToggle,
  onResearch,
}: {
  keyword: KeywordTrack;
  mode: 'google' | 'recorded' | 'answers';
  manager: boolean;
  busy: boolean;
  onDetail: () => void;
  onEdit: () => void;
  onRecord: (kind: 'search' | 'answer') => void;
  onSync: () => void;
  onToggle: () => void;
  onResearch: () => void;
}) {
  const [contextId, setContextId] = useState('');
  const series =
    keyword.answerSeries.find((item) => item.id === contextId) || keyword.answerSeries[0];
  const latestAnswer = series?.points.at(-1);
  const history = mode === 'recorded' ? keyword.recordedSearchHistory : keyword.searchHistory;
  const usable = history.filter((item) => item.position !== null);
  const latest = usable.at(-1);
  const previous = usable.at(-2);
  const improvement =
    latest && previous ? Math.round((previous.position! - latest.position!) * 100) / 100 : null;
  return (
    <article className="keyword-card">
      <div className="keyword-card-heading">
        <div>
          <h3>{keyword.keyword}</h3>
          <p>{keyword.institution}</p>
        </div>
        {mode === 'google' ? (
          <Badge
            tone={
              keyword.status === 'ready'
                ? 'green'
                : keyword.status === 'needs_attention'
                  ? 'red'
                  : 'gray'
            }
          >
            {labels[keyword.status]}
          </Badge>
        ) : (
          <Badge tone="violet">Recorded evidence</Badge>
        )}
      </div>
      <p className="keyword-property">
        {keyword.propertyName || keyword.propertyId || 'Search Console property not selected'}
      </p>
      <div className="keyword-context-labels">
        <span>{keyword.country ? keyword.country.toUpperCase() : 'All countries'}</span>
        <span>{keyword.device === 'all' ? 'All devices' : keyword.device.toLowerCase()}</span>
        <span>{keyword.searchType} search</span>
        {keyword.pageUrl && <span title={keyword.pageUrl}>One page</span>}
      </div>
      {mode === 'answers' ? (
        <>
          {series && (
            <label className="field keyword-context-picker">
              Answer context
              <select value={series.id} onChange={(event) => setContextId(event.target.value)}>
                {keyword.answerSeries.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.provider} · {item.model} · {item.language} · {item.locale} ·{' '}
                    {item.prompt.slice(0, 45)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="keyword-answer-metrics">
            <div>
              <span>Mention rate</span>
              <strong>
                {numberText(latestAnswer?.mentionRate)}
                {latestAnswer ? '%' : ''}
              </strong>
            </div>
            <div>
              <span>School citation rate</span>
              <strong>
                {numberText(latestAnswer?.citationRate)}
                {latestAnswer ? '%' : ''}
              </strong>
            </div>
          </div>
          <div className="keyword-answer-lines">
            <div>
              <span>Mentions</span>
              <KeywordLine
                points={(series?.points || []).map((point) => ({
                  date: point.date,
                  value: point.mentionRate,
                }))}
                percentage
                label={`Recorded mention rate for ${keyword.keyword}`}
              />
            </div>
            <div>
              <span>Citations</span>
              <KeywordLine
                points={(series?.points || []).map((point) => ({
                  date: point.date,
                  value: point.citationRate,
                }))}
                percentage
                color="#26836a"
                label={`Recorded target citation rate for ${keyword.keyword}`}
              />
            </div>
          </div>
          <p className="keyword-freshness">
            {latestAnswer
              ? `${latestAnswer.checks} recorded check${latestAnswer.checks === 1 ? '' : 's'} on ${dateText(latestAnswer.date)} (IST).`
              : 'Record an actual answer or ask ChatGPT to add evidence through MCP.'}
          </p>
          {series && (
            <p className="keyword-prompt" title={series.prompt}>
              Prompt: {series.prompt}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="keyword-position">
            <div>
              <span>
                {mode === 'google' ? 'Latest average position' : 'Latest recorded position'}
              </span>
              <strong>{numberText(latest?.position)}</strong>
            </div>
            <Movement value={improvement} previousDate={previous?.date} />
          </div>
          <KeywordLine
            points={history.map((point) => ({ date: point.date, value: point.position }))}
            label={`${mode === 'google' ? 'Search Console average position' : 'Team-recorded position'} for ${keyword.keyword}`}
          />
          <p className="keyword-freshness">
            {latest
              ? `${dateText(latest.date)}${mode === 'google' ? ' · Search Console reporting date (Pacific Time)' : ' · latest recorded check for that date'}`
              : mode === 'google'
                ? 'No search position is inferred until the property reports a query row.'
                : 'Manual and MCP evidence stays separate from API imports.'}
          </p>
          {mode === 'google' &&
            keyword.movement.latestCheckedDate &&
            keyword.movement.latestCheckedDate !== latest?.date && (
              <p className="keyword-gap-note">
                Checked through {dateText(keyword.movement.latestCheckedDate)}; newer dates have no
                reported query row.
              </p>
            )}
        </>
      )}
      {mode === 'google' && keyword.error && (
        <p className="keyword-card-error">
          <CircleAlert size={16} />
          {keyword.error}
        </p>
      )}
      <div className="keyword-card-footer">
        <Button size="sm" onClick={onDetail}>
          Evidence & history
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onRecord(mode === 'answers' ? 'answer' : 'search')}
        >
          <Plus size={15} />
          {mode === 'answers' ? 'Record answer' : 'Record check'}
        </Button>
        {mode === 'answers' && (
          <Button size="sm" variant="ghost" onClick={onResearch}>
            <Copy size={15} />
            Research prompt
          </Button>
        )}
        {mode === 'google' && manager && (
          <Button size="sm" disabled={busy || !keyword.canSync} onClick={onSync}>
            <RefreshCw size={15} className={busy ? 'spin' : ''} />
            {busy ? 'Checking…' : 'Check now'}
          </Button>
        )}
        {manager && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onEdit}
            aria-label={`Settings for ${keyword.keyword}`}
          >
            <Settings2 size={15} />
            Settings
          </Button>
        )}
      </div>
      {mode === 'google' && (
        <div className="keyword-schedule">
          <span>
            {keyword.autoSync && keyword.active ? 'Daily checks on' : 'Daily checks off'}
            {keyword.lastSuccessAt ? ` · Imported ${timeText(keyword.lastSuccessAt)}` : ''}
          </span>
          {manager && (
            <button
              type="button"
              className="text-link"
              disabled={busy || (!keyword.autoSync && !keyword.canSync)}
              onClick={onToggle}
            >
              {keyword.autoSync ? <Pause size={14} /> : <Play size={14} />}{' '}
              {keyword.autoSync ? 'Pause daily checks' : 'Enable daily checks'}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export default function KeywordTracking() {
  const { data, request, mutate, toast, selectedInstitution, setInstitution, navigate } =
    useWorkspace();
  const [loaded, setLoaded] = useState<KeywordData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [property, setProperty] = useState('all');
  const [mode, setMode] = useState<'google' | 'recorded' | 'answers'>('google');
  const [edit, setEdit] = useState<KeywordTrack | 'new' | null>(null);
  const [record, setRecord] = useState<{ keyword: KeywordTrack; kind: 'search' | 'answer' } | null>(
    null,
  );
  const [detailId, setDetailId] = useState<string | null>(currentKeywordId);
  const [detail, setDetail] = useState<KeywordDetail | null>(null);
  const [busy, setBusy] = useState('');
  const manager = data.user.role === 'manager';
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setLoaded(await request<KeywordData>('/rankings'));
      setError('');
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  }, [request]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]'))
        void reload();
    };
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [reload]);
  useEffect(() => {
    const update = () => setDetailId(currentKeywordId());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    let active = true;
    setDetail(null);
    if (detailId)
      void request<{ keyword: KeywordDetail }>(`/rankings/keywords/${encodeURIComponent(detailId)}`)
        .then((result) => {
          if (active) {
            setDetail(result.keyword);
            setInstitution(result.keyword.institution);
          }
        })
        .catch((caught) => {
          if (active) {
            setError(errorText(caught));
            setDetailId(null);
          }
        });
    return () => {
      active = false;
    };
  }, [detailId, request, setInstitution]);
  const keywords = loaded?.keywords || [];
  const shown = keywords.filter(
    (item) =>
      (selectedInstitution === 'all' || item.institution === selectedInstitution) &&
      (property === 'all' || item.propertyId === property) &&
      (!search ||
        `${item.keyword} ${item.propertyName}`.toLowerCase().includes(search.toLowerCase())),
  );
  const properties = [
    ...new Map(
      keywords
        .filter((item) => item.propertyId)
        .map((item) => [item.propertyId, item.propertyName || item.propertyId]),
    ).entries(),
  ];
  async function check(keyword: KeywordTrack) {
    setBusy(keyword.id);
    try {
      const result = await mutate<{
        reportedDays: number;
        range: { startDate: string; endDate: string };
      }>(`/rankings/keywords/${keyword.id}/sync`, 'POST', {});
      toast(
        `${result.reportedDays} reported day${result.reportedDays === 1 ? '' : 's'} through ${dateText(result.range.endDate)}. Missing dates remain gaps.`,
      );
      await reload();
    } catch (caught) {
      setError(errorText(caught));
      await reload();
      toast(errorText(caught), 'error');
    } finally {
      setBusy('');
    }
  }
  async function toggle(keyword: KeywordTrack) {
    setBusy(keyword.id);
    try {
      await mutate(`/rankings/keywords/${keyword.id}`, 'PATCH', {
        autoSync: !keyword.autoSync,
        active: true,
      });
      await reload();
      toast(
        keyword.autoSync
          ? 'Daily checks paused. Saved history remains.'
          : 'Daily checks enabled for this keyword and property.',
      );
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy('');
    }
  }
  async function research(keyword: KeywordTrack) {
    const text = `Use the connected St. Mary’s Marketing MCP tools to research this tracked keyword.\nKeyword ID: ${keyword.id}\nKeyword: ${keyword.keyword}\nSchool: ${keyword.institution}\nProperty: ${keyword.propertyId || 'Not yet connected'}\nCountry: ${keyword.country || 'all'}; device: ${keyword.device}; search type: ${keyword.searchType}\nExact answer-test prompt: ${keyword.answerPrompt}\nTarget website: ${keyword.answerTargetUrl || 'Set a target website before recording citations'}\nLocale: ${keyword.answerLocale}; language: ${keyword.answerLanguage}\nRecord only an actual dated report or answer, with its evidence URL, disclosed provider/model and source citations. If a model version is not disclosed, say so. Keep manual/MCP observations separate from direct Search Console imports. Do not infer a rank from missing data, invent citations, publish a post, or call a paid API.`;
    try {
      await navigator.clipboard.writeText(text);
      toast('Research task copied. Paste it into ChatGPT with the workspace MCP connection.');
    } catch {
      toast('Clipboard access was blocked. Open the evidence guide to prepare the task.', 'error');
    }
  }
  function closeDetails() {
    setDetailId(null);
    setDetail(null);
    if (currentKeywordId()) window.history.replaceState(null, '', '#performance?tab=keywords');
  }
  return (
    <section className="keyword-section">
      <div className="report-section-heading">
        <div>
          <h2>Keyword trends</h2>
          <p>
            Follow each keyword and property over time, with a source and date behind every point.
          </p>
        </div>
        <div className="keyword-heading-actions">
          <Button disabled={loading} onClick={() => void reload()}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            Refresh view
          </Button>
          {manager && (
            <Button variant="primary" onClick={() => setEdit('new')}>
              <Plus size={16} />
              Add keyword
            </Button>
          )}
        </div>
      </div>
      <div className="keyword-explainer">
        <LineChart size={22} />
        <div>
          <strong>Daily search history. Evidence for AI answers.</strong>
          <p>
            Search Console checks use finalized daily average positions, usually several days behind
            today. AI mention and citation trends use actual team or MCP observations. This
            workspace makes no paid AI or SERP requests.
          </p>
        </div>
      </div>
      <div className="keyword-summary">
        <span>
          <strong>{keywords.length}</strong> of {loaded?.limits.maxKeywords || 60} keyword tracks
        </span>
        <span>
          <strong>{keywords.filter((item) => item.autoSync && item.active).length}</strong> daily
          schedules
        </span>
        <span>Each property and filter combination stays separate</span>
      </div>
      <div className="keyword-toolbar">
        <div className="tabs keyword-view-tabs" aria-label="Keyword evidence source">
          {(
            [
              { id: 'google', label: 'Google search' },
              { id: 'recorded', label: 'Recorded search checks' },
              { id: 'answers', label: 'AEO / GEO evidence' },
            ] as const
          ).map((item) => (
            <button
              type="button"
              className={`tab ${mode === item.id ? 'active' : ''}`}
              aria-pressed={mode === item.id}
              key={item.id}
              onClick={() => setMode(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="keyword-filters">
          <label className="keyword-search">
            <Search size={18} />
            <input
              aria-label="Filter keywords"
              placeholder="Find a keyword…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select
            aria-label="Filter Search Console property"
            value={property}
            onChange={(event) => setProperty(event.target.value)}
          >
            <option value="all">All properties</option>
            {properties.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {mode === 'google' && (
        <p className="keyword-source-note">
          Lower average position is better. Query rows can be absent because of reporting limits or
          privacy filtering; a gap does not mean rank zero or a proven ranking loss. Charts show up
          to 90 days.
        </p>
      )}
      {mode === 'recorded' && (
        <p className="keyword-source-note">
          These are source-linked observations entered by a teammate or MCP assistant. The graph
          shows the latest recorded check per date for the current property and filters. It does not
          replace verified API data.
        </p>
      )}
      {mode === 'answers' && (
        <p className="keyword-source-note">
          Each graph keeps its exact prompt, provider, model, location and language together.
          Percentages describe the recorded checks in that context; they are not a universal AI
          ranking.
        </p>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {!loaded && loading ? (
        <p className="keyword-loading">Loading saved keyword history…</p>
      ) : shown.length ? (
        <div className="keyword-grid">
          {shown.map((keyword) => (
            <KeywordCard
              key={keyword.id}
              keyword={keyword}
              mode={mode}
              manager={manager}
              busy={busy === keyword.id}
              onDetail={() => setDetailId(keyword.id)}
              onEdit={() => setEdit(keyword)}
              onRecord={(kind) => setRecord({ keyword, kind })}
              onSync={() => void check(keyword)}
              onToggle={() => void toggle(keyword)}
              onResearch={() => void research(keyword)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<LineChart size={28} />}
          title={
            keywords.length
              ? 'No keywords match these filters'
              : 'Start with the keywords parents use'
          }
          description={
            keywords.length
              ? 'Change the school, property or search filter to see the saved tracks.'
              : 'Add a keyword, choose its school and optionally select a Search Console property. You can save research before connecting an account.'
          }
          action={
            manager ? (
              <Button variant="primary" onClick={() => setEdit('new')}>
                <Plus size={16} />
                Add keyword
              </Button>
            ) : undefined
          }
        />
      )}
      <div className="keyword-bottom-note">
        <span>
          Daily imports need an authorized Search Console property. A scheduled sweep processes up
          to three due tracks at a time; each enabled track becomes due every 24 hours.
        </span>
        <Button variant="ghost" onClick={() => navigate('settings')}>
          <Link2 size={16} />
          Manage connections
        </Button>
      </div>
      {edit && (
        <KeywordForm
          keyword={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={async () => {
            setEdit(null);
            await reload();
          }}
        />
      )}
      {record && (
        <EvidenceForm
          keyword={record.keyword}
          kind={record.kind}
          onClose={() => setRecord(null)}
          onSaved={async () => {
            setRecord(null);
            await reload();
          }}
        />
      )}
      {detailId && (
        <KeywordDetails
          keyword={detail}
          onClose={closeDetails}
          onResearch={() => detail && void research(detail)}
        />
      )}
    </section>
  );
}

function KeywordForm({
  keyword,
  onClose,
  onSaved,
}: {
  keyword: KeywordTrack | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { data, mutate, toast, selectedInstitution } = useWorkspace();
  const [form, setForm] = useState({
    keyword: keyword?.keyword || '',
    institution:
      keyword?.institution ||
      (selectedInstitution !== 'all' ? selectedInstitution : institutions[0]),
    connectionId: keyword?.connectionId || '',
    country: keyword?.country ?? 'ind',
    device: keyword?.device || 'all',
    searchType: keyword?.searchType || 'web',
    pageUrl: keyword?.pageUrl || '',
    answerPrompt: keyword?.answerPrompt || '',
    answerTargetUrl: keyword?.answerTargetUrl ?? 'https://smis.edu.in/',
    answerLocale: keyword?.answerLocale || 'Chikmagalur, Karnataka, India',
    answerLanguage: keyword?.answerLanguage || 'English',
    autoSync: keyword?.autoSync || false,
    active: keyword?.active ?? true,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [remove, setRemove] = useState(false);
  const accounts = data.connections.filter(
    (item) =>
      item.provider === 'search_console' &&
      item.status === 'connected' &&
      item.capabilities.includes('analytics:read') &&
      item.institution === form.institution &&
      (!keyword?.propertyId || keyword.propertyId === item.accountId),
  );
  const change = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const shared = {
        connectionId: form.connectionId || null,
        answerPrompt: form.answerPrompt.trim() || form.keyword.trim(),
        answerTargetUrl: form.answerTargetUrl,
        answerLocale: form.answerLocale,
        answerLanguage: form.answerLanguage,
        autoSync: form.autoSync,
      };
      await mutate(
        keyword ? `/rankings/keywords/${keyword.id}` : '/rankings/keywords',
        keyword ? 'PATCH' : 'POST',
        keyword
          ? { ...shared, active: form.active }
          : {
              ...shared,
              keyword: form.keyword,
              institution: form.institution,
              country: form.country,
              device: form.device,
              searchType: form.searchType,
              pageUrl: form.pageUrl,
            },
      );
      toast(
        keyword
          ? 'Keyword settings saved. Earlier evidence keeps its original context.'
          : 'Keyword added. History will show actual observations as they arrive.',
      );
      await onSaved();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  async function removeTrack() {
    if (!keyword) return;
    setBusy(true);
    setError('');
    try {
      await mutate(`/rankings/keywords/${keyword.id}`, 'DELETE');
      toast('Keyword track and its history removed.');
      await onSaved();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={keyword ? 'Keyword settings' : 'Add a tracked keyword'}
      onClose={() => !busy && onClose()}
      className="keyword-form-modal"
    >
      <form className="stack" onSubmit={submit}>
        <label className="field">
          Exact keyword
          <input
            required
            maxLength={200}
            value={form.keyword}
            disabled={Boolean(keyword)}
            onChange={(event) => change('keyword', event.target.value)}
            placeholder="best PU college in Chikmagalur"
          />
          <small>
            Search Console query matching is exact, including case. A different term or filter gets
            a separate track.
          </small>
        </label>
        <label className="field">
          School
          <select
            value={form.institution}
            disabled={Boolean(keyword)}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                institution: event.target.value,
                connectionId: '',
                autoSync: false,
              }))
            }
          >
            {institutions.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Search Console property
          <select
            value={form.connectionId}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                connectionId: event.target.value,
                autoSync: event.target.value ? current.autoSync : false,
              }))
            }
          >
            <option value="">Choose later — save the keyword first</option>
            {form.connectionId && !accounts.some((item) => item.id === form.connectionId) && (
              <option value={form.connectionId} disabled>
                Reconnect the saved property
              </option>
            )}
            {accounts.map((item) => (
              <option value={item.id} key={item.id}>
                {item.accountName} · {item.accountId}
              </option>
            ))}
          </select>
          <small>
            {accounts.length
              ? 'Only eligible properties for this school are listed.'
              : 'No connected Search Console property for this school yet. You can still save the keyword and record evidence.'}
          </small>
        </label>
        <div className="form-grid">
          <label className="field">
            Country code
            <input
              maxLength={3}
              pattern="[A-Za-z]{3}|"
              disabled={Boolean(keyword)}
              value={form.country}
              onChange={(event) => change('country', event.target.value)}
              placeholder="IND"
            />
            <small>Three letters, e.g. IND. Leave empty for all countries.</small>
          </label>
          <label className="field">
            Device
            <select
              value={form.device}
              disabled={Boolean(keyword)}
              onChange={(event) => change('device', event.target.value as typeof form.device)}
            >
              <option value="all">All devices</option>
              <option value="MOBILE">Mobile</option>
              <option value="DESKTOP">Desktop</option>
              <option value="TABLET">Tablet</option>
            </select>
          </label>
        </div>
        <div className="form-grid">
          <label className="field">
            Search type
            <select
              disabled={Boolean(keyword)}
              value={form.searchType}
              onChange={(event) =>
                change('searchType', event.target.value as typeof form.searchType)
              }
            >
              <option value="web">Web search</option>
              <option value="image">Image search</option>
              <option value="video">Video search</option>
              <option value="news">News search</option>
            </select>
          </label>
          <label className="field">
            Specific page, optional
            <input
              type="url"
              maxLength={2048}
              disabled={Boolean(keyword)}
              value={form.pageUrl}
              onChange={(event) => change('pageUrl', event.target.value)}
              placeholder="https://smis.edu.in/page/"
            />
          </label>
        </div>
        <label className="keyword-checkbox">
          <input
            type="checkbox"
            checked={form.autoSync}
            disabled={!form.connectionId}
            onChange={(event) => change('autoSync', event.target.checked)}
          />
          <span>
            Enable daily Search Console checks
            <small>
              Finalized reporting dates, one query per due track, no paid ranking service.
            </small>
          </span>
        </label>
        {keyword && (
          <label className="keyword-checkbox">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => change('active', event.target.checked)}
            />
            <span>
              Keep this track active<small>Pausing retains all saved history.</small>
            </span>
          </label>
        )}
        <details className="keyword-form-details" open={Boolean(keyword)}>
          <summary>AEO / GEO research context</summary>
          <div className="stack">
            <label className="field">
              Exact answer-test prompt
              <textarea
                rows={3}
                maxLength={2000}
                value={form.answerPrompt}
                onChange={(event) => change('answerPrompt', event.target.value)}
                placeholder="Leave empty to use the keyword itself."
              />
            </label>
            <label className="field">
              Target school website
              <input
                type="url"
                maxLength={2048}
                value={form.answerTargetUrl}
                onChange={(event) => change('answerTargetUrl', event.target.value)}
                placeholder="https://smis.edu.in/"
              />
              <small>
                Used to distinguish citations to your school from links to other sources.
              </small>
            </label>
            <div className="form-grid">
              <label className="field">
                Location context
                <input
                  required
                  maxLength={180}
                  value={form.answerLocale}
                  onChange={(event) => change('answerLocale', event.target.value)}
                />
              </label>
              <label className="field">
                Language
                <input
                  required
                  maxLength={80}
                  value={form.answerLanguage}
                  onChange={(event) => change('answerLanguage', event.target.value)}
                />
              </label>
            </div>
            <p className="keyword-source-note">
              This saves a repeatable research question. Actual answers can be recorded by your team
              or through MCP; no AI API request is made here.
            </p>
          </div>
        </details>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {remove && (
          <div className="keyword-delete-confirm">
            <strong>Remove this track and all its saved evidence?</strong>
            <p>
              Connected accounts and other keyword tracks remain available. This deletion cannot be
              undone in the interface.
            </p>
            <Button variant="danger" disabled={busy} onClick={() => void removeTrack()}>
              Remove keyword and history
            </Button>
            <Button disabled={busy} onClick={() => setRemove(false)}>
              Keep it
            </Button>
          </div>
        )}
        <div className="form-actions">
          {keyword && !remove && (
            <Button variant="ghost" disabled={busy} onClick={() => setRemove(true)}>
              <Trash2 size={16} />
              Remove track
            </Button>
          )}
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || remove}>
            {busy ? 'Saving…' : keyword ? 'Save settings' : 'Add keyword'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EvidenceForm({
  keyword,
  kind,
  onClose,
  onSaved,
}: {
  keyword: KeywordTrack;
  kind: 'search' | 'answer';
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { mutate, toast } = useWorkspace();
  const [form, setForm] = useState({
    date: localParts().slice(0, 10),
    position: '',
    clicks: '',
    impressions: '',
    evidenceUrl: '',
    notes: '',
    provider: 'ChatGPT',
    model: '',
    checkedAt: localParts(),
    answerExcerpt: '',
    mentioned: false,
    cited: false,
    citations: '',
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const change = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload =
        kind === 'search'
          ? {
              date: form.date,
              position: Number(form.position),
              clicks: form.clicks ? Number(form.clicks) : null,
              impressions: form.impressions ? Number(form.impressions) : null,
              evidenceUrl: form.evidenceUrl,
              notes: form.notes,
            }
          : {
              provider: form.provider,
              model: form.model,
              checkedAt: new Date(`${form.checkedAt}:00+05:30`).toISOString(),
              answerExcerpt: form.answerExcerpt,
              mentioned: form.mentioned,
              cited: form.cited,
              citationUrls: form.citations
                .split(/\r?\n/)
                .map((value) => value.trim())
                .filter(Boolean),
              evidenceUrl: form.evidenceUrl,
              notes: form.notes,
            };
      await mutate(
        `/rankings/keywords/${keyword.id}/${kind === 'search' ? 'search-observations' : 'answer-observations'}`,
        'POST',
        payload,
      );
      toast('Dated evidence saved with its source and context.');
      await onSaved();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={kind === 'search' ? 'Record a search observation' : 'Record an actual AI answer'}
      onClose={() => !busy && onClose()}
      className="keyword-form-modal"
    >
      <form className="stack" onSubmit={submit}>
        <div className="keyword-evidence-context">
          <strong>{keyword.keyword}</strong>
          <span>{keyword.institution}</span>
          <p>
            {kind === 'search'
              ? 'This is team-entered research. It will be shown separately from direct Search Console imports.'
              : `Prompt: ${keyword.answerPrompt}`}
          </p>
          {kind === 'answer' && (
            <small>
              {keyword.answerLocale} · {keyword.answerLanguage} · target{' '}
              {keyword.answerTargetUrl || 'not set'}
            </small>
          )}
        </div>
        {kind === 'search' ? (
          <>
            <div className="form-grid">
              <label className="field">
                Source date
                <input
                  required
                  type="date"
                  max={localParts().slice(0, 10)}
                  value={form.date}
                  onChange={(event) => change('date', event.target.value)}
                />
              </label>
              <label className="field">
                Observed position
                <input
                  required
                  type="number"
                  min="1"
                  max="1000000"
                  step="any"
                  value={form.position}
                  onChange={(event) => change('position', event.target.value)}
                  placeholder="e.g. 8.4"
                />
              </label>
            </div>
            <div className="form-grid">
              <label className="field">
                Clicks, if reported
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.clicks}
                  onChange={(event) => change('clicks', event.target.value)}
                />
              </label>
              <label className="field">
                Impressions, if reported
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.impressions}
                  onChange={(event) => change('impressions', event.target.value)}
                />
              </label>
            </div>
          </>
        ) : (
          <>
            <div className="form-grid">
              <label className="field">
                Answer provider
                <input
                  required
                  maxLength={100}
                  value={form.provider}
                  onChange={(event) => change('provider', event.target.value)}
                />
              </label>
              <label className="field">
                Model / version shown
                <input
                  required
                  maxLength={120}
                  value={form.model}
                  onChange={(event) => change('model', event.target.value)}
                  placeholder="Actual model, or “not disclosed”"
                />
              </label>
            </div>
            <label className="field">
              When was the answer checked? (IST)
              <input
                required
                type="datetime-local"
                value={form.checkedAt}
                onChange={(event) => change('checkedAt', event.target.value)}
              />
            </label>
            <label className="field">
              Actual answer excerpt
              <textarea
                required
                rows={5}
                maxLength={4000}
                value={form.answerExcerpt}
                onChange={(event) => change('answerExcerpt', event.target.value)}
                placeholder="Paste the relevant passage you actually received."
              />
            </label>
            <label className="keyword-checkbox">
              <input
                type="checkbox"
                checked={form.mentioned}
                onChange={(event) => change('mentioned', event.target.checked)}
              />
              <span>The answer mentions this school</span>
            </label>
            <label className="keyword-checkbox">
              <input
                type="checkbox"
                checked={form.cited}
                onChange={(event) => change('cited', event.target.checked)}
              />
              <span>The answer cites the target school website</span>
            </label>
            <label className="field">
              Actual citation URLs, one per line
              <textarea
                rows={3}
                maxLength={20000}
                value={form.citations}
                onChange={(event) => change('citations', event.target.value)}
                placeholder="https://smis.edu.in/..."
              />
              <small>
                A school citation must link to the target website. Other source links can be
                retained too.
              </small>
            </label>
          </>
        )}
        <label className="field">
          {kind === 'search' ? 'Source or evidence URL' : 'Answer share/evidence URL, optional'}
          <input
            type="url"
            required={kind === 'search'}
            maxLength={2048}
            value={form.evidenceUrl}
            onChange={(event) => change('evidenceUrl', event.target.value)}
            placeholder="https://..."
          />
          <small>
            Use a source page or safe share link. Never include login, setup or access-token links.
          </small>
        </label>
        <label className="field">
          {kind === 'search' ? 'Source, method and context' : 'Notes, optional'}
          <textarea
            required={kind === 'search'}
            minLength={kind === 'search' ? 5 : undefined}
            rows={3}
            maxLength={2000}
            value={form.notes}
            onChange={(event) => change('notes', event.target.value)}
            placeholder={
              kind === 'search'
                ? 'Explain which report or search check produced this observation, and its location/device context.'
                : ''
            }
          />
        </label>
        {kind === 'answer' && !keyword.answerTargetUrl && (
          <p className="form-error">
            A manager must set the target website in keyword settings before you can save answer
            evidence.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={busy || (kind === 'answer' && !keyword.answerTargetUrl)}
          >
            {busy ? 'Saving…' : 'Save evidence'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function csvCell(value: unknown) {
  let text = value == null ? '' : String(value);
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function KeywordDetails({
  keyword,
  onClose,
  onResearch,
}: {
  keyword: KeywordDetail | null;
  onClose: () => void;
  onResearch: () => void;
}) {
  const [table, setTable] = useState<'google' | 'recorded' | 'answers'>('google');
  function download() {
    if (!keyword) return;
    let rows: unknown[][];
    if (table === 'google')
      rows = [
        [
          'Keyword',
          'Property',
          'Country',
          'Device',
          'Search type',
          'Page',
          'Date (Pacific Time)',
          'Average position',
          'Clicks',
          'Impressions',
          'CTR',
          'Availability',
          'Imported at',
        ],
        ...keyword.searchHistory.map((row) => [
          keyword.keyword,
          keyword.propertyId,
          keyword.country,
          keyword.device,
          keyword.searchType,
          keyword.pageUrl,
          row.date,
          row.position,
          row.clicks,
          row.impressions,
          row.ctr,
          row.availability,
          row.importedAt,
        ]),
      ];
    else if (table === 'recorded')
      rows = [
        [
          'Keyword',
          'Date',
          'Position',
          'Clicks',
          'Impressions',
          'Provenance',
          'Evidence URL',
          'Notes',
          'Original identity',
          'Recorded by',
        ],
        ...keyword.searchEvidence.map((row) => [
          keyword.keyword,
          row.date,
          row.position,
          row.clicks,
          row.impressions,
          row.provenance,
          row.evidenceUrl,
          row.notes,
          JSON.stringify(row.identitySnapshot),
          row.recordedBy,
        ]),
      ];
    else
      rows = [
        [
          'Keyword',
          'Checked at',
          'Provider',
          'Model',
          'Prompt',
          'Target',
          'Locale',
          'Language',
          'Mentioned',
          'Cited',
          'Citation URLs',
          'Excerpt',
          'Evidence URL',
          'Notes',
          'Provenance',
        ],
        ...keyword.answerEvidence.map((row) => [
          keyword.keyword,
          row.checkedAt,
          row.provider,
          row.model,
          row.prompt,
          row.targetUrl,
          row.locale,
          row.language,
          row.mentioned,
          row.cited,
          row.citationUrls.join(' | '),
          row.answerExcerpt,
          row.evidenceUrl,
          row.notes,
          row.provenance,
        ]),
      ];
    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], {
        type: 'text/csv;charset=utf-8',
      }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `keyword-${keyword.id}-${table}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const samples: SearchSample[] = keyword ? [...keyword.searchHistory].reverse() : [];
  return (
    <Modal title="Keyword evidence & history" onClose={onClose} className="keyword-history-modal">
      {!keyword ? (
        <p>Loading the saved record…</p>
      ) : (
        <div className="stack">
          <div className="keyword-detail-heading">
            <div>
              <h3>{keyword.keyword}</h3>
              <p>
                {keyword.institution} · {keyword.propertyId || 'Property not yet selected'}
              </p>
            </div>
            <Button onClick={download}>
              <Download size={16} />
              Export this table
            </Button>
          </div>
          <div className="keyword-detail-summary">
            <span>
              {keyword.country ? keyword.country.toUpperCase() : 'All countries'} ·{' '}
              {keyword.device === 'all' ? 'All devices' : keyword.device} · {keyword.searchType}
            </span>
            <span>Last API import: {timeText(keyword.lastSuccessAt)}</span>
            <span>
              Next daily check:{' '}
              {keyword.nextSyncAt ? timeText(keyword.nextSyncAt) : 'Off or awaiting connection'}
            </span>
          </div>
          <div className="tabs keyword-view-tabs" aria-label="Keyword history source">
            {(
              [
                { id: 'google', label: 'Search Console' },
                { id: 'recorded', label: 'Recorded checks' },
                { id: 'answers', label: 'AI answers' },
              ] as const
            ).map((item) => (
              <button
                className={`tab ${table === item.id ? 'active' : ''}`}
                aria-pressed={table === item.id}
                key={item.id}
                onClick={() => setTable(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {table === 'google' &&
            (samples.length ? (
              <div className="keyword-table-scroll">
                <table>
                  <caption>
                    Authorized Search Console API history. Empty metrics mean no reported query row.
                    Reporting dates use Pacific Time.
                  </caption>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Average position</th>
                      <th>Clicks</th>
                      <th>Impressions</th>
                      <th>CTR</th>
                      <th>Availability</th>
                    </tr>
                  </thead>
                  <tbody>
                    {samples.map((row) => (
                      <tr key={row.date}>
                        <td>{dateText(row.date)}</td>
                        <td>{numberText(row.position)}</td>
                        <td>{numberText(row.clicks, 0)}</td>
                        <td>{numberText(row.impressions, 0)}</td>
                        <td>{row.ctr === null ? '—' : `${numberText(row.ctr * 100)}%`}</td>
                        <td>{row.availability === 'reported' ? 'Reported' : 'No query row'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="keyword-source-note">
                No authorized Search Console import has been saved for this keyword. Manual/MCP
                evidence appears under Recorded checks.
              </p>
            ))}
          {table === 'recorded' &&
            (keyword.searchEvidence.length ? (
              <div className="keyword-records">
                {keyword.searchEvidence.map((row) => (
                  <article key={row.id}>
                    <div>
                      <strong>
                        {dateText(row.date)} · position {numberText(row.position)}
                      </strong>
                      <Badge tone="violet">
                        {row.provenance === 'mcp' ? 'MCP recorded' : 'Team recorded'}
                      </Badge>
                    </div>
                    <p>{row.notes}</p>
                    <a href={row.evidenceUrl} target="_blank" rel="noreferrer">
                      Open evidence <ArrowUpRight size={14} />
                    </a>
                    <small>
                      {row.recordedBy} ·{' '}
                      {row.identitySnapshot.propertyId ||
                        'Property was not selected at recording time'}{' '}
                      · {row.identitySnapshot.country || 'All countries'} ·{' '}
                      {row.identitySnapshot.device}
                    </small>
                  </article>
                ))}
              </div>
            ) : (
              <p className="keyword-source-note">
                No manual or MCP search evidence has been recorded.
              </p>
            ))}
          {table === 'answers' && (
            <>
              <div className="keyword-research-action">
                <p>Each observation keeps its exact question, provider, model and source links.</p>
                <Button onClick={onResearch}>
                  <Copy size={16} />
                  Copy research task
                </Button>
              </div>
              {keyword.answerEvidence.length ? (
                <div className="keyword-records">
                  {keyword.answerEvidence.map((row) => (
                    <article key={row.id}>
                      <div>
                        <strong>
                          {row.provider} · {row.model}
                        </strong>
                        <Badge tone="violet">
                          {row.provenance === 'mcp' ? 'MCP recorded' : 'Team recorded'}
                        </Badge>
                      </div>
                      <small>
                        {timeText(row.checkedAt)} · {row.locale} · {row.language}
                      </small>
                      <p>
                        <strong>Prompt:</strong> {row.prompt}
                      </p>
                      <blockquote>{row.answerExcerpt}</blockquote>
                      <div>
                        <Badge tone={row.mentioned ? 'green' : 'gray'}>
                          {row.mentioned ? 'School mentioned' : 'No school mention'}
                        </Badge>
                        <Badge tone={row.cited ? 'green' : 'gray'}>
                          {row.cited ? 'School cited' : 'No school citation'}
                        </Badge>
                      </div>
                      {row.citationUrls.map((url) => (
                        <a key={url} href={url} target="_blank" rel="noreferrer">
                          {url} <ArrowUpRight size={14} />
                        </a>
                      ))}
                      {row.evidenceUrl && (
                        <a href={row.evidenceUrl} target="_blank" rel="noreferrer">
                          Open answer evidence <ArrowUpRight size={14} />
                        </a>
                      )}
                      {row.notes && <p>{row.notes}</p>}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="keyword-source-note">
                  No actual answers have been recorded. The app does not make billable AI calls.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
