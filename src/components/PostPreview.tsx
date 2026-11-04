import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  CalendarClock,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  Copy,
  FileText,
  History,
  Link2,
  MessageSquareText,
  Pencil,
  RefreshCw,
  Send,
  ShieldCheck,
  Undo2,
  X,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import type { Post, PublicationJob } from '../lib/types';
import { Avatar, Badge, Button, PlatformIcon, StatusBadge } from './UI';
import { assetImageUrl } from './MediaLibrary';
import '../styles/content.css';

const indiaDate = (value: string, withTime = true) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric' as const, minute: '2-digit' as const, hour12: true } : {}),
  }).format(new Date(value));

function safeUrl(value?: string) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? parsed
      : null;
  } catch {
    return null;
  }
}

type ReviewAction = 'submit' | 'approve' | 'reject' | 'request_changes' | 'schedule' | 'unschedule';

export default function PostPreview({
  post,
  readOnly = false,
  compact = false,
  onEdit,
}: {
  post: Post;
  readOnly?: boolean;
  compact?: boolean;
  onEdit?: () => void;
}) {
  const { data, mutate, toast, openComposer } = useWorkspace();
  const [busy, setBusy] = useState<ReviewAction | null>(null);
  const [feedbackAction, setFeedbackAction] = useState<'reject' | 'request_changes' | null>(null);
  const [feedback, setFeedback] = useState('');
  const [feedbackError, setFeedbackError] = useState('');
  const [actionError, setActionError] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [confirmApproval, setConfirmApproval] = useState(false);
  useEffect(() => {
    setFeedbackAction(null);
    setFeedback('');
    setFeedbackError('');
    setActionError('');
    setConfirmApproval(false);
  }, [post.id, post.revision, post.status, post.scheduledAt, data.user.id, data.user.role]);
  useEffect(() => setImageFailed(false), [post.mediaUrl, post.assetId]);

  const isManager = data.user.role === 'manager';
  const publicationLocked = data.publicationJobs.some(
    (job) =>
      job.postId === post.id &&
      ['processing', 'needs_reconciliation', 'published'].includes(job.status),
  );
  const canEdit =
    !publicationLocked &&
    (isManager ||
      (data.user.id === post.ownerId &&
        ['draft', 'changes_requested', 'rejected'].includes(post.status)));
  const source = safeUrl(post.sourceUrl);
  const asset = data.mediaAssets.find((item) => item.id === post.assetId);
  const media = post.assetId ? assetImageUrl(asset) : safeUrl(post.mediaUrl)?.href;
  const destinations = (post.destinationIds || []).map((id) =>
    data.connections.find((connection) => connection.id === id),
  );
  const hasDestinations = destinations.length > 0;
  const futureDelivery =
    post.scheduledAt && new Date(post.scheduledAt).getTime() > Date.now() ? post.scheduledAt : null;
  const jobs = data.publicationJobs.filter((job) => job.postId === post.id);
  const currentJobs = jobs.filter(
    (job) => job.revision === post.revision && job.status !== 'cancelled',
  );
  const approvalIsCurrent =
    post.approvedRevision === post.revision && !!post.approvedBy && !!post.approvedAt;
  const approvedBy =
    data.users.find((user) => user.id === post.approvedBy)?.name || post.approvedBy;

  async function transition(action: ReviewAction) {
    if (busy || readOnly) return;
    setActionError('');
    if (action === 'submit' ? !canEdit : !isManager) {
      setActionError('Your current role does not allow this action.');
      return;
    }
    if (action === 'submit' && !post.caption.trim()) {
      setActionError('Add a caption before sending this draft for review.');
      return;
    }
    if ((action === 'reject' || action === 'request_changes') && !feedback.trim()) {
      setFeedbackError('Add a short note so your team knows what to change.');
      return;
    }
    const plannedTime = post.scheduledAt ? new Date(post.scheduledAt).getTime() : NaN;
    if (action === 'schedule' && (!Number.isFinite(plannedTime) || plannedTime <= Date.now())) {
      const message =
        'Choose a future planned date, then submit the updated revision for approval.';
      setActionError(message);
      toast(message, 'error');
      return;
    }
    setBusy(action);
    try {
      await mutate(`/posts/${post.id}/transition`, 'POST', {
        action,
        revision: post.revision,
        ...(action === 'reject' || action === 'request_changes'
          ? { feedback: feedback.trim() }
          : {}),
      });
      const messages: Record<ReviewAction, string> = {
        submit: `Revision ${post.revision} sent for review.`,
        approve: hasDestinations
          ? `Revision ${post.revision} approved and queued for ${destinations.length} account${destinations.length === 1 ? '' : 's'}.`
          : `Revision ${post.revision} approved.`,
        reject: 'Post rejected. Your feedback is saved.',
        request_changes: 'Changes requested. Your feedback is saved.',
        schedule: 'Added to your local content plan. This does not publish to a social channel.',
        unschedule: 'Removed from the schedule. The approved revision is preserved.',
      };
      toast(messages[action], 'success');
      setFeedbackAction(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'We couldn’t update this post. Please try again.';
      setActionError(message);
      toast(message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function duplicate() {
    setDuplicating(true);
    setActionError('');
    try {
      const copy = await mutate<Post>(`/posts/${post.id}/duplicate`, 'POST', {});
      toast('A new draft copy is ready. It needs its own review.');
      openComposer(copy);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The draft could not be duplicated.');
    } finally {
      setDuplicating(false);
    }
  }

  return (
    <article
      className={`preview-root${compact ? ' preview-compact' : ''}${readOnly ? ' preview-readonly' : ''}`}
    >
      <div className="preview-topline">
        <span className="eyebrow">{readOnly ? 'Content preview' : 'Post details'}</span>
        <span className="preview-version">v{post.revision}</span>
      </div>

      <div className={`preview-story preview-story-${post.palette}`}>
        {media && !imageFailed ? (
          <img
            className="preview-image"
            src={media}
            alt={`Visual for ${post.title || 'this post'}`}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="preview-type-cover">
            <span className="preview-school">{post.institution || 'St. Mary’s Group'}</span>
            <h3>{post.title.trim() || 'Your next great story.'}</h3>
            <span className="preview-cover-caption">
              <FileText size={12} /> Text preview
            </span>
          </div>
        )}
        <span className="preview-format">{post.format}</span>
      </div>
      {(imageFailed || (post.assetId && !asset)) && (
        <p className="preview-media-note">
          The saved image couldn’t load. Reopen the media library before approving publication.
        </p>
      )}

      <div className="preview-body">
        <div className="preview-status-row">
          {!readOnly && <StatusBadge status={post.status} />}
          {post.sample && <Badge tone="gray">Sample draft</Badge>}
          <span className="preview-language">{post.language}</span>
        </div>

        <div className="preview-destinations">
          <strong>Publishing destination{destinations.length === 1 ? '' : 's'}</strong>
          {destinations.length ? (
            destinations.map((connection, index) => (
              <div key={post.destinationIds?.[index]}>
                <PlatformIcon platform="instagram" size={16} />
                <span>
                  {connection?.accountName || 'Unavailable account'}
                  <small>
                    {connection
                      ? `${connection.institution} · ${connection.accountId || 'Account not selected'}`
                      : 'Reconnect or choose a new destination.'}
                  </small>
                </span>
                <Badge tone={connection?.status === 'connected' ? 'green' : 'amber'}>
                  {connection?.status === 'connected' ? 'Ready' : 'Check access'}
                </Badge>
              </div>
            ))
          ) : (
            <p>
              No account selected. This content can be planned and reviewed; choose an account to
              publish from here.
            </p>
          )}
        </div>
        <div className="preview-channel-row">
          <Avatar name={post.institution || 'St. Mary’s'} size="sm" />
          <div className="preview-channel-name">
            <strong>{post.institution}</strong>
            <span>{post.platforms.length ? 'Selected channels' : 'Choose a channel'}</span>
          </div>
          <div className="preview-platforms">
            {post.platforms.map((platform) => (
              <PlatformIcon key={platform} platform={platform} size={21} />
            ))}
          </div>
        </div>
        {!readOnly && <h3 className="preview-post-title">{post.title}</h3>}
        <p className={`preview-caption${!post.caption.trim() ? ' preview-placeholder' : ''}`}>
          {post.caption.trim() ||
            'Your caption will appear here as you write. Keep it useful, clear, and unmistakably St. Mary’s.'}
        </p>

        <div className="preview-meta">
          <div>
            <CalendarClock size={16} />
            <span>Planned for</span>
            <strong>
              {post.scheduledAt ? `${indiaDate(post.scheduledAt)} IST` : 'Date not set'}
            </strong>
          </div>
          {!readOnly && (
            <div>
              <Pencil size={16} />
              <span>Created by</span>
              <strong>{post.ownerName}</strong>
            </div>
          )}
          <div>
            <FileText size={16} />
            <span>Revision</span>
            <strong>
              {post.revision}
              {!readOnly && approvalIsCurrent ? ' · approved' : ''}
            </strong>
          </div>
        </div>

        {source ? (
          <a
            className="preview-source"
            href={source.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="preview-source-icon">
              <Link2 size={17} />
            </span>
            <span>
              <strong>Check the source</strong>
              <span>{source.hostname.replace(/^www\./, '')}</span>
            </span>
            <ArrowUpRight size={16} />
          </a>
        ) : !readOnly ? (
          <div className="preview-no-source">
            <Link2 size={15} />
            <span>No source attached. Add one for claims about exams, results, or seats.</span>
          </div>
        ) : null}

        {!readOnly && post.feedback && (
          <div className="preview-feedback">
            <MessageSquareText size={17} />
            <div>
              <strong>Review feedback</strong>
              <p>{post.feedback}</p>
            </div>
          </div>
        )}
        {!readOnly && approvalIsCurrent && post.approvedAt && (
          <div className="preview-approval-record">
            <ShieldCheck size={16} />
            <p>
              <strong>Revision {post.approvedRevision} approved</strong>
              <span>
                {approvedBy ? `${approvedBy} · ` : ''}
                {indiaDate(post.approvedAt)}
              </span>
            </p>
          </div>
        )}

        {!readOnly && (
          <div className="preview-actions">
            {actionError && (
              <p className="preview-error" role="alert">
                {actionError}
              </p>
            )}
            {post.status === 'in_review' && isManager && (
              <>
                <div className="preview-review-context">
                  <ShieldCheck size={16} />
                  <span>
                    Your decision applies to <strong>revision {post.revision}</strong>, with the
                    caption, image, source, and destination accounts shown here.
                    {hasDestinations && ' Approving also queues delivery to those accounts.'}
                  </span>
                </div>
                {!feedbackAction ? (
                  confirmApproval ? (
                    <div
                      className="preview-approval-confirm"
                      role="region"
                      aria-label="Confirm approval and queued delivery"
                    >
                      <strong>Approve revision {post.revision} & queue delivery</strong>
                      <p>The saved image and caption shown above will be sent to:</p>
                      <ul>
                        {destinations.map((connection, index) => (
                          <li key={post.destinationIds?.[index]}>
                            <PlatformIcon platform="instagram" size={16} />
                            <span>
                              <strong>{connection?.accountName || 'Unavailable account'}</strong>
                              <small>
                                {connection?.institution || post.institution} · Account{' '}
                                {connection?.accountId || post.destinationIds?.[index]}
                              </small>
                            </span>
                          </li>
                        ))}
                      </ul>
                      <div className="preview-approval-time">
                        <CalendarClock size={17} />
                        <span>
                          {futureDelivery ? (
                            <>
                              Scheduled for <strong>{indiaDate(futureDelivery)} IST</strong>
                            </>
                          ) : (
                            <>
                              Due on the <strong>next publishing run after approval</strong>
                            </>
                          )}
                        </span>
                      </div>
                      <p>
                        {data.publishingEnabled
                          ? 'The publishing worker will send this exact approved revision when the job is due. You can cancel a queued job before processing starts.'
                          : 'Publishing is currently paused. Approval still queues this revision; delivery waits until publishing is enabled and the worker processes the due job.'}
                      </p>
                      <div className="preview-action-pair">
                        <Button
                          variant="primary"
                          autoFocus
                          disabled={!!busy}
                          onClick={() => transition('approve')}
                        >
                          <Check size={16} />
                          {busy === 'approve' ? 'Approving & queueing…' : 'Approve & queue'}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={!!busy}
                          onClick={() => setConfirmApproval(false)}
                        >
                          Go back
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Button
                        variant="primary"
                        disabled={!!busy}
                        onClick={() =>
                          hasDestinations ? setConfirmApproval(true) : transition('approve')
                        }
                      >
                        <Check size={17} />
                        {busy === 'approve'
                          ? 'Approving…'
                          : hasDestinations
                            ? 'Approve & queue'
                            : `Approve revision ${post.revision}`}
                      </Button>
                      <div className="preview-action-pair">
                        <Button
                          variant="secondary"
                          disabled={!!busy}
                          onClick={() => setFeedbackAction('request_changes')}
                        >
                          <MessageSquareText size={15} />
                          Request changes
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={!!busy}
                          onClick={() => setFeedbackAction('reject')}
                        >
                          <X size={15} />
                          Reject
                        </Button>
                      </div>
                    </>
                  )
                ) : (
                  <form
                    className="preview-review-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void transition(feedbackAction);
                    }}
                  >
                    <label htmlFor={`feedback-${post.id}`}>
                      {feedbackAction === 'reject'
                        ? 'Why are you rejecting this post?'
                        : 'What should your team change?'}
                    </label>
                    <textarea
                      id={`feedback-${post.id}`}
                      rows={3}
                      maxLength={2000}
                      autoFocus
                      value={feedback}
                      onChange={(event) => {
                        setFeedback(event.target.value);
                        setFeedbackError('');
                      }}
                      placeholder="Be specific. A helpful note makes the next draft better."
                      aria-invalid={!!feedbackError}
                      aria-describedby={feedbackError ? `feedback-error-${post.id}` : undefined}
                    />
                    {feedbackError && (
                      <p className="preview-error" id={`feedback-error-${post.id}`} role="alert">
                        {feedbackError}
                      </p>
                    )}
                    <div className="preview-action-pair">
                      <Button
                        variant={feedbackAction === 'reject' ? 'danger' : 'primary'}
                        type="submit"
                        disabled={!!busy}
                      >
                        {busy
                          ? 'Saving…'
                          : feedbackAction === 'reject'
                            ? 'Reject post'
                            : 'Send feedback'}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={!!busy}
                        onClick={() => {
                          setFeedbackAction(null);
                          setFeedbackError('');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </>
            )}
            {post.status === 'in_review' && !isManager && (
              <div className="preview-waiting">
                <Clock3 size={18} />
                <span>
                  <strong>With your manager</strong>
                  <span>This revision is waiting for a decision.</span>
                </span>
              </div>
            )}
            {['draft', 'changes_requested', 'rejected'].includes(post.status) && canEdit && (
              <Button variant="primary" disabled={!!busy} onClick={() => transition('submit')}>
                <Send size={16} />
                {busy === 'submit' ? 'Sending…' : 'Send for review'}
              </Button>
            )}
            {post.status === 'approved' &&
              approvalIsCurrent &&
              isManager &&
              !post.destinationIds?.length &&
              (post.scheduledAt && new Date(post.scheduledAt).getTime() > Date.now() ? (
                <Button variant="primary" disabled={!!busy} onClick={() => transition('schedule')}>
                  <CalendarClock size={17} />
                  {busy === 'schedule' ? 'Scheduling…' : 'Add to local schedule'}
                </Button>
              ) : (
                <div className="preview-waiting">
                  <CalendarClock size={18} />
                  <span>
                    <strong>
                      {post.scheduledAt ? 'Planned date has passed' : 'Choose a planned date'}
                    </strong>
                    <span>Edit the date and send the new revision for approval.</span>
                  </span>
                </div>
              ))}
            {post.status === 'scheduled' && isManager && !currentJobs.length && (
              <Button
                variant="secondary"
                disabled={!!busy}
                onClick={() => transition('unschedule')}
              >
                <Undo2 size={16} />
                {busy === 'unschedule' ? 'Updating…' : 'Remove from schedule'}
              </Button>
            )}
            {post.status === 'published' && (
              <div className="preview-waiting">
                <CheckCheck size={18} />
                <span>
                  <strong>{post.sample ? 'Sample published record' : 'Published record'}</strong>
                  <span>
                    {post.sample ? 'This is demonstration content.' : 'This record is read only.'}
                  </span>
                </span>
              </div>
            )}
            {onEdit && canEdit && post.status !== 'published' && (
              <Button variant="ghost" disabled={!!busy} onClick={onEdit}>
                <Pencil size={15} />
                Edit{' '}
                {['approved', 'scheduled', 'in_review'].includes(post.status)
                  ? '& create new revision'
                  : 'draft'}
                <ChevronRight size={15} />
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={!!busy || duplicating}
              onClick={() => void duplicate()}
            >
              <Copy size={15} />
              {duplicating ? 'Creating a copy…' : 'Duplicate as a new draft'}
            </Button>
            <p className="preview-publish-note">
              Your exact revision, saved image and destination accounts stay together throughout
              review and publishing.
            </p>
          </div>
        )}
        {!readOnly && (
          <PublishingPanel post={post} jobs={jobs} approvalIsCurrent={approvalIsCurrent} />
        )}
        {!readOnly && <ReviewConversation post={post} />}
      </div>
    </article>
  );
}

const deliveryStatus: Record<
  PublicationJob['status'],
  { label: string; tone: 'gray' | 'violet' | 'green' | 'red' | 'amber' }
> = {
  queued: { label: 'Queued', tone: 'violet' },
  processing: { label: 'Publishing', tone: 'violet' },
  published: { label: 'Confirmed published', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
  needs_reconciliation: { label: 'Confirmation needed', tone: 'amber' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
};

function PublishingPanel({
  post,
  jobs,
  approvalIsCurrent,
}: {
  post: Post;
  jobs: PublicationJob[];
  approvalIsCurrent: boolean;
}) {
  const { data, mutate, toast } = useWorkspace();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmQueue, setConfirmQueue] = useState(false);
  useEffect(() => {
    setError('');
    setConfirmQueue(false);
  }, [post.id, post.revision, post.status]);
  const isManager = data.user.role === 'manager';
  const destinations = post.destinationIds || [];
  const current = jobs.filter((job) => job.revision === post.revision);
  const hasQueued = current.some((job) =>
    ['queued', 'processing', 'published', 'failed', 'needs_reconciliation'].includes(job.status),
  );
  const eligible =
    destinations.length > 0 &&
    destinations.every((id) => {
      const connection = data.connections.find((item) => item.id === id);
      return (
        connection?.status === 'connected' &&
        connection.provider === 'instagram' &&
        connection.institution === post.institution &&
        !!connection.accountId
      );
    }) &&
    !!post.assetId &&
    post.format === 'Post' &&
    post.caption.length <= 2200;
  const planned =
    post.scheduledAt && new Date(post.scheduledAt).getTime() > Date.now() ? post.scheduledAt : null;
  const canQueue =
    isManager &&
    approvalIsCurrent &&
    ['approved', 'scheduled'].includes(post.status) &&
    destinations.length > 0 &&
    !hasQueued;

  async function action(path: string, kind: string, body: unknown = {}) {
    setBusy(kind);
    setError('');
    try {
      await mutate(path, 'POST', body);
      setConfirmQueue(false);
      toast(
        kind === 'queue'
          ? 'Approved revision added to the publishing queue.'
          : kind.startsWith('retry')
            ? 'Publishing job queued to try again.'
            : 'Publishing job cancelled.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The publishing job could not be updated.');
    } finally {
      setBusy('');
    }
  }
  if (!jobs.length && !canQueue) return null;
  return (
    <section className="preview-delivery">
      <div className="preview-section-title">
        <Send size={16} />
        <h4>Publishing</h4>
        {jobs.length > 0 && <Badge>{jobs.length}</Badge>}
      </div>
      {error && (
        <p className="preview-error" role="alert">
          {error}
        </p>
      )}
      {canQueue && (
        <div className="preview-queue-action">
          <p>
            {planned
              ? `Queue this approved image for ${indiaDate(planned)} IST.`
              : 'Queue this approved image for the next publishing run.'}
          </p>
          {!eligible && (
            <p className="preview-error">
              A connected school account, saved image and supported image Post are required. Update
              the draft and review the new revision.
            </p>
          )}
          {confirmQueue ? (
            <div className="preview-queue-confirm">
              <strong>
                This will authorize delivery to {destinations.length} account
                {destinations.length === 1 ? '' : 's'}.
              </strong>
              <p>
                The saved revision {post.revision} will be sent when its publishing job is
                processed.
              </p>
              <div className="preview-action-pair">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!!busy}
                  onClick={() =>
                    void action(`/posts/${post.id}/publications`, 'queue', {
                      revision: post.revision,
                      ...(planned ? { scheduledAt: planned } : {}),
                    })
                  }
                >
                  {busy ? 'Queueing…' : 'Confirm & queue'}
                </Button>
                <Button size="sm" disabled={!!busy} onClick={() => setConfirmQueue(false)}>
                  Go back
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="primary"
              size="sm"
              disabled={!eligible || !!busy}
              onClick={() => setConfirmQueue(true)}
            >
              <Send size={15} />
              {planned ? 'Queue for planned time' : 'Queue for publishing'}
            </Button>
          )}
        </div>
      )}
      <div className="preview-jobs">
        {jobs
          .slice()
          .reverse()
          .map((job) => {
            const info = deliveryStatus[job.status];
            const remote = safeUrl(job.remoteUrl || undefined);
            return (
              <article className="preview-job" key={job.id}>
                <div>
                  <strong>{job.accountName}</strong>
                  <Badge tone={info.tone}>{info.label}</Badge>
                </div>
                <p>
                  Revision {job.revision} · {indiaDate(job.scheduledAt)} IST
                </p>
                {job.error && <p className="preview-job-error">{job.error}</p>}
                {job.status === 'needs_reconciliation' && (
                  <p>
                    Check the selected Instagram account before any further attempt. Delivery may
                    have succeeded; this job stays locked until its result is verified.
                  </p>
                )}
                {isManager && job.status === 'needs_reconciliation' && <ReconcileJob job={job} />}
                {job.remoteId && <small>Provider record: {job.remoteId}</small>}
                {remote && job.status === 'published' && (
                  <a href={remote.href} target="_blank" rel="noopener noreferrer">
                    View published post <ArrowUpRight size={13} />
                  </a>
                )}
                {isManager &&
                  (job.status === 'queued' ||
                    job.status === 'failed' ||
                    (job.status === 'cancelled' &&
                      job.revision === post.revision &&
                      approvalIsCurrent &&
                      ['approved', 'scheduled'].includes(post.status))) && (
                    <div className="preview-job-actions">
                      {(job.status === 'failed' || job.status === 'cancelled') && (
                        <Button
                          size="sm"
                          disabled={!!busy}
                          title="Make this approved job due on the next publishing run"
                          onClick={() =>
                            void action(`/publications/${job.id}/retry`, `retry:${job.id}`)
                          }
                        >
                          <RefreshCw size={13} />
                          {job.status === 'cancelled' ? 'Resume delivery' : 'Retry delivery'}
                        </Button>
                      )}
                      {job.status !== 'cancelled' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!!busy}
                          onClick={() =>
                            void action(`/publications/${job.id}/cancel`, `cancel:${job.id}`)
                          }
                        >
                          Cancel job
                        </Button>
                      )}
                    </div>
                  )}
                {isManager &&
                  job.status === 'cancelled' &&
                  job.revision === post.revision &&
                  approvalIsCurrent &&
                  ['approved', 'scheduled'].includes(post.status) && (
                    <small>
                      Resuming queues this account for the next publishing run. Confirmed deliveries
                      to other accounts stay complete.
                    </small>
                  )}
              </article>
            );
          })}
      </div>
    </section>
  );
}

function ReconcileJob({ job }: { job: PublicationJob }) {
  const { mutate, toast } = useWorkspace();
  const [remoteId, setRemoteId] = useState(job.remoteId || '');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!checked || !/^\d{1,40}$/.test(remoteId.trim())) {
      setError('Inspect the post and enter its numeric Instagram media ID.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await mutate(`/publications/${job.id}/reconcile`, 'POST', { remoteId: remoteId.trim() });
      toast('The provider confirmed this published post.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The provider could not verify this result.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="preview-reconcile">
      <summary>Verify an existing Instagram post</summary>
      <form onSubmit={verify}>
        <p>
          Inspect the image and caption on {job.accountName}. The server will check the post’s
          account, caption and publication time.
        </p>
        <label>
          Instagram media ID
          <input
            value={remoteId}
            onChange={(event) => setRemoteId(event.target.value)}
            disabled={busy}
            inputMode="numeric"
            pattern="[0-9]{1,40}"
            maxLength={40}
            required
            placeholder="Numeric ID from Instagram’s media record"
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={checked}
            disabled={busy}
            required
            onChange={(event) => setChecked(event.target.checked)}
          />
          I checked that the published image and caption match this approved revision.
        </label>
        {error && (
          <p className="preview-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="sm" disabled={busy || !checked || !remoteId.trim()}>
          {busy ? 'Verifying…' : 'Verify publication result'}
        </Button>
      </form>
    </details>
  );
}

type ReviewComment = {
  id: string;
  postId: string;
  revision: number;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
};
type SavedRevision = {
  revision: number;
  snapshot: Partial<Post>;
  changedBy: string;
  createdAt: string;
};
function ReviewConversation({ post }: { post: Post }) {
  const { data, request, mutate } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'comments' | 'history'>('comments');
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [revisions, setRevisions] = useState<SavedRevision[]>([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setOpen(false);
    setComments([]);
    setRevisions([]);
    setBody('');
    setError('');
  }, [post.id]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    Promise.allSettled([
      request<ReviewComment[]>(`/posts/${post.id}/comments`, { signal: controller.signal }),
      request<{ revisions: SavedRevision[] }>(`/posts/${post.id}/history`, {
        signal: controller.signal,
      }),
    ]).then(([notes, history]) => {
      if (controller.signal.aborted) return;
      if (notes.status === 'fulfilled') setComments(notes.value);
      if (history.status === 'fulfilled') setRevisions(history.value.revisions);
      if (notes.status === 'rejected' || history.status === 'rejected')
        setError('Some review activity could not load. Close and reopen this panel to try again.');
      setLoading(false);
    });
    return () => controller.abort();
  }, [open, post.id, post.revision, request]);
  async function comment(event: FormEvent) {
    event.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const saved = await mutate<ReviewComment>(`/posts/${post.id}/comments`, 'POST', {
        body: body.trim(),
        revision: post.revision,
      });
      setComments((current) => [...current, saved]);
      setBody('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your comment could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  const names = Object.fromEntries(
    (data.teamUsers || data.users).map((user) => [user.id, user.name]),
  );
  return (
    <section className="preview-conversation">
      <button
        type="button"
        className="preview-conversation-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MessageSquareText size={17} />
        <span>Comments & revision history</span>
        <ChevronRight size={15} className={open ? 'rotate' : ''} />
      </button>
      {open && (
        <div className="preview-conversation-body">
          <div className="preview-conversation-tabs">
            <button
              type="button"
              aria-pressed={tab === 'comments'}
              onClick={() => setTab('comments')}
            >
              <MessageSquareText size={14} />
              Comments
            </button>
            <button
              type="button"
              aria-pressed={tab === 'history'}
              onClick={() => setTab('history')}
            >
              <History size={14} />
              History
            </button>
          </div>
          {error && (
            <p className="preview-error" role="alert">
              {error}
            </p>
          )}
          {loading ? (
            <p className="preview-conversation-empty">Loading saved activity…</p>
          ) : tab === 'comments' ? (
            <>
              <div className="preview-comments">
                {comments.length ? (
                  comments.map((item) => (
                    <article key={item.id}>
                      <div>
                        <strong>{item.authorName}</strong>
                        <span>v{item.revision}</span>
                      </div>
                      <p>{item.body}</p>
                      <small>{indiaDate(item.createdAt)} IST</small>
                    </article>
                  ))
                ) : (
                  <p className="preview-conversation-empty">
                    Keep questions and review notes with the story.
                  </p>
                )}
              </div>
              <form className="preview-comment-form" onSubmit={comment}>
                <label htmlFor={`comment-${post.id}`}>Comment on revision {post.revision}</label>
                <textarea
                  id={`comment-${post.id}`}
                  rows={3}
                  maxLength={2000}
                  required
                  disabled={busy}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="Add context or ask a question…"
                />
                <Button type="submit" size="sm" disabled={busy || !body.trim()}>
                  {busy ? 'Saving…' : 'Add comment'}
                </Button>
              </form>
            </>
          ) : (
            <div className="preview-revisions">
              {revisions.length ? (
                revisions
                  .slice()
                  .sort((a, b) => b.revision - a.revision)
                  .map((revision) => {
                    const previous = revisions.find(
                      (item) => item.revision === revision.revision - 1,
                    );
                    const labels: [keyof Post, string][] = [
                      ['title', 'Title'],
                      ['caption', 'Caption'],
                      ['assetId', 'Image'],
                      ['destinationIds', 'Destinations'],
                      ['platforms', 'Channels'],
                      ['institution', 'School'],
                      ['scheduledAt', 'Planned time'],
                      ['sourceUrl', 'Source'],
                      ['format', 'Format'],
                      ['language', 'Language'],
                      ['mediaUrl', 'Preview image'],
                    ];
                    const changed = previous
                      ? labels
                          .filter(
                            ([key]) =>
                              JSON.stringify(previous.snapshot?.[key]) !==
                              JSON.stringify(revision.snapshot?.[key]),
                          )
                          .map(([, label]) => label)
                      : [];
                    return (
                      <article key={revision.revision}>
                        <div>
                          <strong>Revision {revision.revision}</strong>
                          {revision.revision === post.revision && (
                            <Badge tone="violet">Current</Badge>
                          )}
                        </div>
                        <small>
                          {names[revision.changedBy] || revision.changedBy} ·{' '}
                          {indiaDate(revision.createdAt)} IST
                        </small>
                        <p>
                          {previous
                            ? changed.length
                              ? `Changed: ${changed.join(', ')}`
                              : 'Saved content revision'
                            : 'Initial saved draft'}
                        </p>
                        {revision.snapshot?.caption && (
                          <details>
                            <summary>View saved text</summary>
                            <strong>{revision.snapshot.title}</strong>
                            <p>{revision.snapshot.caption}</p>
                          </details>
                        )}
                      </article>
                    );
                  })
              ) : (
                <p className="preview-conversation-empty">Newly saved revisions appear here.</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
