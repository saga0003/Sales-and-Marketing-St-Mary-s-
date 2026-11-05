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
import ConnectionAdministration from './ConnectionAdministration';
import {
  canPublish,
  canReport,
  credentialGroup,
  providerNames,
  providerPlatform,
} from '../lib/providers';

type ConnectionCatalog = {
  providers: ProviderSetup[];
  connections: Connection[];
  applicationAdministration?: { isOwner: boolean };
  viewerId?: string;
};
type AccountChoice = {
  id: string;
  name: string;
  kind: 'ga4' | ProviderId;
  platform?: string;
  timezone?: string;
  connectedConnectionId?: string;
  connectedInstitution?: string;
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
  const { data, request, mutate, toast, selectedInstitution } = useWorkspace();
  const extended = useConnectionData();
  const [catalog, setCatalog] = useState<ConnectionCatalog | null>(() =>
    extended.providerSetup
      ? { providers: extended.providerSetup, connections: extended.connections || [] }
      : null,
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [view, setView] = useState<'accounts' | 'administration'>('accounts');
  const [newAccountSchool, setNewAccountSchool] = useState(
    selectedInstitution === 'all' ? institutions[0] : selectedInstitution,
  );
  const [selectAccount, setSelectAccount] = useState<Connection | null>(null);
  const [disconnect, setDisconnect] = useState<Connection | null>(null);
  const [filter, setFilter] = useState('all');
  const [providerGroup, setProviderGroup] = useState('all');
  const [accountSearch, setAccountSearch] = useState('');
  const [callback, setCallback] = useState(
    () => new URLSearchParams(window.location.hash.split('?')[1] || ''),
  );
  const isManager = data.user.role === 'manager';

  const reload = useCallback(async () => {
    try {
      setCatalog({ ...(await request<ConnectionCatalog>('/connections')), viewerId: data.user.id });
      setError('');
    } catch (err) {
      setError(messageOf(err));
    }
  }, [request, data.user.id]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (extended.providerSetup)
      setCatalog((previous) => ({
        ...previous,
        providers: extended.providerSetup,
        connections: extended.connections || [],
      }));
  }, [extended.providerSetup, extended.connections]);
  useEffect(() => {
    if (selectedInstitution !== 'all') setNewAccountSchool(selectedInstitution);
  }, [selectedInstitution]);
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

  async function beginConnection(provider: ProviderSetup, institution = newAccountSchool) {
    setBusy(`authorize:${provider.id}`);
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
      setBusy('');
    }
  }

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
  const isOwner =
    isManager &&
    (providers.some((item) => item.canConfigure) ||
      (catalog?.viewerId === data.user.id && catalog.applicationAdministration?.isOwner === true));
  const accounts = catalog?.connections || [];
  const connected = accounts.filter((item) => item.status === 'connected').length;
  const needsAttention = accounts.filter(
    (item) => item.status === 'needs_attention' || item.status === 'awaiting_selection',
  ).length;
  const filtered = accounts.filter(
    (item) =>
      (filter === 'all' || item.institution === filter) &&
      (providerGroup === 'all' || credentialGroup(item.provider) === providerGroup) &&
      `${item.accountName} ${item.accountId || ''} ${providerNames[item.provider]}`
        .toLocaleLowerCase()
        .includes(accountSearch.trim().toLocaleLowerCase()),
  );
  const callbackCode = callback.get('connection_error');
  const callbackError = callbackCode
    ? callbackCode === 'access_denied' ||
      callbackCode === 'oauth_cancelled' ||
      callbackCode === 'oauth_denied'
      ? 'Authorization was cancelled. Choose Connect whenever you are ready to try again.'
      : callbackCode === 'oauth_session_expired'
        ? 'Your workspace session expired before authorization finished. Sign in and connect again.'
        : 'The provider could not complete authorization. Try connecting again; the workspace owner can check the shared application if this continues.'
    : '';

  return (
    <div className="connections-page">
      <section className="connection-intro panel">
        <div className="connection-intro-icon">
          <Link2 size={25} />
        </div>
        <div className="connection-intro-copy">
          <h2>Your channels, together.</h2>
          <p>Connect once, choose your accounts, and keep each school’s reports separate.</p>
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

      {isOwner && (
        <div className="tabs connection-view-tabs" aria-label="Connection workspace">
          <button
            type="button"
            className={`tab ${view === 'accounts' ? 'active' : ''}`}
            aria-pressed={view === 'accounts'}
            onClick={() => setView('accounts')}
          >
            <Link2 size={16} />
            Accounts & Pages
          </button>
          <button
            type="button"
            className={`tab ${view === 'administration' ? 'active' : ''}`}
            aria-pressed={view === 'administration'}
            onClick={() => setView('administration')}
          >
            <LockKeyhole size={16} />
            Application administration
          </button>
        </div>
      )}

      {view === 'administration' && isOwner ? (
        <ConnectionAdministration onUpdated={reload} onBack={() => setView('accounts')} />
      ) : (
        <>
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

          <section className="connection-connect-toolbar panel">
            <div>
              <strong>Choose a school, then connect a service</strong>
              <p>
                Continue on the provider’s consent screen, then select one or more accounts or
                Pages. Reports and publishing destinations stay separate.
              </p>
            </div>
            <label className="field">
              School for new connections
              <select
                value={newAccountSchool}
                disabled={!!busy}
                onChange={(event) => setNewAccountSchool(event.target.value)}
              >
                {institutions.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
          </section>
          {providers.some((item) => !item.configured) && (
            <div className="connection-onboarding-note connection-setup-notice">
              <div>
                <strong>Some services need administrator setup</strong>
                <p>
                  {isOwner
                    ? 'Configure the shared applications once. Your team then connects each account through provider consent.'
                    : 'Ask the workspace owner to configure the shared applications. Your team then connects accounts through provider consent.'}
                </p>
              </div>
              {isOwner ? (
                <Button size="sm" onClick={() => setView('administration')}>
                  <Settings2 size={15} />
                  Open application administration
                </Button>
              ) : null}
            </div>
          )}
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
                    <span
                      className={`connection-provider-symbol connection-provider-${provider.id}`}
                    >
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
                      {provider.configured ? 'Ready to authorize' : 'Administrator setup required'}
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
                  <details className="connection-scopes connection-service-permissions">
                    <summary>Requested access</summary>
                    <ul>
                      {provider.scopes.map((scope) => (
                        <li key={scope}>
                          <code>{scope}</code>
                        </li>
                      ))}
                    </ul>
                  </details>
                  <div className="connection-provider-actions">
                    {isManager ? (
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={!provider.configured || !!busy}
                        onClick={() => void beginConnection(provider)}
                      >
                        {busy === `authorize:${provider.id}` ? (
                          <LoaderCircle size={15} className="spin" />
                        ) : (
                          <Plug size={15} />
                        )}
                        {busy === `authorize:${provider.id}`
                          ? 'Opening consent…'
                          : `Connect ${provider.name}`}
                        <ArrowUpRight size={15} />
                      </Button>
                    ) : (
                      <span className="connection-detail-note">
                        A manager can connect your school’s account.
                      </span>
                    )}
                  </div>
                  {!provider.configured && (
                    <p className="connection-detail-note">
                      {provider.error ||
                        'The workspace owner needs to configure the shared application before this service can request consent.'}
                    </p>
                  )}
                </section>
              ))}
          </div>

          <section className="panel connection-accounts">
            <div className="connection-section-heading">
              <div>
                <h2>Your connected accounts</h2>
                <p>Each account has its own reports, access status, and publishing destination.</p>
              </div>
              <div className="connection-account-filters">
                <label>
                  <span className="sr-only">Search connected accounts</span>
                  <input
                    type="search"
                    aria-label="Search connected accounts"
                    placeholder="Search account or Page"
                    value={accountSearch}
                    onChange={(event) => setAccountSearch(event.target.value)}
                  />
                </label>
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
                            <PlatformIcon
                              platform={providerPlatform(connection.provider)!}
                              size={22}
                            />
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
                              Data imported:{' '}
                              <strong>{connectionDate(connection.lastSyncAt)}</strong>
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
                                Imports a 28-day window with a two-day reporting lag. Provider
                                quotas apply.
                              </p>
                              {connection.autoSync && (
                                <small>
                                  Next scheduled check:{' '}
                                  {connectionDate(connection.nextSyncAt || null)}. Due accounts are
                                  processed in turn.
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
                              Choose accounts
                              <ChevronRight size={15} />
                            </Button>
                          )}
                          {connection.status !== 'disconnected' && connection.accountId && (
                            <>
                              <Button
                                size="sm"
                                disabled={!!busy}
                                onClick={() => setSelectAccount(connection)}
                              >
                                <Plug size={14} />
                                Choose more accounts
                              </Button>
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
                                disabled={!!busy}
                                onClick={() =>
                                  void beginConnection(provider, connection.institution)
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
                  accounts.length
                    ? 'No accounts match these filters'
                    : filter === 'all'
                      ? 'Your first connection starts above'
                      : 'No accounts for this school yet'
                }
                description={
                  accounts.length
                    ? 'Clear the search or change the school and provider filters to see your other accounts.'
                    : filter === 'all'
                      ? 'Choose a school and connect a ready service above. Account selection happens after provider consent.'
                      : 'Choose a different school or connect an account and assign it to this institution.'
                }
                action={
                  filter !== 'all' || providerGroup !== 'all' || accountSearch ? (
                    <Button
                      onClick={() => {
                        setFilter('all');
                        setProviderGroup('all');
                        setAccountSearch('');
                      }}
                    >
                      Show all accounts
                    </Button>
                  ) : undefined
                }
              />
            )}
          </section>

          <div className="connection-next-note">
            <LockKeyhole size={18} />
            <p>
              <strong>Access stays specific.</strong> Reporting, publishing and advertising are
              separate capabilities. Accounts expose only the actions supported by the provider and
              your granted permissions. Advertising connections import reports; they do not launch
              campaigns or change budgets.
            </p>
          </div>
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
        </>
      )}
    </div>
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
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
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
        const eligible = result.accounts.filter(
          (account) =>
            !account.connectedInstitution ||
            account.connectedInstitution === connection.institution,
        );
        if (eligible.length === 1) setSelected([eligible[0].id]);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(messageOf(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [connection.id, connection.institution, request]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected.length) {
      setError('Choose at least one account to continue.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await mutate<{ connections: Connection[] }>(
        `/connections/${connection.id}/select-many`,
        'POST',
        { accountIds: selected },
      );
      toast(
        `${result.connections.length} ${result.connections.length === 1 ? 'account connected' : 'accounts connected'}. Each has separate reports and publishing access.`,
      );
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
          ? 'Choose your GA4 properties'
          : `Choose ${providerNames[connection.provider]} accounts`
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="stack" onSubmit={submit}>
        <p className="connection-summary">
          Select up to 25 accounts for <strong>{connection.institution}</strong>. Each one keeps its
          own reports and destination. Existing selected accounts are renewed; unselected accounts
          stay connected.
        </p>
        {loading ? (
          <div className="connection-loading" role="status">
            <LoaderCircle size={19} className="spin" />
            Finding accounts you can access…
          </div>
        ) : accounts.length ? (
          <>
            <div className="connection-choose-toolbar">
              <label className="field">
                <span className="sr-only">Find an available account</span>
                <input
                  type="search"
                  aria-label="Find an available account"
                  placeholder="Find an account or Page"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  disabled={busy}
                />
              </label>
              <span>{selected.length} selected</span>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  setSelected(
                    accounts
                      .filter(
                        (account) =>
                          (!account.connectedInstitution ||
                            account.connectedInstitution === connection.institution) &&
                          `${account.name} ${account.id}`
                            .toLocaleLowerCase()
                            .includes(search.trim().toLocaleLowerCase()),
                      )
                      .slice(0, 25)
                      .map((account) => account.id),
                  )
                }
              >
                Select available (up to 25)
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !selected.length}
                onClick={() => setSelected([])}
              >
                Clear
              </Button>
            </div>
            <fieldset className="connection-account-choices">
              <legend>Accounts available through this authorization</legend>
              {accounts
                .filter((account) =>
                  `${account.name} ${account.id}`
                    .toLocaleLowerCase()
                    .includes(search.trim().toLocaleLowerCase()),
                )
                .map((account) => (
                  <label
                    key={account.id}
                    className={`connection-account-choice${selected.includes(account.id) ? ' selected' : ''}${account.connectedInstitution && account.connectedInstitution !== connection.institution ? ' unavailable' : ''}`}
                  >
                    <input
                      type="checkbox"
                      name="connected-account"
                      disabled={
                        busy ||
                        !!(
                          account.connectedInstitution &&
                          account.connectedInstitution !== connection.institution
                        ) ||
                        (selected.length >= 25 && !selected.includes(account.id))
                      }
                      value={account.id}
                      checked={selected.includes(account.id)}
                      onChange={() =>
                        setSelected((current) =>
                          current.includes(account.id)
                            ? current.filter((id) => id !== account.id)
                            : [...current, account.id],
                        )
                      }
                    />
                    <span>
                      <strong>{account.name}</strong>
                      <small>
                        {account.id}
                        {account.timezone && ` · ${account.timezone}`}
                      </small>
                      {account.connectedInstitution && (
                        <small>
                          {account.connectedInstitution === connection.institution
                            ? 'Already connected here · selected access will be renewed'
                            : `Connected to ${account.connectedInstitution}`}
                        </small>
                      )}
                    </span>
                    {selected.includes(account.id) && <Check size={16} />}
                  </label>
                ))}
            </fieldset>
          </>
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
          <Button variant="primary" type="submit" disabled={busy || loading || !selected.length}>
            {busy
              ? 'Connecting accounts…'
              : `Connect ${selected.length || ''} selected ${selected.length === 1 ? 'account' : 'accounts'}`}
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
