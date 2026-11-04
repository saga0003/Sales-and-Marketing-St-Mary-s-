import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Plug,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Unplug,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import { institutions, type ProviderSetup, type Connection } from '../lib/types';
import { Badge, Button, EmptyState, Modal, PlatformIcon } from './UI';
import { formatDate } from '../lib/utils';
import '../styles/connections.css';

type ConnectionCatalog = { providers: ProviderSetup[]; connections: Connection[] };
type AccountChoice = {
  id: string;
  name: string;
  kind: 'ga4' | 'instagram';
  platform?: string;
  timezone?: string;
};
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : 'The connection could not be updated. Please try again.';
const connectionDate = (value: string | null) =>
  value
    ? `${formatDate(value, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} IST`
    : 'Not yet';
const capabilityLabel = (value: string) =>
  ({
    reporting: 'Read reports',
    analytics: 'Read reports',
    analytics_read: 'Read reports',
    read_reports: 'Read reports',
    publishing: 'Publish approved posts',
    publish: 'Publish approved posts',
    publish_content: 'Publish approved posts',
    instagram_publish: 'Publish approved posts',
    'analytics:read': 'Read website reports',
    'publish:image': 'Publish approved image posts',
    'account:read': 'Read account identity',
  })[value] || value.replaceAll('_', ' ').replaceAll('.', ' ');

export function useConnectionData() {
  return useWorkspace().data;
}

export default function Connections() {
  const { data, request, mutate, toast } = useWorkspace();
  const extended = useConnectionData();
  const [catalog, setCatalog] = useState<ConnectionCatalog | null>(() =>
    extended.providerSetup
      ? { providers: extended.providerSetup, connections: extended.connections || [] }
      : null,
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [setup, setSetup] = useState<ProviderSetup | null>(null);
  const [authorize, setAuthorize] = useState<{
    provider: ProviderSetup;
    institution?: string;
  } | null>(null);
  const [selectAccount, setSelectAccount] = useState<Connection | null>(null);
  const [disconnect, setDisconnect] = useState<Connection | null>(null);
  const [filter, setFilter] = useState('all');
  const [callback, setCallback] = useState(
    () => new URLSearchParams(window.location.hash.split('?')[1] || ''),
  );
  const isManager = data.user.role === 'manager';

  const reload = useCallback(async () => {
    try {
      setCatalog(await request<ConnectionCatalog>('/connections'));
      setError('');
    } catch (err) {
      setError(messageOf(err));
    }
  }, [request]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (extended.providerSetup)
      setCatalog({ providers: extended.providerSetup, connections: extended.connections || [] });
  }, [extended.providerSetup, extended.connections]);
  useEffect(() => {
    const connectedId = callback.get('connected');
    if (!connectedId) return;
    const connection = catalog?.connections.find((item) => item.id === connectedId);
    if (!connection) return;
    if (connection.status === 'awaiting_selection') setSelectAccount(connection);
    setCallback(new URLSearchParams());
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}#settings`,
    );
  }, [callback, catalog]);

  async function action(connection: Connection, kind: 'test' | 'sync') {
    setBusy(`${connection.id}:${kind}`);
    setError('');
    try {
      await mutate(`/connections/${connection.id}/${kind}`, 'POST', {});
      toast(
        kind === 'test'
          ? `${connection.accountName || 'Account'} access checked.`
          : 'Your latest website report has been imported.',
      );
      await reload();
    } catch (err) {
      await reload();
      setError(messageOf(err));
    } finally {
      setBusy('');
    }
  }

  const providers = catalog?.providers || [];
  const accounts = catalog?.connections || [];
  const connected = accounts.filter((item) => item.status === 'connected').length;
  const needsAttention = accounts.filter(
    (item) => item.status === 'needs_attention' || item.status === 'awaiting_selection',
  ).length;
  const filtered = accounts.filter((item) => filter === 'all' || item.institution === filter);
  const callbackCode = callback.get('connection_error');
  const callbackError = callbackCode
    ? callbackCode === 'access_denied' || callbackCode === 'oauth_cancelled'
      ? 'Authorization was cancelled. Choose Connect account whenever you are ready to try again.'
      : 'Authorization could not be completed. Check your app settings, then connect the account again.'
    : '';

  return (
    <div className="connections-page">
      <section className="connection-intro panel">
        <div className="connection-intro-icon">
          <Link2 size={25} />
        </div>
        <div className="connection-intro-copy">
          <span className="eyebrow">BRING YOUR CHANNELS TOGETHER</span>
          <h2>The right account. The right school.</h2>
          <p>Authorize a service, choose your account, and see what it can do here.</p>
        </div>
        <div className="connection-intro-counts">
          <div>
            <strong>{connected}</strong>
            <span>Connected</span>
          </div>
          <div>
            <strong>{needsAttention}</strong>
            <span>Need a step</span>
          </div>
        </div>
      </section>

      {(error || callbackError) && (
        <div className="connection-alert" role="alert">
          <CircleAlert size={19} />
          <div>
            <strong>Let’s check this connection</strong>
            <p>{error || callbackError}</p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setCallback(new URLSearchParams());
              window.history.replaceState(
                null,
                '',
                `${window.location.pathname}${window.location.search}#settings`,
              );
              void reload();
            }}
          >
            Refresh
          </Button>
        </div>
      )}
      {!catalog && !error && (
        <div className="connection-loading" role="status">
          <LoaderCircle className="spin" size={21} />
          Loading connection setup…
        </div>
      )}

      <div className="connection-provider-grid">
        {providers.map((provider) => (
          <section className="panel connection-provider" key={provider.id}>
            <div className="connection-provider-heading">
              <span className={`connection-provider-symbol connection-provider-${provider.id}`}>
                {provider.id === 'google' ? (
                  <BarChart3 size={23} />
                ) : (
                  <PlatformIcon platform="instagram" size={25} />
                )}
              </span>
              <div>
                <h3>{provider.name}</h3>
                <span>
                  {provider.id === 'google' ? 'Website reporting' : 'Approved social publishing'}
                </span>
              </div>
              <Badge tone={provider.configured ? 'green' : 'amber'}>
                {provider.configured ? 'App ready' : 'Setup required'}
              </Badge>
            </div>
            <p>
              {provider.description ||
                (provider.id === 'google'
                  ? 'Bring your GA4 traffic, landing pages and enquiry events into Performance.'
                  : 'Send approved image posts to the professional account you select.')}
            </p>
            <div className="connection-provider-scope">
              <ShieldCheck size={15} />
              <span>
                {provider.id === 'google'
                  ? 'Read-only access to your selected property'
                  : 'Your review stays part of every publication'}
              </span>
            </div>
            {provider.error && <p className="connection-provider-error">{provider.error}</p>}
            <div className="connection-provider-actions">
              {isManager ? (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!provider.configured && !provider.canConfigure}
                    onClick={() =>
                      provider.configured ? setAuthorize({ provider }) : setSetup(provider)
                    }
                  >
                    {provider.configured ? (
                      <>
                        <PlusIcon />
                        Connect account
                      </>
                    ) : (
                      <>
                        <Settings2 size={15} />
                        Set up {provider.name}
                      </>
                    )}
                    <ArrowRight size={15} />
                  </Button>
                  {provider.configured && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!provider.canConfigure}
                      onClick={() => setSetup(provider)}
                    >
                      <Settings2 size={15} />
                      App settings
                    </Button>
                  )}
                </>
              ) : (
                <span className="connection-detail-note">
                  A manager can connect your school’s account.
                </span>
              )}
            </div>
            {!provider.configured && !provider.canConfigure && isManager && (
              <p className="connection-detail-note">
                Provider setup is waiting for secure credential storage to be configured for this
                workspace.
              </p>
            )}
          </section>
        ))}
      </div>

      <section className="panel connection-accounts">
        <div className="connection-section-heading">
          <div>
            <h2>Your connected accounts</h2>
            <p>Connection health and imported data stay visible to your team.</p>
          </div>
          <label>
            <span className="sr-only">Filter connected accounts by institution</span>
            <select
              aria-label="Filter connected accounts by institution"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">All schools</option>
              {institutions.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
        </div>
        {filtered.length ? (
          <div className="connection-account-list">
            {filtered.map((connection) => {
              const provider = providers.find((item) => item.id === connection.provider);
              const status =
                connection.status === 'connected'
                  ? connection.lastSyncAt
                    ? 'Data imported'
                    : connection.provider === 'google'
                      ? 'Ready to import'
                      : 'Account connected'
                  : connection.status === 'awaiting_selection'
                    ? 'Choose an account'
                    : connection.status === 'needs_attention'
                      ? 'Needs attention'
                      : 'Disconnected';
              return (
                <article className="connection-account" key={connection.id}>
                  <div className="connection-account-heading">
                    <span
                      className={`connection-account-symbol connection-provider-${connection.provider}`}
                    >
                      {connection.provider === 'google' ? (
                        <BarChart3 size={20} />
                      ) : (
                        <PlatformIcon platform="instagram" size={22} />
                      )}
                    </span>
                    <div>
                      <h3>
                        {connection.accountName ||
                          (connection.provider === 'google'
                            ? 'Google authorization'
                            : 'Instagram authorization')}
                      </h3>
                      <p>
                        {connection.institution}
                        {connection.accountId && (
                          <span>
                            {' '}
                            · {connection.provider === 'google' ? 'Property' : 'Account'}{' '}
                            {connection.accountId}
                          </span>
                        )}
                      </p>
                    </div>
                    <Badge
                      tone={
                        connection.status === 'connected'
                          ? 'green'
                          : connection.status === 'disconnected'
                            ? 'gray'
                            : 'amber'
                      }
                    >
                      {connection.status === 'connected' && <CheckCircle2 size={12} />}
                      {status}
                    </Badge>
                  </div>
                  <div className="connection-account-detail">
                    <div className="connection-capabilities">
                      {connection.capabilities.map((capability) => (
                        <span key={capability}>
                          <ShieldCheck size={12} />
                          {capabilityLabel(capability)}
                        </span>
                      ))}
                    </div>
                    <div className="connection-timestamps">
                      <span>
                        <Clock3 size={13} />
                        Access checked: <strong>{connectionDate(connection.lastTestAt)}</strong>
                      </span>
                      {connection.provider === 'google' && (
                        <span>
                          <RefreshCw size={13} />
                          Data imported: <strong>{connectionDate(connection.lastSyncAt)}</strong>
                        </span>
                      )}
                    </div>
                  </div>
                  {connection.error && (
                    <p className="connection-account-error">
                      <CircleAlert size={15} />
                      {connection.error}
                    </p>
                  )}
                  {isManager && (
                    <div className="connection-account-actions">
                      {connection.status === 'awaiting_selection' && (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => setSelectAccount(connection)}
                        >
                          Choose account
                          <ChevronRight size={15} />
                        </Button>
                      )}
                      {connection.status !== 'disconnected' && connection.accountId && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={!!busy}
                            onClick={() => void action(connection, 'test')}
                          >
                            <ShieldCheck size={14} />
                            {busy === `${connection.id}:test` ? 'Checking…' : 'Test access'}
                          </Button>
                          {connection.provider === 'google' && (
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={!!busy}
                              onClick={() => void action(connection, 'sync')}
                            >
                              <RefreshCw
                                size={14}
                                className={busy === `${connection.id}:sync` ? 'spin' : ''}
                              />
                              {busy === `${connection.id}:sync`
                                ? 'Importing…'
                                : connection.lastSyncAt
                                  ? 'Refresh report'
                                  : 'Import first report'}
                            </Button>
                          )}
                        </>
                      )}
                      {(connection.status === 'needs_attention' ||
                        connection.status === 'disconnected') &&
                        provider?.configured && (
                          <Button
                            size="sm"
                            onClick={() =>
                              setAuthorize({ provider, institution: connection.institution })
                            }
                          >
                            <Link2 size={14} />
                            Authorize again
                          </Button>
                        )}
                      {connection.status !== 'disconnected' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!!busy}
                          onClick={() => setDisconnect(connection)}
                        >
                          <Unplug size={14} />
                          Disconnect
                        </Button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<Plug size={30} />}
            title={
              filter === 'all'
                ? 'Your first connection starts above'
                : 'No accounts for this school yet'
            }
            description={
              filter === 'all'
                ? 'Set up a provider, authorize access, and select the exact account your team should use.'
                : 'Choose a different school or connect an account and assign it to this institution.'
            }
            action={
              filter !== 'all' ? (
                <Button onClick={() => setFilter('all')}>Show all schools</Button>
              ) : undefined
            }
          />
        )}
      </section>

      <div className="connection-next-note">
        <LockKeyhole size={18} />
        <p>
          <strong>Access stays specific.</strong> Reporting, publishing and advertising are separate
          capabilities. This release connects GA4 reporting and eligible Instagram image publishing;
          other service adapters remain on the roadmap.
        </p>
      </div>
      {setup && (
        <ProviderSettings
          provider={setup}
          onClose={() => setSetup(null)}
          onComplete={() => {
            setSetup(null);
            void reload();
          }}
        />
      )}
      {authorize && (
        <AuthorizeAccount
          provider={authorize.provider}
          initialInstitution={authorize.institution}
          onClose={() => setAuthorize(null)}
        />
      )}
      {selectAccount && (
        <SelectAccount
          connection={selectAccount}
          onClose={() => setSelectAccount(null)}
          onComplete={() => {
            setSelectAccount(null);
            void reload();
          }}
        />
      )}
      {disconnect && (
        <DisconnectAccount
          connection={disconnect}
          onClose={() => setDisconnect(null)}
          onComplete={() => {
            setDisconnect(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function PlusIcon() {
  return <Plug size={15} />;
}

function ProviderSettings({
  provider,
  onClose,
  onComplete,
}: {
  provider: ProviderSetup;
  onClose: () => void;
  onComplete: () => void;
}) {
  const { mutate, toast } = useWorkspace();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await mutate(`/connections/providers/${provider.id}`, 'PUT', {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      });
      setClientSecret('');
      toast(`${provider.name} app settings saved. You can now authorize an account.`);
      onComplete();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`${provider.name} app setup`}
      onClose={() => {
        if (!busy) onClose();
      }}
      className="connection-setup-modal"
    >
      <form className="stack" onSubmit={save}>
        <Badge tone="violet">One-time manager setup</Badge>
        <p className="connection-summary">
          Register this workspace in your{' '}
          {provider.id === 'google' ? 'Google Cloud' : 'Meta developer'} app, then save its
          credentials here. You’ll choose and authorize the school account in the next step.
        </p>
        {provider.requirements.length > 0 && (
          <ol className="setup-steps">
            {provider.requirements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        )}
        <label className="field">
          Authorized redirect URI
          <div className="connection-copy-field">
            <input
              readOnly
              value={provider.redirectUri}
              onFocus={(event) => event.target.select()}
            />
            <Button
              size="sm"
              aria-label="Copy authorized redirect URI"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(provider.redirectUri);
                  setCopied(true);
                } catch {
                  setError('Select the redirect URI and copy it manually.');
                }
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </Button>
          </div>
          <small>Copy this exact address into the provider’s app settings.</small>
        </label>
        <label className="field">
          {provider.id === 'google' ? 'OAuth client ID' : 'Meta app ID'}
          <input
            required
            autoComplete="off"
            spellCheck={false}
            value={clientId}
            disabled={busy}
            maxLength={1024}
            onChange={(event) => setClientId(event.target.value)}
            placeholder={
              provider.configured
                ? 'Enter the app ID to replace the current setup'
                : 'Paste the ID from your provider app'
            }
          />
        </label>
        <label className="field">
          {provider.id === 'google' ? 'OAuth client secret' : 'Meta app secret'}
          <input
            required
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={clientSecret}
            disabled={busy}
            maxLength={4096}
            onChange={(event) => setClientSecret(event.target.value)}
          />
          <small>
            Stored encrypted by the server. Saved secrets are never returned to this screen.
          </small>
        </label>
        <div className="modal-note">
          <LockKeyhole size={18} />
          <span>
            {provider.configured
              ? 'Replacing app credentials may require existing accounts to authorize again.'
              : 'App setup makes authorization available. It does not connect a school account by itself.'}
          </span>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy || !provider.canConfigure}>
            {busy ? 'Saving securely…' : 'Save app settings'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function AuthorizeAccount({
  provider,
  initialInstitution,
  onClose,
}: {
  provider: ProviderSetup;
  initialInstitution?: string;
  onClose: () => void;
}) {
  const { mutate } = useWorkspace();
  const [institution, setInstitution] = useState(initialInstitution || institutions[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function begin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { url } = await mutate<{ url: string }>('/connections/authorize', 'POST', {
        provider: provider.id,
        institution,
      });
      const target = new URL(url);
      if (
        target.protocol !== 'https:' ||
        ![
          'accounts.google.com',
          'www.instagram.com',
          'api.instagram.com',
          'www.facebook.com',
          'facebook.com',
        ].includes(target.hostname)
      )
        throw new Error('The provider returned an unexpected authorization address.');
      window.location.assign(target.href);
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Connect ${provider.name}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="stack" onSubmit={begin}>
        <div className="connection-consent-summary">
          <ShieldCheck size={24} />
          <div>
            <h3>
              {provider.id === 'google'
                ? 'Read your website reports'
                : 'Publish the content you approve'}
            </h3>
            <p>
              {provider.id === 'google'
                ? 'Choose a GA4 property after authorizing Google. This connection does not change your website or advertising campaigns.'
                : 'Use an Instagram professional account linked to a Facebook Page your school controls. Publishing requires the exact approved content and a confirmed destination.'}
            </p>
          </div>
        </div>
        <label className="field">
          Which school is this for?
          <select
            value={institution}
            disabled={busy}
            onChange={(event) => setInstitution(event.target.value)}
          >
            {institutions.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <div className="connection-consent-steps">
          <span>
            <CheckCircle2 size={16} />
            Authorize access with {provider.name}
          </span>
          <span>
            <CheckCircle2 size={16} />
            Select the exact account or property
          </span>
          <span>
            <CheckCircle2 size={16} />
            Test the connection here
          </span>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <ArrowUpRight size={16} />}
            {busy ? 'Opening authorization…' : `Continue to ${provider.name}`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SelectAccount({
  connection,
  onClose,
  onComplete,
}: {
  connection: Connection;
  onClose: () => void;
  onComplete: () => void;
}) {
  const { request, mutate, toast } = useWorkspace();
  const [accounts, setAccounts] = useState<AccountChoice[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    request<{ accounts: AccountChoice[] }>(`/connections/${connection.id}/accounts`, {
      signal: controller.signal,
    })
      .then((result) => {
        setAccounts(result.accounts);
        if (result.accounts.length === 1) setSelected(result.accounts[0].id);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(messageOf(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [connection.id, request]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) {
      setError('Choose an account to continue.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await mutate(`/connections/${connection.id}/select`, 'POST', { accountId: selected });
      toast('Account selected. You can now test access and use its available actions.');
      onComplete();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        connection.provider === 'google'
          ? 'Choose your GA4 property'
          : 'Choose your Instagram account'
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="stack" onSubmit={submit}>
        <p className="connection-summary">
          This account will be assigned to <strong>{connection.institution}</strong>.
        </p>
        {loading ? (
          <div className="connection-loading" role="status">
            <LoaderCircle size={19} className="spin" />
            Finding accounts you can access…
          </div>
        ) : accounts.length ? (
          <fieldset className="connection-account-choices">
            <legend>Available accounts</legend>
            {accounts.map((account) => (
              <label
                key={account.id}
                className={`connection-account-choice${selected === account.id ? ' selected' : ''}`}
              >
                <input
                  type="radio"
                  name="connected-account"
                  disabled={busy}
                  value={account.id}
                  checked={selected === account.id}
                  onChange={() => setSelected(account.id)}
                />
                <span>
                  <strong>{account.name}</strong>
                  <small>
                    {account.id}
                    {account.timezone && ` · ${account.timezone}`}
                  </small>
                </span>
                {selected === account.id && <Check size={16} />}
              </label>
            ))}
          </fieldset>
        ) : (
          <EmptyState
            icon={<Plug size={25} />}
            title="No eligible accounts found"
            description="Check that the account you authorized has access to the school’s property or professional account, then authorize again."
          />
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button disabled={busy} onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" type="submit" disabled={busy || loading || !selected}>
            {busy ? 'Saving account…' : 'Use selected account'}
            <ArrowRight size={15} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DisconnectAccount({
  connection,
  onClose,
  onComplete,
}: {
  connection: Connection;
  onClose: () => void;
  onComplete: () => void;
}) {
  const { mutate, toast } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    setBusy(true);
    setError('');
    try {
      await mutate(`/connections/${connection.id}`, 'DELETE');
      toast('Account disconnected.');
      onComplete();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Disconnect this account?"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="stack">
        <p className="connection-summary">
          <strong>{connection.accountName || 'This account'}</strong> will no longer be available
          for new imports or publishing. Your saved workspace content remains.
        </p>
        <div className="modal-note">
          <Unplug size={18} />
          <span>{connection.institution}</span>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button disabled={busy} onClick={onClose}>
            Keep connected
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void remove()}>
            {busy ? 'Disconnecting…' : 'Disconnect account'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
