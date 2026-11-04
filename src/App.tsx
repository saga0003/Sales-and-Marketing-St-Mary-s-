import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  Compass,
  FileText,
  Home,
  LayoutDashboard,
  LogOut,
  Plus,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { WorkspaceProvider, useWorkspace } from './lib/workspace';
import type { Role, View } from './lib/types';
import { Avatar, Badge, Button, Modal } from './components/UI';
import PostComposer from './components/PostComposer';
import Overview from './pages/Overview';
import Content from './pages/Content';
import Intelligence from './pages/Intelligence';
import Performance from './pages/Performance';
import Workspace from './pages/Workspace';
import Settings from './pages/Settings';

const navigation = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    detail: 'Your priorities and performance',
  },
  {
    id: 'content',
    label: 'Content',
    icon: CalendarDays,
    detail: 'Drafts, calendar, and approvals',
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    icon: Compass,
    detail: 'Research, competitors, and sources',
  },
  {
    id: 'performance',
    label: 'Performance',
    icon: BarChart3,
    detail: 'Social, ads, and search insights',
  },
  {
    id: 'workspace',
    label: 'Workspace',
    icon: BookOpen,
    detail: 'Team tasks and shared knowledge',
  },
] as const;

export default function App() {
  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  );
}

function Shell() {
  const { data, view, navigate, openComposer, composer, closeComposer, mutate, toast } =
    useWorkspace();
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [menu, setMenu] = useState<'profile' | 'notifications' | null>(null);
  const [changingRole, setChangingRole] = useState(false);
  const [hash, setHash] = useState(window.location.hash);
  const [compact, setCompact] = useState(
    () => localStorage.getItem('stmarys-density') === 'compact',
  );
  const mainRef = useRef<HTMLElement>(null);
  const pending = data.posts.filter((post) => post.status === 'in_review');
  const label = navigation.find((item) => item.id === view)?.label || 'Settings';
  const tab = new URLSearchParams(hash.split('?')[1]).get('tab');
  const contentTab = tab === 'approvals' || tab === 'calendar' ? tab : 'library';

  useEffect(() => {
    const changed = () => {
      setHash(window.location.hash);
      setMenu(null);
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => {
    document.title = `${label} · St. Mary’s`;
  }, [label]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const editing = /INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        if (document.querySelector('dialog[open]') && !searchOpen) return;
        event.preventDefault();
        setSearchOpen((current) => !current);
        setMenu(null);
      }
      if (event.key === 'Escape') setMenu(null);
      if (
        !editing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'n' &&
        !document.querySelector('dialog[open]')
      ) {
        event.preventDefault();
        openComposer();
        setMenu(null);
      }
    };
    const outside = (event: MouseEvent) => {
      if (!(event.target as Element).closest('[data-header-menu]')) setMenu(null);
    };
    document.addEventListener('keydown', key);
    document.addEventListener('click', outside);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('click', outside);
    };
  }, [openComposer, searchOpen]);

  function go(next: View) {
    navigate(next);
    setMenu(null);
  }
  function setDensity(value: boolean) {
    setCompact(value);
    localStorage.setItem('stmarys-density', value ? 'compact' : 'comfortable');
  }
  async function changeRole(role: Role) {
    setChangingRole(true);
    try {
      await mutate('/auth/demo-role', 'POST', { role });
      setMenu(null);
      toast(`Previewing the ${role} workspace.`, 'info');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not change the demo role.', 'error');
    } finally {
      setChangingRole(false);
    }
  }
  async function signOut() {
    try {
      await mutate('/auth/logout', 'POST');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not sign out.', 'error');
    }
  }
  function reviewQueue() {
    go('content');
    window.location.hash = 'content?tab=approvals';
  }

  return (
    <div className={`app-shell${compact ? ' compact' : ''}`}>
      <a
        href="#main-content"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="app-header">
        <a
          href="#overview"
          className="brand-lockup"
          aria-label="St. Mary’s marketing workspace home"
          onClick={(event) => {
            event.preventDefault();
            go('overview');
          }}
        >
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <div>
            <strong>ST. MARY’S</strong>
            <span>Ideas. Stories. Impact.</span>
          </div>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map(({ id, label: text, icon: Icon }) => (
            <button
              key={id}
              className={view === id ? 'active' : ''}
              aria-current={view === id ? 'page' : undefined}
              onClick={() => go(id)}
            >
              <Icon size={14} />
              <span>{text}</span>
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <button
            className="icon-button header-search"
            aria-label="Search workspace (Control or Command K)"
            title="Search workspace · Ctrl / ⌘ K"
            onClick={() => setSearchOpen(true)}
          >
            <Search size={18} />
            <kbd>⌘ K</kbd>
          </button>
          <button
            className="icon-button help-trigger"
            aria-label="Workspace guide"
            title="Workspace guide"
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp size={18} />
          </button>
          <div className="header-menu-wrap" data-header-menu>
            <button
              className="icon-button"
              aria-label={`Review notifications${pending.length ? `, ${pending.length} posts waiting` : ''}`}
              aria-expanded={menu === 'notifications'}
              onClick={() => setMenu(menu === 'notifications' ? null : 'notifications')}
            >
              <Bell size={18} />
              {pending.length > 0 && <span className="notification-dot" />}
            </button>
            {menu === 'notifications' && (
              <section className="header-popover" aria-label="Review notifications">
                <h3>Ready for a second look</h3>
                <p>
                  {pending.length
                    ? `${pending.length} drafts are waiting for review.`
                    : 'There are no drafts waiting for review.'}
                </p>
                <div className="menu-separator" />
                {pending.slice(0, 3).map((post) => (
                  <button key={post.id} className="notif-row" onClick={reviewQueue}>
                    <ShieldCheck size={17} />
                    <div>
                      <strong>{post.title}</strong>
                      <small>
                        {post.ownerName} · Revision {post.revision}
                      </small>
                    </div>
                  </button>
                ))}
                <button onClick={reviewQueue}>
                  Open approvals
                  <ArrowUpRight size={15} />
                </button>
              </section>
            )}
          </div>
          <button
            className="icon-button settings-trigger"
            aria-label="Workspace settings"
            title="Settings"
            aria-current={view === 'settings' ? 'page' : undefined}
            onClick={() => go('settings')}
          >
            <SettingsIcon size={18} />
          </button>
          <div className="header-menu-wrap" data-header-menu>
            <button
              className="profile-button"
              aria-label={`Account: ${data.user.name}, ${data.user.role}`}
              aria-expanded={menu === 'profile'}
              onClick={() => setMenu(menu === 'profile' ? null : 'profile')}
            >
              <Avatar name={data.user.name} />
            </button>
            {menu === 'profile' && (
              <section className="header-popover" aria-label="Account menu">
                <div className="popover-title">
                  <Avatar name={data.user.name} />
                  <div>
                    <strong>{data.user.name}</strong>
                    <small>
                      {data.user.role === 'manager' ? 'Workspace manager' : 'Content contributor'}
                    </small>
                  </div>
                </div>
                <p>{data.user.email}</p>
                <div className="menu-separator" />
                <button onClick={() => go('settings')}>
                  <SettingsIcon size={16} />
                  Workspace settings
                </button>
                {data.demoMode ? (
                  <>
                    <div className="menu-separator" />
                    <p>Explore team permissions</p>
                    <button
                      disabled={changingRole || data.user.role === 'manager'}
                      onClick={() => changeRole('manager')}
                    >
                      <ShieldCheck size={16} />
                      Preview as manager
                    </button>
                    <button
                      disabled={changingRole || data.user.role === 'contributor'}
                      onClick={() => changeRole('contributor')}
                    >
                      <Users size={16} />
                      Preview as contributor
                    </button>
                  </>
                ) : (
                  <button onClick={signOut}>
                    <LogOut size={16} />
                    Sign out
                  </button>
                )}
              </section>
            )}
          </div>
        </div>
      </header>
      <div className="workspace-bar">
        <div className="workspace-breadcrumb">
          <Home size={12} />
          <span>Marketing workspace</span>
          <ChevronRight size={12} />
          <strong>{label}</strong>
        </div>
        <div className="workspace-mode">
          <span className="workspace-mode-dot" />
          <span className="mode-description">
            {data.demoMode ? 'Demo workspace' : 'Team workspace'}
          </span>
          {data.demoMode ? (
            <button onClick={() => setHelpOpen(true)}>Sample data</button>
          ) : (
            <button onClick={() => go('settings')}>Local planning</button>
          )}
        </div>
      </div>
      <main ref={mainRef} id="main-content" className="app-main" tabIndex={-1}>
        {view === 'overview' && <Overview />}
        {view === 'content' && <Content initialTab={contentTab} />}
        {view === 'intelligence' && <Intelligence />}
        {view === 'performance' && <Performance />}
        {view === 'workspace' && <Workspace />}
        {view === 'settings' && <Settings compact={compact} onDensityChange={setDensity} />}
      </main>
      <footer className="app-footer">
        <span>
          <ShieldCheck size={12} />
          Saved in your workspace · All times IST
        </span>
        <span className="footer-tagline">A little clarity. A lot of possibility.</span>
        <button onClick={() => setHelpOpen(true)}>
          Workspace guide <ArrowUpRight size={11} />
        </button>
      </footer>
      {composer.open && (
        <PostComposer
          key={composer.post?.id || 'new'}
          post={composer.post}
          onClose={closeComposer}
        />
      )}
      {searchOpen && <CommandPalette onClose={() => setSearchOpen(false)} />}
      {helpOpen && (
        <Modal title="Your team’s next great story starts here" onClose={() => setHelpOpen(false)}>
          <div className="help-grid">
            <div className="help-item">
              <FileText size={23} />
              <h3>Create with context</h3>
              <p>
                Draft your caption, choose channels, and attach the official source. Save your work
                or send it for manager review.
              </p>
            </div>
            <div className="help-item">
              <ShieldCheck size={23} />
              <h3>A clear approval step</h3>
              <p>
                Managers review each revision. Changes clear the previous approval. Approved content
                can join your local plan.
              </p>
            </div>
            <div className="help-item">
              <Compass size={23} />
              <h3>Keep research close</h3>
              <p>
                Organise competitor profiles and official notices. Check the source, verify the
                facts, then turn an idea into a draft.
              </p>
            </div>
            <div className="help-item">
              <Users size={23} />
              <h3>Move work forward</h3>
              <p>
                Assign tasks, set dates, and keep school guidelines together. Use search to jump
                straight to a draft or section.
              </p>
            </div>
          </div>
          <div className="modal-note">
            <Sparkles size={18} />
            <span>
              {data.demoMode
                ? 'This is a demo workspace. Example posts, research opportunities, campaigns and charts are illustrative. Your edits are saved locally.'
                : 'Your team’s changes are saved in this workspace.'}{' '}
              Social accounts are not connected yet. Planning a date does not publish a post, and
              source bookmarks do not run automatic monitoring.
            </span>
          </div>
          <div className="help-shortcuts">
            <span>
              <kbd className="keyboard-key">Ctrl / ⌘ K</kbd> Search
            </span>
            <span>
              <kbd className="keyboard-key">N</kbd> New draft
            </span>
            <span>
              <kbd className="keyboard-key">Esc</kbd> Close dialog
            </span>
          </div>
          <div className="form-actions">
            <Button
              onClick={() => {
                setHelpOpen(false);
                go('settings');
              }}
            >
              View connections
              <ArrowUpRight size={15} />
            </Button>
            <Button variant="primary" onClick={() => setHelpOpen(false)}>
              Got it
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const { data, navigate, openComposer } = useWorkspace();
  const [query, setQuery] = useState('');
  const text = query.trim().toLowerCase();
  const sections = [
    ...navigation,
    {
      id: 'settings' as const,
      label: 'Settings',
      icon: SettingsIcon,
      detail: 'Team, connections, and preferences',
    },
  ].filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(text));
  const posts = data.posts
    .filter((post) => `${post.title} ${post.caption}`.toLowerCase().includes(text))
    .slice(0, text ? 8 : 3);
  function action(fn: () => void) {
    onClose();
    requestAnimationFrame(fn);
  }
  return (
    <Modal title="Find your next step" onClose={onClose} className="command-dialog">
      <div className="command-input">
        <Search size={21} />
        <input
          autoFocus
          aria-label="Search posts and sections"
          placeholder="Search a post or jump to a section…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}>
            <X size={15} />
          </button>
        )}
      </div>
      <div className="command-results">
        <button className="command-item" onClick={() => action(() => openComposer())}>
          <span className="command-icon">
            <Plus size={18} />
          </span>
          <div>
            <strong>Create a new post</strong>
            <small>A fresh place for your next idea</small>
          </div>
          <kbd className="keyboard-key">N</kbd>
        </button>
        {sections.map(({ id, label, icon: Icon, detail }) => (
          <button key={id} className="command-item" onClick={() => action(() => navigate(id))}>
            <span className="command-icon">
              <Icon size={18} />
            </span>
            <div>
              <strong>{label}</strong>
              <small>{detail}</small>
            </div>
            <ChevronRight size={15} />
          </button>
        ))}
        {posts.length > 0 && (
          <div className="command-group-label">{text ? 'Matching posts' : 'Recent posts'}</div>
        )}
        {posts.map((post) => (
          <button
            className="command-item"
            key={post.id}
            onClick={() => action(() => openComposer(post))}
          >
            <span className="command-icon">
              <FileText size={18} />
            </span>
            <div>
              <strong>{post.title}</strong>
              <small>
                {post.institution} · Revision {post.revision}
              </small>
            </div>
            {post.sample && <Badge>Sample</Badge>}
          </button>
        ))}
        {text && !sections.length && !posts.length && (
          <p className="command-no-results">No matching posts or sections. Try a shorter search.</p>
        )}
      </div>
      <p className="command-hint">
        Use <kbd className="keyboard-key">Tab</kbd> to move between results and{' '}
        <kbd className="keyboard-key">Enter</kbd> to open one.
      </p>
    </Modal>
  );
}
