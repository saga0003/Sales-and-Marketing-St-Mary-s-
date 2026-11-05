import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  Download,
  History,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type { WorkspaceDocument } from '../lib/types';
import { useWorkspace } from '../lib/workspace';
import {
  blockTypes,
  decodeDocument,
  encodeDocument,
  newBlock,
  type BlockType,
  type DocumentBlock,
  type DocumentRevision,
} from '../lib/documents';
import { formatDate } from '../lib/utils';
import { Badge, Button, Modal } from './UI';
import '../styles/documents.css';

export function DocumentContent({ content }: { content: string }) {
  const blocks = useMemo(() => decodeDocument(content), [content]);
  if (!blocks.some((block) => block.text.trim()))
    return <p className="muted">This document does not have any content yet.</p>;
  return (
    <div className="document-block-content">
      {blocks.map((block, index) =>
        block.type === 'heading' ? (
          <h3 key={block.id || index}>{block.text}</h3>
        ) : block.type === 'quote' ? (
          <blockquote key={block.id || index}>{block.text}</blockquote>
        ) : block.type === 'bullet' ? (
          <ul key={block.id || index}>
            <li>{block.text}</li>
          </ul>
        ) : block.type === 'checklist' ? (
          <div
            key={block.id || index}
            className={`document-checklist${block.checked ? ' checked' : ''}`}
          >
            <span role="img" aria-label={block.checked ? 'Completed' : 'Not completed'}>
              {block.checked ? <Check size={16} /> : null}
            </span>
            <p>{block.text}</p>
          </div>
        ) : (
          <p key={block.id || index}>{block.text}</p>
        ),
      )}
    </div>
  );
}

export default function DocumentEditor({
  editor,
  categories,
  onClose,
  onSave,
  onError,
}: {
  editor: { item?: WorkspaceDocument };
  categories: string[];
  onClose: () => void;
  onSave: (body: unknown) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const { request } = useWorkspace();
  const [title, setTitle] = useState(editor.item?.title || '');
  const [category, setCategory] = useState(editor.item?.category || 'General');
  const [blocks, setBlocks] = useState<DocumentBlock[]>(() =>
    decodeDocument(editor.item?.content || ''),
  );
  const [version, setVersion] = useState(editor.item?.version || 1);
  const [mode, setMode] = useState<'write' | 'preview' | 'history'>('write');
  const [addingType, setAddingType] = useState<BlockType>('paragraph');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<DocumentRevision[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<number | null>(null);
  const [conflict, setConflict] = useState<DocumentRevision | null>(null);
  const [discard, setDiscard] = useState(false);
  const initial = useRef(JSON.stringify({ title, category, blocks }));
  const content = encodeDocument(blocks);
  const text = blocks.map((block) => block.text).join('\n');
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const dirty = initial.current !== JSON.stringify({ title, category, blocks });
  const restored = history.find((item) => item.version === selectedHistory);

  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  function close() {
    if (saving) return;
    if (dirty) setDiscard(true);
    else onClose();
  }
  function updateBlock(id: string, patch: Partial<DocumentBlock>) {
    setBlocks((current) =>
      current.map((block) => (block.id === id ? { ...block, ...patch } : block)),
    );
  }
  function move(index: number, offset: number) {
    setBlocks((current) => {
      const next = [...current];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
  }
  async function loadHistory() {
    if (!editor.item) return;
    setHistoryBusy(true);
    setError('');
    try {
      const result = await request<{ revisions: DocumentRevision[] }>(
        `/documents/${encodeURIComponent(editor.item.id)}/history`,
      );
      setHistory([...result.revisions].sort((a, b) => b.version - a.version));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Document history could not be loaded.');
    } finally {
      setHistoryBusy(false);
    }
  }
  async function submit(event?: FormEvent, expectedVersion = version) {
    event?.preventDefault();
    if (saving) return;
    if (!title.trim()) {
      setError('Add a title so your team can find this document.');
      return;
    }
    if (content.length > 100000) {
      setError(
        'This document is too large. Keep its saved content below 100,000 characters or split it into two documents.',
      );
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({
        title: title.trim(),
        category: category.trim() || 'General',
        content,
        ...(editor.item ? { expectedVersion } : {}),
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not save your changes. Please try again.',
      );
      if ((caught as { status?: number }).status === 409 && editor.item) {
        try {
          const result = await request<{ revisions: DocumentRevision[] }>(
            `/documents/${encodeURIComponent(editor.item.id)}/history`,
          );
          const latest = [...result.revisions].sort((a, b) => b.version - a.version)[0];
          if (latest) {
            setConflict(latest);
            setHistory(result.revisions);
          }
        } catch {
          /* Preserve unsaved content even if the latest revision is unavailable. */
        }
      }
      onError(caught);
    } finally {
      setSaving(false);
    }
  }
  function exportDraft() {
    const blob = new Blob([`${title}\n\n${text}`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(title || 'document').replace(/[^\p{L}\p{N} -]/gu, '').slice(0, 80)}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Modal
      title={editor.item ? 'Edit document' : 'Start a new document'}
      onClose={close}
      className="work-document-modal block-editor-modal"
    >
      <form
        className="work-editor-form work-document-editor"
        onSubmit={(event) => void submit(event)}
      >
        <div className="document-editor-heading">
          <Badge tone="violet">{editor.item ? `Editing version ${version}` : 'New document'}</Badge>
          <span>
            {words} words · {blocks.length}/100 blocks
          </span>
        </div>
        <label className="field">
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={180}
            placeholder="Give this knowledge a name"
            autoFocus
          />
        </label>
        <label className="field">
          Category
          <input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            list="document-category-options"
            maxLength={80}
          />
          <datalist id="document-category-options">
            {categories.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </label>
        <div className="document-mode-bar">
          <div className="tabs">
            <button
              type="button"
              className={`tab ${mode === 'write' ? 'active' : ''}`}
              onClick={() => setMode('write')}
            >
              Write
            </button>
            <button
              type="button"
              className={`tab ${mode === 'preview' ? 'active' : ''}`}
              onClick={() => setMode('preview')}
            >
              Preview
            </button>
            {editor.item && (
              <button
                type="button"
                className={`tab ${mode === 'history' ? 'active' : ''}`}
                onClick={() => {
                  setMode('history');
                  void loadHistory();
                }}
              >
                <History size={15} />
                History
              </button>
            )}
          </div>
          <button type="button" className="text-link" onClick={exportDraft}>
            <Download size={15} />
            Export draft
          </button>
        </div>
        {mode === 'write' && (
          <div className="block-editor-list">
            {blocks.map((block, index) => (
              <div className={`block-editor-row block-${block.type}`} key={block.id}>
                <div className="block-editor-tools">
                  <span className="block-number">{index + 1}</span>
                  <select
                    aria-label={`Block ${index + 1} type`}
                    value={block.type}
                    onChange={(event) =>
                      updateBlock(block.id, {
                        type: event.target.value as BlockType,
                        ...(event.target.value === 'checklist'
                          ? { checked: Boolean(block.checked) }
                          : {}),
                      })
                    }
                  >
                    {blockTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                  <div className="block-move-tools">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Move block ${index + 1} up`}
                      disabled={!index}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Move block ${index + 1} down`}
                      disabled={index === blocks.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove block ${index + 1}`}
                      onClick={() =>
                        setBlocks((current) => current.filter((item) => item.id !== block.id))
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="block-text-row">
                  {block.type === 'checklist' && (
                    <input
                      type="checkbox"
                      checked={!!block.checked}
                      aria-label={`Mark checklist item ${index + 1} complete`}
                      onChange={(event) => updateBlock(block.id, { checked: event.target.checked })}
                    />
                  )}
                  <textarea
                    aria-label={`${blockTypes.find((type) => type.value === block.type)?.label} ${index + 1}`}
                    value={block.text}
                    maxLength={10000}
                    rows={block.type === 'paragraph' || block.type === 'quote' ? 3 : 2}
                    placeholder={
                      block.type === 'heading' ? 'A clear section heading…' : 'Write your content…'
                    }
                    onChange={(event) => updateBlock(block.id, { text: event.target.value })}
                  />
                </div>
              </div>
            ))}
            <div className="block-add">
              <label className="field">
                <span className="sr-only">New block type</span>
                <select
                  aria-label="New block type"
                  value={addingType}
                  onChange={(event) => setAddingType(event.target.value as BlockType)}
                >
                  {blockTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                disabled={blocks.length >= 100}
                onClick={() => setBlocks((current) => [...current, newBlock(addingType)])}
              >
                <Plus size={17} />
                Add block
              </Button>
            </div>
            <p className="document-help">
              Add headings, bullet points, checklists, and quotes. Move blocks with the arrows.
              Changes are shared when you save.
            </p>
          </div>
        )}
        {mode === 'preview' && (
          <div className="document-preview">
            <h2>{title || 'Untitled document'}</h2>
            <DocumentContent content={content} />
          </div>
        )}
        {mode === 'history' && (
          <div className="document-history">
            <p>Inspect a saved version. Restoring it creates a new revision when you save.</p>
            {historyBusy && <p role="status">Loading saved versions…</p>}
            <div className="document-history-versions">
              {history.map((revision) => (
                <button
                  type="button"
                  key={revision.version}
                  className={selectedHistory === revision.version ? 'active' : ''}
                  onClick={() => setSelectedHistory(revision.version)}
                >
                  <strong>Version {revision.version}</strong>
                  <span>
                    {formatDate(revision.updatedAt, {
                      day: 'numeric',
                      month: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}{' '}
                    IST
                  </span>
                  <small>{revision.updatedBy}</small>
                </button>
              ))}
            </div>
            {restored && (
              <div className="document-history-preview">
                <h3>{restored.title}</h3>
                <DocumentContent content={restored.content} />
                <Button
                  onClick={() => {
                    setTitle(restored.title);
                    setCategory(restored.category);
                    setBlocks(decodeDocument(restored.content));
                    setMode('write');
                    setSelectedHistory(null);
                  }}
                >
                  <RotateCcw size={16} />
                  Use version {restored.version} in this draft
                </Button>
              </div>
            )}
            {!historyBusy && !history.length && <p>No saved history is available yet.</p>}
          </div>
        )}
        {conflict && (
          <section className="document-conflict" role="alert">
            <h3>
              <CircleAlert size={20} />
              Another version was saved
            </h3>
            <p>
              Your draft is safe here. Version {conflict.version} was saved by {conflict.updatedBy}.
              Compare it before choosing which content to keep.
            </p>
            <details>
              <summary>Read the latest saved version</summary>
              <h4>{conflict.title}</h4>
              <DocumentContent content={conflict.content} />
            </details>
            <div className="form-actions">
              <Button
                disabled={saving}
                onClick={() => {
                  setTitle(conflict.title);
                  setCategory(conflict.category);
                  setBlocks(decodeDocument(conflict.content));
                  setVersion(conflict.version);
                  setConflict(null);
                  setError('');
                }}
              >
                Use the saved version
              </Button>
              <Button
                variant="primary"
                disabled={saving}
                onClick={() => void submit(undefined, conflict.version)}
              >
                Save my draft over version {conflict.version}
              </Button>
            </div>
          </section>
        )}
        {error && (
          <p className="work-form-error" role="alert">
            {error}
          </p>
        )}
        {discard && (
          <div className="document-discard" role="alert">
            <p>Close without saving these document changes?</p>
            <div className="form-actions">
              <Button onClick={() => setDiscard(false)}>Keep editing</Button>
              <Button variant="danger" onClick={onClose}>
                Discard changes
              </Button>
            </div>
          </div>
        )}
        <div className="work-modal-actions">
          <Button disabled={saving} onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={saving || !!conflict}>
            {saving ? 'Saving…' : editor.item ? 'Save changes' : 'Create document'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
