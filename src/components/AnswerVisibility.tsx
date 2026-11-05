import { useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  Check,
  ClipboardCheck,
  Copy,
  MessageSquareText,
  Pause,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import { institutions, type AnswerObservation, type AnswerPrompt } from '../lib/types';
import { formatDate } from '../lib/utils';
import { Badge, Button, EmptyState, Modal } from './UI';
import '../styles/discovery.css';

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'The observation could not be saved.';
const localNow = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
};
const safeLink = (value: string) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
};
export default function AnswerVisibility() {
  const { data, selectedInstitution, mutate, toast } = useWorkspace();
  const [promptId, setPromptId] = useState('');
  const [editor, setEditor] = useState<{ prompt?: AnswerPrompt } | null>(null);
  const [record, setRecord] = useState<AnswerPrompt | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: 'prompt' | 'observation';
    id: string;
    name: string;
  } | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const prompts = data.intelligence.answerPrompts.filter(
    (item) => selectedInstitution === 'all' || item.institution === selectedInstitution,
  );
  const prompt = prompts.find((item) => item.id === promptId) || prompts[0];
  const observations = data.intelligence.answerObservations.filter(
    (item) => item.promptId === prompt?.id,
  );
  const manager = data.user.role === 'manager';
  async function toggle() {
    if (!prompt) return;
    setBusy('toggle');
    setError('');
    try {
      await mutate(`/intelligence/answer-prompts/${prompt.id}`, 'PATCH', {
        active: !prompt.active,
      });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="discovery-section answer-visibility">
      <div className="report-section-heading">
        <div>
          <h2>AI answer visibility</h2>
          <p>
            Keep repeatable questions, the answers your team observed, and the evidence behind
            mentions and citations.
          </p>
        </div>
        <Button variant="primary" onClick={() => setEditor({})}>
          <Plus size={16} />
          Add test question
        </Button>
      </div>
      <div className="discovery-note">
        <Sparkles size={20} />
        <p>
          <strong>Manual observations, recorded consistently.</strong> Run the same question in the
          AI service you use, then record its date, model, location, language, answer, and sources
          here. These records do not represent an automatic AI scan or a universal ranking.
        </p>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!prompts.length ? (
        <section className="panel">
          <EmptyState
            icon={<MessageSquareText size={30} />}
            title="Start with a question parents actually ask"
            description="Create a defined question, audience location, language, and target website. Reuse that context when recording future answers so the comparison is meaningful."
            action={
              <Button variant="primary" onClick={() => setEditor({})}>
                <Plus size={16} />
                Add test question
              </Button>
            }
          />
        </section>
      ) : (
        <>
          <label className="field answer-prompt-select">
            Test question
            <select value={prompt?.id || ''} onChange={(event) => setPromptId(event.target.value)}>
              {prompts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.prompt.slice(0, 150)} · {item.institution}
                  {item.active ? '' : ' · Paused'}
                </option>
              ))}
            </select>
          </label>
          {prompt && (
            <section className="panel answer-prompt">
              <div className="answer-prompt-meta">
                <Badge tone={prompt.active ? 'green' : 'gray'}>
                  {prompt.active ? 'Active question' : 'Paused question'}
                </Badge>
                <span>{prompt.institution}</span>
              </div>
              <h3>{prompt.prompt}</h3>
              <p>{prompt.intent}</p>
              <dl>
                <div>
                  <dt>Location context</dt>
                  <dd>{prompt.locale}</dd>
                </div>
                <div>
                  <dt>Language</dt>
                  <dd>{prompt.language}</dd>
                </div>
                <div>
                  <dt>Target website</dt>
                  <dd>
                    <a href={safeLink(prompt.targetUrl)} target="_blank" rel="noreferrer">
                      {prompt.targetUrl}
                      <ArrowUpRight size={14} />
                    </a>
                  </dd>
                </div>
              </dl>
              <div className="answer-prompt-actions">
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(prompt.prompt);
                      setCopied(prompt.id);
                    } catch {
                      setError('Select the question text and copy it manually.');
                    }
                  }}
                >
                  {copied === prompt.id ? <Check size={15} /> : <Copy size={15} />}
                  {copied === prompt.id ? 'Copied' : 'Copy question'}
                </Button>
                <Button size="sm" onClick={() => setEditor({ prompt })}>
                  <Pencil size={15} />
                  Edit
                </Button>
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void toggle()}>
                  {prompt.active ? <Pause size={15} /> : <Play size={15} />}
                  {prompt.active ? 'Pause' : 'Resume'}
                </Button>
                {manager && (
                  <button
                    className="icon-button"
                    aria-label="Delete this test question and observations"
                    onClick={() =>
                      setDeleteTarget({ kind: 'prompt', id: prompt.id, name: prompt.prompt })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                )}
                <Button
                  variant="primary"
                  disabled={!prompt.active}
                  onClick={() => setRecord(prompt)}
                >
                  <Plus size={16} />
                  Record an answer
                </Button>
              </div>
            </section>
          )}
          <div className="answer-summary">
            <div>
              <strong>{observations.length || '—'}</strong>
              <span>Recorded checks</span>
            </div>
            <div>
              <strong>
                {observations.length
                  ? `${observations.filter((item) => item.mentioned).length}/${observations.length}`
                  : '—'}
              </strong>
              <span>School mentioned</span>
            </div>
            <div>
              <strong>
                {observations.length
                  ? `${observations.filter((item) => item.cited).length}/${observations.length}`
                  : '—'}
              </strong>
              <span>Target website cited</span>
            </div>
          </div>
          <p className="answer-sampling-note">
            Counts cover the saved observations for this question, up to the latest 200 workspace
            observations. Different services, models, dates, and question revisions are shown
            explicitly.
          </p>
          {observations.length ? (
            <div className="answer-observation-list">
              {observations.map((observation) => (
                <ObservationCard
                  key={observation.id}
                  observation={observation}
                  currentPrompt={prompt}
                  onDelete={
                    manager
                      ? () =>
                          setDeleteTarget({
                            kind: 'observation',
                            id: observation.id,
                            name: `${observation.provider} observation`,
                          })
                      : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <section className="panel">
              <EmptyState
                icon={<ClipboardCheck size={29} />}
                title="No answers recorded for this question"
                description="Use Copy question, check it in your chosen service, then record the actual answer and its sources. No result is assumed until you add an observation."
              />
            </section>
          )}
        </>
      )}
      {editor && (
        <PromptEditor
          prompt={editor.prompt}
          onClose={() => setEditor(null)}
          onSaved={(saved) => {
            setEditor(null);
            setPromptId(saved.id);
          }}
        />
      )}
      {record && <ObservationEditor prompt={record} onClose={() => setRecord(null)} />}
      {deleteTarget && (
        <Modal
          title={`Delete ${deleteTarget.kind === 'prompt' ? 'test question' : 'observation'}?`}
          onClose={() => !busy && setDeleteTarget(null)}
        >
          <p>
            Delete <strong>{deleteTarget.name}</strong>?{' '}
            {deleteTarget.kind === 'prompt'
              ? 'Its saved observations will also be removed.'
              : 'This removes the recorded evidence from this log.'}
          </p>
          <div className="form-actions">
            <Button disabled={!!busy} onClick={() => setDeleteTarget(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              disabled={!!busy}
              onClick={async () => {
                setBusy('delete');
                setError('');
                try {
                  await mutate(
                    `/intelligence/${deleteTarget.kind === 'prompt' ? 'answer-prompts' : 'answer-observations'}/${deleteTarget.id}`,
                    'DELETE',
                  );
                  setDeleteTarget(null);
                  toast('Record removed.');
                } catch (caught) {
                  setError(errorText(caught));
                } finally {
                  setBusy('');
                }
              }}
            >
              Delete
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function ObservationCard({
  observation,
  currentPrompt,
  onDelete,
}: {
  observation: AnswerObservation;
  currentPrompt?: AnswerPrompt;
  onDelete?: () => void;
}) {
  const snapshot = observation.promptSnapshot || currentPrompt;
  return (
    <article className="panel answer-observation">
      <div className="answer-observation-heading">
        <div>
          <h3>
            {observation.provider}
            <span>{observation.model}</span>
          </h3>
          <p>
            {formatDate(observation.checkedAt, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}{' '}
            IST · Recorded by {observation.recordedBy}
          </p>
        </div>
        {onDelete && (
          <button className="icon-button" aria-label="Delete this observation" onClick={onDelete}>
            <Trash2 size={15} />
          </button>
        )}
      </div>
      <div className="answer-result-tags">
        <Badge tone={observation.mentioned ? 'green' : 'gray'}>
          {observation.mentioned ? 'School mentioned' : 'No school mention recorded'}
        </Badge>
        <Badge tone={observation.cited ? 'green' : 'gray'}>
          {observation.cited ? 'Target website cited' : 'No target citation recorded'}
        </Badge>
      </div>
      <blockquote>{observation.answerExcerpt}</blockquote>
      {snapshot && (
        <details className="answer-context">
          <summary>Question and context used</summary>
          <p>{snapshot.prompt}</p>
          <span>
            {snapshot.locale} · {snapshot.language}
          </span>
          <a href={safeLink(snapshot.targetUrl)} target="_blank" rel="noreferrer">
            {snapshot.targetUrl}
            <ArrowUpRight size={14} />
          </a>
        </details>
      )}
      {observation.citationUrls.length > 0 && (
        <div className="answer-citations">
          <h4>Sources cited in the answer</h4>
          <ul>
            {observation.citationUrls.map((url) => (
              <li key={url}>
                <a href={safeLink(url)} target="_blank" rel="noreferrer">
                  {url}
                  <ArrowUpRight size={13} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {observation.evidenceUrl && (
        <a
          className="text-link"
          href={safeLink(observation.evidenceUrl)}
          target="_blank"
          rel="noreferrer"
        >
          Open saved evidence <ArrowUpRight size={15} />
        </a>
      )}
      {observation.notes && <p className="answer-observation-notes">{observation.notes}</p>}
    </article>
  );
}
function PromptEditor({
  prompt,
  onClose,
  onSaved,
}: {
  prompt?: AnswerPrompt;
  onClose: () => void;
  onSaved: (prompt: AnswerPrompt) => void;
}) {
  const { selectedInstitution, mutate, toast } = useWorkspace();
  const [form, setForm] = useState({
    prompt: prompt?.prompt || '',
    intent: prompt?.intent || '',
    institution:
      prompt?.institution ||
      (selectedInstitution === 'all' ? institutions[0] : selectedInstitution),
    locale: prompt?.locale || '',
    language: prompt?.language || 'English',
    targetUrl: prompt?.targetUrl || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await mutate<{ prompt: AnswerPrompt }>(
        prompt ? `/intelligence/answer-prompts/${prompt.id}` : '/intelligence/answer-prompts',
        prompt ? 'PATCH' : 'POST',
        form,
      );
      toast(
        prompt
          ? 'Test question updated. Earlier observations keep their original context.'
          : 'Test question saved.',
      );
      onSaved(result.prompt);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={prompt ? 'Edit test question' : 'Add an answer-visibility question'}
      onClose={() => !busy && onClose()}
    >
      <form className="stack" onSubmit={submit}>
        <label className="field">
          Exact question
          <textarea
            required
            minLength={5}
            maxLength={3000}
            value={form.prompt}
            onChange={(event) => change('prompt', event.target.value)}
            rows={3}
            placeholder="Which schools offer…?"
          />
        </label>
        <label className="field">
          What are you trying to learn?
          <input
            required
            maxLength={300}
            value={form.intent}
            onChange={(event) => change('intent', event.target.value)}
            placeholder="e.g. Whether parents discover our admissions page"
          />
        </label>
        <div className="form-grid">
          <label className="field">
            School
            <select
              value={form.institution}
              onChange={(event) => change('institution', event.target.value)}
            >
              {institutions.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Language
            <input
              required
              maxLength={80}
              value={form.language}
              onChange={(event) => change('language', event.target.value)}
            />
          </label>
        </div>
        <label className="field">
          Location context
          <input
            required
            maxLength={180}
            value={form.locale}
            onChange={(event) => change('locale', event.target.value)}
            placeholder="City or region used when checking the answer"
          />
        </label>
        <label className="field">
          Target website URL
          <input
            required
            type="url"
            maxLength={2048}
            value={form.targetUrl}
            onChange={(event) => change('targetUrl', event.target.value)}
            placeholder="https://www.yourschool.edu.in"
          />
          <small>Citations to this website are counted separately from other sources.</small>
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
          <Button disabled={busy} variant="primary" type="submit">
            {busy ? 'Saving…' : 'Save question'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function ObservationEditor({ prompt, onClose }: { prompt: AnswerPrompt; onClose: () => void }) {
  const { mutate, toast } = useWorkspace();
  const [provider, setProvider] = useState('ChatGPT');
  const [model, setModel] = useState('');
  const [checkedAt, setCheckedAt] = useState(localNow);
  const [answerExcerpt, setAnswerExcerpt] = useState('');
  const [mentioned, setMentioned] = useState('');
  const [cited, setCited] = useState('');
  const [citations, setCitations] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (!mentioned || !cited)
        throw new Error(
          'Record whether the school was mentioned and whether its website was cited.',
        );
      const timestamp = new Date(`${checkedAt}:00+05:30`);
      if (!Number.isFinite(timestamp.getTime()))
        throw new Error('Choose the actual date and time of the observation.');
      await mutate('/intelligence/answer-observations', 'POST', {
        promptId: prompt.id,
        provider: provider.trim(),
        model: model.trim(),
        checkedAt: timestamp.toISOString(),
        answerExcerpt,
        mentioned: mentioned === 'yes',
        cited: cited === 'yes',
        citationUrls: citations
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean),
        evidenceUrl: evidenceUrl.trim(),
        notes,
      });
      toast('Answer observation saved with its question, context, and sources.');
      onClose();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Record an observed answer"
      onClose={() => !busy && onClose()}
      className="answer-observation-modal"
    >
      <form className="stack" onSubmit={submit}>
        <div className="discovery-note">
          <MessageSquareText size={20} />
          <p>
            {prompt.prompt}
            <br />
            <small>
              {prompt.locale} · {prompt.language}
            </small>
          </p>
        </div>
        <div className="form-grid">
          <label className="field">
            Service
            <input
              required
              list="answer-service-options"
              maxLength={100}
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            />
            <datalist id="answer-service-options">
              {['ChatGPT', 'Gemini', 'Google AI Overviews', 'Perplexity', 'Copilot'].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </datalist>
          </label>
          <label className="field">
            Model or product version
            <input
              required
              maxLength={120}
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="Record the displayed version, or Not disclosed"
            />
          </label>
        </div>
        <label className="field">
          Observed at · India Standard Time
          <input
            required
            type="datetime-local"
            value={checkedAt}
            onChange={(event) => setCheckedAt(event.target.value)}
          />
        </label>
        <label className="field">
          Relevant answer excerpt
          <textarea
            required
            maxLength={6000}
            rows={5}
            value={answerExcerpt}
            onChange={(event) => setAnswerExcerpt(event.target.value)}
            placeholder="Record the relevant portion you actually observed."
          />
        </label>
        <div className="form-grid">
          <label className="field">
            Was the school mentioned?
            <select
              required
              value={mentioned}
              onChange={(event) => setMentioned(event.target.value)}
            >
              <option value="">Choose…</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label className="field">
            Was the target website cited?
            <select required value={cited} onChange={(event) => setCited(event.target.value)}>
              <option value="">Choose…</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
        </div>
        <label className="field">
          Citation URLs
          <textarea
            value={citations}
            onChange={(event) => setCitations(event.target.value)}
            maxLength={30000}
            rows={3}
            placeholder="One complete source URL per line"
          />
          <small>
            If the target website was cited, include its actual citation URL. Other cited sources
            can also be recorded.
          </small>
        </label>
        <label className="field">
          Evidence link · optional
          <input
            type="url"
            value={evidenceUrl}
            maxLength={2048}
            onChange={(event) => setEvidenceUrl(event.target.value)}
            placeholder="Shared answer or saved evidence URL"
          />
        </label>
        <label className="field">
          Notes · optional
          <textarea
            value={notes}
            rows={3}
            maxLength={3000}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Relevant settings, personalization, or differences from the previous check"
          />
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
          <Button disabled={busy} type="submit" variant="primary">
            {busy ? 'Saving…' : 'Save observed answer'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
