import { useCallback, useEffect, useState } from 'react';
import { BellRing, RefreshCw } from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import type { IntelligenceWatch } from '../lib/types';
import { formatDate } from '../lib/utils';
import { Badge, Button } from './UI';
import '../styles/youtube-push.css';

type PushState = {
  watchId: string;
  enabled: boolean;
  state: 'disabled' | 'pending' | 'active' | 'paused' | 'needs_attention';
  canEnable: boolean;
  reason: string | null;
  error: string | null;
  leaseExpiresAt: string | null;
  renewAfter: string | null;
  lastDeliveryAt: string | null;
  lastAttemptAt: string | null;
};
type PushData = { subscriptions: PushState[]; available: boolean; reason: string | null };
// Watch cards share one short-lived read instead of issuing one request per card.
let sharedRead: { userId: string; expires: number; promise: Promise<PushData> } | null = null;
const labels: Record<PushState['state'], string> = {
  disabled: 'Off',
  pending: 'Awaiting YouTube',
  active: 'Active',
  paused: 'Paused',
  needs_attention: 'Needs attention',
};

export function YoutubePushControl({ watch }: { watch: IntelligenceWatch }) {
  const { data, request, mutate, toast } = useWorkspace();
  const [state, setState] = useState<PushState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const manager = data.user.role === 'manager';
  const load = useCallback(
    async (force = false) => {
      if (
        force ||
        !sharedRead ||
        sharedRead.userId !== data.user.id ||
        sharedRead.expires < Date.now()
      ) {
        sharedRead = {
          userId: data.user.id,
          expires: Date.now() + 2000,
          promise: request<PushData>('/intelligence/youtube-push'),
        };
      }
      const result = await sharedRead.promise;
      return result.subscriptions.find((item) => item.watchId === watch.id) ?? null;
    },
    [request, data.user.id, watch.id],
  );

  useEffect(() => {
    if (watch.mode !== 'youtube') return;
    let cancelled = false;
    load()
      .then((result) => {
        if (!cancelled) {
          setState(result);
          setError('');
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : 'Push status could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, [load, watch.mode, watch.active, watch.lastCheckedAt]);

  useEffect(() => {
    if (state?.state !== 'pending') return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      load(true)
        .then(setState)
        .catch(() => {
          /* The next visible refresh can retry a status read. */
        });
    }, 20000);
    return () => window.clearInterval(timer);
  }, [state?.state, load]);

  async function change(enabled: boolean) {
    setBusy(true);
    setError('');
    try {
      const result = await mutate<{ subscription: PushState }>(
        `/intelligence/watches/${watch.id}/youtube-push`,
        'POST',
        { enabled },
      );
      sharedRead = null;
      setState(result.subscription);
      toast(
        enabled
          ? 'Push requested. YouTube will verify the generated callback.'
          : 'YouTube push is off. Scheduled checks remain available.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Push monitoring could not be updated.');
    } finally {
      setBusy(false);
    }
  }
  if (watch.mode !== 'youtube') return null;
  return (
    <section className="youtube-push-control" aria-label={`YouTube push for ${watch.name}`}>
      <div className="youtube-push-heading">
        <strong>
          <BellRing size={17} aria-hidden="true" /> YouTube push
        </strong>
        {state && (
          <Badge
            tone={
              state.state === 'active'
                ? 'green'
                : state.state === 'needs_attention'
                  ? 'amber'
                  : 'gray'
            }
          >
            {labels[state.state]}
          </Badge>
        )}
      </div>
      <p>
        Get uploads and video title or description changes when YouTube sends an update. The
        callback is set up automatically.
      </p>
      {!state && !error && <p className="youtube-push-detail">Checking availability…</p>}
      {state?.reason && <p className="youtube-push-detail">{state.reason}</p>}
      {state?.state === 'pending' && (
        <p className="youtube-push-detail">
          Waiting for the hub to verify this subscription. A public callback must be reachable; no
          URL needs to be copied.
        </p>
      )}
      {state?.lastDeliveryAt && (
        <p className="youtube-push-detail">
          Last received {formatDate(state.lastDeliveryAt, { hour: 'numeric', minute: '2-digit' })}{' '}
          IST.
        </p>
      )}
      {state?.state === 'active' && state.leaseExpiresAt && (
        <p className="youtube-push-detail">
          Subscription until {formatDate(state.leaseExpiresAt)}. The scheduled worker renews it
          automatically.
        </p>
      )}
      {(error || state?.error) && (
        <p className="youtube-push-error" role="alert">
          {error || state?.error}
        </p>
      )}
      <div className="youtube-push-actions">
        {manager && state && (
          <Button
            size="sm"
            variant={state.enabled ? 'secondary' : 'primary'}
            disabled={busy || (!state.enabled && !state.canEnable)}
            onClick={() => change(!state.enabled)}
          >
            {busy ? 'Updating…' : state.enabled ? 'Turn off push' : 'Enable push'}
          </Button>
        )}
        {manager && state?.enabled && state.canEnable && state.state === 'needs_attention' && (
          <Button size="sm" disabled={busy} onClick={() => change(true)}>
            Retry subscription
          </Button>
        )}
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            setError('');
            load(true)
              .then(setState)
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : 'Status could not be refreshed.'),
              );
          }}
        >
          <RefreshCw size={14} aria-hidden="true" /> Refresh status
        </Button>
      </div>
    </section>
  );
}
