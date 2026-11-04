import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ArrowRight, Check, CircleAlert, Info, LoaderCircle, X } from 'lucide-react';
import type { Post, View, WorkspaceData } from './types';
import { errorMessage } from './utils';
import { Button } from '../components/UI';

type ToastKind = 'success' | 'error' | 'info';
interface WorkspaceContextValue {
  data: WorkspaceData;
  refresh: () => Promise<void>;
  mutate: <T = unknown>(path: string, method: string, body?: unknown) => Promise<T>;
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

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [view, setView] = useState<View>(readView);
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
    setData(result);
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
    const handle = () => setView(readView());
    window.addEventListener('hashchange', handle);
    return () => window.removeEventListener('hashchange', handle);
  }, []);
  const navigate = useCallback((next: View) => {
    window.location.hash = next;
    setView(next);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);
  const mutate = useCallback(
    async <T,>(path: string, method: string, body?: unknown): Promise<T> => {
      const response = await fetch(`/api${path}`, {
        method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': token.current },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const result = response.status === 204 ? {} : await response.json();
      if (!response.ok) {
        if (response.status === 401) await refresh();
        throw new Error(result.error || 'We could not save that change. Please try again.');
      }
      await refresh();
      return result as T;
    },
    [refresh],
  );
  const openComposer = useCallback((post?: Post) => setComposer({ open: true, post }), []);
  if (loading)
    return (
      <div className="loading-screen">
        <div className="brand-mark">M</div>
        <LoaderCircle className="spin" size={22} />
        <p>Opening your workspace…</p>
      </div>
    );
  if (needsLogin) return <Login onSuccess={refresh} />;
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
        mutate,
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

function Login({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
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
        <span className="eyebrow">A little clarity. A lot of possibility.</span>
        <h1>
          Welcome to your
          <br />
          next great idea.
        </h1>
        <p>One place for your content, your team, and the work that moves your school forward.</p>
        <form onSubmit={submit}>
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
          <label className="field">
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Open workspace'}
            <ArrowRight size={17} />
          </Button>
        </form>
        <p className="login-note">Need access? Ask your workspace manager to create an account.</p>
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
