import { useMemo, useState, type FormEvent } from 'react';
import {
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
  Image,
  Link2,
  Pencil,
  Save,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import { institutions, type Platform, type Post, type PostInput } from '../lib/types';
import { Badge, Button, Modal, PlatformIcon, platformNames } from './UI';
import PostPreview from './PostPreview';
import '../styles/content.css';

type ComposerForm = Omit<PostInput, 'scheduledAt' | 'revision'> & {
  scheduledAt: string;
  sourceUrl: string;
  mediaUrl: string;
};
type Intent = 'save' | 'review';

function localIndiaDate(value?: string | null) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const valueOf = (part: string) => parts.find((item) => item.type === part)?.value || '';
  return `${valueOf('year')}-${valueOf('month')}-${valueOf('day')}T${valueOf('hour')}:${valueOf('minute')}`;
}
function dateToIso(value: string) {
  if (!value) return null;
  const parsed = new Date(`${value}+05:30`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function validWebUrl(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}
function initialForm(post?: Post): ComposerForm {
  return {
    title: post?.title || '',
    caption: post?.caption || '',
    platforms: post?.platforms || ['instagram', 'facebook'],
    format: post?.format || 'Post',
    institution: post?.institution || institutions[0],
    scheduledAt: localIndiaDate(post?.scheduledAt),
    language: post?.language || 'English',
    palette: post?.palette || 'violet',
    sourceUrl: post?.sourceUrl || '',
    mediaUrl: post?.mediaUrl || '',
  };
}

export default function PostComposer({ post, onClose }: { post?: Post; onClose: () => void }) {
  const { data, mutate, toast } = useWorkspace();
  const [form, setForm] = useState<ComposerForm>(() => initialForm(post));
  const [savedPost, setSavedPost] = useState<Post | undefined>(post);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initialForm(post)));
  const [errors, setErrors] = useState<Partial<Record<keyof ComposerForm, string>>>({});
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState<Intent | null>(null);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [editorUserId] = useState(data.user.id);
  const dirty = JSON.stringify(form) !== baseline;
  const latestPost = savedPost ? data.posts.find((item) => item.id === savedPost.id) : undefined;
  const currentPost = latestPost || savedPost;
  const accountChanged = data.user.id !== editorUserId;
  const postMissing = !!savedPost && !latestPost;
  const savedVersionChanged = !!(
    savedPost &&
    latestPost &&
    (latestPost.revision !== savedPost.revision ||
      latestPost.status !== savedPost.status ||
      latestPost.updatedAt !== savedPost.updatedAt)
  );
  const permissionReadOnly =
    !!currentPost &&
    (currentPost.status === 'published' ||
      (data.user.role !== 'manager' &&
        (currentPost.ownerId !== data.user.id ||
          !['draft', 'changes_requested', 'rejected'].includes(currentPost.status))));
  const readOnly = accountChanged || postMissing || savedVersionChanged || permissionReadOnly;
  const changesRequireReview =
    !!currentPost && ['approved', 'scheduled', 'in_review'].includes(currentPost.status);
  const unchangedReviewedPost = !dirty && changesRequireReview;

  const previewPost = useMemo<Post>(
    () => ({
      id: savedPost?.id || 'new-draft',
      ...form,
      scheduledAt: dateToIso(form.scheduledAt),
      status: 'draft',
      ownerId: savedPost?.ownerId || data.user.id,
      ownerName: savedPost?.ownerName || data.user.name,
      createdAt: savedPost?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revision: savedPost ? savedPost.revision + (dirty ? 1 : 0) : 1,
    }),
    [data.user.id, data.user.name, dirty, form, savedPost],
  );

  function update<K extends keyof ComposerForm>(field: K, value: ComposerForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSaveError('');
    setDiscardPrompt(false);
  }

  function requestClose() {
    if (busy) return;
    if (dirty) {
      setDiscardPrompt(true);
      return;
    }
    onClose();
  }

  function loadLatest() {
    if (!latestPost || busy) return;
    const nextForm = initialForm(latestPost);
    setForm(nextForm);
    setSavedPost(latestPost);
    setBaseline(JSON.stringify(nextForm));
    setErrors({});
    setSaveError('');
    setDiscardPrompt(false);
  }

  function validate(intent: Intent) {
    const next: Partial<Record<keyof ComposerForm, string>> = {};
    if (!form.title.trim()) next.title = 'Give this draft a title so your team can find it.';
    else if (form.title.trim().length > 180) next.title = 'Keep the title within 180 characters.';
    if (intent === 'review' && !form.caption.trim())
      next.caption = 'Add a caption before sending this draft for review.';
    if (form.caption.length > 12000)
      next.caption = 'Keep your workspace draft within 12,000 characters.';
    if (!form.platforms.length) next.platforms = 'Choose at least one channel.';
    if (form.sourceUrl.trim() && !validWebUrl(form.sourceUrl.trim()))
      next.sourceUrl = 'Use a complete https:// or http:// source link without credentials.';
    if (form.mediaUrl.trim() && !validWebUrl(form.mediaUrl.trim()))
      next.mediaUrl = 'Use a complete https:// or http:// image link without credentials.';
    const plannedDate = dateToIso(form.scheduledAt);
    if (form.scheduledAt && !plannedDate) next.scheduledAt = 'Choose a valid date and time.';
    else if (intent === 'review' && plannedDate && new Date(plannedDate).getTime() <= Date.now())
      next.scheduledAt = 'Choose a future planned time, or clear the date for now.';
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) requestAnimationFrame(() => document.getElementById(`composer-${first}`)?.focus());
    return !first;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || readOnly) return;
    const intent: Intent =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'review'
        ? 'review'
        : 'save';
    if (!validate(intent)) return;
    setBusy(intent);
    setSaveError('');
    let draftSaved = false;
    try {
      let saved = savedPost;
      if (!saved || dirty) {
        const input: PostInput = {
          title: form.title.trim(),
          caption: form.caption.trim(),
          platforms: form.platforms,
          format: form.format,
          institution: form.institution,
          language: form.language,
          palette: form.palette,
          scheduledAt: dateToIso(form.scheduledAt),
          sourceUrl: form.sourceUrl.trim(),
          mediaUrl: form.mediaUrl.trim(),
        };
        saved = saved
          ? await mutate<Post>(`/posts/${saved.id}`, 'PATCH', {
              ...input,
              revision: saved.revision,
            })
          : await mutate<Post>('/posts', 'POST', input);
        draftSaved = true;
        setSavedPost(saved);
        const savedForm = initialForm(saved);
        setForm(savedForm);
        setBaseline(JSON.stringify(savedForm));
      }
      if (intent === 'review') {
        await mutate<Post>(`/posts/${saved.id}/transition`, 'POST', {
          action: 'submit',
          revision: saved.revision,
        });
        toast(`Revision ${saved.revision} sent to your manager for review.`, 'success');
      } else {
        toast(
          draftSaved
            ? `Draft saved as revision ${saved.revision}.`
            : 'Your draft is already up to date.',
          'success',
        );
      }
      onClose();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'We couldn’t save your draft. Please try again.';
      setSaveError(
        draftSaved
          ? `Your draft is saved, but it couldn’t be sent for review. ${message}`
          : message,
      );
      toast(draftSaved ? 'Draft saved. Please check the review message below.' : message, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      title={savedPost ? 'Make your story even better' : 'Create your next story'}
      onClose={requestClose}
      className="composer-modal"
    >
      <form className="composer-form" onSubmit={submit} noValidate>
        <div className="composer-topbar">
          <div className="composer-steps">
            <span className="composer-step-active">
              <Pencil size={14} />
              Draft
            </span>
            <ChevronRight size={13} />
            <span>
              <ShieldCheck size={14} />
              Review
            </span>
            <ChevronRight size={13} />
            <span>
              <CalendarClock size={14} />
              Plan
            </span>
          </div>
          <Badge tone="gray">
            {savedPost ? `Editing revision ${savedPost.revision}` : 'New draft'}
          </Badge>
        </div>
        {discardPrompt && (
          <div className="composer-discard" role="alert">
            <CircleAlert size={19} />
            <div>
              <strong>Keep your changes?</strong>
              <p>You have unsaved edits in this draft.</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setDiscardPrompt(false)}>
              Keep editing
            </Button>
            <Button variant="danger" size="sm" onClick={onClose}>
              Discard edits
            </Button>
          </div>
        )}
        <div className="composer-layout">
          <div className="composer-fields">
            {accountChanged ? (
              <div className="composer-info composer-info-warning" role="alert">
                <CircleAlert size={18} />
                <span>
                  Your workspace account changed while this editor was open. Your unsaved text is
                  still here. Close and reopen the editor before saving as {data.user.name}.
                </span>
              </div>
            ) : postMissing ? (
              <div className="composer-info composer-info-warning" role="alert">
                <CircleAlert size={18} />
                <span>
                  This post is no longer in the workspace. Your unsaved text is still here, but this
                  revision cannot be saved.
                </span>
              </div>
            ) : savedVersionChanged ? (
              <div className="composer-info composer-info-warning composer-conflict" role="alert">
                <CircleAlert size={18} />
                <div>
                  <strong>The saved post changed while you were editing.</strong>
                  <p>
                    Revision {latestPost?.revision} is now {latestPost?.status.replaceAll('_', ' ')}
                    . Your unsaved edits are preserved here. Load the current post before making
                    further changes.
                  </p>
                  <Button variant="secondary" size="sm" disabled={!!busy} onClick={loadLatest}>
                    {dirty ? 'Discard my edits & load current post' : 'Load current post'}
                  </Button>
                </div>
              </div>
            ) : (
              permissionReadOnly && (
                <div className="composer-info composer-info-warning">
                  <CircleAlert size={18} />
                  <span>
                    This post is read only.{' '}
                    {currentPost?.status === 'published'
                      ? 'Published records cannot be edited.'
                      : currentPost?.ownerId !== data.user.id
                        ? 'Only its creator or a manager can edit this draft.'
                        : 'Ask a manager to request changes before editing a submitted or approved revision.'}
                  </span>
                </div>
              )
            )}
            {changesRequireReview && !readOnly && (
              <div className="composer-info">
                <ShieldCheck size={18} />
                <span>
                  Saving changes creates a new draft revision. Any previous approval is cleared, and
                  scheduled content returns to review.
                </span>
              </div>
            )}
            <section className="composer-section">
              <div className="composer-section-heading">
                <span>01</span>
                <div>
                  <h3>The story</h3>
                  <p>A clear idea is a great place to start.</p>
                </div>
              </div>
              <label className="field" htmlFor="composer-title">
                <span className="composer-label-icon">
                  Working title <span>Required</span>
                </span>
                <input
                  id="composer-title"
                  autoFocus
                  disabled={!!busy || readOnly}
                  value={form.title}
                  onChange={(event) => update('title', event.target.value)}
                  maxLength={180}
                  placeholder="Give your next story a name"
                  aria-invalid={!!errors.title}
                  aria-describedby={errors.title ? 'composer-title-error' : 'composer-title-help'}
                />
                <small id="composer-title-help">
                  An internal title to keep your content organised.
                </small>
              </label>
              {errors.title && (
                <p id="composer-title-error" className="composer-error" role="alert">
                  {errors.title}
                </p>
              )}
              <label className="field" htmlFor="composer-caption">
                Caption
                <textarea
                  id="composer-caption"
                  disabled={!!busy || readOnly}
                  rows={7}
                  value={form.caption}
                  onChange={(event) => update('caption', event.target.value)}
                  maxLength={12000}
                  placeholder="What would you like parents and students to know?"
                  aria-invalid={!!errors.caption}
                  aria-describedby={
                    errors.caption ? 'composer-caption-error' : 'composer-caption-help'
                  }
                />
              </label>
              <div className="composer-caption-footer">
                <span id="composer-caption-help">Write in your school’s voice.</span>
                <span>{form.caption.length.toLocaleString('en-IN')} / 12,000</span>
              </div>
              {errors.caption && (
                <p id="composer-caption-error" className="composer-error" role="alert">
                  {errors.caption}
                </p>
              )}
              <div className="form-grid">
                <label className="field">
                  Institution
                  <select
                    disabled={!!busy || readOnly}
                    value={form.institution}
                    onChange={(event) => update('institution', event.target.value)}
                  >
                    {!institutions.includes(form.institution) && (
                      <option value={form.institution}>{form.institution}</option>
                    )}
                    {institutions.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Language
                  <select
                    disabled={!!busy || readOnly}
                    value={form.language}
                    onChange={(event) => update('language', event.target.value as Post['language'])}
                  >
                    <option>English</option>
                    <option>Kannada</option>
                    <option>English + Kannada</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="composer-section">
              <div className="composer-section-heading">
                <span>02</span>
                <div>
                  <h3>Make it yours</h3>
                  <p>Choose where your story belongs.</p>
                </div>
              </div>
              <fieldset
                className="composer-channels-fieldset"
                id="composer-platforms"
                tabIndex={-1}
                aria-describedby={errors.platforms ? 'composer-platforms-error' : undefined}
              >
                <legend>
                  Channels <span className="composer-required">Choose at least one</span>
                </legend>
                <div className="composer-channels">
                  {(
                    [
                      'instagram',
                      'facebook',
                      'youtube',
                      'linkedin',
                      'google_business',
                    ] as Platform[]
                  ).map((platform) => (
                    <label
                      key={platform}
                      className={`composer-channel${form.platforms.includes(platform) ? ' composer-channel-selected' : ''}`}
                    >
                      <input
                        type="checkbox"
                        disabled={!!busy || readOnly}
                        checked={form.platforms.includes(platform)}
                        onChange={(event) =>
                          update(
                            'platforms',
                            event.target.checked
                              ? [...form.platforms, platform]
                              : form.platforms.filter((item) => item !== platform),
                          )
                        }
                      />
                      <PlatformIcon platform={platform} size={16} />
                      <span>{platformNames[platform]}</span>
                      {form.platforms.includes(platform) && <Check size={13} />}
                    </label>
                  ))}
                </div>
              </fieldset>
              {errors.platforms && (
                <p id="composer-platforms-error" className="composer-error" role="alert">
                  {errors.platforms}
                </p>
              )}
              <div className="form-grid">
                <label className="field">
                  Format
                  <select
                    disabled={!!busy || readOnly}
                    value={form.format}
                    onChange={(event) => update('format', event.target.value as Post['format'])}
                  >
                    <option>Post</option>
                    <option>Carousel</option>
                    <option>Reel</option>
                    <option>Video</option>
                    <option>Article</option>
                  </select>
                </label>
                <fieldset className="composer-palettes">
                  <legend>Preview style</legend>
                  <div>
                    {(['violet', 'navy', 'sage', 'peach'] as const).map((palette) => (
                      <label
                        key={palette}
                        className={`composer-palette composer-palette-${palette}${form.palette === palette ? ' composer-palette-selected' : ''}`}
                        title={`${palette.charAt(0).toUpperCase() + palette.slice(1)} preview`}
                      >
                        <input
                          type="radio"
                          name="palette"
                          value={palette}
                          checked={form.palette === palette}
                          disabled={!!busy || readOnly}
                          onChange={() => update('palette', palette)}
                          aria-label={`${palette} preview style`}
                        />
                        {form.palette === palette && <Check size={16} />}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
              <label className="field" htmlFor="composer-mediaUrl">
                <span className="composer-label-icon">
                  <Image size={14} />
                  Preview image URL <span>Optional</span>
                </span>
                <input
                  id="composer-mediaUrl"
                  type="url"
                  disabled={!!busy || readOnly}
                  value={form.mediaUrl}
                  onChange={(event) => update('mediaUrl', event.target.value)}
                  placeholder="https://…/your-image.jpg"
                  maxLength={2048}
                  aria-invalid={!!errors.mediaUrl}
                  aria-describedby={
                    errors.mediaUrl ? 'composer-mediaUrl-error' : 'composer-mediaUrl-help'
                  }
                />
                <small id="composer-mediaUrl-help">
                  Use an accessible image link. Your preview style is used when no image is added.
                </small>
              </label>
              {errors.mediaUrl && (
                <p id="composer-mediaUrl-error" className="composer-error" role="alert">
                  {errors.mediaUrl}
                </p>
              )}
            </section>

            <section className="composer-section composer-section-last">
              <div className="composer-section-heading">
                <span>03</span>
                <div>
                  <h3>Ready for a second look</h3>
                  <p>Give your reviewer the context they need.</p>
                </div>
              </div>
              <label className="field" htmlFor="composer-sourceUrl">
                <span className="composer-label-icon">
                  <Link2 size={14} />
                  Source URL <span>Optional</span>
                </span>
                <input
                  id="composer-sourceUrl"
                  type="url"
                  disabled={!!busy || readOnly}
                  value={form.sourceUrl}
                  onChange={(event) => update('sourceUrl', event.target.value)}
                  placeholder="Link to the official notice, result, or reference"
                  maxLength={2048}
                  aria-invalid={!!errors.sourceUrl}
                  aria-describedby={
                    errors.sourceUrl ? 'composer-sourceUrl-error' : 'composer-sourceUrl-help'
                  }
                />
                <small id="composer-sourceUrl-help">
                  Attach a source for exam dates, seat numbers, results, or other factual claims.
                </small>
              </label>
              {errors.sourceUrl && (
                <p id="composer-sourceUrl-error" className="composer-error" role="alert">
                  {errors.sourceUrl}
                </p>
              )}
              <label className="field" htmlFor="composer-scheduledAt">
                <span className="composer-label-icon">
                  <CalendarClock size={14} />
                  Planned date & time <span>Optional</span>
                </span>
                <div className="composer-date-input">
                  <input
                    id="composer-scheduledAt"
                    type="datetime-local"
                    disabled={!!busy || readOnly}
                    value={form.scheduledAt}
                    onChange={(event) => update('scheduledAt', event.target.value)}
                    aria-invalid={!!errors.scheduledAt}
                    aria-describedby={
                      errors.scheduledAt ? 'composer-scheduledAt-error' : 'composer-date-help'
                    }
                  />
                  {form.scheduledAt && (
                    <button
                      type="button"
                      disabled={!!busy || readOnly}
                      onClick={() => update('scheduledAt', '')}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <small id="composer-date-help">
                  India Standard Time · Asia/Kolkata. This saves a local plan; it does not publish
                  your post.
                </small>
              </label>
              {errors.scheduledAt && (
                <p id="composer-scheduledAt-error" className="composer-error" role="alert">
                  {errors.scheduledAt}
                </p>
              )}
            </section>
          </div>

          <aside className="composer-preview">
            <div className="composer-preview-intro">
              <span className="eyebrow">SEE YOUR STORY TAKE SHAPE</span>
              <h3>A little preview.</h3>
              <p>Your reviewer will see this exact content.</p>
            </div>
            <PostPreview post={previewPost} readOnly compact />
            <div className="composer-preview-note">
              <ShieldCheck size={17} />
              <span>
                Approval stays with a specific revision. Edit the story, and it gets a fresh review.
              </span>
            </div>
          </aside>
        </div>
        <div className="composer-bottom">
          {saveError && (
            <div className="composer-save-error" role="alert">
              <CircleAlert size={17} />
              <span>{saveError}</span>
            </div>
          )}
          <div className="composer-footer">
            <div>
              <span className={`composer-save-indicator${dirty ? ' composer-unsaved' : ''}`} />
              {busy
                ? 'Saving your story…'
                : dirty
                  ? 'Unsaved changes'
                  : savedPost
                    ? `Revision ${savedPost.revision} saved`
                    : 'Your ideas start here'}
            </div>
            <div className="composer-footer-actions">
              <Button variant="ghost" disabled={!!busy} onClick={requestClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                name="intent"
                value="save"
                variant="secondary"
                disabled={!!busy || readOnly}
              >
                <Save size={15} />
                {busy === 'save' ? 'Saving…' : 'Save draft'}
              </Button>
              <Button
                type="submit"
                name="intent"
                value="review"
                variant="primary"
                disabled={!!busy || readOnly || unchangedReviewedPost}
                title={
                  unchangedReviewedPost
                    ? 'This revision has already been submitted. Edit the draft to create a new revision.'
                    : undefined
                }
              >
                <Send size={15} />
                {busy === 'review' ? 'Sending…' : 'Send for review'}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </Modal>
  );
}
