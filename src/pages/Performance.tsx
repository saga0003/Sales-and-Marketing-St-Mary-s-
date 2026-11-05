import { useEffect, useState } from 'react';
import { Link2 } from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import { Button, PageHeading } from '../components/UI';
import WebsiteAnalytics from '../components/WebsiteAnalytics';
import PlatformAnalytics from '../components/PlatformAnalytics';
import OwnedSiteChecks from '../components/OwnedSiteChecks';
import AnswerVisibility from '../components/AnswerVisibility';
import KeywordTracking from '../components/KeywordTracking';
import '../styles/performance.css';

const tabs = [
  { id: 'website', label: 'Website analytics' },
  { id: 'channels', label: 'Social & local' },
  { id: 'ads', label: 'Ads reports' },
  { id: 'search', label: 'Search Console' },
  { id: 'keywords', label: 'Keyword trends' },
  { id: 'checks', label: 'Website checks' },
  { id: 'answers', label: 'AI answer visibility' },
] as const;
type PerformanceTab = (typeof tabs)[number]['id'];
function readTab(): PerformanceTab {
  const tab = new URLSearchParams(window.location.hash.split('?')[1]).get('tab');
  return tabs.some((item) => item.id === tab) ? (tab as PerformanceTab) : 'website';
}
export default function Performance() {
  const { navigate } = useWorkspace();
  const [tab, setTab] = useState<PerformanceTab>(readTab);
  useEffect(() => {
    const changed = () => setTab(readTab());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  return (
    <div className="performance-page">
      <PageHeading
        eyebrow="MEASURE, LEARN, IMPROVE"
        title="Performance"
        description="Your connected reports, website checks, and recorded answer visibility—with the source and date behind every result."
        actions={
          <Button onClick={() => navigate('settings')}>
            <Link2 size={16} />
            Manage connections
          </Button>
        }
      />
      <div className="toolbar">
        <div className="tabs" aria-label="Performance section">
          {tabs.map((item) => (
            <button
              className={`tab ${tab === item.id ? 'active' : ''}`}
              key={item.id}
              aria-pressed={tab === item.id}
              onClick={() => {
                setTab(item.id);
                window.location.hash = `performance?tab=${item.id}`;
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'website' && <WebsiteAnalytics />}
      {tab === 'channels' && (
        <PlatformAnalytics
          providers={[
            'instagram',
            'facebook',
            'youtube',
            'linkedin',
            'linkedin_member',
            'google_business',
          ]}
          title="Social and local reports"
          description="Import authorized account metrics. Each platform uses its own definitions, so its reports remain attributed to the source account."
        />
      )}
      {tab === 'ads' && (
        <PlatformAnalytics
          providers={['meta_ads', 'google_ads']}
          title="Advertising reports"
          description="Review reported spend, delivery, clicks, and conversions in the account’s currency. These connections read reports and do not create campaigns or change budgets."
        />
      )}
      {tab === 'search' && (
        <PlatformAnalytics
          providers={['search_console']}
          title="Google Search Console"
          description="Read your website’s search clicks, impressions, queries, and pages. Reporting reflects the selected property and imported period."
        />
      )}
      {tab === 'checks' && <OwnedSiteChecks />}
      {tab === 'keywords' && <KeywordTracking />}
      {tab === 'answers' && <AnswerVisibility />}
    </div>
  );
}
