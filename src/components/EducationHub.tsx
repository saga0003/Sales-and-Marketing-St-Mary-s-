import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  BookOpen,
  GraduationCap,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import { Badge, Button, EmptyState, Modal } from './UI';
import {
  EvidenceLink,
  intelligenceError,
  lines,
  ReferenceEditor,
  References,
  researchStamp,
} from './IntelligenceV4Shared';
import type {
  CareerPathway,
  EducationData,
  EducationStream,
  EntryRoute,
  ExamRecord,
  Milestone,
  ReferenceLink,
} from './intelligence-v4-types';
import '../styles/intelligence-v4.css';

const streams: EducationStream[] = ['Science', 'Commerce', 'Humanities', 'Vocational', 'Any'];
type EducationSelection =
  { kind: 'exam'; record: ExamRecord } | { kind: 'pathway'; record: CareerPathway };
type EducationEditor =
  { kind: 'exam'; record?: ExamRecord } | { kind: 'pathway'; record?: CareerPathway };

export default function EducationHub({
  onResearchRequested,
}: {
  onResearchRequested: (id: string) => void;
}) {
  const { data, request, mutate, toast } = useWorkspace();
  const [info, setInfo] = useState<EducationData | null>(null);
  const [section, setSection] = useState<'exams' | 'pathways'>('exams');
  const [stream, setStream] = useState('all');
  const [query, setQuery] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editor, setEditor] = useState<EducationEditor | null>(null);
  const [selected, setSelected] = useState<EducationSelection | null>(null);
  const [review, setReview] = useState<EducationSelection | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const manager = data.user.role === 'manager';
  const load = useCallback(async () => {
    try {
      setInfo(await request<EducationData>('/intelligence/education'));
      setError('');
    } catch (caught) {
      setError(intelligenceError(caught));
    }
  }, [request]);
  useEffect(() => {
    void load();
  }, [load]);
  const exams = (info?.exams || []).filter(
    (item) =>
      (includeArchived || item.status !== 'archived') &&
      (stream === 'all' ||
        item.streams.includes(stream as EducationStream) ||
        item.streams.includes('Any')) &&
      `${item.name} ${item.description} ${item.category} ${item.academicYear}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const pathways = (info?.pathways || []).filter(
    (item) =>
      (includeArchived || item.status !== 'archived') &&
      (stream === 'all' || item.stream === stream || item.stream === 'Any') &&
      `${item.name} ${item.field} ${item.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  async function researchExam(exam: ExamRecord) {
    setBusy(exam.id);
    setError('');
    try {
      const result = await mutate<{ request: { id: string }; existing: boolean }>(
        '/intelligence/research-requests',
        'POST',
        { targetType: 'exam', targetId: exam.id },
      );
      toast(
        result.existing
          ? 'This exam already has a pending research request.'
          : 'Research requested. The official sources still need to be inspected.',
      );
      onResearchRequested(result.request.id);
    } catch (caught) {
      setError(intelligenceError(caught));
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="iv4-page">
      <section className="iv4-intro">
        <div>
          <span className="eyebrow">FROM EXAMS TO OPPORTUNITIES</span>
          <h2>A growing guide for your students.</h2>
          <p>
            Save exams, official reference links and dated milestones. Build career routes by
            stream, with eligibility and entry methods your team can review.
          </p>
        </div>
        <div className="iv4-intro-metric">
          <strong>{info?.exams.filter((item) => item.status !== 'archived').length || 0}</strong>
          <span>exams in your registry</span>
          <strong>{info?.pathways.filter((item) => item.status !== 'archived').length || 0}</strong>
          <span>career pathways</span>
        </div>
      </section>
      <div className="iv4-toolbar">
        <div className="tabs" aria-label="Education sections">
          <button
            className={`tab ${section === 'exams' ? 'active' : ''}`}
            aria-pressed={section === 'exams'}
            onClick={() => setSection('exams')}
          >
            <BookOpen size={16} />
            Exam registry
          </button>
          <button
            className={`tab ${section === 'pathways' ? 'active' : ''}`}
            aria-pressed={section === 'pathways'}
            onClick={() => setSection('pathways')}
          >
            <GraduationCap size={16} />
            Career pathways
          </button>
        </div>
        <div className="iv4-actions">
          <Button
            aria-label="Refresh education records"
            disabled={!!busy}
            onClick={() => void load()}
          >
            <RefreshCw size={16} />
          </Button>
          <Button
            variant="primary"
            onClick={() => setEditor({ kind: section === 'exams' ? 'exam' : 'pathway' })}
          >
            <Plus size={16} />
            Add {section === 'exams' ? 'exam' : 'pathway'}
          </Button>
        </div>
      </div>
      <div className="iv4-filters">
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Search education records"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              section === 'exams'
                ? 'Search exams, boards, or years…'
                : 'Search fields or career routes…'
            }
          />
        </label>
        <select
          aria-label="Filter by school stream"
          value={stream}
          onChange={(event) => setStream(event.target.value)}
        >
          <option value="all">All streams</option>
          {streams.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <label className="iv4-check">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />
          Include archived
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!info && !error && <p role="status">Loading your education guide…</p>}
      {section === 'exams' &&
        info &&
        (exams.length ? (
          <div className="iv4-card-grid">
            {exams.map((item) => (
              <article className="iv4-card" key={item.id}>
                <div className="iv4-badges">
                  <Badge tone="violet">{item.category}</Badge>
                  <Badge tone={item.verification === 'verified' ? 'green' : 'amber'}>
                    {item.verification === 'verified'
                      ? 'Reviewed by manager'
                      : 'Needs source review'}
                  </Badge>
                  {item.status !== 'tracking' && <Badge>{item.status}</Badge>}
                </div>
                <h3>{item.name}</h3>
                <p className="iv4-card-subtitle">
                  {item.streams.join(' · ')}
                  {item.academicYear ? ` · ${item.academicYear}` : ' · Year not specified'}
                </p>
                <p className="iv4-clamp">{item.description}</p>
                <References links={item.referenceLinks.slice(0, 3)} />
                {item.milestones.length > 0 && (
                  <div className="iv4-milestone-summary">
                    {item.milestones.slice(0, 2).map((milestone, index) => (
                      <div key={index}>
                        <strong>{milestone.label}</strong>
                        <span>{milestone.date || 'Date to confirm'}</span>
                      </div>
                    ))}
                    {item.milestones.length > 2 && (
                      <small>+{item.milestones.length - 2} more milestones</small>
                    )}
                  </div>
                )}
                <div className="iv4-card-meta">
                  <span>Revision {item.revision}</span>
                  <span>
                    {item.watchIds.length
                      ? `${item.watchIds.length} source ${item.watchIds.length === 1 ? 'watch' : 'watches'} linked`
                      : 'Link a source watch to collect updates'}
                  </span>
                </div>
                <div className="iv4-actions">
                  <Button size="sm" onClick={() => setSelected({ kind: 'exam', record: item })}>
                    View guide
                    <ArrowRight size={15} />
                  </Button>
                  <Button size="sm" onClick={() => setEditor({ kind: 'exam', record: item })}>
                    <Pencil size={15} />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    disabled={!!busy || item.status === 'archived'}
                    onClick={() => void researchExam(item)}
                  >
                    Request research
                  </Button>
                  {manager && item.status !== 'archived' && item.verification !== 'verified' && (
                    <Button size="sm" onClick={() => setReview({ kind: 'exam', record: item })}>
                      <ShieldCheck size={15} />
                      Review
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<BookOpen size={28} />}
            title={
              query || stream !== 'all'
                ? 'No exams match these filters'
                : 'Add the exams your community follows'
            }
            description="Save a name, description and official source. Link an existing source watch to collect notices, then review dates and eligibility for the relevant year."
            action={
              <Button variant="primary" onClick={() => setEditor({ kind: 'exam' })}>
                <Plus size={16} />
                Add exam
              </Button>
            }
          />
        ))}
      {section === 'pathways' && info && (
        <>
          <div className="iv4-notice">
            <GraduationCap size={20} />
            <p>
              <strong>Build a source-backed route map.</strong> Start with a stream, then a field,
              entry routes, linked exams, education and outcomes. The suggestions below are planning
              prompts; they do not establish current eligibility.
            </p>
          </div>
          {pathways.length ? (
            <div className="iv4-card-grid">
              {pathways.map((item) => (
                <article className="iv4-card" key={item.id}>
                  <div className="iv4-badges">
                    <Badge tone="violet">{item.stream}</Badge>
                    <Badge tone={item.verification === 'verified' ? 'green' : 'amber'}>
                      {item.verification === 'verified'
                        ? 'Reviewed by manager'
                        : 'Needs source review'}
                    </Badge>
                    {item.status !== 'active' && <Badge>{item.status}</Badge>}
                  </div>
                  <h3>{item.name}</h3>
                  <p className="iv4-card-subtitle">
                    {item.field}
                    {item.academicYear ? ` · ${item.academicYear}` : ''}
                  </p>
                  <p className="iv4-clamp">{item.description}</p>
                  <div className="iv4-route-preview">
                    {item.entryRoutes.map((route, index) => (
                      <span key={index}>
                        <ArrowRight size={14} />
                        {route.name}
                      </span>
                    ))}
                    {!item.entryRoutes.length && <span>Entry routes still to be researched</span>}
                  </div>
                  <References links={item.referenceLinks.slice(0, 3)} />
                  <div className="iv4-card-meta">
                    <span>Revision {item.revision}</span>
                    <span>{item.entryRoutes.length} entry routes</span>
                  </div>
                  <div className="iv4-actions">
                    <Button
                      size="sm"
                      onClick={() => setSelected({ kind: 'pathway', record: item })}
                    >
                      Explore routes
                      <ArrowRight size={15} />
                    </Button>
                    <Button size="sm" onClick={() => setEditor({ kind: 'pathway', record: item })}>
                      <Pencil size={15} />
                      Edit
                    </Button>
                    {manager && item.status !== 'archived' && item.verification !== 'verified' && (
                      <Button
                        size="sm"
                        onClick={() => setReview({ kind: 'pathway', record: item })}
                      >
                        <ShieldCheck size={15} />
                        Review
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<GraduationCap size={28} />}
              title="Map the first career pathway"
              description="Create a guide your team can expand over time. Keep admission methods, age rules, subject requirements and academic years attached to their sources."
              action={
                <Button variant="primary" onClick={() => setEditor({ kind: 'pathway' })}>
                  <Plus size={16} />
                  Add pathway
                </Button>
              }
            />
          )}
          <details className="iv4-planning-prompts">
            <summary>Fields to consider when planning the guide</summary>
            <div className="iv4-starter-grid">
              {(stream === 'all'
                ? streams.filter((item) => item !== 'Any')
                : [stream as EducationStream]
              ).map((item) => (
                <div key={item}>
                  <h3>{item}</h3>
                  <ul>
                    {info.starterFields[item]?.map((field) => (
                      <li key={field}>{field}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
      {editor?.kind === 'exam' && (
        <ExamEditor
          record={editor.record}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await load();
          }}
        />
      )}
      {editor?.kind === 'pathway' && (
        <PathwayEditor
          record={editor.record}
          exams={info?.exams || []}
          starterFields={info?.starterFields}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await load();
          }}
        />
      )}
      {selected && (
        <Modal
          title={selected.kind === 'exam' ? 'Exam guide' : 'Career pathway'}
          className="iv4-wide-modal"
          onClose={() => setSelected(null)}
        >
          <EducationDetails selected={selected} exams={info?.exams || []} />
          <div className="form-actions">
            <Button
              onClick={() => {
                setEditor(selected);
                setSelected(null);
              }}
            >
              <Pencil size={16} />
              Edit guide
            </Button>
            <Button onClick={() => setSelected(null)}>Close</Button>
          </div>
        </Modal>
      )}
      {review && (
        <EducationReview
          selected={review}
          exams={info?.exams || []}
          onClose={() => setReview(null)}
          onSaved={async () => {
            setReview(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function EducationDetails({
  selected,
  exams,
}: {
  selected: EducationSelection;
  exams: ExamRecord[];
}) {
  const { data } = useWorkspace();
  const item = selected.record;
  return (
    <div className="iv4-detail">
      <div className="iv4-badges">
        <Badge tone={item.verification === 'verified' ? 'green' : 'amber'}>
          {item.verification === 'verified' ? 'Reviewed by manager' : 'Needs source review'}
        </Badge>
        <Badge>Revision {item.revision}</Badge>
        <Badge>{item.status}</Badge>
      </div>
      <h2>{item.name}</h2>
      <p className="iv4-preserve">{item.description}</p>
      <dl className="iv4-facts">
        <div>
          <dt>Academic year</dt>
          <dd>{item.academicYear || 'Not specified'}</dd>
        </div>
        <div>
          <dt>Last updated</dt>
          <dd>{researchStamp(item.updatedAt)}</dd>
        </div>
        <div>
          <dt>Last manager review</dt>
          <dd>{researchStamp(item.verifiedAt)}</dd>
        </div>
      </dl>
      <h3>Eligibility, age and year notes</h3>
      <p className="iv4-preserve">
        {item.eligibilityNotes ||
          'Not researched yet. Confirm subject, age, category and year-specific rules in the original sources.'}
      </p>
      <h3>Reference sources</h3>
      <References links={item.referenceLinks} />
      {selected.kind === 'exam' ? (
        <>
          <h3>Milestones</h3>
          {selected.record.milestones.length ? (
            <div className="iv4-milestone-summary">
              {selected.record.milestones.map((milestone, index) => (
                <section key={index}>
                  <strong>
                    {milestone.label} · {milestone.date || 'Date to confirm'}
                  </strong>
                  {milestone.notes && <p>{milestone.notes}</p>}
                  {milestone.referenceUrl && (
                    <EvidenceLink url={milestone.referenceUrl}>Milestone source</EvidenceLink>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <p className="muted">No dated milestones saved.</p>
          )}
          <h3>Linked source watches</h3>
          {selected.record.watchIds.length ? (
            <ul>
              {selected.record.watchIds.map((id) => {
                const watch = data.intelligence.watches.find((value) => value.id === id);
                return (
                  <li key={id}>
                    {watch?.name || 'Unavailable watch'}
                    {watch
                      ? ` · ${watch.active ? 'Active' : 'Paused'} · every ${watch.intervalHours} hours`
                      : ''}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">
              Add an official source watch in Monitoring, then link it here. Source updates flag
              reviewed guidance for review again.
            </p>
          )}
        </>
      ) : (
        <>
          <h3>
            {selected.record.stream} → {selected.record.field}
          </h3>
          {selected.record.entryRoutes.map((route, index) => (
            <article className="iv4-route-detail" key={index}>
              <span className="eyebrow">ENTRY ROUTE {index + 1}</span>
              <h3>{route.name}</h3>
              <p className="iv4-preserve">{route.method}</p>
              <dl>
                <dt>Requirements</dt>
                <dd>{route.requirements || 'To be researched'}</dd>
                <dt>Education / qualification</dt>
                <dd>{route.education || 'To be researched'}</dd>
                <dt>Outcomes / next routes</dt>
                <dd>{route.outcomes || 'To be researched'}</dd>
              </dl>
              {route.examIds.length > 0 && (
                <div className="iv4-badges">
                  {route.examIds.map((id) => {
                    const exam = exams.find((value) => value.id === id);
                    return (
                      <Badge tone={exam?.verification === 'verified' ? 'green' : 'amber'} key={id}>
                        {exam?.name || 'Unavailable exam'} ·{' '}
                        {exam?.verification === 'verified' ? 'reviewed' : 'needs review'}
                      </Badge>
                    );
                  })}
                </div>
              )}
              <div className="iv4-links">
                {route.referenceUrls.map((url) => (
                  <EvidenceLink key={url} url={url} />
                ))}
              </div>
            </article>
          ))}
          {!selected.record.entryRoutes.length && <p>No entry routes saved yet.</p>}
        </>
      )}
    </div>
  );
}

function EducationReview({
  selected,
  exams,
  onClose,
  onSaved,
}: {
  selected: EducationSelection;
  exams: ExamRecord[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { mutate, toast } = useWorkspace();
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!confirmed || busy) return;
    setBusy(true);
    try {
      await mutate(
        `/intelligence/${selected.kind === 'exam' ? 'exams' : 'pathways'}/${selected.record.id}/verify`,
        'POST',
        { expectedRevision: selected.record.revision },
      );
      toast(
        'This revision is marked as reviewed. Later edits or linked source updates require another review.',
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
      title="Review the source evidence"
      className="iv4-wide-modal"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <EducationDetails selected={selected} exams={exams} />
      <form onSubmit={submit}>
        <label className="iv4-check iv4-review-check">
          <input
            required
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>
            I inspected the cited sources and checked the academic year, eligibility and current
            revisions. This marks the saved guide as reviewed; it does not publish anything.
          </span>
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!confirmed || busy}>
            <ShieldCheck size={16} />
            {busy ? 'Saving review…' : 'Mark this revision reviewed'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ExamEditor({
  record,
  onClose,
  onSaved,
}: {
  record?: ExamRecord;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { data, mutate, toast } = useWorkspace();
  const [name, setName] = useState(record?.name || ''),
    [category, setCategory] = useState<ExamRecord['category']>(record?.category || 'Entrance');
  const [selectedStreams, setStreams] = useState<EducationStream[]>(record?.streams || ['Science']);
  const [description, setDescription] = useState(record?.description || ''),
    [year, setYear] = useState(record?.academicYear || ''),
    [eligibility, setEligibility] = useState(record?.eligibilityNotes || '');
  const [references, setReferences] = useState<ReferenceLink[]>(
    record?.referenceLinks || [{ label: '', url: '' }],
  );
  const [milestones, setMilestones] = useState<Milestone[]>(record?.milestones || []),
    [watchIds, setWatchIds] = useState<string[]>(record?.watchIds || []);
  const [status, setStatus] = useState<ExamRecord['status']>(record?.status || 'draft'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const watches = data.intelligence.watches.filter((watch) => watch.kind === 'source');
  const manager = data.user.role === 'manager';
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (!selectedStreams.length) {
      setError('Choose at least one stream.');
      return;
    }
    setBusy(true);
    const input = {
      name,
      category,
      streams: selectedStreams,
      description,
      academicYear: year,
      eligibilityNotes: eligibility,
      referenceLinks: references,
      milestones: milestones.map((item) => ({ ...item, date: item.date || undefined })),
      watchIds,
      status,
      ...(record ? { expectedRevision: record.revision } : {}),
    };
    try {
      await mutate(
        record ? `/intelligence/exams/${record.id}` : '/intelligence/exams',
        record ? 'PATCH' : 'POST',
        input,
      );
      toast('Exam saved. A manager can review the cited details.');
      await onSaved();
    } catch (caught) {
      setError(intelligenceError(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={record ? 'Edit exam guide' : 'Add an exam'}
      className="iv4-wide-modal"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="iv4-form" onSubmit={submit}>
        <p className="iv4-help">
          Keep each academic year clear. Dates and eligibility stay unverified until a manager
          checks the original sources.
        </p>
        <div className="form-grid">
          <label className="field">
            <span>Exam / board / counselling name *</span>
            <input
              required
              minLength={2}
              maxLength={180}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name of the exam or authority"
            />
          </label>
          <label className="field">
            <span>Category</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as ExamRecord['category'])}
            >
              {['Entrance', 'Board', 'Counselling', 'Scholarship', 'Recruitment', 'Other'].map(
                (item) => (
                  <option key={item}>{item}</option>
                ),
              )}
            </select>
          </label>
          <label className="field">
            <span>Academic year / cycle</span>
            <input
              maxLength={40}
              value={year}
              onChange={(event) => setYear(event.target.value)}
              placeholder="For example, 2027–28"
            />
          </label>
          <label className="field">
            <span>Guide status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as ExamRecord['status'])}
            >
              <option value="draft">Draft</option>
              <option value="tracking">Tracking</option>
              {(manager || record?.status === 'archived') && (
                <option value="archived">Archived</option>
              )}
            </select>
          </label>
        </div>
        <fieldset className="iv4-fieldset">
          <legend>Relevant streams *</legend>
          <div className="iv4-check-grid">
            {streams.map((item) => (
              <label className="iv4-check" key={item}>
                <input
                  type="checkbox"
                  checked={selectedStreams.includes(item)}
                  onChange={(event) =>
                    setStreams(
                      event.target.checked
                        ? [...selectedStreams, item]
                        : selectedStreams.filter((value) => value !== item),
                    )
                  }
                />
                {item}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="field">
          <span>Description *</span>
          <textarea
            required
            maxLength={6000}
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What the exam is for, who follows it, and the information your team wants to track."
          />
        </label>
        <label className="field">
          <span>Eligibility, age and year notes</span>
          <textarea
            maxLength={4000}
            rows={3}
            value={eligibility}
            onChange={(event) => setEligibility(event.target.value)}
            placeholder="Record confirmed subject requirements, age limits and exceptions with the relevant year. Leave unknown details explicitly unconfirmed."
          />
        </label>
        <ReferenceEditor value={references} onChange={setReferences} required />
        <fieldset className="iv4-fieldset">
          <legend>Milestones</legend>
          <p className="iv4-help">
            Add application, exam, result or counselling dates only when supported by a dated
            source.
          </p>
          {milestones.map((item, index) => (
            <div className="iv4-repeat-block" key={index}>
              <div className="iv4-repeat-heading">
                <strong>Milestone {index + 1}</strong>
                <Button
                  size="sm"
                  aria-label={`Remove milestone ${index + 1}`}
                  onClick={() => setMilestones(milestones.filter((_, at) => at !== index))}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
              <div className="form-grid">
                <label className="field">
                  <span>Milestone *</span>
                  <input
                    required
                    maxLength={160}
                    value={item.label}
                    onChange={(event) =>
                      setMilestones(
                        milestones.map((value, at) =>
                          at === index ? { ...value, label: event.target.value } : value,
                        ),
                      )
                    }
                  />
                </label>
                <label className="field">
                  <span>Date, if confirmed</span>
                  <input
                    type="date"
                    value={item.date || ''}
                    onChange={(event) =>
                      setMilestones(
                        milestones.map((value, at) =>
                          at === index ? { ...value, date: event.target.value } : value,
                        ),
                      )
                    }
                  />
                </label>
                <label className="field form-full">
                  <span>Source URL</span>
                  <input
                    type="url"
                    maxLength={2048}
                    value={item.referenceUrl}
                    onChange={(event) =>
                      setMilestones(
                        milestones.map((value, at) =>
                          at === index ? { ...value, referenceUrl: event.target.value } : value,
                        ),
                      )
                    }
                  />
                </label>
                <label className="field form-full">
                  <span>Notes / corrections</span>
                  <input
                    maxLength={2000}
                    value={item.notes}
                    onChange={(event) =>
                      setMilestones(
                        milestones.map((value, at) =>
                          at === index ? { ...value, notes: event.target.value } : value,
                        ),
                      )
                    }
                  />
                </label>
              </div>
            </div>
          ))}
          <Button
            size="sm"
            disabled={milestones.length >= 30}
            onClick={() =>
              setMilestones([...milestones, { label: '', notes: '', referenceUrl: '' }])
            }
          >
            <Plus size={15} />
            Add milestone
          </Button>
        </fieldset>
        <fieldset className="iv4-fieldset">
          <legend>Source watches</legend>
          <p className="iv4-help">
            Link watches created in Monitoring. Later source updates flag reviewed exam and career
            guidance for review again.
          </p>
          {watches.length ? (
            <div className="iv4-checkbox-list">
              {watches.map((watch) => (
                <label className="iv4-check" key={watch.id}>
                  <input
                    type="checkbox"
                    checked={watchIds.includes(watch.id)}
                    disabled={!watchIds.includes(watch.id) && watchIds.length >= 12}
                    onChange={(event) =>
                      setWatchIds(
                        event.target.checked
                          ? [...watchIds, watch.id]
                          : watchIds.filter((id) => id !== watch.id),
                      )
                    }
                  />
                  <span>
                    {watch.name}
                    <small>
                      {watch.active ? 'Active' : 'Paused'} · every {watch.intervalHours} hours
                    </small>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="muted">
              No source watches yet. Save this guide, add an official source watch in Monitoring,
              then link it here.
            </p>
          )}
        </fieldset>
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
            {busy ? 'Saving…' : 'Save exam guide'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PathwayEditor({
  record,
  exams,
  starterFields,
  onClose,
  onSaved,
}: {
  record?: CareerPathway;
  exams: ExamRecord[];
  starterFields?: EducationData['starterFields'];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { data, mutate, toast } = useWorkspace();
  const [name, setName] = useState(record?.name || ''),
    [stream, setStream] = useState<EducationStream>(record?.stream || 'Science'),
    [field, setField] = useState(record?.field || '');
  const [description, setDescription] = useState(record?.description || ''),
    [year, setYear] = useState(record?.academicYear || ''),
    [eligibility, setEligibility] = useState(record?.eligibilityNotes || '');
  const [references, setReferences] = useState<ReferenceLink[]>(record?.referenceLinks || []),
    [routes, setRoutes] = useState<EntryRoute[]>(record?.entryRoutes || []);
  const [status, setStatus] = useState<CareerPathway['status']>(record?.status || 'draft'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const manager = data.user.role === 'manager';
  function updateRoute(index: number, patch: Partial<EntryRoute>) {
    setRoutes((current) =>
      current.map((item, at) => (at === index ? { ...item, ...patch } : item)),
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const input = {
      name,
      stream,
      field,
      description,
      academicYear: year,
      eligibilityNotes: eligibility,
      referenceLinks: references,
      entryRoutes: routes.map((route) => ({
        ...route,
        referenceUrls: lines(route.referenceUrls.join('\n')),
      })),
      status,
      ...(record ? { expectedRevision: record.revision } : {}),
    };
    try {
      await mutate(
        record ? `/intelligence/pathways/${record.id}` : '/intelligence/pathways',
        record ? 'PATCH' : 'POST',
        input,
      );
      toast('Career pathway saved as unverified guidance.');
      await onSaved();
    } catch (caught) {
      setError(intelligenceError(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={record ? 'Edit career pathway' : 'Add a career pathway'}
      className="iv4-wide-modal"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="iv4-form" onSubmit={submit}>
        <p className="iv4-help">
          Build this guide gradually. Entry routes are your researched notes; saving a draft does
          not confirm current admission requirements.
        </p>
        <div className="form-grid">
          <label className="field">
            <span>Pathway title *</span>
            <input
              required
              minLength={2}
              maxLength={180}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="A clear student-facing pathway name"
            />
          </label>
          <label className="field">
            <span>School stream</span>
            <select
              value={stream}
              onChange={(event) => setStream(event.target.value as EducationStream)}
            >
              {streams.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Field *</span>
            <input
              required
              maxLength={180}
              list="career-field-suggestions"
              value={field}
              onChange={(event) => setField(event.target.value)}
              placeholder="Medicine, finance, design…"
            />
            <datalist id="career-field-suggestions">
              {starterFields?.[stream]?.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Academic year / cycle</span>
            <input
              maxLength={40}
              value={year}
              onChange={(event) => setYear(event.target.value)}
              placeholder="Year these routes were researched for"
            />
          </label>
        </div>
        <label className="field">
          <span>Description *</span>
          <textarea
            required
            rows={3}
            maxLength={6000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Explain this field and the opportunities you want students to explore."
          />
        </label>
        <label className="field">
          <span>Eligibility, age and year notes</span>
          <textarea
            rows={3}
            maxLength={4000}
            value={eligibility}
            onChange={(event) => setEligibility(event.target.value)}
          />
        </label>
        <fieldset className="iv4-fieldset">
          <legend>Entry routes</legend>
          {routes.map((route, index) => (
            <div className="iv4-repeat-block" key={index}>
              <div className="iv4-repeat-heading">
                <strong>Route {index + 1}</strong>
                <Button
                  size="sm"
                  aria-label={`Remove entry route ${index + 1}`}
                  onClick={() => setRoutes(routes.filter((_, at) => at !== index))}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
              <label className="field">
                <span>Route name *</span>
                <input
                  required
                  maxLength={180}
                  value={route.name}
                  onChange={(event) => updateRoute(index, { name: event.target.value })}
                  placeholder="Name this entry method"
                />
              </label>
              <label className="field">
                <span>How students enter *</span>
                <textarea
                  required
                  maxLength={2000}
                  rows={2}
                  value={route.method}
                  onChange={(event) => updateRoute(index, { method: event.target.value })}
                  placeholder="Entrance test, application, selection or qualification steps"
                />
              </label>
              <div className="form-grid">
                <label className="field">
                  <span>Subject / age / other requirements</span>
                  <textarea
                    maxLength={3000}
                    rows={2}
                    value={route.requirements}
                    onChange={(event) => updateRoute(index, { requirements: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Education / qualification</span>
                  <textarea
                    maxLength={3000}
                    rows={2}
                    value={route.education}
                    onChange={(event) => updateRoute(index, { education: event.target.value })}
                  />
                </label>
                <label className="field form-full">
                  <span>Outcomes / further routes</span>
                  <textarea
                    maxLength={3000}
                    rows={2}
                    value={route.outcomes}
                    onChange={(event) => updateRoute(index, { outcomes: event.target.value })}
                  />
                </label>
              </div>
              <fieldset className="iv4-nested-fieldset">
                <legend>Linked exams</legend>
                {exams.filter(
                  (exam) => exam.status !== 'archived' || route.examIds.includes(exam.id),
                ).length ? (
                  <div className="iv4-checkbox-list">
                    {exams
                      .filter(
                        (exam) => exam.status !== 'archived' || route.examIds.includes(exam.id),
                      )
                      .map((exam) => (
                        <label className="iv4-check" key={exam.id}>
                          <input
                            type="checkbox"
                            checked={route.examIds.includes(exam.id)}
                            disabled={
                              !route.examIds.includes(exam.id) && route.examIds.length >= 12
                            }
                            onChange={(event) =>
                              updateRoute(index, {
                                examIds: event.target.checked
                                  ? [...route.examIds, exam.id]
                                  : route.examIds.filter((id) => id !== exam.id),
                              })
                            }
                          />
                          <span>
                            {exam.name}
                            {exam.academicYear ? ` · ${exam.academicYear}` : ''}
                            <small>
                              {exam.verification === 'verified'
                                ? 'Reviewed by manager'
                                : 'Needs source review'}
                            </small>
                          </span>
                        </label>
                      ))}
                  </div>
                ) : (
                  <p className="iv4-help">Save exams in the registry to link them to a route.</p>
                )}
              </fieldset>
              <label className="field">
                <span>Route source URLs, one per line</span>
                <textarea
                  rows={2}
                  maxLength={25000}
                  value={route.referenceUrls.join('\n')}
                  onChange={(event) =>
                    updateRoute(index, { referenceUrls: event.target.value.split('\n') })
                  }
                  onBlur={() =>
                    updateRoute(index, { referenceUrls: lines(route.referenceUrls.join('\n')) })
                  }
                  placeholder="https://official-source…"
                />
              </label>
            </div>
          ))}
          <Button
            size="sm"
            disabled={routes.length >= 12}
            onClick={() =>
              setRoutes([
                ...routes,
                {
                  name: '',
                  method: '',
                  examIds: [],
                  requirements: '',
                  education: '',
                  outcomes: '',
                  referenceUrls: [],
                },
              ])
            }
          >
            <Plus size={15} />
            Add entry route
          </Button>
        </fieldset>
        <ReferenceEditor value={references} onChange={setReferences} />
        <label className="field">
          <span>Guide status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as CareerPathway['status'])}
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            {(manager || record?.status === 'archived') && (
              <option value="archived">Archived</option>
            )}
          </select>
        </label>
        <p className="iv4-help">
          Manager review requires at least one researched entry route, source links, and reviewed
          linked exams. Edits reopen source review.
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
            {busy ? 'Saving…' : 'Save pathway'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
