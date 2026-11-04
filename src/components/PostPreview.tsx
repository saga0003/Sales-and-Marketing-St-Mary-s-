import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  CalendarClock,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  FileText,
  Link2,
  MessageSquareText,
  Pencil,
  Send,
  ShieldCheck,
  Undo2,
  X,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import type { Post } from '../lib/types';
import { Avatar, Badge, Button, PlatformIcon, StatusBadge } from './UI';
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
  const { data, mutate, toast } = useWorkspace();
  const [busy, setBusy] = useState<ReviewAction | null>(null);
  const [feedbackAction, setFeedbackAction] = useState<'reject' | 'request_changes' | null>(null);
  const [feedback, setFeedback] = useState('');
  const [feedbackError, setFeedbackError] = useState('');
  const [actionError, setActionError] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setFeedbackAction(null);
    setFeedback('');
    setFeedbackError('');
    setActionError('');
  }, [post.id, post.revision, post.status, post.scheduledAt, data.user.id, data.user.role]);
  useEffect(() => setImageFailed(false), [post.mediaUrl]);

  const isManager = data.user.role === 'manager';
  const canEdit =
    isManager ||
    (data.user.id === post.ownerId &&
      ['draft', 'changes_requested', 'rejected'].includes(post.status));
  const source = safeUrl(post.sourceUrl);
  const media = safeUrl(post.mediaUrl);
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
        approve: `Revision ${post.revision} approved.`,
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
            src={media.href}
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
      {imageFailed && (
        <p className="preview-media-note">
          The image couldn’t load. Check the media link before scheduling.
        </p>
      )}

      <div className="preview-body">
        <div className="preview-status-row">
          {!readOnly && <StatusBadge status={post.status} />}
          {post.sample && <Badge tone="gray">Sample draft</Badge>}
          <span className="preview-language">{post.language}</span>
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
                    caption, channels, media, and source shown here.
                  </span>
                </div>
                {!feedbackAction ? (
                  <>
                    <Button
                      variant="primary"
                      disabled={!!busy}
                      onClick={() => transition('approve')}
                    >
                      <Check size={17} />
                      {busy === 'approve' ? 'Approving…' : `Approve revision ${post.revision}`}
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
            {post.status === 'scheduled' && isManager && (
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
            <p className="preview-publish-note">
              {data.publishingEnabled
                ? 'Publication is subject to each connected channel’s availability.'
                : 'Local workspace only. Scheduling here will not publish to a social channel.'}
            </p>
          </div>
        )}
      </div>
    </article>
  );
}
