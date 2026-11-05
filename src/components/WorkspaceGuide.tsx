import { useState } from 'react';
import {
  ArrowUpRight,
  Bell,
  Bot,
  BookOpen,
  CheckCircle2,
  Database,
  Link2,
  ShieldCheck,
  UserRoundPlus,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import { Badge, Button, Modal } from './UI';
import '../styles/guide.css';

const repository = 'https://github.com/saga0003/Sales-and-Marketing-St-Mary-s-/blob/main/docs/';
export default function WorkspaceGuide({ onClose }: { onClose: () => void }) {
  const { navigate } = useWorkspace();
  const [tab, setTab] = useState<
    'start' | 'test' | 'connect' | 'research' | 'keywords' | 'storage'
  >('start');
  const tabs = [
    { id: 'start', label: 'Start here' },
    { id: 'test', label: 'Test with your team' },
    { id: 'connect', label: 'Connect accounts' },
    { id: 'research', label: 'Research & competitors' },
    { id: 'keywords', label: 'Keywords & ChatGPT' },
    { id: 'storage', label: 'Storage & access' },
  ] as const;
  const go = (view: 'settings' | 'content' | 'intelligence' | 'performance', tab?: string) => {
    onClose();
    navigate(view);
    if (tab) window.location.hash = `${view}?tab=${tab}`;
  };
  return (
    <Modal title="Your workspace guide" onClose={onClose} className="workspace-guide-modal">
      <div className="guide-tabs tabs" aria-label="Guide sections">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`tab ${tab === item.id ? 'active' : ''}`}
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === 'start' && (
        <div className="guide-section">
          <span className="guide-symbol">
            <BookOpen size={26} />
          </span>
          <h3>One place to plan, review, and learn.</h3>
          <p>Choose your school in the header, then use the main sections to keep work moving.</p>
          <dl className="guide-map">
            <div>
              <dt>Content</dt>
              <dd>Drafts, media, manager review, calendar, and publishing jobs.</dd>
            </div>
            <div>
              <dt>Intelligence</dt>
              <dd>
                Official notices, webpage changes, competitor research, exams and career paths.
              </dd>
            </div>
            <div>
              <dt>Performance</dt>
              <dd>
                Connected analytics, daily keyword trends, ad reports, website checks and answer
                evidence.
              </dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>Tasks and shared documents with structured blocks and saved history.</dd>
            </div>
            <div>
              <dt>Settings</dt>
              <dd>
                Connected accounts, team access, ChatGPT, storage usage and notification
                preferences.
              </dd>
            </div>
          </dl>
          <div className="guide-note">
            <Bell size={20} />
            <p>
              Enable sound in the notification inbox or Settings → Preferences. Keep the workspace
              open to receive alerts; unread updates remain saved for your next visit.
            </p>
          </div>
        </div>
      )}
      {tab === 'test' && (
        <div className="guide-section">
          <span className="guide-symbol">
            <UserRoundPlus size={26} />
          </span>
          <h3>A safe test with two roles</h3>
          <p>
            Use your manager account in one browser and a contributor account in another browser
            profile or private window.
          </p>
          <ol className="guide-steps">
            <li>
              <strong>Create the test member.</strong> In Settings → Team & access, add a name, a
              second email you control, and the Contributor role. A supported email alias can also
              work. The address is a sign-in identifier; the app does not send an email
              automatically.
            </li>
            <li>
              <strong>Copy the personal setup link.</strong> Open it in the second browser and
              choose a password of at least 12 characters. The link expires after 24 hours and works
              once. Your account and the app remain available afterward.
            </li>
            <li>
              <strong>Enable notifications in both browsers.</strong> Turn on sound with the bell.
              Leave both workspaces open. If the browser asks for desktop permission, choose whether
              to allow it.
            </li>
            <li>
              <strong>Submit as the contributor.</strong> Create a post, upload media, save, and
              send for review. Leave publishing destinations empty for this test.
            </li>
            <li>
              <strong>Review as the manager.</strong> Within about 20 seconds in a visible tab, the
              submission should appear in the inbox. Open it, add a comment, and request changes.
            </li>
            <li>
              <strong>Revise and approve.</strong> The contributor sees the decision, edits, and
              resubmits. Approve the new revision. Editing approved content clears that approval.
              With no destination, this does not publish publicly.
            </li>
            <li>
              <strong>Check persistence and cleanup.</strong> Reload and reopen the saved draft and
              notification history. Deactivate the test member when finished; their saved work and
              decisions remain available.
            </li>
          </ol>
          <div className="guide-note">
            <ShieldCheck size={20} />
            <p>
              If the hosting platform asks for access before the app opens, use the access link
              supplied by your manager. Vercel access and your workspace sign-in are separate.
            </p>
          </div>
          <Button variant="primary" onClick={() => go('settings', 'team')}>
            Open team settings <ArrowUpRight size={16} />
          </Button>
        </div>
      )}
      {tab === 'connect' && (
        <div className="guide-section">
          <span className="guide-symbol">
            <Link2 size={26} />
          </span>
          <h3>Set up the application once. Connect accounts as needed.</h3>
          <p>
            The first connection needs a developer application registered with Google, Meta, or
            LinkedIn. The workspace owner manages that setup in Application administration. Once the
            shared application and required approvals are in place, a manager can connect a school’s
            account in a few steps.
          </p>
          <ol className="guide-steps">
            <li>
              <strong>Owner setup, once.</strong> Settings → Connections → Application
              administration shows three shared groups and a generated callback address. Ordinary
              connection cards never ask staff for secrets or callback URLs.
            </li>
            <li>
              <strong>Choose Connect account.</strong> Select the institution. The provider opens
              its own secure sign-in and permission screen.
            </li>
            <li>
              <strong>Review and grant consent.</strong> The account owner selects the requested
              permissions. The software cannot grant itself access to your accounts.
            </li>
            <li>
              <strong>Select the resources.</strong> Choose one or more properties, Pages, channels,
              locations or ad accounts, then save and test access. Each selected resource has its
              own report and publishing destination.
            </li>
            <li>
              <strong>Import or publish deliberately.</strong> Import a dated report in Performance,
              or enable automatic imports on a reporting account. Automatic imports use a 28-day
              window with a two-day reporting lag. For publishing, choose an eligible account in the
              post composer and approve the exact revision and media before queuing it.
            </li>
          </ol>
          <p className="guide-note-text">
            Account ownership, enabled APIs, provider app review, quotas, and account eligibility
            can add steps. Google services need their APIs enabled for the application. Organization
            publishing on LinkedIn requires the corresponding product access. No ad budget or
            spending is changed by the reporting connections.
          </p>
          <Button variant="primary" onClick={() => go('settings')}>
            Open connections <ArrowUpRight size={16} />
          </Button>
          <a
            className="text-link"
            href={`${repository}CONNECTIONS-V04.md`}
            target="_blank"
            rel="noreferrer"
          >
            Full provider setup guide <ArrowUpRight size={15} />
          </a>
        </div>
      )}
      {tab === 'research' && (
        <div className="guide-section">
          <span className="guide-symbol">
            <CheckCircle2 size={26} />
          </span>
          <h3>Turn a source update into a reviewed story.</h3>
          <ol className="guide-steps">
            <li>
              <strong>Add an official source or competitor.</strong> Use the source catalog or a
              saved notice/feed URL. YouTube monitoring uses an exact channel ID. A profile bookmark
              alone is not a scheduled watch.
            </li>
            <li>
              <strong>Configure a watch.</strong> Choose its supported mode, keywords, and checking
              interval. A manager can run it immediately and inspect the last check or error.
            </li>
            <li>
              <strong>Review the detected notice.</strong> The first scan establishes a baseline. A
              detected date does not prove the notice was published that day.
            </li>
            <li>
              <strong>Create a research brief.</strong> Check the original source, exam/session,
              dates, seat counts, and eligibility. A manager verifies the facts before they become
              publishable content.
            </li>
            <li>
              <strong>Draft for your audience.</strong> Add your school’s useful explanation or next
              step. Send it through the normal review and approval process.
            </li>
          </ol>
          <div className="guide-note">
            <ShieldCheck size={20} />
            <p>
              YouTube public uploads and supported official notice pages can be checked
              automatically. Other social competitor profiles remain manual where the platform does
              not provide authorized access. Private analytics and competitor ad spend are not
              available from a public profile link.
            </p>
          </div>
          <p>
            Website checks inspect a verified owned page. The AEO/GEO section records repeatable
            prompts, observed answers, mentions, citations, and evidence; it does not invent an AI
            ranking or run consumer AI accounts in the background.
          </p>
          <p>
            Use <strong>Research queue</strong> to queue a GMB or social-profile investigation, open
            it in ChatGPT and save dated evidence. A queued request has not yet inspected the
            account. Use <strong>Exams & careers</strong> for multiple exam descriptions, official
            references, linked watches and Science or Commerce entry routes. New source changes
            clear earlier guidance verification.
          </p>
          <Button variant="primary" onClick={() => go('intelligence')}>
            Open intelligence <ArrowUpRight size={16} />
          </Button>
        </div>
      )}
      {tab === 'keywords' && (
        <div className="guide-section">
          <span className="guide-symbol">
            <Bot size={26} />
          </span>
          <h3>Follow keyword movement. Bring ChatGPT into the workflow.</h3>
          <ol className="guide-steps">
            <li>
              <strong>Add your keywords.</strong> Performance → Keyword trends saves the exact
              keyword, school, property, country and device. Connect Search Console and enable daily
              checks for automatic history. Finalized provider data is several days behind today;
              gaps are not zero.
            </li>
            <li>
              <strong>Read the trend.</strong> Each keyword has a small line graph and an
              improvement or decline label. Lower search position is better. Team and MCP
              observations remain in a separate evidence view.
            </li>
            <li>
              <strong>Record answer evidence.</strong> Save the actual model, prompt, date, answer,
              school mention and citation. AEO/GEO trends compare matching contexts and do not
              represent a universal AI rank.
            </li>
            <li>
              <strong>Connect ChatGPT.</strong> Copy the server URL in Settings → ChatGPT & MCP. In
              ChatGPT Plugins, add a custom MCP server with OAuth, then sign in and choose reading,
              draft or research permissions.
            </li>
            <li>
              <strong>Ask it to work on a request.</strong> ChatGPT can read saved research, inspect
              sources in its session and save cited findings or drafts. Manager verification and
              publication approval remain in this workspace.
            </li>
          </ol>
          <p className="guide-note-text">
            No automatic OpenAI API calls are made. Your ChatGPT plan limits still apply. MCP does
            not wake ChatGPT or run paid background searches. MFA is deferred.
          </p>
          <Button variant="primary" onClick={() => go('performance', 'keywords')}>
            Open keyword trends <ArrowUpRight size={16} />
          </Button>
          <Button onClick={() => go('settings', 'mcp')}>
            Open ChatGPT connection <ArrowUpRight size={16} />
          </Button>
        </div>
      )}
      {tab === 'storage' && (
        <div className="guide-section">
          <span className="guide-symbol">
            <Database size={26} />
          </span>
          <h3>Where your work is kept</h3>
          <dl className="guide-map">
            <div>
              <dt>Images and videos</dt>
              <dd>
                Private Supabase Storage. Authenticated previews and time-limited delivery links are
                used when an approved publishing job needs media.
              </dd>
            </div>
            <div>
              <dt>Drafts, reviews, tasks, documents, and notifications</dt>
              <dd>
                Supabase PostgreSQL. A browser copy of an unsent draft is separate from a saved
                shared draft.
              </dd>
            </div>
            <div>
              <dt>Workspace login</dt>
              <dd>
                The app’s own email/password authentication is backed by Supabase PostgreSQL.
                Supabase Auth is not the login provider in this release.
              </dd>
            </div>
            <div>
              <dt>Google, Meta, and LinkedIn</dt>
              <dd>
                Provider authorization is separate from workspace login. A manager connects an
                account with consent. Provider credentials are encrypted on the server.
              </dd>
            </div>
            <div>
              <dt>The 24-hour activation link</dt>
              <dd>
                Only the personal setup/recovery link expires. It does not expire the website,
                deployment, or activated account. Managers can create replacement links.
              </dd>
            </div>
          </dl>
          <Badge tone="green">Saved work persists across deployments</Badge>
          <p>
            The workspace allows 512 MiB and 200 media items, including pending upload reservations.
            Images are limited to 3 MiB; videos to 40 MiB and 10 minutes. Supabase hosting and
            download quotas are separate.
          </p>
          <Button onClick={() => go('settings', 'storage')}>
            View current storage usage <ArrowUpRight size={16} />
          </Button>
        </div>
      )}
      <div className="guide-footer">
        <a
          className="text-link"
          href={`${repository}V04-USER-GUIDE.md`}
          target="_blank"
          rel="noreferrer"
        >
          Read the complete user guide <ArrowUpRight size={15} />
        </a>
        <Button onClick={onClose}>Close guide</Button>
      </div>
    </Modal>
  );
}
