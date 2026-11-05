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
import { institutions, type ProviderSetup, type Connection, type ProviderId } from '../lib/types';
import { Badge, Button, EmptyState, Modal, PlatformIcon } from './UI';
import { formatDate } from '../lib/utils';
import '../styles/connections.css';
import {
  canPublish,
  canReport,
  credentialGroup,
  providerNames,
  providerPlatform,
} from '../lib/providers';

type ConnectionCatalog = { providers: ProviderSetup[]; connections: Connection[] };
type AccountChoice = {
  id: string;
  name: string;
  kind: 'ga4' | ProviderId;
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
    'analytics:read': 'Read account reports',
    'publish:image': 'Approved image posts',
    'publish:text': 'Approved text posts',
    'publish:carousel': 'Approved image carousels',
    'publish:video': 'Approved videos',
    'ads:read': 'Read advertising reports',
    'search:read': 'Read search reports',
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
  const [providerGroup, setProviderGroup] = useState('all');
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
          : 'Your latest account report has been imported.',
      );
      await reload();
    } catch (err) {
      await reload();
      setError(messageOf(err));
    } finally {
      setBusy('');
    }
  }

  async function setReportSchedule(
    connection: Connection,
    autoSync: boolean,
    syncIntervalHours = connection.syncIntervalHours || 24,
  ) {
    setBusy(`${connection.id}:schedule`);
    setError('');
    try {
      await mutate(`/connections/${connection.id}/sync-settings`, 'POST', {
        autoSync,
        syncIntervalHours,
      });
      toast(
        autoSync ? 'Automatic report imports enabled.' : 'Automatic report imports turned off.',
      );
      await reload();
    } catch (err) {
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

      <div className="connection-onboarding-note">
        <strong>One app setup, then a few clicks per account.</strong>
        <p>
          Configure your Google, Meta, or LinkedIn application once. Each service asks for its own
          permissions, then lets you choose a school account. App review and account eligibility are
          shown in its setup steps.
        </p>
        <a
          className="text-link"
          href="https://github.com/saga0003/Sales-and-Marketing-St-Mary-s-/blob/main/docs/CONNECTING-ACCOUNTS.md"
          target="_blank"
          rel="noreferrer"
        >
          Connection guide <ArrowUpRight size={15} />
        </a>
      </div>
      <div className="tabs connection-group-tabs" aria-label="Provider groups">
        {['all', 'google', 'meta', 'linkedin'].map((group) => (
          <button
            type="button"
            key={group}
            className={`tab ${providerGroup === group ? 'active' : ''}`}
            aria-pressed={providerGroup === group}
            onClick={() => setProviderGroup(group)}
          >
            {group === 'all'
              ? 'All services'
              : group === 'google'
                ? 'Google'
                : group === 'meta'
                  ? 'Meta'
                  : 'LinkedIn'}
          </button>
        ))}
      </div>
      <div className="connection-provider-grid">
        {providers
          .filter(
            (provider) =>
              providerGroup === 'all' ||
              (provider.credentialGroup || credentialGroup(provider.id)) === providerGroup,
          )
          .map((provider) => (
            <section className="panel connection-provider" key={provider.id}>
              <div className="connection-provider-heading">
                <span className={`connection-provider-symbol connection-provider-${provider.id}`}>
                  {providerPlatform(provider.id) ? (
                    <PlatformIcon platform={providerPlatform(provider.id)!} size={25} />
                  ) : (
                    <BarChart3 size={23} />
                  )}
                </span>
                <div>
                  <h3>{provider.name}</h3>
                  <span>
                    {canPublish(provider.capabilities || [])
                      ? canReport(provider.capabilities || [])
                        ? 'Reporting & approved publishing'
                        : 'Approved publishing'
                      : 'Account reporting'}
                  </span>
                </div>
                <Badge tone={provider.configured ? 'green' : 'amber'}>
                  {provider.configured ? 'App ready' : 'Setup required'}
                </Badge>
              </div>
              <p>{provider.description}</p>
              <div className="connection-provider-scope">
                <ShieldCheck size={15} />
                <span>
                  {canPublish(provider.capabilities || [])
                    ? 'Every publication requires an approved revision'
                    : 'Imports reports without changing account settings or ad spend'}
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
                    : canReport(connection.capabilities)
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
                      {providerPlatform(connection.provider) ? (
                        <PlatformIcon platform={providerPlatform(connection.provider)!} size={22} />
                      ) : (
                        <BarChart3 size={20} />
                      )}
                    </span>
                    <div>
                      <h3>
                        {connection.accountName ||
                          `${providerNames[connection.provider]} authorization`}
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
                      {canReport(connection.capabilities) && (
                        <span>
                          <RefreshCw size={13} />
                          Data imported: <strong>{connectionDate(connection.lastSyncAt)}</strong>
                        </span>
                      )}
                    </div>
                  </div>
                  {connection.capabilities.includes('analytics:read') &&
                    connection.status !== 'disconnected' && (
                      <div className="connection-sync-settings">
                        <div>
                          <strong>Automatic report imports</strong>
                          <p>
                            Imports a 28-day window with a two-day reporting lag. Provider quotas
                            apply.
                          </p>
                          {connection.autoSync && (
                            <small>
                              Next scheduled check: {connectionDate(connection.nextSyncAt || null)}.
                              Due accounts are processed in turn.
                            </small>
                          )}
                        </div>
                        {isManager ? (
                          <div className="connection-sync-controls">
                            <label className="checkbox-field">
                              <input
                                type="checkbox"
                                checked={!!connection.autoSync}
                                disabled={
                                  !!busy ||
                                  (connection.status !== 'connected' && !connection.autoSync)
                                }
                                onChange={(event) =>
                                  void setReportSchedule(connection, event.target.checked)
                                }
                              />
                              <span>
                                {connection.autoSync ? 'Enabled' : 'Enable automatic imports'}
                              </span>
                            </label>
                            {connection.autoSync && (
                              <select
                                aria-label={`Import frequency for ${connection.accountName}`}
                                value={connection.syncIntervalHours || 24}
                                disabled={!!busy}
                                onChange={(event) =>
                                  void setReportSchedule(
                                    connection,
                                    true,
                                    Number(event.target.value),
                                  )
                                }
                              >
                                <option value={6}>Every 6 hours</option>
                                <option value={12}>Every 12 hours</option>
                                <option value={24}>Every day</option>
                                <option value={48}>Every 2 days</option>
                                <option value={168}>Every week</option>
                              </select>
                            )}
                          </div>
                        ) : (
                          <Badge tone={connection.autoSync ? 'green' : 'gray'}>
                            {connection.autoSync ? 'Enabled' : 'Off'}
                          </Badge>
                        )}
                      </div>
                    )}
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
                          {canReport(connection.capabilities) && (
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
          capabilities. Accounts expose only the actions supported by the provider and your granted
          permissions. Advertising connections import reports; they do not launch campaigns or
          change budgets.
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
  const [extraFields, setExtraFields] = useState<Record<string, string>>({});
  const group = provider.credentialGroup || credentialGroup(provider.id);
  const fields = (provider.credentialFields || []).filter(
    (field) => !['clientId', 'clientSecret'].includes(field.key),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await mutate(`/connections/providers/${provider.id}`, 'PUT', {
        ...(clientId.trim() ? { clientId: clientId.trim() } : {}),
        ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
        ...Object.fromEntries(
          Object.entries(extraFields)
            .filter(([, value]) => value.trim())
            .map(([key, value]) => [key, value.trim()]),
        ),
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
          {group === 'google'
            ? 'Google Cloud'
            : group === 'meta'
              ? 'Meta developer'
              : 'LinkedIn developer'}{' '}
          app, then save its credentials here. You’ll choose and authorize the school account in the
          next step.
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
          {group === 'meta' ? 'Meta app ID' : 'OAuth client ID'}
          <input
            required={!provider.configured}
            autoComplete="off"
            spellCheck={false}
            value={clientId}
            disabled={busy}
            maxLength={1024}
            onChange={(event) => setClientId(event.target.value)}
            placeholder={
              provider.configured
                ? 'Leave blank to keep the saved app ID'
                : 'Paste the ID from your provider app'
            }
          />
        </label>
        <label className="field">
          {group === 'meta' ? 'Meta app secret' : 'OAuth client secret'}
          <input
            required={!provider.configured}
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={clientSecret}
            disabled={busy}
            maxLength={4096}
            onChange={(event) => setClientSecret(event.target.value)}
          />
          <small>
            Stored encrypted by the server. Saved secrets are never returned to this screen. Leave
            blank to keep a saved secret when updating other settings.
          </small>
        </label>
        {fields.map((field) => (
          <label className="field" key={field.key}>
            {field.label}
            <input
              required={field.required && !provider.configured}
              type={field.secret ? 'password' : 'text'}
              autoComplete={field.secret ? 'new-password' : 'off'}
              spellCheck={false}
              maxLength={4096}
              placeholder={field.placeholder}
              value={extraFields[field.key] || ''}
              disabled={busy}
              onChange={(event) =>
                setExtraFields((current) => ({ ...current, [field.key]: event.target.value }))
              }
            />
          </label>
        ))}
        <p className="connection-detail-note">
          This application is shared by the{' '}
          {group === 'meta' ? 'Meta' : group === 'google' ? 'Google' : 'LinkedIn'} services in this
          workspace. Register each service’s exact callback URL when enabling it.
        </p>
        {provider.docsUrl && (
          <a className="text-link" href={provider.docsUrl} target="_blank" rel="noreferrer">
            Official provider setup documentation <ArrowUpRight size={15} />
          </a>
        )}
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
          'www.linkedin.com',
          'linkedin.com',
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
              {canPublish(provider.capabilities || [])
                ? 'Connect reporting and approved publishing'
                : 'Read the reports you authorize'}
            </h3>
            <p>{provider.description}</p>
          </div>
        </div>
        <details className="connection-scopes">
          <summary>Permissions this service requests</summary>
          <ul>
            {provider.scopes.map((scope) => (
              <li key={scope}>
                <code>{scope}</code>
              </li>
            ))}
          </ul>
          <p>The provider shows its own consent screen. Grant only the access you intend to use.</p>
        </details>
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
          : `Choose your ${providerNames[connection.provider]} account`
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
