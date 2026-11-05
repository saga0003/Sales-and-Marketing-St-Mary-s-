import { useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  Copy,
  Globe2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import type { SeoAudit, SeoFinding, SiteVerification } from '../lib/types';
import { formatDate } from '../lib/utils';
import { Badge, Button, EmptyState, Modal } from './UI';
import '../styles/discovery.css';

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'The website check could not be completed.';
const dateText = (value: string | null) =>
  value
    ? `${formatDate(value, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} IST`
    : 'Not checked yet';
export default function OwnedSiteChecks() {
  const { data, mutate, toast } = useWorkspace();
  const manager = data.user.role === 'manager';
  const [siteId, setSiteId] = useState('');
  const [pageUrl, setPageUrl] = useState('');
  const [register, setRegister] = useState(false);
  const [verification, setVerification] = useState<SiteVerification | null>(null);
  const [removeSite, setRemoveSite] = useState<SiteVerification | null>(null);
  const [auditId, setAuditId] = useState('');
  const [localAudit, setLocalAudit] = useState<SeoAudit | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [addedTasks, setAddedTasks] = useState<string[]>([]);
  const sites = data.intelligence.siteVerifications;
  const site = sites.find((item) => item.id === siteId) || sites[0];
  const audits = data.intelligence.seoAudits.filter((item) => item.siteId === site?.id);
  const audit =
    localAudit?.siteId === site?.id
      ? localAudit
      : audits.find((item) => item.id === auditId) || audits[0];
  async function run() {
    if (!site) return;
    setBusy('audit');
    setError('');
    try {
      const result = await mutate<{ audit: SeoAudit }>(
        `/intelligence/sites/${site.id}/audit`,
        'POST',
        { url: pageUrl.trim() || site.origin },
      );
      setLocalAudit(result.audit);
      setAuditId(result.audit.id);
      toast('Website page checked. Review each finding and its evidence.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('');
    }
  }
  async function addTask(finding: SeoFinding) {
    if (!audit) return;
    setBusy(finding.id);
    setError('');
    try {
      await mutate('/tasks', 'POST', {
        title: `${finding.title}: ${audit.url}`.slice(0, 180),
        owner: data.user.name,
        dueDate: new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(Date.now() + 7 * 86400000)),
        status: 'todo',
        priority: finding.severity === 'issue' ? 'high' : 'medium',
      });
      setAddedTasks((current) => [...current, `${audit.id}:${finding.id}`]);
      toast('Website follow-up added to Tasks.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="discovery-section">
      <div className="report-section-heading">
        <div>
          <h2>Website checks</h2>
          <p>
            Inspect a page on a website your team controls. Turn concrete findings into tasks, then
            check again after making changes.
          </p>
        </div>
        {manager && (
          <Button variant="primary" onClick={() => setRegister(true)}>
            <Plus size={16} />
            Add website
          </Button>
        )}
      </div>
      <div className="discovery-note">
        <ShieldCheck size={18} />
        <p>
          Verify ownership with a file or meta tag; renew verification after 30 days. Each check
          reads one public page and respects access restrictions. It is a technical review, not a
          search-ranking prediction.
        </p>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!sites.length ? (
        <section className="panel">
          <EmptyState
            icon={<Globe2 size={30} />}
            title="Start with your school’s website"
            description="A manager adds the website and copies a public ownership challenge to its homepage or verification file. Then you can check a specific page."
            action={
              manager ? (
                <Button variant="primary" onClick={() => setRegister(true)}>
                  Add website
                </Button>
              ) : undefined
            }
          />
        </section>
      ) : (
        <>
          <section className="panel site-controls">
            <label className="field">
              Website
              <select
                value={site?.id || ''}
                onChange={(event) => {
                  setSiteId(event.target.value);
                  setPageUrl('');
                  setAuditId('');
                  setLocalAudit(null);
                  setError('');
                }}
              >
                {sites.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.origin} ·{' '}
                    {item.status === 'verified' ? 'Verified' : 'Verification needed'}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Page to check
              <input
                type="url"
                placeholder={site?.origin}
                value={pageUrl}
                onChange={(event) => setPageUrl(event.target.value)}
              />
              <small>Same website as the verified origin; leave empty for its homepage.</small>
            </label>
            <div className="site-control-actions">
              {site?.status === 'verified' ? (
                <Button variant="primary" disabled={!!busy || !manager} onClick={() => void run()}>
                  <RefreshCw size={16} className={busy === 'audit' ? 'spin' : ''} />
                  {busy === 'audit' ? 'Checking page…' : 'Check page'}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  disabled={!manager}
                  onClick={() => site && setVerification(site)}
                >
                  <ShieldCheck size={16} />
                  Verify website
                </Button>
              )}
              {site && manager && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${site.origin}`}
                  onClick={() => setRemoveSite(site)}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </section>
          {site && (
            <div className="site-status">
              <Badge tone={site.status === 'verified' ? 'green' : 'amber'}>
                {site.status === 'verified' ? 'Ownership verified' : 'Ownership not verified'}
              </Badge>
              <span>Last check: {dateText(site.lastAuditAt)}</span>
              {manager && site.status === 'verified' && (
                <button className="text-link" onClick={() => setVerification(site)}>
                  Ownership details
                </button>
              )}
            </div>
          )}
          {audits.length > 1 && (
            <label className="field site-audit-select">
              Saved checks
              <select
                value={audit?.id || ''}
                onChange={(event) => {
                  setLocalAudit(null);
                  setAuditId(event.target.value);
                }}
              >
                {audits.map((item) => (
                  <option key={item.id} value={item.id}>
                    {dateText(item.checkedAt)} · {item.url}
                  </option>
                ))}
              </select>
            </label>
          )}
          {audit ? (
            <>
              <section className="panel seo-page-summary">
                <div className="seo-page-summary-top">
                  <Badge tone="violet">HTTP {audit.statusCode}</Badge>
                  <span>Checked {dateText(audit.checkedAt)}</span>
                </div>
                <h3>{audit.title || 'No page title found'}</h3>
                <a className="text-link" href={audit.fetchedUrl} target="_blank" rel="noreferrer">
                  {audit.fetchedUrl}
                  <ArrowUpRight size={15} />
                </a>
                <p>{audit.description || 'No meta description found.'}</p>
                <dl>
                  <div>
                    <dt>Canonical URL</dt>
                    <dd>{audit.canonical || 'Not declared'}</dd>
                  </div>
                  <div>
                    <dt>Structured data types</dt>
                    <dd>
                      {audit.structuredDataTypes.length
                        ? audit.structuredDataTypes.join(', ')
                        : 'None detected'}
                    </dd>
                  </div>
                  <div>
                    <dt>Images without alt text</dt>
                    <dd>
                      {audit.imagesWithoutAlt} of {audit.imageCount}
                    </dd>
                  </div>
                  <div>
                    <dt>Page links</dt>
                    <dd>
                      {audit.internalLinkCount} internal · {audit.externalLinkCount} external
                    </dd>
                  </div>
                </dl>
              </section>
              <div className="seo-findings-header">
                <h3>Findings</h3>
                <div>
                  <Badge tone="red">
                    {audit.findings.filter((item) => item.severity === 'issue').length} issues
                  </Badge>
                  <Badge tone="amber">
                    {audit.findings.filter((item) => item.severity === 'warning').length} checks to
                    review
                  </Badge>
                  <Badge tone="green">
                    {audit.findings.filter((item) => item.severity === 'pass').length} passed checks
                  </Badge>
                </div>
              </div>
              <div className="seo-findings">
                {audit.findings.map((finding) => (
                  <article
                    className={`panel seo-finding finding-${finding.severity}`}
                    key={finding.id}
                  >
                    <span className="seo-finding-icon">
                      {finding.severity === 'pass' ? (
                        <CheckCircle2 size={21} />
                      ) : (
                        <CircleAlert size={21} />
                      )}
                    </span>
                    <div>
                      <h4>{finding.title}</h4>
                      <p>{finding.detail}</p>
                    </div>
                    {['issue', 'warning'].includes(finding.severity) && (
                      <Button
                        size="sm"
                        disabled={!!busy || addedTasks.includes(`${audit.id}:${finding.id}`)}
                        onClick={() => void addTask(finding)}
                      >
                        {addedTasks.includes(`${audit.id}:${finding.id}`) ? (
                          <Check size={15} />
                        ) : (
                          <ClipboardList size={15} />
                        )}
                        {addedTasks.includes(`${audit.id}:${finding.id}`)
                          ? 'Task added'
                          : 'Add task'}
                      </Button>
                    )}
                  </article>
                ))}
              </div>
              <details className="panel seo-heading-details">
                <summary>Page headings and crawl directives</summary>
                <p>Robots directives: {audit.robots || 'None detected in the page'}</p>
                <ol>
                  {audit.headings.map((heading, index) => (
                    <li key={index}>
                      <Badge>H{heading.level}</Badge>
                      <span>{heading.text || '(Empty heading)'}</span>
                    </li>
                  ))}
                </ol>
              </details>
            </>
          ) : (
            <section className="panel">
              <EmptyState
                icon={<SearchSymbol />}
                title={
                  site?.status === 'verified'
                    ? 'Ready for your first page check'
                    : 'Verify ownership to continue'
                }
                description={
                  site?.status === 'verified'
                    ? 'Enter a page URL and choose Check page. A saved result includes the URL, check time, and detailed findings.'
                    : 'Open Verify website to copy the exact file contents or meta tag for your website administrator.'
                }
              />
            </section>
          )}
        </>
      )}
      {register && (
        <RegisterSite
          onClose={() => setRegister(false)}
          onAdded={(added) => {
            setRegister(false);
            setSiteId(added.id);
            setVerification(added);
          }}
        />
      )}
      {verification && (
        <VerifySite
          site={
            data.intelligence.siteVerifications.find((item) => item.id === verification.id) ||
            verification
          }
          onClose={() => setVerification(null)}
        />
      )}
      {removeSite && (
        <Modal title="Remove this website?" onClose={() => !busy && setRemoveSite(null)}>
          <p>
            Remove <strong>{removeSite.origin}</strong> and its stored checks from the workspace?
            This does not change the website itself.
          </p>
          <div className="form-actions">
            <Button disabled={!!busy} onClick={() => setRemoveSite(null)}>
              Keep website
            </Button>
            <Button
              variant="danger"
              disabled={!!busy}
              onClick={async () => {
                setBusy('remove');
                try {
                  await mutate(`/intelligence/sites/${removeSite.id}`, 'DELETE');
                  setRemoveSite(null);
                  setSiteId('');
                  setLocalAudit(null);
                  toast('Website removed from checks.');
                } catch (caught) {
                  setError(errorMessage(caught));
                } finally {
                  setBusy('');
                }
              }}
            >
              Remove website
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function SearchSymbol() {
  return <Globe2 size={30} />;
}
function RegisterSite({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (site: SiteVerification) => void;
}) {
  const { mutate } = useWorkspace();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await mutate<{ site: SiteVerification }>('/intelligence/sites', 'POST', {
        url: url.trim(),
      });
      onAdded(result.site);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Add your website" onClose={() => !busy && onClose()}>
      <form className="stack" onSubmit={submit}>
        <p className="connection-summary">
          Add the exact HTTPS website origin that your school controls. Ownership verification keeps
          the checks tied to your website.
        </p>
        <label className="field">
          Website URL
          <input
            type="url"
            required
            placeholder="https://www.yourschool.edu.in"
            value={url}
            maxLength={2048}
            onChange={(event) => setUrl(event.target.value)}
            autoFocus
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
            {busy ? 'Adding…' : 'Add & get verification steps'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function VerifySite({ site, onClose }: { site: SiteVerification; onClose: () => void }) {
  const { mutate, toast } = useWorkspace();
  const [method, setMethod] = useState<'meta' | 'file'>('meta');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setError('Select the value and copy it manually.');
    }
  }
  return (
    <Modal title="Verify website ownership" onClose={() => !busy && onClose()}>
      <div className="stack">
        <p className="connection-summary">
          Your website administrator can use either method for <strong>{site.origin}</strong>. This
          is a public ownership token, not a password.
        </p>
        <div className="tabs">
          <button
            className={`tab ${method === 'meta' ? 'active' : ''}`}
            onClick={() => {
              setMethod('meta');
              setCopied(false);
            }}
          >
            Homepage meta tag
          </button>
          <button
            className={`tab ${method === 'file' ? 'active' : ''}`}
            onClick={() => {
              setMethod('file');
              setCopied(false);
            }}
          >
            Verification file
          </button>
        </div>
        {method === 'meta' ? (
          <>
            <p className="connection-summary">
              Add this tag inside the homepage’s HTML head, publish the page, and choose Verify now.
            </p>
            <label className="field">
              Exact tag
              <textarea
                readOnly
                value={site.metaTag}
                rows={3}
                onFocus={(event) => event.target.select()}
              />
            </label>
            <Button onClick={() => void copy(site.metaTag)}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied' : 'Copy meta tag'}
            </Button>
          </>
        ) : (
          <>
            <p className="connection-summary">
              Make a plain-text file available at this exact URL containing only the token below.
            </p>
            <label className="field">
              Verification file URL
              <input
                readOnly
                value={site.verificationUrl}
                onFocus={(event) => event.target.select()}
              />
            </label>
            <label className="field">
              File contents
              <input
                readOnly
                value={site.verificationToken}
                onFocus={(event) => event.target.select()}
              />
            </label>
            <Button onClick={() => void copy(site.verificationToken)}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied' : 'Copy file contents'}
            </Button>
          </>
        )}
        {site.status === 'verified' && (
          <p className="site-verified-note">
            <CheckCircle2 size={18} />
            Verified {dateText(site.verifiedAt)}. Ownership is rechecked periodically.
          </p>
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
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await mutate(`/intelligence/sites/${site.id}/verify`, 'POST', {});
                toast('Website ownership verified. You can check a page now.');
                onClose();
              } catch (caught) {
                setError(errorMessage(caught));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Checking ownership…' : 'Verify now'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
