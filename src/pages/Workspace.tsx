import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  ClipboardList,
  Columns3,
  FileText,
  Flag,
  FolderOpen,
  LayoutList,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import type { Task, WorkspaceDocument } from '../lib/types';
import { Avatar, Badge, Button, Modal } from '../components/UI';
import '../styles/workspace.css';

type WorkspaceTab = 'tasks' | 'knowledge';
type TaskEditor = { item?: Task; initialStatus?: Task['status'] };
type DocumentEditor = { item?: WorkspaceDocument };
type DeleteTarget = { kind: 'task' | 'document'; id: string; title: string };
const statuses: { key: Task['status']; label: string; description: string }[] = [
  { key: 'todo', label: 'To do', description: 'Ready for a fresh start' },
  { key: 'in_progress', label: 'In progress', description: 'Good things in the making' },
  { key: 'done', label: 'Completed', description: 'One less thing on the list' },
];
const priorityLabel = { high: 'High', medium: 'Medium', low: 'Low' };
const priorityTone = { high: 'red', medium: 'amber', low: 'gray' } as const;

function planningDate(daysFromToday = 0) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + daysFromToday * 86400000));
}

function friendlyDate(value: string, withYear = false) {
  if (!value) return 'No due date';
  const date = new Date(value.length === 10 ? `${value}T12:00:00+05:30` : value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : date.toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        ...(withYear ? { year: 'numeric' } : {}),
      });
}

function isOverdue(task: Task) {
  if (!task.dueDate || task.status === 'done') return false;
  const date = new Date(`${task.dueDate.slice(0, 10)}T23:59:59+05:30`);
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

function excerpt(content: string) {
  return content.replace(/^#+\s/gm, '').replace(/\n+/g, ' ').slice(0, 170);
}

export default function Workspace() {
  const { data, mutate, toast } = useWorkspace();
  const [tab, setTab] = useState<WorkspaceTab>('tasks');
  const [query, setQuery] = useState('');
  const [taskView, setTaskView] = useState<'board' | 'list'>('board');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [documentCategory, setDocumentCategory] = useState('all');
  const [taskEditor, setTaskEditor] = useState<TaskEditor | null>(null);
  const [documentEditor, setDocumentEditor] = useState<DocumentEditor | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const selectedDocument = data.documents.find((item) => item.id === selectedDocumentId);
  const owners = useMemo(
    () =>
      [
        ...new Set([
          ...data.users.map((item) => item.name),
          ...data.tasks.map((item) => item.owner).filter(Boolean),
        ]),
      ].sort(),
    [data.users, data.tasks],
  );
  const documentCategories = useMemo(
    () => [...new Set(data.documents.map((item) => item.category || 'General'))].sort(),
    [data.documents],
  );
  const visibleTasks = useMemo(
    () =>
      data.tasks.filter(
        (item) =>
          `${item.title} ${item.owner}`.toLowerCase().includes(query.toLowerCase()) &&
          (ownerFilter === 'all' || item.owner === ownerFilter) &&
          (priorityFilter === 'all' || item.priority === priorityFilter),
      ),
    [data.tasks, query, ownerFilter, priorityFilter],
  );
  const visibleDocuments = useMemo(
    () =>
      data.documents.filter(
        (item) =>
          `${item.title} ${item.content} ${item.category}`
            .toLowerCase()
            .includes(query.toLowerCase()) &&
          (documentCategory === 'all' || (item.category || 'General') === documentCategory),
      ),
    [data.documents, query, documentCategory],
  );
  const completedCount = data.tasks.filter((item) => item.status === 'done').length;
  const completion = data.tasks.length ? Math.round((completedCount / data.tasks.length) * 100) : 0;

  function reportError(error: unknown) {
    toast(
      error instanceof Error ? error.message : 'Something went wrong. Please try again.',
      'error',
    );
  }
  function changeTab(next: WorkspaceTab) {
    setTab(next);
    setQuery('');
  }

  async function changeTaskStatus(task: Task, status: Task['status']) {
    if (busy) return;
    setBusy(task.id);
    try {
      await mutate(`/tasks/${encodeURIComponent(task.id)}`, 'PATCH', { status });
      toast(
        status === 'done'
          ? 'Task completed. Nicely done.'
          : `Task moved to ${status === 'todo' ? 'To do' : 'In progress'}.`,
        'success',
      );
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(null);
    }
  }

  async function removeItem() {
    if (!deleteTarget || busy) return;
    setBusy('delete');
    try {
      await mutate(
        `/${deleteTarget.kind === 'task' ? 'tasks' : 'documents'}/${encodeURIComponent(deleteTarget.id)}`,
        'DELETE',
      );
      if (deleteTarget.kind === 'document') setSelectedDocumentId(null);
      toast(`${deleteTarget.kind === 'task' ? 'Task' : 'Document'} deleted.`, 'success');
      setDeleteTarget(null);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(null);
    }
  }

  function taskCard(task: Task) {
    return (
      <article
        className={`work-task-card ${task.status === 'done' ? 'is-done' : ''}`}
        key={task.id}
      >
        <div className="work-task-top">
          <Badge tone={priorityTone[task.priority]}>
            <Flag size={10} aria-hidden="true" />
            {priorityLabel[task.priority]} priority
          </Badge>
          <button
            className="icon-button"
            aria-label={`Edit task: ${task.title}`}
            onClick={() => setTaskEditor({ item: task })}
          >
            <MoreHorizontal size={18} aria-hidden="true" />
          </button>
        </div>
        <button className="work-task-title" onClick={() => setTaskEditor({ item: task })}>
          {task.title}
        </button>
        <div className="work-task-person">
          <Avatar name={task.owner || 'Unassigned'} size="sm" />
          <span>{task.owner || 'Unassigned'}</span>
        </div>
        <div className="work-task-card-footer">
          <span className={`work-due ${isOverdue(task) ? 'is-overdue' : ''}`}>
            <CalendarDays size={12} aria-hidden="true" />
            {task.dueDate ? friendlyDate(task.dueDate) : 'No due date'}
            {isOverdue(task) && <span> · Overdue</span>}
          </span>
          <button
            className={`work-move-task ${task.status === 'done' ? 'is-complete' : ''}`}
            disabled={!!busy}
            aria-label={`${task.status === 'todo' ? 'Start' : task.status === 'in_progress' ? 'Complete' : 'Reopen'} task: ${task.title}`}
            onClick={() =>
              changeTaskStatus(
                task,
                task.status === 'todo'
                  ? 'in_progress'
                  : task.status === 'in_progress'
                    ? 'done'
                    : 'todo',
              )
            }
          >
            {busy === task.id ? (
              'Saving…'
            ) : task.status === 'todo' ? (
              <>
                Start
                <ArrowRight size={12} aria-hidden="true" />
              </>
            ) : task.status === 'in_progress' ? (
              <>
                Complete
                <Check size={12} aria-hidden="true" />
              </>
            ) : (
              <>
                Reopen
                <CheckCircle2 size={12} aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </article>
    );
  }

  return (
    <div className="work-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">A LITTLE MORE ORGANIZED</p>
          <h1 className="page-title">Workspace</h1>
          <p className="page-description">
            Shared plans. Clear owners. Everything moving together.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => (tab === 'tasks' ? setTaskEditor({}) : setDocumentEditor({}))}
        >
          <Plus size={17} aria-hidden="true" />
          {tab === 'tasks' ? 'Add task' : 'New document'}
        </Button>
      </div>

      <div className="work-tabs-row">
        <div className="tabs" aria-label="Workspace sections">
          <button
            className={`tab ${tab === 'tasks' ? 'active' : ''}`}
            aria-pressed={tab === 'tasks'}
            onClick={() => changeTab('tasks')}
          >
            <ClipboardList size={16} aria-hidden="true" />
            Tasks<span className="work-tab-count">{data.tasks.length}</span>
          </button>
          <button
            className={`tab ${tab === 'knowledge' ? 'active' : ''}`}
            aria-pressed={tab === 'knowledge'}
            onClick={() => changeTab('knowledge')}
          >
            <BookOpen size={16} aria-hidden="true" />
            Knowledge<span className="work-tab-count">{data.documents.length}</span>
          </button>
        </div>
        <span className="work-team-note">
          <span className="work-team-dot" />
          Your team’s shared space
        </span>
      </div>

      {tab === 'tasks' ? (
        <>
          <div className="work-overview-strip">
            <div className="work-overview-heading">
              <span className="work-overview-icon">
                <ClipboardList size={23} aria-hidden="true" />
              </span>
              <div>
                <h2>Small steps. Steady progress.</h2>
                <p>
                  {data.tasks.length
                    ? `${data.tasks.length - completedCount} ${data.tasks.length - completedCount === 1 ? 'task' : 'tasks'} still in motion. Keep the team moving with a clear next step.`
                    : 'Give your next good idea an owner and a place to start.'}
                </p>
              </div>
            </div>
            <div className="work-progress">
              <div>
                <span>Team progress</span>
                <strong>
                  {completedCount}
                  <span> / {data.tasks.length} completed</span>
                </strong>
              </div>
              <div
                className="work-progress-track"
                role="progressbar"
                aria-label="Tasks completed"
                aria-valuenow={completion}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span style={{ width: `${completion}%` }} />
              </div>
            </div>
          </div>

          <div className="work-task-toolbar">
            <div className="work-filter-group">
              <label className="work-search">
                <Search size={16} aria-hidden="true" />
                <input
                  aria-label="Search tasks"
                  placeholder="Find a task…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button aria-label="Clear search" onClick={() => setQuery('')}>
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </label>
              <select
                className="select work-filter-select"
                aria-label="Filter tasks by owner"
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
              >
                <option value="all">All owners</option>
                {owners.map((owner) => (
                  <option key={owner}>{owner}</option>
                ))}
              </select>
              <select
                className="select work-filter-select"
                aria-label="Filter tasks by priority"
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
              >
                <option value="all">All priorities</option>
                <option value="high">High priority</option>
                <option value="medium">Medium priority</option>
                <option value="low">Low priority</option>
              </select>
            </div>
            <div className="work-view-toggle" aria-label="Task layout">
              <button
                className={taskView === 'board' ? 'active' : ''}
                onClick={() => setTaskView('board')}
                aria-pressed={taskView === 'board'}
                aria-label="Board view"
              >
                <Columns3 size={15} aria-hidden="true" />
                <span>Board</span>
              </button>
              <button
                className={taskView === 'list' ? 'active' : ''}
                onClick={() => setTaskView('list')}
                aria-pressed={taskView === 'list'}
                aria-label="List view"
              >
                <LayoutList size={15} aria-hidden="true" />
                <span>List</span>
              </button>
            </div>
          </div>

          {taskView === 'board' ? (
            <div className="work-board">
              {statuses.map((status) => {
                const columnTasks = visibleTasks.filter((item) => item.status === status.key);
                return (
                  <section
                    className={`work-column work-column-${status.key}`}
                    key={status.key}
                    aria-label={`${status.label} tasks`}
                  >
                    <div className="work-column-header">
                      <div>
                        <span className="work-column-dot" />
                        <h2>{status.label}</h2>
                        <span className="work-column-count">{columnTasks.length}</span>
                      </div>
                      <button
                        className="icon-button"
                        onClick={() => setTaskEditor({ initialStatus: status.key })}
                        aria-label={`Add a ${status.label.toLowerCase()} task`}
                      >
                        <Plus size={16} aria-hidden="true" />
                      </button>
                    </div>
                    <p className="work-column-description">{status.description}</p>
                    <div className="work-column-cards">
                      {columnTasks.map(taskCard)}
                      {columnTasks.length === 0 && (
                        <div className="work-column-empty">
                          {status.key === 'done' ? (
                            <CheckCircle2 size={24} aria-hidden="true" />
                          ) : (
                            <Circle size={24} aria-hidden="true" />
                          )}
                          <p>
                            {query || ownerFilter !== 'all' || priorityFilter !== 'all'
                              ? 'No matching tasks here'
                              : status.key === 'done'
                                ? 'Finished tasks will find a home here.'
                                : 'Room for your next task.'}
                          </p>
                        </div>
                      )}
                    </div>
                    <button
                      className="work-add-task"
                      onClick={() => setTaskEditor({ initialStatus: status.key })}
                    >
                      <Plus size={14} aria-hidden="true" />
                      Add a task
                    </button>
                  </section>
                );
              })}
            </div>
          ) : (
            <section className="panel work-list-panel">
              <div className="work-table-scroll">
                <table className="work-task-table">
                  <caption className="work-sr-only">
                    Team tasks with owners, due dates, priorities and statuses
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Task</th>
                      <th scope="col">Owner</th>
                      <th scope="col">Due date</th>
                      <th scope="col">Priority</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span className="work-sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTasks.map((task) => (
                      <tr key={task.id}>
                        <td>
                          <button
                            className={`work-list-title ${task.status === 'done' ? 'is-done' : ''}`}
                            onClick={() => setTaskEditor({ item: task })}
                          >
                            {task.status === 'done' ? (
                              <CheckCircle2 size={16} aria-hidden="true" />
                            ) : (
                              <Circle size={16} aria-hidden="true" />
                            )}
                            {task.title}
                          </button>
                        </td>
                        <td>
                          <span className="work-list-owner">
                            <Avatar name={task.owner || 'Unassigned'} size="sm" />
                            {task.owner || 'Unassigned'}
                          </span>
                        </td>
                        <td>
                          <span className={`work-due ${isOverdue(task) ? 'is-overdue' : ''}`}>
                            {friendlyDate(task.dueDate)}
                            {isOverdue(task) && <span className="work-overdue-label">Overdue</span>}
                          </span>
                        </td>
                        <td>
                          <Badge tone={priorityTone[task.priority]}>
                            {priorityLabel[task.priority]}
                          </Badge>
                        </td>
                        <td>
                          <select
                            className={`work-status-select work-status-${task.status}`}
                            aria-label={`Status for ${task.title}`}
                            value={task.status}
                            disabled={!!busy}
                            onChange={(e) =>
                              changeTaskStatus(task, e.target.value as Task['status'])
                            }
                          >
                            {statuses.map((status) => (
                              <option key={status.key} value={status.key}>
                                {status.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <div className="work-row-actions">
                            <button
                              className="icon-button"
                              onClick={() => setTaskEditor({ item: task })}
                              aria-label={`Edit task: ${task.title}`}
                            >
                              <Pencil size={14} aria-hidden="true" />
                            </button>
                            <button
                              className="icon-button work-delete-icon"
                              onClick={() =>
                                setDeleteTarget({ kind: 'task', id: task.id, title: task.title })
                              }
                              aria-label={`Delete task: ${task.title}`}
                            >
                              <Trash2 size={14} aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {visibleTasks.length === 0 && (
                <div className="work-empty">
                  <ClipboardList size={29} aria-hidden="true" />
                  <h3>No tasks here yet</h3>
                  <p>
                    {query || ownerFilter !== 'all' || priorityFilter !== 'all'
                      ? 'Try a different search or filter.'
                      : 'Start with one clear task and give it an owner.'}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      if (query || ownerFilter !== 'all' || priorityFilter !== 'all') {
                        setQuery('');
                        setOwnerFilter('all');
                        setPriorityFilter('all');
                      } else setTaskEditor({});
                    }}
                  >
                    {query || ownerFilter !== 'all' || priorityFilter !== 'all'
                      ? 'Clear filters'
                      : 'Add task'}
                  </Button>
                </div>
              )}
            </section>
          )}
          <p className="work-board-note">
            Move work forward with the action on each card, or edit a task to update its owner, date
            and status.
          </p>
        </>
      ) : (
        <>
          <div className="work-knowledge-heading">
            <div>
              <h2>A home for what your team knows.</h2>
              <p>Keep your playbooks, brand guidance and good ideas easy to find.</p>
            </div>
            <label className="work-search">
              <Search size={17} aria-hidden="true" />
              <input
                aria-label="Search knowledge documents"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your knowledge…"
              />
              {query && (
                <button aria-label="Clear search" onClick={() => setQuery('')}>
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </label>
          </div>
          <div className="work-knowledge-layout">
            <aside className="panel work-knowledge-sidebar">
              <p className="work-category-heading">YOUR LIBRARY</p>
              <button
                className={`work-category-button ${documentCategory === 'all' ? 'active' : ''}`}
                aria-pressed={documentCategory === 'all'}
                onClick={() => setDocumentCategory('all')}
              >
                <BookOpen size={16} aria-hidden="true" />
                <span>All documents</span>
                <span className="work-category-count">{data.documents.length}</span>
              </button>
              {documentCategories.map((category) => (
                <button
                  className={`work-category-button ${documentCategory === category ? 'active' : ''}`}
                  aria-pressed={documentCategory === category}
                  key={category}
                  onClick={() => setDocumentCategory(category)}
                >
                  <FolderOpen size={15} aria-hidden="true" />
                  <span>{category}</span>
                  <span className="work-category-count">
                    {
                      data.documents.filter((item) => (item.category || 'General') === category)
                        .length
                    }
                  </span>
                </button>
              ))}
              <div className="work-library-note">
                <FileText size={22} aria-hidden="true" />
                <h3>
                  Write it once.
                  <br />
                  Keep everyone aligned.
                </h3>
                <p>A useful shared document can save the team a hundred repeat questions.</p>
              </div>
            </aside>
            <section className="work-document-section" aria-label="Knowledge documents">
              <div className="work-document-section-heading">
                <h3>{documentCategory === 'all' ? 'All documents' : documentCategory}</h3>
                <span>
                  {visibleDocuments.length}{' '}
                  {visibleDocuments.length === 1 ? 'document' : 'documents'}
                </span>
              </div>
              <div className="work-document-grid">
                {visibleDocuments.map((doc, index) => (
                  <article className="panel work-document-card" key={doc.id}>
                    <div className="work-document-card-top">
                      <span className={`work-document-icon work-document-tint-${index % 3}`}>
                        <FileText size={23} aria-hidden="true" />
                      </span>
                      <button
                        className="icon-button"
                        aria-label={`Edit ${doc.title}`}
                        onClick={() => setDocumentEditor({ item: doc })}
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                    </div>
                    <span className="work-document-category">{doc.category || 'General'}</span>
                    <button
                      className="work-document-title"
                      onClick={() => setSelectedDocumentId(doc.id)}
                    >
                      {doc.title}
                    </button>
                    <p>
                      {excerpt(doc.content) || 'This document is ready for your team’s knowledge.'}
                    </p>
                    <div className="work-document-card-bottom">
                      <span>Updated {friendlyDate(doc.updatedAt)}</span>
                      <button
                        onClick={() => setSelectedDocumentId(doc.id)}
                        aria-label={`Open ${doc.title}`}
                      >
                        <span>Read</span>
                        <ArrowRight size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                ))}
                <button className="work-new-document-card" onClick={() => setDocumentEditor({})}>
                  <span>
                    <Plus size={23} aria-hidden="true" />
                  </span>
                  <strong>Create a document</strong>
                  <p>A fresh page for something worth sharing.</p>
                </button>
              </div>
              {visibleDocuments.length === 0 && (query || documentCategory !== 'all') && (
                <div className="work-empty">
                  <Search size={28} aria-hidden="true" />
                  <h3>No documents found</h3>
                  <p>Try another phrase or browse the full library.</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setQuery('');
                      setDocumentCategory('all');
                    }}
                  >
                    Show all documents
                  </Button>
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {taskEditor && (
        <TaskEditorModal
          key={taskEditor.item?.id || `new-${taskEditor.initialStatus || 'todo'}`}
          editor={taskEditor}
          owners={owners}
          currentUser={data.user.name}
          onClose={() => setTaskEditor(null)}
          onError={reportError}
          onDelete={
            taskEditor.item
              ? () => {
                  const item = taskEditor.item!;
                  setTaskEditor(null);
                  setDeleteTarget({ kind: 'task', id: item.id, title: item.title });
                }
              : undefined
          }
          onSave={async (body) => {
            await mutate(
              taskEditor.item ? `/tasks/${encodeURIComponent(taskEditor.item.id)}` : '/tasks',
              taskEditor.item ? 'PATCH' : 'POST',
              body,
            );
            toast(taskEditor.item ? 'Task updated.' : 'Task added to the board.', 'success');
            setTaskEditor(null);
          }}
        />
      )}
      {documentEditor && (
        <DocumentEditorModal
          key={documentEditor.item?.id || 'new-document'}
          editor={documentEditor}
          categories={documentCategories}
          onClose={() => setDocumentEditor(null)}
          onError={reportError}
          onSave={async (body) => {
            await mutate(
              documentEditor.item
                ? `/documents/${encodeURIComponent(documentEditor.item.id)}`
                : '/documents',
              documentEditor.item ? 'PATCH' : 'POST',
              body,
            );
            toast(
              documentEditor.item ? 'Document updated.' : 'Document added to your library.',
              'success',
            );
            setDocumentEditor(null);
          }}
        />
      )}
      {selectedDocument && !documentEditor && !deleteTarget && (
        <Modal
          title="Team knowledge"
          onClose={() => setSelectedDocumentId(null)}
          className="work-document-modal"
        >
          <div className="work-document-reader">
            <div className="work-document-reader-meta">
              <Badge tone="violet">{selectedDocument.category || 'General'}</Badge>
              <span>Updated {friendlyDate(selectedDocument.updatedAt, true)}</span>
            </div>
            <h2>{selectedDocument.title}</h2>
            <div className="work-document-body">
              {selectedDocument.content || 'This document does not have any content yet.'}
            </div>
            <div className="work-document-reader-footer">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setDeleteTarget({
                    kind: 'document',
                    id: selectedDocument.id,
                    title: selectedDocument.title,
                  })
                }
              >
                <Trash2 size={15} aria-hidden="true" />
                Delete
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setDocumentEditor({ item: selectedDocument });
                  setSelectedDocumentId(null);
                }}
              >
                <Pencil size={15} aria-hidden="true" />
                Edit document
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {deleteTarget && (
        <Modal
          title={`Delete ${deleteTarget.kind}?`}
          onClose={() => !busy && setDeleteTarget(null)}
        >
          <p className="work-confirm-copy">
            Delete <strong>{deleteTarget.title}</strong>? This will remove it from your team’s
            workspace and cannot be undone.
          </p>
          <div className="work-modal-actions">
            <Button variant="secondary" disabled={!!busy} onClick={() => setDeleteTarget(null)}>
              Keep it
            </Button>
            <Button variant="danger" disabled={!!busy} onClick={removeItem}>
              {busy === 'delete' ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TaskEditorModal({
  editor,
  owners,
  currentUser,
  onClose,
  onSave,
  onError,
  onDelete,
}: {
  editor: TaskEditor;
  owners: string[];
  currentUser: string;
  onClose: () => void;
  onSave: (body: unknown) => Promise<void>;
  onError: (error: unknown) => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(editor.item?.title || '');
  const [owner, setOwner] = useState(editor.item?.owner || currentUser);
  const [dueDate, setDueDate] = useState(editor.item?.dueDate?.slice(0, 10) || planningDate());
  const [priority, setPriority] = useState<Task['priority']>(editor.item?.priority || 'medium');
  const [status, setStatus] = useState<Task['status']>(
    editor.item?.status || editor.initialStatus || 'todo',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!title.trim()) {
      setError('Give this task a clear title.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({ title: title.trim(), owner, dueDate, priority, status });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not save your changes. Please try again.',
      );
      onError(caught);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={editor.item ? 'Edit task' : 'A new next step'}
      onClose={() => !saving && onClose()}
    >
      <form className="work-editor-form" onSubmit={submit}>
        <label className="field">
          <span>Task title</span>
          <input
            className="input"
            placeholder="What needs to get done?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={180}
            autoFocus
          />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Owner</span>
            <select
              className="select"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              required
            >
              <option value="" disabled>
                Select an owner
              </option>
              {owners.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <div className="field">
            <label htmlFor="task-due-date">Due date · IST</label>
            <input
              id="task-due-date"
              className="input"
              type="date"
              required
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
            <div className="work-date-shortcuts">
              <button type="button" onClick={() => setDueDate(planningDate())}>
                Today
              </button>
              <button type="button" onClick={() => setDueDate(planningDate(7))}>
                In 7 days
              </button>
            </div>
          </div>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>Priority</span>
            <select
              className="select"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Task['priority'])}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select
              className="select"
              value={status}
              onChange={(e) => setStatus(e.target.value as Task['status'])}
            >
              {statuses.map((item) => (
                <option value={item.key} key={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && (
          <p className="work-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="work-editor-footer">
          {onDelete && (
            <Button variant="ghost" size="sm" disabled={saving} onClick={onDelete}>
              <Trash2 size={15} aria-hidden="true" />
              Delete task
            </Button>
          )}
          <div>
            <Button variant="secondary" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : editor.item ? 'Save changes' : 'Add task'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function DocumentEditorModal({
  editor,
  categories,
  onClose,
  onSave,
  onError,
}: {
  editor: DocumentEditor;
  categories: string[];
  onClose: () => void;
  onSave: (body: unknown) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [title, setTitle] = useState(editor.item?.title || '');
  const [category, setCategory] = useState(editor.item?.category || 'General');
  const [content, setContent] = useState(editor.item?.content || '');
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!title.trim()) {
      setError('Add a title so your team can find this document.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({ title: title.trim(), category: category.trim() || 'General', content });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not save your changes. Please try again.',
      );
      onError(caught);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={editor.item ? 'Edit document' : 'Start a new document'}
      onClose={() => !saving && onClose()}
      className="work-document-modal"
    >
      <form className="work-editor-form work-document-editor" onSubmit={submit}>
        <label className="field">
          <span>Title</span>
          <input
            className="input work-document-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={180}
            placeholder="Give this knowledge a name"
            autoFocus
          />
        </label>
        <label className="field">
          <span>Category</span>
          <input
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            list="work-document-categories"
            maxLength={80}
            placeholder="e.g. Brand guidelines"
          />
          <datalist id="work-document-categories">
            {categories.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </label>
        <div className="work-editor-writing">
          <div className="work-writing-toolbar">
            <div aria-label="Document editor mode">
              <button
                type="button"
                className={!preview ? 'active' : ''}
                aria-pressed={!preview}
                onClick={() => setPreview(false)}
              >
                Write
              </button>
              <button
                type="button"
                className={preview ? 'active' : ''}
                aria-pressed={preview}
                onClick={() => setPreview(true)}
              >
                Preview
              </button>
            </div>
            <span>
              {words} {words === 1 ? 'word' : 'words'}
            </span>
          </div>
          {preview ? (
            <div className="work-document-body work-writing-preview">
              {content || 'Your document preview will appear here.'}
            </div>
          ) : (
            <textarea
              aria-label="Document content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Share the guidance, process or ideas your team should know.\n\nStart with a clear purpose, then add useful details."
              rows={13}
              maxLength={50000}
            />
          )}
          <p className="work-writing-note">
            Plain text · Use line breaks to organize your document.
          </p>
        </div>
        {error && (
          <p className="work-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="work-modal-actions">
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : editor.item ? 'Save changes' : 'Create document'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
