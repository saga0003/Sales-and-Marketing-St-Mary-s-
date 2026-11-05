import { useEffect, useState, type FormEvent } from 'react';
import {
  Check,
  Bot,
  HardDrive,
  ChevronDown,
  Copy,
  History,
  KeyRound,
  Link2,
  LockKeyhole,
  Pencil,
  Plug,
  Plus,
  Settings2,
  ShieldCheck,
  UserCheck,
  UserRoundX,
  Users,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import type { Role, User } from '../lib/types';
import { Avatar, Badge, Button, EmptyState, Modal, PageHeading } from '../components/UI';
import Connections from '../components/Connections';
import McpSettings from '../components/McpSettings';
import StorageSettings from '../components/StorageSettings';
import { formatDate } from '../lib/utils';
import { NotificationSettings } from '../components/Notifications';
import '../styles/connections.css';

type TeamUser = User & { active?: boolean };
type AccessLink = { setupUrl: string; expiresAt?: string; name: string; purpose: string };
type SettingsTab = 'connections' | 'team' | 'preferences' | 'mcp' | 'storage';
const readSettingsTab = (): SettingsTab => {
  const value = new URLSearchParams(window.location.hash.split('?')[1]).get('tab');
  return value === 'team' || value === 'preferences' || value === 'mcp' || value === 'storage'
    ? value
    : 'connections';
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'We could not save this change. Please try again.';

export default function Settings({
  compact,
  onDensityChange,
}: {
  compact: boolean;
  onDensityChange: (value: boolean) => void;
}) {
  const { data, mutate, toast } = useWorkspace();
  const [tab, setTab] = useState<SettingsTab>(readSettingsTab);
  useEffect(() => {
    const changed = () => setTab(readSettingsTab());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  const [addUser, setAddUser] = useState(false);
  const [editUser, setEditUser] = useState<TeamUser | null>(null);
  const [accessLink, setAccessLink] = useState<AccessLink | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [busyUser, setBusyUser] = useState('');
  const [teamError, setTeamError] = useState('');
  const extended = data as typeof data & { teamUsers?: TeamUser[] };
  const team = extended.teamUsers || data.users;
  const isManager = data.user.role === 'manager';
  const visibleTeam = team.filter((user) => showInactive || user.active !== false);
  const activeCount = team.filter((user) => user.active !== false).length;

  async function createRecoveryLink(user: TeamUser) {
    setBusyUser(user.id);
    setTeamError('');
    try {
      const result = await mutate<{ setupUrl: string; expiresAt: string }>(
        `/users/${user.id}/setup-link`,
        'POST',
        { purpose: 'recovery' },
      );
      setAccessLink({ ...result, name: user.name, purpose: 'Password recovery' });
    } catch (error) {
      setTeamError(errorText(error));
    } finally {
      setBusyUser('');
    }
  }
  return (
    <div className="settings-page">
      <PageHeading
        eyebrow="YOUR WORKSPACE, CONNECTED"
        title="Make it yours."
        description="Connect the right accounts, bring your team together, and keep work moving."
        actions={
          <Badge tone={data.demoMode ? 'violet' : 'green'}>
            {data.demoMode ? 'Evaluation data' : 'Team workspace'}
          </Badge>
        }
      />
      <div className="connection-tabs" aria-label="Settings sections">
        {(
          [
            ['connections', 'Connections', Plug],
            ['team', 'Team & access', Users],
            ['mcp', 'ChatGPT & MCP', Bot],
            ['storage', 'Storage & access', HardDrive],
            ['preferences', 'Preferences', Settings2],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => {
              setTab(id);
              window.location.hash = `settings?tab=${id}`;
            }}
          >
            <Icon size={17} />
            {label}
            {id === 'team' && <span>{activeCount}</span>}
          </button>
        ))}
      </div>
      {tab === 'connections' && <Connections />}
      {tab === 'mcp' && <McpSettings />}
      {tab === 'storage' && <StorageSettings />}
      {tab === 'team' && (
        <div className="team-layout">
          <section className="panel settings-card team-panel">
            <div className="settings-section-heading">
              <div className="settings-title-icon">
                <Users size={21} />
                <h2>People in your workspace</h2>
              </div>
              {isManager && (
                <Button variant="primary" size="sm" onClick={() => setAddUser(true)}>
                  <Plus size={15} /> Add member
                </Button>
              )}
            </div>
            <p>Contributors prepare their own drafts. Managers review content and manage access.</p>
            {isManager && (
              <label className="team-show-inactive">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(event) => setShowInactive(event.target.checked)}
                />
                Show deactivated members
              </label>
            )}
            {teamError && (
              <p className="form-error" role="alert">
                {teamError}
              </p>
            )}
            <div className="settings-team">
              {visibleTeam.map((user) => (
                <div
                  className={`settings-member team-member${user.active === false ? ' team-member-inactive' : ''}`}
                  key={user.id}
                >
                  <Avatar name={user.name} />
                  <div className="team-member-identity">
                    <strong>
                      {user.name}
                      {user.id === data.user.id && <span> · You</span>}
                    </strong>
                    <small>{user.email}</small>
                  </div>
                  <Badge
                    tone={
                      user.active === false ? 'gray' : user.role === 'manager' ? 'violet' : 'gray'
                    }
                  >
                    {user.active === false
                      ? 'Deactivated'
                      : user.role === 'manager'
                        ? 'Manager'
                        : 'Contributor'}
                  </Badge>
                  {isManager && (
                    <div className="team-member-actions">
                      {user.active !== false && user.id !== data.user.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Create password recovery link for ${user.name}`}
                          disabled={!!busyUser}
                          onClick={() => void createRecoveryLink(user)}
                        >
                          <KeyRound size={15} />
                          <span>{busyUser === user.id ? 'Creating…' : 'Recovery link'}</span>
                        </Button>
                      )}
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Manage ${user.name}`}
                        onClick={() => setEditUser(user)}
                      >
                        <Pencil size={16} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
          <aside className="stack">
            <section className="panel settings-card settings-approval-note">
              <ShieldCheck size={25} />
              <h2>One clear approval flow.</h2>
              <p>
                Every decision belongs to a specific content revision. Changes to the story, media
                or destinations require a fresh review.
              </p>
              <span>
                <LockKeyhole size={14} /> Access is enforced when actions are saved.
              </span>
            </section>
            <section className="panel settings-card">
              <div className="settings-title-icon">
                <KeyRound size={20} />
                <h2>Your password</h2>
              </div>
              <p>Update your password and sign out previous sessions.</p>
              <Button onClick={() => setPasswordOpen(true)}>Change password</Button>
            </section>
          </aside>
        </div>
      )}
      {tab === 'preferences' && (
        <div className="settings-grid">
          <NotificationSettings />
          <section className="panel settings-card">
            <div className="settings-title-icon">
              <Settings2 size={20} />
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
                <strong>Publishing</strong>
                <small>
                  {data.publishingEnabled
                    ? 'Approved content can use eligible connected accounts'
                    : 'Connect an eligible account before publishing'}
                </small>
              </div>
              <Badge tone={data.publishingEnabled ? 'green' : 'amber'}>
                {data.publishingEnabled ? 'Available' : 'Setup required'}
              </Badge>
            </div>
            <div className="settings-row">
              <div>
                <strong>Workspace data</strong>
                <small>
                  {data.demoMode
                    ? 'Example records remain labelled throughout the app'
                    : 'Your team’s saved content and decisions'}
                </small>
              </div>
              <Badge tone={data.demoMode ? 'violet' : 'green'}>
                {data.demoMode ? 'Evaluation' : 'Team'}
              </Badge>
            </div>
          </section>
          <section className="panel settings-card">
            <div className="settings-title-icon">
              <LockKeyhole size={20} />
              <h2>Your account</h2>
            </div>
            <p>Signed in as {data.user.name}.</p>
            <div className="settings-row">
              <div>
                <strong>Email</strong>
                <small>{data.user.email}</small>
              </div>
              <Badge>{data.user.role === 'manager' ? 'Manager' : 'Contributor'}</Badge>
            </div>
            <div className="settings-row">
              <div>
                <strong>Password</strong>
                <small>Use a unique password for this workspace</small>
              </div>
              <Button size="sm" onClick={() => setPasswordOpen(true)}>
                Change
              </Button>
            </div>
          </section>
        </div>
      )}
      <section className="panel settings-audit">
        <button
          type="button"
          className="settings-audit-toggle"
          aria-expanded={auditOpen}
          onClick={() => setAuditOpen(!auditOpen)}
        >
          <History size={20} />
          <span>
            <strong>Workspace activity</strong>
            <small>Saved changes, review decisions and connection activity</small>
          </span>
          <Badge>{data.audit.length}</Badge>
          <ChevronDown size={18} className={auditOpen ? 'rotate' : ''} />
        </button>
        {auditOpen && (
          <div className="settings-audit-list">
            {data.audit.length ? (
              data.audit.slice(0, 40).map((entry) => (
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
                description="Content changes and review decisions appear as your team works."
              />
            )}
          </div>
        )}
      </section>
      {addUser && (
        <AddMember
          onClose={() => setAddUser(false)}
          onCreated={(link) => {
            setAddUser(false);
            if (link) setAccessLink(link);
          }}
        />
      )}
      {editUser && (
        <EditMember
          member={editUser}
          onClose={() => setEditUser(null)}
          onSaved={() => {
            toast('Team access updated.');
            setEditUser(null);
          }}
        />
      )}
      {accessLink && <AccessLinkDialog link={accessLink} onClose={() => setAccessLink(null)} />}
      {passwordOpen && <ChangePassword onClose={() => setPasswordOpen(false)} />}
    </div>
  );
}

function AddMember({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (link?: AccessLink) => void;
}) {
  const { mutate, toast } = useWorkspace();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('contributor');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await mutate<User & { setupUrl?: string; setupExpiresAt?: string }>(
        '/users',
        'POST',
        { name: name.trim(), email: email.trim(), role },
      );
      toast(`${name.trim()} has been added to the team.`);
      onCreated(
        result.setupUrl
          ? {
              setupUrl: result.setupUrl,
              expiresAt: result.setupExpiresAt,
              name: name.trim(),
              purpose: 'Account setup',
            }
          : undefined,
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Add someone to your team"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit} className="stack">
        <p className="connection-summary">
          They’ll use a private, single-use link to choose their own password.
        </p>
        <div className="form-grid">
          <label className="field">
            Full name
            <input
              autoFocus
              required
              maxLength={120}
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="field">
            Work email
            <input
              required
              type="email"
              maxLength={254}
              value={email}
              disabled={busy}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
            />
          </label>
        </div>
        <label className="field">
          Workspace role
          <select
            value={role}
            disabled={busy}
            onChange={(event) => setRole(event.target.value as Role)}
          >
            <option value="contributor">Contributor — create and submit own drafts</option>
            <option value="manager">Manager — review content and manage team</option>
          </select>
        </label>
        <div className="modal-note">
          <Link2 size={18} />
          <span>
            The setup link appears after saving. Share it directly with your colleague; no email is
            sent automatically.
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
            <Plus size={15} />
            {busy ? 'Adding member…' : 'Add member & create link'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditMember({
  member,
  onClose,
  onSaved,
}: {
  member: TeamUser;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data, mutate } = useWorkspace();
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState(member.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const isSelf = data.user.id === member.id;
  async function save(active?: boolean) {
    setBusy(true);
    setError('');
    try {
      await mutate(
        `/users/${member.id}`,
        'PATCH',
        active === undefined ? { name: name.trim(), role } : { active },
      );
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Manage ${member.name}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="field">
          Full name
          <input
            autoFocus
            required
            maxLength={120}
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          Workspace role
          <select
            disabled={busy || isSelf}
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
          >
            <option value="contributor">Contributor</option>
            <option value="manager">Manager</option>
          </select>
          {isSelf && <small>Your own manager role stays active.</small>}
        </label>
        {!isSelf && (
          <div className="team-access-control">
            <div>
              <strong>
                {member.active === false ? 'This account is deactivated' : 'Workspace access'}
              </strong>
              <p>
                {member.active === false
                  ? 'Reactivate this person when they need to work with the team again.'
                  : 'Deactivation signs this person out. Their content and history are retained.'}
              </p>
            </div>
            {member.active === false ? (
              <Button disabled={busy} onClick={() => void save(true)}>
                <UserCheck size={15} />
                Reactivate
              </Button>
            ) : !confirmDeactivate ? (
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmDeactivate(true)}>
                <UserRoundX size={15} />
                Deactivate
              </Button>
            ) : (
              <div className="team-deactivate-confirm" role="alert">
                <p>Deactivate {member.name} and revoke their sessions?</p>
                <div>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busy}
                    onClick={() => void save(false)}
                  >
                    Yes, deactivate
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirmDeactivate(false)}
                  >
                    Keep active
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
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
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function AccessLinkDialog({ link, onClose }: { link: AccessLink; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  let absoluteUrl = link.setupUrl;
  try {
    absoluteUrl = new URL(link.setupUrl, window.location.origin).href;
  } catch {
    /* Keep the original value visible if it cannot be resolved. */
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setCopied(true);
      setCopyError('');
    } catch {
      setCopyError('Select the link below and copy it manually.');
    }
  }
  return (
    <Modal title={`${link.purpose} link ready`} onClose={onClose}>
      <div className="stack">
        <div className="connection-success-symbol">
          <Check size={26} />
        </div>
        <p className="connection-summary">
          Share this link privately with <strong>{link.name}</strong>. They can choose a password
          and sign in.
        </p>
        <label className="field">
          Single-use access link
          <input readOnly value={absoluteUrl} onFocus={(event) => event.target.select()} />
        </label>
        {link.expiresAt && (
          <p className="connection-detail-note">
            Expires{' '}
            {formatDate(link.expiresAt, {
              day: 'numeric',
              month: 'short',
              hour: 'numeric',
              minute: '2-digit',
            })}{' '}
            IST.
          </p>
        )}
        <div className="modal-note">
          <LockKeyhole size={18} />
          <span>
            This link grants account access. It is shown only now; a manager can create a
            replacement if needed.
          </span>
        </div>
        {copyError && (
          <p className="form-error" role="alert">
            {copyError}
          </p>
        )}
        <div className="form-actions">
          <Button onClick={onClose}>Done</Button>
          <Button variant="primary" onClick={() => void copy()}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'Copied' : 'Copy private link'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ChangePassword({ onClose }: { onClose: () => void }) {
  const { mutate, toast } = useWorkspace();
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await mutate('/auth/password', 'POST', { currentPassword, password });
      toast('Password changed. Your previous sessions have been signed out.');
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Change your password"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="stack" onSubmit={submit}>
        <label className="field">
          Current password
          <input
            autoFocus
            required
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            disabled={busy}
            maxLength={256}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </label>
        <label className="field">
          New password
          <input
            required
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={256}
            disabled={busy}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <small>Use at least 12 characters.</small>
        </label>
        <label className="field">
          Repeat new password
          <input
            required
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={256}
            disabled={busy}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </label>
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
            {busy ? 'Updating…' : 'Update password'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
