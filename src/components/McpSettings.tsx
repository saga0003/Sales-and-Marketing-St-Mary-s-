import { useCallback, useEffect, useState } from 'react';
import { Bot, Copy, ExternalLink, Link2, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import { Badge, Button, EmptyState } from './UI';
import { formatDate } from '../lib/utils';
import '../styles/workspace-access.css';

type Scope = 'workspace:read' | 'workspace:drafts' | 'workspace:research';
type Grant = {
  id: string;
  clientName: string;
  scopes: Scope[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
};
type State = {
  ready: boolean;
  endpoint: string | null;
  scopes: Scope[];
  additionalApiSpendUsd: number;
  grants: Grant[];
};
type Consent = { clientName: string; redirectOrigin: string; scopes: Scope[]; expiresAt: string };
const permissions: Record<Scope, { title: string; detail: string }> = {
  'workspace:read': {
    title: 'Read the workspace',
    detail: 'Read saved content, research, exams, career paths and keyword history.',
  },
  'workspace:drafts': {
    title: 'Prepare content drafts',
    detail: 'Create unscheduled drafts for your team to review.',
  },
  'workspace:research': {
    title: 'Save research and evidence',
    detail:
      'Create research requests and record cited observations, exam drafts and keyword evidence.',
  },
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'This connection could not be updated.';
const readRequest = () =>
  new URLSearchParams(window.location.hash.split('?')[1]).get('authorize') || '';

export default function McpSettings() {
  const { data, request, mutate, toast } = useWorkspace();
  const [state, setState] = useState<State | null>(null);
  const [consent, setConsent] = useState<Consent | null>(null);
  const [authorization, setAuthorization] = useState(readRequest);
  const [scopes, setScopes] = useState<Scope[]>(['workspace:read']);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    try {
      setState(await request<State>('/mcp/settings'));
      setError('');
    } catch (error) {
      setError(message(error));
    }
  }, [request]);
  useEffect(() => {
    const changed = () => setAuthorization(readRequest());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => {
    if (data.user.role !== 'manager') return;
    void load();
  }, [data.user.role, load]);
  useEffect(() => {
    let current = true;
    setConsent(null);
    if (!authorization || data.user.role !== 'manager') return;
    void request<Consent>('/mcp/consent/' + encodeURIComponent(authorization))
      .then((value) => {
        if (current) {
          setConsent(value);
          setScopes(['workspace:read']);
          setError('');
        }
      })
      .catch((error) => {
        if (current) setError(message(error));
      });
    return () => {
      current = false;
    };
  }, [authorization, data.user.role, request]);
  async function decide(allow: boolean) {
    setBusy('consent');
    setError('');
    try {
      const result = await mutate<{ redirectUrl: string }>(
        '/mcp/consent/' + encodeURIComponent(authorization),
        'POST',
        { allow, scopes },
      );
      const destination = new URL(result.redirectUrl);
      if (destination.origin !== 'https://chatgpt.com')
        throw new Error('This callback is not a supported ChatGPT address.');
      window.location.assign(destination.href);
    } catch (error) {
      setError(message(error));
      setBusy('');
    }
  }
  async function revoke(id: string) {
    setBusy(id);
    setError('');
    try {
      await mutate('/mcp/grants/' + encodeURIComponent(id) + '/revoke', 'POST', {});
      await load();
      toast('ChatGPT connection revoked.');
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy('');
    }
  }
  if (data.user.role !== 'manager')
    return (
      <EmptyState
        icon={ShieldCheck}
        title="A manager connects ChatGPT"
        description="Your manager can grant access to workspace research and drafts from this screen."
      />
    );
  return (
    <div className="access-stack">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {authorization && (
        <section className="panel access-consent" aria-labelledby="mcp-consent-title">
          <div className="access-heading">
            <Bot size={24} />
            <div>
              <span className="eyebrow">CONNECTION REQUEST</span>
              <h2 id="mcp-consent-title">Choose what ChatGPT can do</h2>
            </div>
          </div>
          {consent ? (
            <>
              <p>
                <strong>{consent.clientName}</strong> is requesting access as{' '}
                <strong>{data.user.name}</strong>. You will return to {consent.redirectOrigin} after
                your decision.
              </p>
              <div className="access-permissions">
                {consent.scopes.map((scope) => (
                  <label key={scope}>
                    <input
                      type="checkbox"
                      checked={scopes.includes(scope)}
                      disabled={scope === 'workspace:read' || !!busy}
                      onChange={(event) =>
                        setScopes((current) =>
                          event.target.checked
                            ? [...current, scope]
                            : current.filter((item) => item !== scope),
                        )
                      }
                    />
                    <span>
                      <strong>{permissions[scope].title}</strong>
                      <small>{permissions[scope].detail}</small>
                    </span>
                  </label>
                ))}
              </div>
              <p className="access-note">
                Approval, publishing, advertising spend, account secrets and team administration
                stay in the workspace. Research submitted by ChatGPT requires verification.
              </p>
              <div className="access-actions">
                <Button variant="primary" disabled={!!busy} onClick={() => void decide(true)}>
                  {busy === 'consent' ? 'Returning to ChatGPT…' : 'Allow selected access'}
                </Button>
                <Button disabled={!!busy} onClick={() => void decide(false)}>
                  Decline
                </Button>
              </div>
              <small className="access-note">
                This request expires{' '}
                {formatDate(consent.expiresAt, { dateStyle: 'medium', timeStyle: 'short' })} IST.
              </small>
            </>
          ) : (
            !error && <p role="status">Loading your connection request…</p>
          )}
        </section>
      )}
      <div className="access-columns">
        <section className="panel access-card">
          <div className="access-heading">
            <Link2 size={22} />
            <h2>Connect your ChatGPT</h2>
            <Badge tone={state?.ready ? 'green' : 'gray'}>
              {state?.ready ? 'Server ready' : state ? 'Setup needed' : 'Loading'}
            </Badge>
          </div>
          <p>
            Use your existing ChatGPT account to research public sources and prepare work here.
            Every connection starts with your workspace login and permission screen.
          </p>
          <label className="access-field">
            MCP server URL
            <div className="access-copy">
              <input readOnly value={state?.endpoint || ''} placeholder="Your workspace endpoint" />
              <Button
                aria-label="Copy MCP server URL"
                disabled={!state?.endpoint}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(state!.endpoint!)
                    .then(() => toast('MCP server URL copied.'))
                    .catch(() => toast('Select and copy the URL from the field.', 'info'));
                }}
              >
                <Copy size={17} />
              </Button>
            </div>
          </label>
          <ol className="access-steps">
            <li>In ChatGPT, open Plugins, select the plus button, then Add custom MCP server.</li>
            <li>
              Enter a name, paste this server URL and select OAuth. Client registration is
              automatic; leave optional client ID and secret fields empty.
            </li>
            <li>
              Create the plugin, sign in to this workspace and choose permissions. Start a
              conversation and select the plugin using @.
            </li>
            <li>
              Ask: “List pending research requests, inspect their official references, and save
              cited findings for review.”
            </li>
          </ol>
          <p className="access-note">
            ChatGPT account and workspace policies control whether custom MCP servers are available.
            Some interfaces use the older Apps or Connectors label.
          </p>
          <a
            className="access-link"
            href="https://developers.openai.com/apps-sdk/deploy/connect-chatgpt"
            target="_blank"
            rel="noreferrer"
          >
            OpenAI connection instructions <ExternalLink size={15} />
          </a>
        </section>
        <section className="panel access-card">
          <div className="access-heading">
            <ShieldCheck size={22} />
            <h2>You keep control</h2>
          </div>
          <div className="access-budget">
            <strong>$0</strong>
            <span>Automatic AI API spending</span>
          </div>
          <p>
            This server makes no OpenAI API calls. Your ChatGPT plan and usage limits still apply.
            MCP connects the conversation to your workspace; it does not start a background ChatGPT
            session.
          </p>
          <p>
            Use <strong>Research now</strong> in Intelligence to create a request, then open it in
            ChatGPT. Findings retain their source links and remain unverified until reviewed.
          </p>
          <p className="access-note">
            Connections expire after 30 days and can be revoked here at any time. Social-platform
            permissions are separate: the school’s provider apps still need their initial setup.
          </p>
        </section>
      </div>
      <section className="panel access-card">
        <div className="access-heading">
          <Bot size={22} />
          <h2>Your ChatGPT connections</h2>
          <Button size="sm" onClick={() => void load()}>
            <RefreshCw size={15} />
            Refresh
          </Button>
        </div>
        {!state ? (
          <p role="status">Loading connections…</p>
        ) : state.grants.length === 0 ? (
          <p>No ChatGPT connections yet. Start from ChatGPT using the URL above.</p>
        ) : (
          <div className="access-grants">
            {state.grants.map((grant) => {
              const expired = Date.parse(grant.expiresAt) <= Date.now();
              return (
                <article key={grant.id}>
                  <div>
                    <strong>{grant.clientName}</strong>
                    <p>{grant.scopes.map((scope) => permissions[scope].title).join(' · ')}</p>
                    <small>
                      {grant.revoked
                        ? 'Revoked'
                        : expired
                          ? 'Expired'
                          : `Expires ${formatDate(grant.expiresAt)}`}{' '}
                      ·{' '}
                      {grant.lastUsedAt
                        ? `Last used ${formatDate(grant.lastUsedAt)}`
                        : 'Not used yet'}
                    </small>
                  </div>
                  <Badge tone={grant.revoked || expired ? 'gray' : 'green'}>
                    {grant.revoked ? 'Revoked' : expired ? 'Expired' : 'Active'}
                  </Badge>
                  {!grant.revoked && !expired && (
                    <Button size="sm" disabled={!!busy} onClick={() => void revoke(grant.id)}>
                      <Unplug size={15} />
                      {busy === grant.id ? 'Revoking…' : 'Revoke'}
                    </Button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
