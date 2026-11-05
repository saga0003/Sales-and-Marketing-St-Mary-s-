import { useEffect, useState } from 'react';
import { Database, ExternalLink, HardDrive, Mail, ShieldCheck } from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import { Badge, EmptyState } from './UI';
import '../styles/workspace-access.css';

type StorageState = {
  provider: string;
  projectRef: string | null;
  projectDashboard: string | null;
  committedItems: number;
  committedBytes: number;
  reservedItems: number;
  reservedBytes: number;
  capacityBytes: number;
  maxItems: number;
  remainingBytes: number;
  maxImageBytes: number;
  maxVideoBytes: number;
  activeAccounts: number;
  measuredAt: string;
};
const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KiB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
export default function StorageSettings() {
  const { data, request } = useWorkspace();
  const [state, setState] = useState<StorageState | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (data.user.role !== 'manager') return;
    let current = true;
    void request<StorageState>('/workspace/storage')
      .then((value) => {
        if (current) setState(value);
      })
      .catch((error: unknown) => {
        if (current)
          setError(error instanceof Error ? error.message : 'Storage information is unavailable.');
      });
    return () => {
      current = false;
    };
  }, [data.user.role, request]);
  if (data.user.role !== 'manager')
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Workspace storage"
        description="Your manager can view storage usage and account settings."
      />
    );
  const used = (state?.committedBytes || 0) + (state?.reservedBytes || 0);
  return (
    <div className="access-stack">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="access-columns">
        <section className="panel access-card">
          <div className="access-heading">
            <HardDrive size={22} />
            <h2>Media storage</h2>
            <Badge tone="violet">Private files</Badge>
          </div>
          {!state ? (
            <p role="status">Loading current usage…</p>
          ) : (
            <>
              <div className="access-storage-total">
                <strong>{size(used)}</strong>
                <span>of {size(state.capacityBytes)} workspace allowance</span>
              </div>
              <progress
                className="access-progress"
                aria-label="Workspace media storage used"
                value={used}
                max={state.capacityBytes}
              />
              <dl className="access-facts">
                <div>
                  <dt>Saved media</dt>
                  <dd>
                    {state.committedItems} items · {size(state.committedBytes)}
                  </dd>
                </div>
                <div>
                  <dt>Upload reservations</dt>
                  <dd>
                    {state.reservedItems} items · {size(state.reservedBytes)}
                  </dd>
                </div>
                <div>
                  <dt>Available in this workspace</dt>
                  <dd>{size(state.remainingBytes)}</dd>
                </div>
                <div>
                  <dt>Workspace item limit</dt>
                  <dd>{state.maxItems} items</dd>
                </div>
                <div>
                  <dt>Per image / per video</dt>
                  <dd>
                    {size(state.maxImageBytes)} / {size(state.maxVideoBytes)}
                  </dd>
                </div>
              </dl>
              <p className="access-note">
                Videos can be up to 10 minutes. Pending videos reserve their maximum size until
                completed or cleaned up. These are the app’s limits; the provider’s total storage
                and download quotas are separate.
              </p>
            </>
          )}
        </section>
        <section className="panel access-card">
          <div className="access-heading">
            <Database size={22} />
            <h2>Where your files live</h2>
          </div>
          <p>
            Uploaded images and videos are stored in private object storage. Drafts, reviews,
            account records and file references are stored in the application database.
          </p>
          {state?.projectRef ? (
            <>
              <dl className="access-facts">
                <div>
                  <dt>Storage provider</dt>
                  <dd>{state.provider}</dd>
                </div>
                <div>
                  <dt>Supabase project</dt>
                  <dd>
                    <code>{state.projectRef}</code>
                  </dd>
                </div>
              </dl>
              <a
                className="access-link"
                href={state.projectDashboard!}
                target="_blank"
                rel="noreferrer"
              >
                Open project dashboard <ExternalLink size={15} />
              </a>
            </>
          ) : (
            <p className="access-note">
              {state?.provider === 'unconfigured'
                ? 'Shared storage is not configured in this environment.'
                : 'This environment uses its configured storage adapter. The production dashboard identifies its Supabase project.'}
            </p>
          )}
          <p className="access-note">
            Vercel runs the app; its temporary file system is not the permanent media library.
            Download links are issued only when needed. Storage is limited, not unlimited.
          </p>
        </section>
      </div>
      <section className="panel access-card">
        <div className="access-heading">
          <Mail size={22} />
          <h2>Your app email is a login address</h2>
        </div>
        <p>
          Use an email address you already control. The app does not create an inbox or email
          hosting account. Passwords and sessions are managed by this application in PostgreSQL;
          this version does not use Supabase Auth or send email.
        </p>
        <p>
          In <strong>Team & access</strong>, a manager creates a member and shares the one-time
          setup link privately. That link lasts 24 hours and works once. After setting a password,
          the member signs in normally; the account and website do not expire with that link.
        </p>
        {state && (
          <p className="access-note">
            {state.activeAccounts} active workspace accounts. This usage view does not describe an
            unlimited hosting, email, storage or ChatGPT plan.
          </p>
        )}
      </section>
    </div>
  );
}
