import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CircleAlert,
  Copy,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Settings2,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import type { ProviderId } from '../lib/types';
import { Badge, Button, Modal } from './UI';

type ApplicationGroup = 'google' | 'meta' | 'linkedin';
type ApplicationSetup = {
  id: ApplicationGroup;
  name: string;
  configured: boolean;
  canConfigure: boolean;
  credentialsSource: 'workspace' | 'environment' | 'missing';
  updatedAt: string | null;
  redirectUri: string;
  docsUrl: string;
  error: string | null;
  services: {
    id: ProviderId;
    name: string;
    requirements: string[];
    scopes: string[];
    docsUrl: string;
  }[];
};
type ApplicationCatalog = {
  applications: ApplicationSetup[];
  redirectUri: string;
  encryptionConfigured: boolean;
  originConfigured: boolean;
};
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : 'Application setup could not be loaded.';

export default function ConnectionAdministration({
  onUpdated,
  onBack,
}: {
  onUpdated: () => Promise<void>;
  onBack: () => void;
}) {
  const { request } = useWorkspace();
  const [catalog, setCatalog] = useState<ApplicationCatalog | null>(null);
  const [selected, setSelected] = useState<ApplicationSetup | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const load = useCallback(async () => {
    try {
      setCatalog(await request<ApplicationCatalog>('/connections/applications'));
      setError('');
    } catch (caught) {
      setError(messageOf(caught));
    }
  }, [request]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="connection-administration">
      <div className="connection-admin-heading">
        <div>
          <span className="eyebrow">WORKSPACE OWNER</span>
          <h2>Three shared applications. One setup location.</h2>
          <p>
            Configure Google, Meta, and LinkedIn here once. Your managers connect accounts from
            Accounts & Pages without entering app credentials.
          </p>
        </div>
        <Button size="sm" onClick={onBack}>
          <ArrowLeft size={16} />
          Accounts & Pages
        </Button>
      </div>
      <div className="connection-onboarding-note">
        <strong>Automatic setup and provider approval</strong>
        <p>
          The workspace generates the authorization address, callback, permissions, and account
          chooser. Each provider still requires its own registered application, owner consent, and
          any applicable access review. Saving credentials alone does not confirm that review or
          connect a social account.
        </p>
      </div>
      {error && (
        <div className="connection-alert" role="alert">
          <CircleAlert size={20} />
          <p>{error}</p>
          <Button size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}
      {!catalog && !error && (
        <div className="connection-loading" role="status">
          <LoaderCircle size={20} className="spin" />
          Loading owner configuration…
        </div>
      )}
      {catalog && (
        <>
          <section className="panel connection-shared-callback">
            <div>
              <KeyRound size={22} />
              <div>
                <h3>One generated return address</h3>
                <p>
                  Register this exact address once in each provider application you enable. It
                  serves all ten services and is never entered per account or Page.
                </p>
              </div>
            </div>
            <label className="field">
              Authorized callback / redirect URI
              <div className="connection-copy-field">
                <input
                  aria-label="Shared authorization callback"
                  value={catalog.redirectUri}
                  readOnly
                  onFocus={(event) => event.target.select()}
                />
                <Button
                  disabled={!catalog.redirectUri}
                  aria-label="Copy shared callback"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(catalog.redirectUri);
                      setCopied(true);
                    } catch {
                      setError('Select the generated address and copy it manually.');
                    }
                  }}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </Button>
              </div>
              <small>
                The app generates this value from its production address. Existing service callbacks
                remain supported for older authorizations.
              </small>
            </label>
            {(!catalog.encryptionConfigured || !catalog.originConfigured) && (
              <p className="form-error">
                {!catalog.encryptionConfigured
                  ? 'Secure server credential storage must be configured before saving applications. '
                  : ''}
                {!catalog.originConfigured
                  ? 'The server production address must be configured before authorization can begin.'
                  : ''}
              </p>
            )}
          </section>
          <div className="connection-application-grid">
            {catalog.applications.map((application) => (
              <article className="panel connection-application-card" key={application.id}>
                <div className="connection-application-title">
                  <div
                    className={`connection-provider-symbol connection-provider-${application.id}`}
                  >
                    <LockKeyhole size={22} />
                  </div>
                  <h3>{application.name}</h3>
                  <Badge tone={application.configured ? 'green' : 'amber'}>
                    {application.configured ? 'Credentials saved' : 'Setup required'}
                  </Badge>
                </div>
                <p className="connection-application-services">
                  {application.services.map((service) => service.name).join(' · ')}
                </p>
                <p className="connection-detail-note">
                  {application.credentialsSource === 'environment'
                    ? 'Managed in the secure deployment environment. No credentials are displayed here.'
                    : application.credentialsSource === 'workspace'
                      ? 'Stored encrypted in this workspace. Saved secrets are never returned to the browser.'
                      : 'Register an application with this provider, then save its client ID and secret once.'}
                </p>
                {application.error && (
                  <p className="connection-provider-error">{application.error}</p>
                )}
                <div className="connection-provider-actions">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!application.canConfigure}
                    onClick={() => setSelected(application)}
                  >
                    <Settings2 size={15} />
                    {application.configured
                      ? 'Update shared application'
                      : `Configure ${application.name}`}
                  </Button>
                  <a
                    href={application.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-link"
                  >
                    Provider registration <ArrowUpRight size={14} />
                  </a>
                </div>
                <details className="connection-application-requirements">
                  <summary>Service access requirements</summary>
                  {application.services.map((service) => (
                    <section key={service.id}>
                      <h4>{service.name}</h4>
                      <ul>
                        {service.requirements.map((requirement) => (
                          <li key={requirement}>{requirement}</li>
                        ))}
                      </ul>
                      <a href={service.docsUrl} target="_blank" rel="noreferrer">
                        Official instructions <ArrowUpRight size={13} />
                      </a>
                    </section>
                  ))}
                </details>
              </article>
            ))}
          </div>
          <p className="connection-detail-note">
            This workspace uses the providers’ own consent flows. No paid connection service is
            added. Account eligibility, scopes, and provider approval still determine the actions
            available.
          </p>
        </>
      )}
      {selected && (
        <ApplicationSettings
          application={selected}
          onClose={() => setSelected(null)}
          onComplete={async () => {
            setSelected(null);
            await load();
            await onUpdated();
          }}
        />
      )}
    </section>
  );
}

function ApplicationSettings({
  application,
  onClose,
  onComplete,
}: {
  application: ApplicationSetup;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const { mutate, toast } = useWorkspace();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [loginCustomerId, setLoginCustomerId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await mutate(`/connections/applications/${application.id}`, 'PUT', {
        ...(clientId.trim() ? { clientId: clientId.trim() } : {}),
        ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
        ...(application.id === 'google' && loginCustomerId.trim()
          ? { loginCustomerId: loginCustomerId.trim() }
          : {}),
      });
      setClientSecret('');
      toast(`${application.name} application saved. Return to Accounts & Pages to connect.`);
      await onComplete();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`${application.name} shared application`}
      onClose={() => {
        if (!busy) onClose();
      }}
      className="connection-setup-modal"
    >
      <form className="stack" onSubmit={save}>
        <Badge tone="violet">Workspace owner only</Badge>
        <p className="connection-summary">
          These credentials identify the workspace’s {application.name} application. They apply to
          every {application.name} service and account here. The return address is already generated
          in Application administration.
        </p>
        <label className="field">
          {application.id === 'meta' ? 'Meta app ID' : 'OAuth client ID'}
          <input
            required={!application.configured}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            value={clientId}
            maxLength={512}
            placeholder={
              application.configured
                ? 'Leave blank to keep the saved ID'
                : 'Application ID from the provider console'
            }
            onChange={(event) => setClientId(event.target.value)}
          />
        </label>
        <label className="field">
          {application.id === 'meta' ? 'Meta app secret' : 'OAuth client secret'}
          <input
            required={!application.configured}
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            disabled={busy}
            value={clientSecret}
            maxLength={4096}
            onChange={(event) => setClientSecret(event.target.value)}
          />
          <small>Saved encrypted on the server. Leave blank to keep a saved secret.</small>
        </label>
        {application.id === 'google' && (
          <details className="connection-scopes">
            <summary>Optional Google Ads manager account</summary>
            <label className="field">
              Manager customer ID
              <input
                value={loginCustomerId}
                disabled={busy}
                inputMode="numeric"
                pattern="[0-9]{10}"
                maxLength={10}
                autoComplete="off"
                placeholder="10 digits, only when applicable"
                onChange={(event) => setLoginCustomerId(event.target.value)}
              />
              <small>
                Used when your authorized Ads accounts belong to this manager hierarchy. Leave blank
                to retain the existing value.
              </small>
            </label>
          </details>
        )}
        <div className="modal-note">
          <LockKeyhole size={19} />
          <span>
            {application.configured
              ? 'Changing the application ID requires connected accounts in this family to authorize again. Existing publishing destinations keep their identity.'
              : 'Register the shared callback and obtain the required provider access before expecting consent and discovery to succeed.'}
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
          <Button type="submit" variant="primary" disabled={busy || !application.canConfigure}>
            {busy ? 'Saving securely…' : 'Save shared application'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
