import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ArrowRight, Check, CircleAlert, Info, LoaderCircle, X } from 'lucide-react';
import type { Post, View, WorkspaceData } from './types';
import { institutions } from './types';
import { errorMessage } from './utils';
import { Button } from '../components/UI';

export class WorkspaceRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = 'WorkspaceRequestError';
  }
}

type ToastKind = 'success' | 'error' | 'info';
interface WorkspaceContextValue {
  data: WorkspaceData;
  refresh: () => Promise<void>;
  request: <T = unknown>(path: string, options?: RequestInit) => Promise<T>;
  mutate: <T = unknown>(path: string, method: string, body?: unknown) => Promise<T>;
  selectedInstitution: string;
  setInstitution: (value: string) => void;
  toast: (message: string, kind?: ToastKind) => void;
  view: View;
  navigate: (view: View) => void;
  openComposer: (post?: Post) => void;
  composer: { open: boolean; post?: Post };
  closeComposer: () => void;
}
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
const views: View[] = [
  'overview',
  'content',
  'intelligence',
  'performance',
  'workspace',
  'settings',
];
const readView = (): View => {
  const value = window.location.hash.slice(1).split('?')[0] as View;
  return views.includes(value) ? value : 'overview';
};
const readSetupToken = () =>
  window.location.hash.startsWith('#setup?')
    ? new URLSearchParams(window.location.hash.split('?')[1]).get('token') || ''
    : '';

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [view, setView] = useState<View>(readView);
  const [setupToken, setSetupToken] = useState(readSetupToken);
  const [selectedInstitution, setSelectedInstitution] = useState(() => {
    const saved = localStorage.getItem('stmarys-institution') || 'all';
    return institutions.includes(saved) ? saved : 'all';
  });
  const [composer, setComposer] = useState<{ open: boolean; post?: Post }>({ open: false });
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: ToastKind }[]>([]);
  const token = useRef('');
  const initialRequest = useRef<Promise<void> | null>(null);
  const toastCounter = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const toast = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = ++toastCounter.current;
    setToasts((items) => [...items.slice(-3), { id, message, kind }]);
    timers.current.push(
      setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 5500),
    );
  }, []);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );
  const refresh = useCallback(async () => {
    const response = await fetch('/api/bootstrap', { credentials: 'same-origin' });
    if (response.status === 401) {
      setData(null);
      token.current = '';
      setNeedsLogin(true);
      setError('');
      return;
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to load your workspace.');
    token.current = result.csrfToken;
    setData({
      ...result,
      providerSetup: result.providerSetup || [],
      connections: result.connections || [],
      mediaAssets: result.mediaAssets || [],
      publicationJobs: result.publicationJobs || [],
      websiteAnalytics: result.websiteAnalytics || [],
      platformAnalytics: result.platformAnalytics || [],
      notifications: result.notifications || [],
      unreadNotificationCount: result.unreadNotificationCount || 0,
      notificationPreferences: result.notificationPreferences || { sound: false, desktop: false },
      intelligence: result.intelligence || {
        watches: [],
        notices: [],
        sourceCatalog: [],
        siteVerifications: [],
        seoAudits: [],
        answerPrompts: [],
        answerObservations: [],
        automation: { enabled: false, minimumIntervalHours: 1, maxWatchesPerRun: 2 },
      },
    });
    setNeedsLogin(false);
    setError('');
  }, []);
  useEffect(() => {
    // React StrictMode replays effects in development. Reuse the initial
    // request so two anonymous bootstraps cannot race their session cookies.
    initialRequest.current ??= refresh();
    initialRequest.current
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    const handle = () => {
      setView(readView());
      setSetupToken(readSetupToken());
    };
    window.addEventListener('hashchange', handle);
    return () => window.removeEventListener('hashchange', handle);
  }, []);
  const navigate = useCallback((next: View) => {
    window.location.hash = next;
    setView(next);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);
  const setInstitution = useCallback((value: string) => {
    const next = institutions.includes(value) ? value : 'all';
    setSelectedInstitution(next);
    localStorage.setItem('stmarys-institution', next);
  }, []);
  const request = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      if (!path.startsWith('/') || path.startsWith('//'))
        throw new Error('Invalid workspace request.');
      const headers = new Headers(options.headers);
      const method = (options.method || 'GET').toUpperCase();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('x-csrf-token', token.current);
      if (typeof options.body === 'string' && !headers.has('Content-Type'))
        headers.set('Content-Type', 'application/json');
      const response = await fetch(`/api${path}`, {
        ...options,
        method,
        headers,
        credentials: 'same-origin',
      });
      const content = await response.text();
      let result;
      try {
        result = content ? JSON.parse(content) : {};
      } catch {
        throw new Error('The workspace could not complete this request. Please try again.');
      }
      if (!response.ok) {
        if (response.status === 401) await refresh();
        throw new WorkspaceRequestError(
          result.error || 'We could not save that change. Please try again.',
          response.status,
          result.code,
        );
      }
      return result as T;
    },
    [refresh],
  );
  const mutate = useCallback(
    async <T,>(path: string, method: string, body?: unknown): Promise<T> => {
      const result = await request<T>(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      try {
        await refresh();
      } catch {
        // The write is already committed. Preserve its result (including one-time
        // setup links) so callers never repeat a successful create after a read failure.
        toast(
          'Your change was saved. The view could not refresh yet; reload to see the latest data.',
          'info',
        );
      }
      return result as T;
    },
    [refresh, request, toast],
  );
  const openComposer = useCallback((post?: Post) => setComposer({ open: true, post }), []);
  useEffect(() => {
    if (!data || needsLogin) return;
    const update = () => {
      if (
        document.visibilityState !== 'visible' ||
        composer.open ||
        document.querySelector('dialog[open]')
      )
        return;
      void refresh().catch(() => {
        /* Keep saved data visible while a transient refresh fails. */
      });
    };
    const interval = window.setInterval(update, 60000);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', update);
    };
  }, [Boolean(data), needsLogin, composer.open, refresh]);
  if (loading)
    return (
      <div className="loading-screen">
        <div className="brand-mark">M</div>
        <LoaderCircle className="spin" size={22} />
        <p>Opening your workspace…</p>
      </div>
    );
  if (needsLogin || setupToken)
    return (
      <Login
        setupToken={setupToken}
        onSuccess={async () => {
          window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${window.location.search}#overview`,
          );
          setSetupToken('');
          setView('overview');
          await refresh();
        }}
      />
    );
  if (!data || error)
    return (
      <div className="loading-screen">
        <CircleAlert size={30} />
        <h1>Let’s reconnect your workspace</h1>
        <p>{error || 'The workspace is unavailable.'}</p>
        <Button
          variant="primary"
          onClick={() => {
            setLoading(true);
            refresh()
              .catch((err) => setError(errorMessage(err)))
              .finally(() => setLoading(false));
          }}
        >
          Try again
        </Button>
      </div>
    );
  return (
    <WorkspaceContext.Provider
      value={{
        data,
        refresh,
        request,
        mutate,
        selectedInstitution,
        setInstitution,
        toast,
        view,
        navigate,
        openComposer,
        composer,
        closeComposer: () => setComposer({ open: false }),
      }}
    >
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map((item) => (
          <div
            key={item.id}
            className={`toast toast-${item.kind}`}
            role={item.kind === 'error' ? 'alert' : 'status'}
          >
            {item.kind === 'success' ? (
              <Check size={18} />
            ) : item.kind === 'error' ? (
              <CircleAlert size={18} />
            ) : (
              <Info size={18} />
            )}
            <span>{item.message}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() => setToasts((items) => items.filter((t) => t.id !== item.id))}
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </WorkspaceContext.Provider>
  );
}
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used inside its provider');
  return context;
}

function Login({
  onSuccess,
  setupToken = '',
}: {
  onSuccess: () => Promise<void>;
  setupToken?: string;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (setupToken && password !== confirmPassword)
        throw new Error('Your passwords do not match.');
      const response = await fetch(setupToken ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(setupToken ? { token: setupToken, password } : { email, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Please check your email and password.');
      await onSuccess();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="brand-lockup">
          <span className="brand-mark">M</span>
          <div>
            <strong>ST. MARY’S</strong>
            <span>Marketing workspace</span>
          </div>
        </div>
        <span className="eyebrow">
          {setupToken ? 'Your private team workspace' : 'A little clarity. A lot of possibility.'}
        </span>
        <h1>
          {setupToken ? (
            <>
              Make yourself
              <br />
              at home.
            </>
          ) : (
            <>
              Welcome to your
              <br />
              next great idea.
            </>
          )}
        </h1>
        <p>
          {setupToken
            ? 'Choose a password to activate your account. This personal setup link can be used once.'
            : 'One place for your content, your team, and the work that moves your school forward.'}
        </p>
        <form onSubmit={submit}>
          {!setupToken && (
            <label className="field">
              Work email
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@school.edu.in"
              />
            </label>
          )}
          <label className="field">
            Password
            <input
              type="password"
              required
              minLength={setupToken ? 12 : undefined}
              maxLength={256}
              autoComplete={setupToken ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {setupToken && (
            <>
              <small className="field-help">
                Use at least 12 characters. A memorable passphrase works well.
              </small>
              <label className="field">
                Confirm password
                <input
                  type="password"
                  required
                  minLength={12}
                  maxLength={256}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </label>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy
              ? setupToken
                ? 'Activating your account…'
                : 'Signing in…'
              : setupToken
                ? 'Set password & open workspace'
                : 'Open workspace'}
            <ArrowRight size={17} />
          </Button>
        </form>
        <p className="login-note">
          {setupToken
            ? 'An expired or already used link? Ask your manager for a new setup link.'
            : 'Need access or a password reset? Ask your manager for a personal setup link.'}
        </p>
      </section>
      <aside className="login-art" aria-hidden="true">
        <div className="login-art-card">
          <span>IDEAS BECOME IMPACT.</span>
          <h2>
            Plan with purpose.
            <br />
            Create with confidence.
          </h2>
          <div className="art-orbits">
            <i />
            <i />
            <i />
          </div>
          <p>Every story starts with your team.</p>
        </div>
      </aside>
    </main>
  );
}
