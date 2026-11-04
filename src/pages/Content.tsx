import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownWideNarrow,
  ArrowUpRight,
  CalendarDays,
  CalendarRange,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Filter,
  Layers3,
  LayoutList,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Video,
  X,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import { institutions, type Platform, type Post, type PostStatus } from '../lib/types';
import { Badge, Button, EmptyState, Modal, PlatformIcon, StatusBadge } from '../components/UI';
import PostPreview from '../components/PostPreview';
import '../styles/content.css';

type ContentTab = 'library' | 'calendar' | 'approvals';
const platformNames: Record<Platform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  google_business: 'Google Business',
};
const statusNames: Record<PostStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  rejected: 'Rejected',
};

function indiaKey(value: string | Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`;
}
const keyFor = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const shortDate = (value: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
  }).format(new Date(value));
const shortTime = (value: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(value));

function Calendar({
  posts,
  onSelect,
  onCreate,
}: {
  posts: Post[];
  onSelect: (post: Post) => void;
  onCreate: () => void;
}) {
  const today = indiaKey(new Date());
  const [month, setMonth] = useState(() => new Date(`${today}T12:00:00`));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
  const scheduledPosts = useMemo(
    () =>
      posts
        .filter((post) => post.scheduledAt)
        .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime()),
    [posts],
  );
  const byDay = useMemo(() => {
    const days: Record<string, Post[]> = {};
    for (const post of scheduledPosts) (days[indiaKey(post.scheduledAt!)] ||= []).push(post);
    return days;
  }, [scheduledPosts]);
  const monthCount = scheduledPosts.filter((post) =>
    indiaKey(post.scheduledAt!).startsWith(monthKey),
  ).length;
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(
    month.getFullYear(),
    month.getMonth(),
    1 - ((monthStart.getDay() + 6) % 7),
  );
  const days = Array.from(
    { length: 42 },
    (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i),
  );
  const agendaDays = selectedDay
    ? [selectedDay]
    : Object.keys(byDay)
        .filter((day) => day.startsWith(monthKey))
        .sort();

  function changeMonth(delta: number) {
    setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));
    setSelectedDay(null);
  }

  return (
    <section className="calendar-panel panel">
      <div className="calendar-heading">
        <div>
          <div className="eyebrow">YOUR EDITORIAL CALENDAR</div>
          <h2>{month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h2>
          <p>
            {monthCount} {monthCount === 1 ? 'post' : 'posts'} planned this month{' '}
            <span>· All times IST</span>
          </p>
        </div>
        <div className="calendar-controls">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setMonth(new Date(`${today}T12:00:00`));
              setSelectedDay(null);
            }}
          >
            Today
          </Button>
          <div className="calendar-arrows">
            <button
              className="icon-button"
              aria-label="Previous month"
              onClick={() => changeMonth(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <button className="icon-button" aria-label="Next month" onClick={() => changeMonth(1)}>
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>
      <div className="calendar-weekdays" aria-hidden="true">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div
        className="calendar-grid"
        aria-label={`Content planned for ${month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`}
      >
        {days.map((date) => {
          const dayKey = keyFor(date);
          const dayPosts = byDay[dayKey] || [];
          return (
            <div
              key={dayKey}
              className={`calendar-day${date.getMonth() !== month.getMonth() ? ' calendar-outside' : ''}${dayKey === today ? ' calendar-today' : ''}${dayKey === selectedDay ? ' calendar-selected' : ''}`}
            >
              <button
                className="calendar-day-number"
                onClick={() => setSelectedDay(dayKey)}
                aria-label={`Show plan for ${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}`}
                aria-pressed={dayKey === selectedDay}
              >
                {date.getDate()}
              </button>
              <div className="calendar-events">
                {dayPosts.slice(0, 3).map((post) => (
                  <button
                    className={`calendar-event calendar-event-${post.palette}`}
                    key={post.id}
                    onClick={() => onSelect(post)}
                    aria-label={`${post.title}, ${shortTime(post.scheduledAt!)}, ${statusNames[post.status]}`}
                  >
                    <span>{shortTime(post.scheduledAt!)}</span>
                    <strong>{post.title}</strong>
                    <div>
                      {post.platforms.slice(0, 3).map((platform) => (
                        <PlatformIcon platform={platform} key={platform} size={13} />
                      ))}
                    </div>
                  </button>
                ))}
                {dayPosts.length > 3 && (
                  <button className="calendar-more" onClick={() => setSelectedDay(dayKey)}>
                    +{dayPosts.length - 3} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="calendar-mobile-jump">
        <label htmlFor="calendar-jump">Jump to a date</label>
        <input
          id="calendar-jump"
          type="date"
          value={selectedDay || ''}
          onChange={(event) => {
            const value = event.target.value;
            setSelectedDay(value || null);
            if (value) setMonth(new Date(`${value}T12:00:00`));
          }}
        />
      </div>
      <div className="calendar-agenda">
        <div className="calendar-agenda-heading">
          <h3>
            {selectedDay
              ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'long',
                  weekday: 'long',
                })
              : 'The month ahead'}
          </h3>
          {selectedDay && (
            <Button variant="ghost" size="sm" onClick={() => setSelectedDay(null)}>
              <X size={14} />
              Show whole month
            </Button>
          )}
        </div>
        {agendaDays.some((day) => byDay[day]?.length) ? (
          agendaDays.map(
            (day) =>
              (byDay[day] || []).length > 0 && (
                <div className="calendar-agenda-day" key={day}>
                  {!selectedDay && (
                    <div className="calendar-agenda-date">
                      <strong>{new Date(`${day}T12:00:00`).getDate()}</strong>
                      <span>
                        {new Date(`${day}T12:00:00`).toLocaleDateString('en-IN', {
                          month: 'short',
                          weekday: 'short',
                        })}
                      </span>
                    </div>
                  )}
                  <div className="calendar-agenda-posts">
                    {(byDay[day] || []).map((post) => (
                      <button
                        className="calendar-agenda-post"
                        onClick={() => onSelect(post)}
                        key={post.id}
                      >
                        <span className="calendar-agenda-time">{shortTime(post.scheduledAt!)}</span>
                        <span className="calendar-agenda-name">
                          <strong>{post.title}</strong>
                          <span>{post.institution}</span>
                        </span>
                        <span className="calendar-agenda-platforms">
                          {post.platforms.slice(0, 3).map((platform) => (
                            <PlatformIcon platform={platform} key={platform} size={17} />
                          ))}
                        </span>
                        <StatusBadge status={post.status} />
                        <ChevronRight size={16} />
                      </button>
                    ))}
                  </div>
                </div>
              ),
          )
        ) : (
          <EmptyState
            icon={<CalendarDays size={28} />}
            title={
              selectedDay
                ? 'A little space for your next story'
                : 'Your calendar is ready for a fresh start'
            }
            description={
              selectedDay
                ? 'No posts are planned for this date. Add a planned date when you create a draft.'
                : 'Choose a planned date in a draft to see it here. All times use India Standard Time.'
            }
            action={
              <Button variant="secondary" onClick={onCreate}>
                <Plus size={16} />
                Create a draft
              </Button>
            }
          />
        )}
      </div>
      <div className="calendar-local-note">
        <CalendarClockIcon />
        <span>
          Dates are saved in your local content plan. A connected publishing service is required to
          send posts to social channels.
        </span>
      </div>
    </section>
  );
}

function CalendarClockIcon() {
  return <Clock3 size={15} aria-hidden="true" />;
}

export default function Content({ initialTab = 'library' }: { initialTab?: ContentTab }) {
  const { data, openComposer } = useWorkspace();
  const [tab, setTab] = useState<ContentTab>(initialTab);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<PostStatus | 'all'>('all');
  const [platform, setPlatform] = useState<Platform | 'all'>('all');
  const [institution, setInstitution] = useState('all');
  const [sort, setSort] = useState('updated');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1150px)').matches,
  );
  useEffect(() => {
    setTab(initialTab);
    setStatus('all');
    setSelectedId(null);
    setShowPreview(false);
  }, [initialTab]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1150px)');
    const onChange = () => setIsNarrow(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const counts = useMemo(
    () => ({
      all: data.posts.length,
      review: data.posts.filter((post) => post.status === 'in_review').length,
      approved: data.posts.filter((post) => post.status === 'approved').length,
      scheduled: data.posts.filter((post) => post.status === 'scheduled').length,
    }),
    [data.posts],
  );
  const filteredPosts = useMemo(() => {
    const search = query.trim().toLowerCase();
    return data.posts
      .filter((post) => {
        if (tab === 'approvals' && post.status !== 'in_review') return false;
        if (status !== 'all' && post.status !== status) return false;
        if (platform !== 'all' && !post.platforms.includes(platform)) return false;
        if (institution !== 'all' && post.institution !== institution) return false;
        return (
          !search ||
          `${post.title} ${post.caption} ${post.ownerName} ${post.institution}`
            .toLowerCase()
            .includes(search)
        );
      })
      .sort((a, b) =>
        sort === 'title'
          ? a.title.localeCompare(b.title)
          : sort === 'planned'
            ? (a.scheduledAt ? new Date(a.scheduledAt).getTime() : Infinity) -
              (b.scheduledAt ? new Date(b.scheduledAt).getTime() : Infinity)
            : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [data.posts, institution, platform, query, sort, status, tab]);
  const selectedMatch = filteredPosts.find((post) => post.id === selectedId);
  const selectedPost = selectedMatch || filteredPosts[0];
  useEffect(() => {
    if (selectedId && !selectedMatch) {
      setSelectedId(null);
      setShowPreview(false);
    }
  }, [selectedId, selectedMatch]);
  const hasFilters = !!query || status !== 'all' || platform !== 'all' || institution !== 'all';

  function switchTab(nextTab: ContentTab) {
    setTab(nextTab);
    setStatus('all');
    setSelectedId(null);
    setShowPreview(false);
  }
  function resetFilters() {
    setQuery('');
    setStatus('all');
    setPlatform('all');
    setInstitution('all');
    setSelectedId(null);
    setShowPreview(false);
  }
  function selectPost(post: Post) {
    setSelectedId(post.id);
    if (isNarrow || tab === 'calendar') setShowPreview(true);
  }
  function editPost(post: Post) {
    setShowPreview(false);
    openComposer(post);
  }
  function selectCount(nextStatus: PostStatus | 'all') {
    setTab(nextStatus === 'in_review' ? 'approvals' : 'library');
    setStatus(nextStatus === 'in_review' ? 'all' : nextStatus);
    setQuery('');
    setPlatform('all');
    setInstitution('all');
    setSelectedId(null);
    setShowPreview(false);
  }

  return (
    <div className="content-page">
      <header className="page-heading">
        <div>
          <div className="eyebrow">MAKE EVERY STORY COUNT</div>
          <h1 className="page-title">
            Content studio<span className="content-title-dot">.</span>
          </h1>
          <p className="page-description">
            A space for good ideas, thoughtful reviews, and your next great post.
          </p>
        </div>
        <Button variant="primary" onClick={() => openComposer()}>
          <Plus size={18} />
          Create post
        </Button>
      </header>

      <div className="content-stats">
        <button className="content-stat" onClick={() => selectCount('all')}>
          <span className="content-stat-icon content-stat-icon-violet">
            <Layers3 size={19} />
          </span>
          <span>
            <span>All content</span>
            <strong>{counts.all}</strong>
          </span>
          <ArrowUpRight size={17} />
        </button>
        <button className="content-stat" onClick={() => selectCount('in_review')}>
          <span className="content-stat-icon content-stat-icon-amber">
            <ShieldCheck size={19} />
          </span>
          <span>
            <span>Waiting for review</span>
            <strong>{counts.review}</strong>
          </span>
          <ArrowUpRight size={17} />
        </button>
        <button className="content-stat" onClick={() => selectCount('approved')}>
          <span className="content-stat-icon content-stat-icon-sage">
            <CheckCheck size={19} />
          </span>
          <span>
            <span>Approved & ready</span>
            <strong>{counts.approved}</strong>
          </span>
          <ArrowUpRight size={17} />
        </button>
        <button className="content-stat" onClick={() => selectCount('scheduled')}>
          <span className="content-stat-icon content-stat-icon-blue">
            <CalendarRange size={19} />
          </span>
          <span>
            <span>Locally scheduled</span>
            <strong>{counts.scheduled}</strong>
          </span>
          <ArrowUpRight size={17} />
        </button>
      </div>

      <div className="content-navigation">
        <div className="tabs" role="tablist" aria-label="Content views">
          <button
            className={`tab ${tab === 'library' ? 'active' : ''}`}
            role="tab"
            aria-selected={tab === 'library'}
            onClick={() => switchTab('library')}
          >
            <LayoutList size={16} />
            Content library
          </button>
          <button
            className={`tab ${tab === 'calendar' ? 'active' : ''}`}
            role="tab"
            aria-selected={tab === 'calendar'}
            onClick={() => switchTab('calendar')}
          >
            <CalendarDays size={16} />
            Calendar
          </button>
          <button
            className={`tab ${tab === 'approvals' ? 'active' : ''}`}
            role="tab"
            aria-selected={tab === 'approvals'}
            onClick={() => switchTab('approvals')}
          >
            <ShieldCheck size={16} />
            Approvals<span className="content-tab-count">{counts.review}</span>
          </button>
        </div>
        <span className="content-timezone">
          <Clock3 size={13} />
          Asia/Kolkata
        </span>
      </div>

      <div className="content-filters">
        <label className="content-search">
          <Search size={17} />
          <input
            type="search"
            placeholder="Find a story, caption, or creator…"
            aria-label="Search content"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedId(null);
            }}
          />
          {query && (
            <button
              className="content-search-clear"
              aria-label="Clear search"
              onClick={() => setQuery('')}
            >
              <X size={14} />
            </button>
          )}
        </label>
        <div className="content-filter-select">
          <Filter size={15} />
          <select
            aria-label="Filter by institution"
            value={institution}
            onChange={(event) => {
              setInstitution(event.target.value);
              setSelectedId(null);
            }}
          >
            <option value="all">All institutions</option>
            {institutions.map((name) => (
              <option value={name} key={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <select
          aria-label="Filter by platform"
          value={platform}
          onChange={(event) => {
            setPlatform(event.target.value as Platform | 'all');
            setSelectedId(null);
          }}
        >
          <option value="all">All channels</option>
          {Object.entries(platformNames).map(([key, name]) => (
            <option value={key} key={key}>
              {name}
            </option>
          ))}
        </select>
        {tab !== 'approvals' && (
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as PostStatus | 'all');
              setSelectedId(null);
            }}
          >
            <option value="all">All statuses</option>
            {Object.entries(statusNames).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        )}
        {hasFilters && (
          <button className="content-reset" onClick={resetFilters}>
            Reset
          </button>
        )}
      </div>

      {tab === 'calendar' ? (
        <Calendar posts={filteredPosts} onSelect={selectPost} onCreate={() => openComposer()} />
      ) : (
        <div className="content-layout">
          <section
            className={`content-list-panel panel${tab === 'approvals' ? ' content-review-list' : ''}`}
          >
            {tab === 'approvals' ? (
              <div className="content-review-intro">
                <span className="content-review-spark">
                  <Sparkles size={23} />
                </span>
                <Badge tone="violet">
                  {data.user.role === 'manager' ? 'Your review desk' : 'Team review queue'}
                </Badge>
                <h2>
                  A fresh set of eyes.
                  <br />A stronger story.
                </h2>
                <p>
                  {data.user.role === 'manager'
                    ? 'Review the exact revision, check the source, and give your team the green light.'
                    : 'Follow your drafts as they move through manager review.'}
                </p>
              </div>
            ) : null}
            <div className="content-list-heading">
              <div>
                <h2>
                  {tab === 'approvals' ? 'Awaiting a decision' : 'Your content'}
                  <span>{filteredPosts.length}</span>
                </h2>
                {tab !== 'approvals' && <p>From first thought to final approval.</p>}
              </div>
              <label className="content-sort">
                <ArrowDownWideNarrow size={15} />
                <select
                  aria-label="Sort content"
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                >
                  <option value="updated">Recently updated</option>
                  <option value="planned">Planned date</option>
                  <option value="title">Title A–Z</option>
                </select>
              </label>
            </div>
            {filteredPosts.length ? (
              <>
                <div className="content-list-columns" aria-hidden="true">
                  <span>CONTENT</span>
                  <span>CHANNELS</span>
                  <span>STATUS</span>
                </div>
                <div className="content-post-list">
                  {filteredPosts.map((post) => (
                    <button
                      key={post.id}
                      className={`content-post-row${selectedPost?.id === post.id ? ' content-post-selected' : ''}`}
                      onClick={() => selectPost(post)}
                      aria-label={`View ${post.title}, ${statusNames[post.status]}, revision ${post.revision}`}
                      aria-pressed={selectedPost?.id === post.id}
                    >
                      <span className="content-post-main">
                        <span className={`content-mini-cover content-mini-${post.palette}`}>
                          {post.format === 'Reel' || post.format === 'Video' ? (
                            <Video size={20} />
                          ) : post.format === 'Carousel' ? (
                            <Layers3 size={20} />
                          ) : (
                            <FileText size={20} />
                          )}
                        </span>
                        <span className="content-post-copy">
                          <strong>{post.title}</strong>
                          <span className="content-post-caption">{post.caption}</span>
                          <span className="content-post-meta">
                            {post.format}
                            <span>·</span>
                            {post.scheduledAt
                              ? `${shortDate(post.scheduledAt)} · ${shortTime(post.scheduledAt)}`
                              : 'No date planned'}
                            <span className="content-post-revision">v{post.revision}</span>
                          </span>
                        </span>
                      </span>
                      <span className="content-post-platforms">
                        {post.platforms.slice(0, 3).map((item) => (
                          <PlatformIcon platform={item} key={item} size={18} />
                        ))}
                        {post.platforms.length > 3 && <small>+{post.platforms.length - 3}</small>}
                      </span>
                      <span className="content-post-status">
                        <StatusBadge status={post.status} />
                        <ChevronRight size={14} />
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <EmptyState
                icon={tab === 'approvals' ? <CheckCheck size={29} /> : <FileText size={29} />}
                title={
                  hasFilters
                    ? 'No stories match these filters'
                    : tab === 'approvals'
                      ? 'You’re all caught up'
                      : 'Your next story starts here'
                }
                description={
                  hasFilters
                    ? 'Try a different search or clear the filters to see all your content.'
                    : tab === 'approvals'
                      ? 'New submissions will appear here, ready for a thoughtful review.'
                      : 'Create a draft, choose your channels, and bring your team into the process.'
                }
                action={
                  hasFilters ? (
                    <Button variant="secondary" onClick={resetFilters}>
                      Clear filters
                    </Button>
                  ) : tab === 'library' ? (
                    <Button variant="primary" onClick={() => openComposer()}>
                      <Plus size={16} />
                      Create your first draft
                    </Button>
                  ) : undefined
                }
              />
            )}
            <div className="content-list-footer">
              <span>
                <ShieldCheck size={14} />
                Approval is saved for each revision.
              </span>
              <span>
                {filteredPosts.length} {filteredPosts.length === 1 ? 'story' : 'stories'}
              </span>
            </div>
          </section>
          <aside className="content-detail" aria-label="Selected post preview">
            {selectedPost ? (
              <PostPreview
                key={selectedPost.id}
                post={selectedPost}
                onEdit={() => editPost(selectedPost)}
              />
            ) : (
              <div className="content-detail-empty panel">
                <FileText size={28} />
                <h3>Room for your next idea</h3>
                <p>A preview and review actions will appear here when you select a post.</p>
              </div>
            )}
          </aside>
        </div>
      )}
      {showPreview && selectedMatch && (isNarrow || tab === 'calendar') && (
        <Modal
          title="Post details"
          onClose={() => setShowPreview(false)}
          className="preview-dialog"
        >
          <PostPreview
            key={selectedMatch.id}
            post={selectedMatch}
            onEdit={() => editPost(selectedMatch)}
          />
        </Modal>
      )}
    </div>
  );
}
