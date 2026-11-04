import { useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  Globe,
  History,
  Link2,
  LockKeyhole,
  Mail,
  Plug,
  Plus,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import type { Integration, Role } from '../lib/types';
import { Avatar, Badge, Button, EmptyState, Modal, PageHeading } from '../components/UI';
import { formatDate, safeExternalUrl } from '../lib/utils';

export default function Settings({
  compact,
  onDensityChange,
}: {
  compact: boolean;
  onDensityChange: (value: boolean) => void;
}) {
  const { data } = useWorkspace();
  const [setup, setSetup] = useState<Integration | null>(null);
  const [addUser, setAddUser] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [category, setCategory] = useState('all');
  const categories = [...new Set(data.integrations.map((item) => item.category))];
  return (
    <div className="settings-page">
      <PageHeading
        eyebrow="A workspace that works for you"
        title="Make it yours."
        description="Your team, your preferences, and the connections that come next."
      />
      <div className="settings-grid">
        <div className="stack">
          <section className="panel settings-card">
            <div className="settings-title-icon">
              <SettingsSymbol />
              <h2>Workspace preferences</h2>
            </div>
            <p>Keep your day comfortable and your team in sync.</p>
            <div className="settings-row">
              <div>
                <strong>Display density</strong>
                <small>Applies to this browser</small>
              </div>
              <select
                aria-label="Display density"
                value={compact ? 'compact' : 'comfortable'}
                onChange={(event) => onDensityChange(event.target.value === 'compact')}
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </div>
            <div className="settings-row">
              <div>
                <strong>Planning time zone</strong>
                <small>Dates and times across the workspace</small>
              </div>
              <Badge>India · IST</Badge>
            </div>
            <div className="settings-row">
              <div>
                <strong>Publishing mode</strong>
                <small>Approved posts stay in your local plan</small>
              </div>
              <Badge tone="amber">Local only</Badge>
            </div>
            <div className="settings-row">
              <div>
                <strong>Workspace data</strong>
                <small>
                  {data.demoMode
                    ? 'Illustrative records for exploring the app'
                    : 'Your team’s saved records'}
                </small>
              </div>
              <Badge tone={data.demoMode ? 'violet' : 'green'}>
                {data.demoMode ? 'Demo' : 'Team'}
              </Badge>
            </div>
          </section>
          <section className="panel settings-card">
            <div className="settings-section-heading">
              <div className="settings-title-icon">
                <Users size={20} />
                <h2>Your team</h2>
              </div>
              {data.user.role === 'manager' && (
                <Button size="sm" onClick={() => setAddUser(true)}>
                  <Plus size={14} />
                  Add member
                </Button>
              )}
            </div>
            <p>Managers review drafts. Contributors create and submit their own work.</p>
            <div className="settings-team">
              {data.users.map((user) => (
                <div key={user.id} className="settings-member">
                  <Avatar name={user.name} />
                  <div>
                    <strong>
                      {user.name}
                      {user.id === data.user.id && <span> · You</span>}
                    </strong>
                    <small>{user.email}</small>
                  </div>
                  <Badge tone={user.role === 'manager' ? 'violet' : 'gray'}>
                    {user.role === 'manager' ? 'Manager' : 'Contributor'}
                  </Badge>
                </div>
              ))}
            </div>
          </section>
          <section className="panel settings-card settings-approval-note">
            <ShieldCheck size={24} />
            <h2>Every approval has a revision.</h2>
            <p>
              Your manager’s approval applies to the content they reviewed. Editing an approved post
              clears that approval, so the latest version always gets a second look.
            </p>
            <span>
              <LockKeyhole size={13} />
              Permissions are checked when changes are saved.
            </span>
          </section>
        </div>
        <section className="panel settings-card">
          <div className="settings-title-icon">
            <Plug size={20} />
            <h2>Your connections</h2>
          </div>
          <p>Bring publishing and live insights together as each service is connected.</p>
          <div className="settings-connection-note">
            <Link2 size={17} />
            <span>
              Connection adapters are the next build phase. No external account has been linked, and
              this app does not publish or spend on ads.
            </span>
          </div>
          <label className="settings-category">
            <span>Show connections</span>
            <select
              aria-label="Filter connections by category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="all">All categories</option>
              {categories.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <div className="integration-list">
            {data.integrations
              .filter((item) => category === 'all' || item.category === category)
              .map((item) => (
                <div className="integration-row" key={item.id}>
                  <span className="integration-symbol">
                    {/search|seo|web/i.test(item.category) ? (
                      <Globe size={19} />
                    ) : /analytic|ads/i.test(item.category) ? (
                      <BarChart3 size={19} />
                    ) : (
                      <Plug size={19} />
                    )}
                  </span>
                  <div className="integration-description">
                    <strong>{item.name}</strong>
                    <p>
                      {item.category} <span>· Not connected</span>
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setSetup(item)}>
                    View setup
                    <ArrowUpRight size={13} />
                  </Button>
                </div>
              ))}
          </div>
        </section>
      </div>
      <section className="panel settings-audit">
        <button
          className="settings-audit-toggle"
          aria-expanded={auditOpen}
          onClick={() => setAuditOpen(!auditOpen)}
        >
          <History size={20} />
          <span>
            <strong>Workspace activity</strong>
            <small>Saved changes, review decisions, and local plans</small>
          </span>
          <Badge>{data.audit.length}</Badge>
          <ChevronDown size={18} className={auditOpen ? 'rotate' : ''} />
        </button>
        {auditOpen && (
          <div className="settings-audit-list">
            {data.audit.length ? (
              data.audit.slice(0, 30).map((entry) => (
                <div key={entry.id} className="settings-audit-entry">
                  <span className="audit-dot" />
                  <div>
                    <strong>{entry.action.replaceAll('_', ' ')}</strong>
                    <p>{entry.detail}</p>
                    <small>
                      {entry.actor} ·{' '}
                      {formatDate(entry.createdAt, {
                        day: 'numeric',
                        month: 'short',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}{' '}
                      IST
                    </small>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                icon={<History size={24} />}
                title="Your activity starts here"
                description="Content changes and review decisions will appear when your team starts working."
              />
            )}
          </div>
        )}
      </section>
      {setup && <ConnectionSetup integration={setup} onClose={() => setSetup(null)} />}
      {addUser && <AddMember onClose={() => setAddUser(false)} />}
    </div>
  );
}
function SettingsSymbol() {
  return <Check size={20} />;
}

function ConnectionSetup({
  integration,
  onClose,
}: {
  integration: Integration;
  onClose: () => void;
}) {
  const docs = safeExternalUrl(integration.docsUrl);
  const isAds = /ads/i.test(integration.name);
  return (
    <Modal title={`${integration.name} connection`} onClose={onClose}>
      <Badge tone="amber">Not connected</Badge>
      <p className="connection-summary">{integration.description}</p>
      <h3>What this connection needs</h3>
      <ol className="setup-steps">
        <li>
          An administrator with access to your school’s{' '}
          {isAds ? 'advertising account' : 'account or property'} and the service’s developer
          settings.
        </li>
        <li>
          A working connection adapter, secure account authorisation, and any permissions or review
          required by the service. This adapter is not included in the current release.
        </li>
        <li>
          A small verified test with your own account, followed by checks that imported data and
          available actions match the platform’s permissions.
        </li>
      </ol>
      <div className="modal-note">
        <ShieldCheck size={18} />
        <span>
          {isAds
            ? 'The first ads connection should import reports. Campaign creation and budget changes need their own review step before they can be enabled.'
            : 'Connecting a service must not bypass manager approval. Live publishing should use the approved revision and confirm the platform result.'}
        </span>
      </div>
      <div className="form-actions">
        <Button onClick={onClose}>Close</Button>
        {docs && (
          <a className="button button-primary" href={docs} target="_blank" rel="noreferrer">
            Official documentation
            <ArrowUpRight size={15} />
          </a>
        )}
      </div>
    </Modal>
  );
}

function AddMember({ onClose }: { onClose: () => void }) {
  const { mutate, toast, data } = useWorkspace();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('contributor');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await mutate('/users', 'POST', { name: name.trim(), email: email.trim(), password, role });
      toast(`${name.trim()} has been added to the team.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this team member.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Welcome someone to your team"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit} className="stack">
        <div className="form-grid">
          <label className="field">
            Full name
            <input
              autoFocus
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="field">
            Work email
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
            />
          </label>
        </div>
        <label className="field">
          Workspace role
          <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
            <option value="contributor">Contributor — create and submit own drafts</option>
            <option value="manager">Manager — review content and manage team</option>
          </select>
        </label>
        <label className="field">
          Account password
          <input
            required
            type="password"
            minLength={12}
            maxLength={200}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <small>At least 12 characters. Share access with your team member separately.</small>
        </label>
        <div className="modal-note">
          <Mail size={17} />
          <span>
            {data.demoMode
              ? 'This account is being added to the demo database. Use illustrative details only.'
              : 'This creates a local account. An invitation email will not be sent.'}
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
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Adding member…' : 'Add team member'}
            <Plus size={15} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
