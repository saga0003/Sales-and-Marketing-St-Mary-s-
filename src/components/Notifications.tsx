import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Bell,
  Check,
  CheckCheck,
  CircleAlert,
  ExternalLink,
  RefreshCw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import type {
  NotificationInbox,
  NotificationPreferences,
  Post,
  WorkspaceNotification,
} from '../lib/types';
import { formatDate } from '../lib/utils';
import { Badge, Button } from './UI';
import '../styles/notifications.css';

interface NotificationState extends NotificationInbox {
  error: string;
  loading: boolean;
  soundReady: boolean;
  desktopPermission: NotificationPermission | 'unsupported';
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  setSound: (enabled: boolean) => Promise<void>;
  setDesktop: (enabled: boolean) => Promise<void>;
  openItem: (item: WorkspaceNotification) => Promise<void>;
}
const NotificationContext = createContext<NotificationState | null>(null);
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Notifications could not be updated.';
const notificationTime = (value: string) =>
  `${formatDate(value, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} IST`;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const {
    data,
    request,
    toast,
    navigate,
    openComposer,
    refresh: refreshWorkspace,
  } = useWorkspace();
  const [inbox, setInbox] = useState<NotificationInbox>(() => ({
    notifications: data.notifications || [],
    unreadCount: data.unreadNotificationCount || 0,
    preferences: data.notificationPreferences || { sound: false, desktop: false },
  }));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [soundReady, setSoundReady] = useState(false);
  const [desktopPermission, setDesktopPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  const seen = useRef(new Set(data.notifications.map((item) => item.id)));
  const preferences = useRef(inbox.preferences);
  const userId = useRef(data.user.id);
  const audio = useRef<AudioContext | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const alive = useRef(true);
  const latest = useRef({ data, navigate, openComposer, refreshWorkspace });
  latest.current = { data, navigate, openComposer, refreshWorkspace };
  preferences.current = inbox.preferences;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void audio.current?.close();
      audio.current = null;
    };
  }, []);

  const armAudio = useCallback(async () => {
    const AudioConstructor = window.AudioContext;
    if (!AudioConstructor)
      throw new Error(
        'Sound notifications are not supported in this browser. The inbox remains available.',
      );
    if (!audio.current || audio.current.state === 'closed') audio.current = new AudioConstructor();
    if (audio.current.state === 'suspended') await audio.current.resume();
    setSoundReady(audio.current.state === 'running');
    return audio.current;
  }, []);
  const playSound = useCallback(() => {
    const context = audio.current;
    if (!context || context.state !== 'running') return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(660, context.currentTime);
    oscillator.frequency.setValueAtTime(880, context.currentTime + 0.12);
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(0.09, context.currentTime + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.32);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.34);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }, []);

  const displayNew = useCallback(
    async (items: WorkspaceNotification[]) => {
      if (!items.length || !alive.current) return;
      const display = () => {
        const key = `stmarys-notifications-seen:${userId.current}`;
        let previouslyShown: string[] = [];
        try {
          previouslyShown = JSON.parse(localStorage.getItem(key) || '[]');
        } catch {
          /* Storage may be unavailable. */
        }
        const fresh = items.filter((item) => !previouslyShown.includes(item.id) && !item.readAt);
        if (!fresh.length) return;
        try {
          localStorage.setItem(
            key,
            JSON.stringify(
              [...new Set([...previouslyShown, ...fresh.map((item) => item.id)])].slice(-250),
            ),
          );
        } catch {
          /* The server inbox still persists read state. */
        }
        const item = fresh[0];
        toast(
          fresh.length === 1
            ? `${item.title}: ${item.message}`
            : `${fresh.length} new updates. Open your notification inbox to review them.`,
          'info',
        );
        if (preferences.current.sound) playSound();
        if (
          preferences.current.desktop &&
          'Notification' in window &&
          Notification.permission === 'granted' &&
          !document.hasFocus()
        ) {
          try {
            const notice = new Notification(
              fresh.length === 1 ? item.title : `${fresh.length} workspace updates`,
              {
                body:
                  fresh.length === 1
                    ? item.message
                    : 'Open St. Mary’s Marketing Workspace to review them.',
                tag: `stmarys-${item.id}`,
              },
            );
            notice.onclick = () => {
              window.focus();
              window.dispatchEvent(new Event('stmarys-open-notifications'));
              notice.close();
            };
            setTimeout(() => notice.close(), 10000);
          } catch {
            /* Some browsers require a push service for system notifications. */
          }
        }
      };
      if (navigator.locks)
        await navigator.locks.request(`stmarys-notification-display:${userId.current}`, display);
      else display();
    },
    [playSound, toast],
  );

  const accept = useCallback(
    (next: NotificationInbox, announce = true) => {
      const fresh = next.notifications.filter((item) => !seen.current.has(item.id));
      next.notifications.forEach((item) => seen.current.add(item.id));
      if (seen.current.size > 1000)
        seen.current = new Set(next.notifications.map((item) => item.id));
      setInbox(next);
      preferences.current = next.preferences;
      setError('');
      if (announce) void displayNew(fresh);
    },
    [displayNew],
  );

  useEffect(() => {
    const changedUser = userId.current !== data.user.id;
    if (changedUser) {
      userId.current = data.user.id;
      seen.current = new Set(data.notifications.map((item) => item.id));
    }
    accept(
      {
        notifications: data.notifications || [],
        unreadCount: data.unreadNotificationCount || 0,
        preferences: data.notificationPreferences || { sound: false, desktop: false },
      },
      !changedUser,
    );
  }, [
    data.notifications,
    data.unreadNotificationCount,
    data.notificationPreferences,
    data.user.id,
    accept,
  ]);

  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const operation = (async () => {
      setLoading(true);
      try {
        const result = await request<NotificationInbox>('/notifications');
        if (alive.current) accept(result);
      } catch (caught) {
        if (alive.current) setError(errorText(caught));
      } finally {
        if (alive.current) setLoading(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = operation;
    return operation;
  }, [request, accept]);

  useEffect(() => {
    const poll = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = window.setInterval(poll, 20000);
    const focus = () => {
      if ('Notification' in window) setDesktopPermission(Notification.permission);
      poll();
    };
    document.addEventListener('visibilitychange', poll);
    window.addEventListener('focus', focus);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
      window.removeEventListener('focus', focus);
    };
  }, [refresh]);

  useEffect(() => {
    if (!inbox.preferences.sound || soundReady) return;
    const activate = () => {
      void armAudio().catch(() => {});
    };
    document.addEventListener('pointerdown', activate, { once: true });
    document.addEventListener('keydown', activate, { once: true });
    return () => {
      document.removeEventListener('pointerdown', activate);
      document.removeEventListener('keydown', activate);
    };
  }, [inbox.preferences.sound, soundReady, armAudio]);

  async function markRead(id: string) {
    try {
      await request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
      setInbox((current) => ({
        ...current,
        notifications: current.notifications.map((item) =>
          item.id === id ? { ...item, readAt: new Date().toISOString() } : item,
        ),
        unreadCount: Math.max(
          0,
          current.unreadCount -
            (current.notifications.some((item) => item.id === id && !item.readAt) ? 1 : 0),
        ),
      }));
      setError('');
    } catch (caught) {
      setError(errorText(caught));
    }
  }
  async function markAllRead() {
    try {
      await request('/notifications/read-all', { method: 'POST' });
      setInbox((current) => ({
        ...current,
        unreadCount: 0,
        notifications: current.notifications.map((item) => ({
          ...item,
          readAt: item.readAt || new Date().toISOString(),
        })),
      }));
      setError('');
    } catch (caught) {
      setError(errorText(caught));
    }
  }
  async function savePreference(patch: Partial<NotificationPreferences>) {
    await request('/notifications/preferences', { method: 'PATCH', body: JSON.stringify(patch) });
    setInbox((current) => ({ ...current, preferences: { ...current.preferences, ...patch } }));
    preferences.current = { ...preferences.current, ...patch };
    setError('');
  }
  async function setSound(enabled: boolean) {
    try {
      if (enabled) await armAudio();
      await savePreference({ sound: enabled });
      if (enabled) playSound();
    } catch (caught) {
      setError(errorText(caught));
    }
  }
  async function setDesktop(enabled: boolean) {
    try {
      if (enabled) {
        if (!('Notification' in window))
          throw new Error(
            'This browser does not support desktop notifications. Use the in-app inbox.',
          );
        const permission = await Notification.requestPermission();
        setDesktopPermission(permission);
        if (permission !== 'granted')
          throw new Error(
            'Desktop notifications were not enabled. You can change permission in your browser’s site settings.',
          );
      }
      await savePreference({ desktop: enabled });
    } catch (caught) {
      setError(errorText(caught));
    }
  }
  async function openItem(item: WorkspaceNotification) {
    await markRead(item.id);
    const current = latest.current;
    if (item.entityType === 'post' || item.entityType === 'publication') {
      let post: Post | undefined;
      try {
        post = await request<Post>(`/posts/${encodeURIComponent(item.entityId)}`);
      } catch {
        post = current.data.posts.find((candidate) => candidate.id === item.entityId);
      }
      if (!post) {
        current.navigate('content');
        toast('This post is no longer available. Open Content to see current work.', 'info');
        return;
      }
      const editingOwnDraft =
        current.data.user.role === 'contributor' &&
        current.data.user.id === post.ownerId &&
        ['draft', 'changes_requested', 'rejected'].includes(post.status);
      if (editingOwnDraft) {
        current.navigate('content');
        current.openComposer(post);
        return;
      }
      try {
        await current.refreshWorkspace();
      } catch {
        toast('This post could not be refreshed. Try opening the notification again.', 'error');
        return;
      }
      const tab =
        current.data.user.role === 'manager' && post.status === 'in_review'
          ? 'approvals'
          : 'library';
      current.navigate('content');
      window.location.hash = `content?tab=${tab}&post=${encodeURIComponent(post.id)}`;
    } else if (item.entityType === 'document') {
      await current.refreshWorkspace().catch(() => {});
      current.navigate('workspace');
      window.location.hash = `workspace?tab=knowledge&document=${encodeURIComponent(item.entityId)}`;
    } else if (item.entityType === 'task') {
      await current.refreshWorkspace().catch(() => {});
      current.navigate('workspace');
      window.location.hash = `workspace?task=${encodeURIComponent(item.entityId)}`;
    } else if (
      item.entityType === 'source' ||
      item.entityType === 'notice' ||
      item.entityType === 'opportunity' ||
      item.entityType === 'intelligence' ||
      item.entityType === 'research'
    ) {
      current.navigate('intelligence');
      window.location.hash =
        item.entityType === 'opportunity'
          ? 'intelligence?tab=opportunities'
          : /^(Exam (added|updated|verified)|Career pathway)/i.test(item.title)
            ? 'intelligence?tab=education'
            : /^(Competitor|Webpage|Research result|Exam research requested)/i.test(item.title)
              ? 'intelligence?tab=research'
              : 'intelligence?tab=monitoring';
    } else if (item.entityType === 'keyword') {
      current.navigate('performance');
      window.location.hash =
        'performance?tab=keywords&keyword=' + encodeURIComponent(item.entityId);
    } else if (item.entityType === 'connection') current.navigate('settings');
    else current.navigate('overview');
  }

  return (
    <NotificationContext.Provider
      value={{
        ...inbox,
        error,
        loading,
        soundReady,
        desktopPermission,
        refresh,
        markRead,
        markAllRead,
        setSound,
        setDesktop,
        openItem,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('Notifications must be used in the workspace.');
  return context;
}

export function NotificationBell({
  open,
  onToggle,
  onClose,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const notifications = useNotifications();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    void notifications.refresh();
    const outside = (event: MouseEvent) => {
      if (container.current && !container.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('click', outside);
    return () => document.removeEventListener('click', outside);
  }, [open, notifications.refresh, onClose]);
  const items = notifications.notifications.filter((item) => filter === 'all' || !item.readAt);
  return (
    <div className="header-menu-wrap notification-menu-wrap" data-header-menu ref={container}>
      <button
        className="icon-button"
        aria-label={`Notifications${notifications.unreadCount ? `, ${notifications.unreadCount} unread` : ''}`}
        aria-expanded={open}
        aria-controls="notification-inbox"
        onClick={onToggle}
      >
        <Bell size={20} />
        {notifications.unreadCount > 0 && (
          <span className="notification-count">
            {notifications.unreadCount > 99 ? '99+' : notifications.unreadCount}
          </span>
        )}
      </button>
      {open && (
        <section className="notification-inbox" id="notification-inbox" aria-label="Notifications">
          <div className="notification-inbox-heading">
            <div>
              <h2>Notifications</h2>
              <p>Review decisions and updates from your team.</p>
            </div>
            <button className="icon-button" aria-label="Close notifications" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
          <div className="notification-inbox-toolbar">
            <div className="tabs">
              <button
                className={`tab ${filter === 'all' ? 'active' : ''}`}
                onClick={() => setFilter('all')}
              >
                All
              </button>
              <button
                className={`tab ${filter === 'unread' ? 'active' : ''}`}
                onClick={() => setFilter('unread')}
              >
                Unread <span className="tab-count">{notifications.unreadCount}</span>
              </button>
            </div>
            <button
              className="text-link"
              onClick={() => void notifications.markAllRead()}
              disabled={!notifications.unreadCount}
            >
              <CheckCheck size={16} />
              Mark all read
            </button>
          </div>
          {notifications.error && (
            <p className="notification-error" role="alert">
              <CircleAlert size={16} />
              {notifications.error}
            </p>
          )}
          <div className="notification-list">
            {items.length ? (
              items.map((item) => (
                <article
                  className={`notification-item${item.readAt ? '' : ' unread'}`}
                  key={item.id}
                >
                  <button
                    className="notification-open"
                    onClick={() => {
                      void notifications.openItem(item);
                      onClose();
                    }}
                  >
                    <span className="notification-event-dot" aria-hidden="true" />
                    <span>
                      <strong>{item.title}</strong>
                      <span className="notification-message">{item.message}</span>
                      <small>
                        {item.actorName ? `${item.actorName} · ` : ''}
                        {notificationTime(item.createdAt)}
                      </small>
                    </span>
                    <ExternalLink size={15} />
                  </button>
                  {!item.readAt && (
                    <button
                      className="notification-mark"
                      aria-label={`Mark ${item.title} as read`}
                      title="Mark as read"
                      onClick={() => void notifications.markRead(item.id)}
                    >
                      <Check size={16} />
                    </button>
                  )}
                </article>
              ))
            ) : (
              <div className="notification-empty">
                <Bell size={28} />
                <h3>
                  {filter === 'unread'
                    ? 'You’re up to date'
                    : 'Your team’s updates will appear here'}
                </h3>
                <p>
                  {filter === 'unread'
                    ? 'New updates will arrive here as the team works.'
                    : 'Submissions, changes, comments, and review decisions are saved in this inbox.'}
                </p>
              </div>
            )}
          </div>
          <div className="notification-inbox-footer">
            <button
              className="text-link"
              onClick={() =>
                void notifications.setSound(
                  !(notifications.preferences.sound && notifications.soundReady),
                )
              }
            >
              {notifications.preferences.sound && notifications.soundReady ? (
                <Volume2 size={17} />
              ) : (
                <VolumeX size={17} />
              )}
              {notifications.preferences.sound && notifications.soundReady
                ? 'Mute sound'
                : 'Enable sound'}
            </button>
            <button
              className="text-link"
              disabled={notifications.loading}
              onClick={() => void notifications.refresh()}
            >
              <RefreshCw size={15} className={notifications.loading ? 'spin' : ''} />
              Refresh
            </button>
          </div>
          <p className="notification-session-note">
            Checks for updates every 20 seconds while this workspace is visible.
          </p>
        </section>
      )}
    </div>
  );
}

export function NotificationSettings() {
  const state = useNotifications();
  return (
    <section className="panel settings-card notification-settings">
      <div className="settings-title-icon">
        <Bell size={21} />
        <h2>Your notifications</h2>
      </div>
      <p>Updates are saved in your personal inbox. Choose how this browser alerts you.</p>
      <div className="settings-row">
        <div>
          <strong>Sound</strong>
          <small>
            {state.preferences.sound && state.soundReady
              ? 'A short chime for new team updates'
              : state.preferences.sound
                ? 'Click to enable audio in this browser'
                : 'Turn on a short chime for new updates'}
          </small>
        </div>
        <Button
          size="sm"
          onClick={() => void state.setSound(!(state.preferences.sound && state.soundReady))}
        >
          {state.preferences.sound && state.soundReady ? (
            <Volume2 size={16} />
          ) : (
            <VolumeX size={16} />
          )}
          {state.preferences.sound && state.soundReady ? 'Mute' : 'Enable sound'}
        </Button>
      </div>
      <div className="settings-row">
        <div>
          <strong>Desktop alerts</strong>
          <small>
            {state.desktopPermission === 'unsupported'
              ? 'Not supported in this browser'
              : state.desktopPermission === 'denied'
                ? 'Permission is blocked in your browser settings'
                : 'Optional system alerts while the workspace is open'}
          </small>
        </div>
        <Button
          size="sm"
          disabled={state.desktopPermission === 'unsupported'}
          onClick={() =>
            void state.setDesktop(
              !(state.preferences.desktop && state.desktopPermission === 'granted'),
            )
          }
        >
          {state.preferences.desktop && state.desktopPermission === 'granted'
            ? 'Turn off'
            : 'Enable alerts'}
        </Button>
      </div>
      <div className="settings-row">
        <div>
          <strong>In-app inbox</strong>
          <small>Unread and read updates persist across devices</small>
        </div>
        <Badge tone="green">Always available</Badge>
      </div>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      <p className="notification-help">
        Keep the workspace open for alerts. Closed-browser push notifications and notification
        emails are not enabled in this version.
      </p>
    </section>
  );
}
