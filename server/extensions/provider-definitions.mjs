const google = 'https://www.googleapis.com/auth/';

// Each service asks for its own scopes even when it shares application credentials.
// A configured application is not proof of account access or provider approval.
export const PROVIDERS = {
  google: {
    id: 'google',
    name: 'Google Analytics 4',
    credentialGroup: 'google',
    scopes: [`${google}analytics.readonly`],
    capabilities: ['analytics:read'],
    docsUrl:
      'https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart-client-libraries',
    description:
      'Read website traffic, top pages, acquisition sources and key events from a GA4 property.',
    requirements: [
      'Create one Google Cloud OAuth web application and register every Google callback URL you intend to use.',
      'Enable the Google Analytics Admin API and Google Analytics Data API.',
      'Authorize a Google account with access to the school’s GA4 property. Connecting an account does not install GA4 on your website.',
    ],
  },
  search_console: {
    id: 'search_console',
    name: 'Google Search Console',
    credentialGroup: 'google',
    scopes: [`${google}webmasters.readonly`],
    capabilities: ['analytics:read'],
    docsUrl: 'https://developers.google.com/webmaster-tools/v1/searchanalytics/query',
    description:
      'Import search clicks, impressions, queries and pages for a verified website property.',
    requirements: [
      'Reuse your Google OAuth app and add this callback URL.',
      'Enable the Google Search Console API and verify the website in Search Console.',
      'The authorizing Google account needs access to that property. This connection reads reports and does not change indexing.',
    ],
  },
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    credentialGroup: 'google',
    scopes: [
      `${google}youtube.readonly`,
      `${google}yt-analytics.readonly`,
      `${google}youtube.upload`,
    ],
    capabilities: ['analytics:read', 'publish:video', 'account:read'],
    docsUrl: 'https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps',
    description:
      'Import channel analytics and upload an approved MP4 video to your selected channel.',
    requirements: [
      'Enable YouTube Data API v3 and YouTube Analytics API in your Google project; add this callback URL.',
      'Authorize the identity that owns the intended YouTube channel or Brand Account. Verify the selected channel before approving uploads.',
      'Provider verification, quota and account restrictions still apply. Upload visibility and made-for-kids settings are part of the approved content.',
    ],
  },
  google_business: {
    id: 'google_business',
    name: 'Google Business Profile',
    credentialGroup: 'google',
    scopes: [`${google}business.manage`],
    capabilities: ['analytics:read', 'publish:text', 'publish:image', 'account:read'],
    docsUrl: 'https://developers.google.com/my-business/content/basic-setup',
    description:
      'Select a school location, import profile performance and publish an approved business update.',
    requirements: [
      'Request Business Profile API access for your Google Cloud project. A zero quota means access is not yet approved.',
      'Enable Account Management, Business Information, Business Profile Performance and Google My Business APIs; register this callback.',
      'Authorize an owner or manager of the verified school location. Some business types or locations cannot create local posts.',
    ],
  },
  google_ads: {
    id: 'google_ads',
    name: 'Google Ads',
    credentialGroup: 'google',
    scopes: [`${google}adwords`],
    capabilities: ['analytics:read'],
    docsUrl: 'https://developers.google.com/google-ads/api/docs/api-policy/developer-token',
    description:
      'Read campaign spend, impressions, clicks and configured conversions without changing ads or budgets.',
    credentialFields: [
      {
        key: 'loginCustomerId',
        label: 'Manager customer ID (if applicable)',
        required: false,
        secret: false,
        placeholder: '10 digits, no hyphens',
      },
    ],
    requirements: [
      'Enable Google Ads API in the Google project that owns your OAuth app, and obtain the access level needed for production accounts.',
      'Google’s current access flow is managed in Cloud Console. Legacy developer tokens are optional; they are no longer required for new setup.',
      'For access through a manager account, save its 10-digit customer ID. The Google Ads permission is broad, but this app implements report queries only.',
    ],
  },
  instagram: {
    id: 'instagram',
    name: 'Instagram',
    credentialGroup: 'meta',
    scopes: [
      'pages_show_list',
      'pages_read_engagement',
      'instagram_basic',
      'instagram_content_publish',
      'instagram_manage_insights',
    ],
    capabilities: [
      'analytics:read',
      'publish:image',
      'publish:carousel',
      'publish:video',
      'account:read',
    ],
    docsUrl:
      'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/',
    description:
      'Import professional-account insights and publish approved images, carousels or Reels.',
    requirements: [
      'Use a Meta app with Facebook Login and register every Meta callback URL you intend to use.',
      'Connect a professional Instagram account linked to a Facebook Page that you manage.',
      'Grant the listed permissions; advanced access/app review or eligible app-role testing is required. Reconnect an older authorization to enable new scopes.',
    ],
  },
  facebook: {
    id: 'facebook',
    name: 'Facebook Pages',
    credentialGroup: 'meta',
    scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'read_insights'],
    capabilities: ['analytics:read', 'publish:text', 'publish:image', 'account:read'],
    docsUrl: 'https://developers.facebook.com/docs/pages-api/posts/',
    description:
      'Read recent Page posts and engagement snapshots, and publish an approved text or image post.',
    requirements: [
      'Reuse the Meta app, add this callback URL, and obtain the listed Page permissions.',
      'Authorize a person with sufficient Page access and select the exact Page.',
      'This connection publishes to Pages, not personal Facebook profiles. Provider app review/access rules still apply.',
    ],
  },
  meta_ads: {
    id: 'meta_ads',
    name: 'Meta Ads',
    credentialGroup: 'meta',
    scopes: ['ads_read'],
    capabilities: ['analytics:read'],
    docsUrl: 'https://developers.facebook.com/docs/marketing-api/insights/',
    description:
      'Read ad-account and campaign performance with the account currency and provider attribution.',
    requirements: [
      'Enable the Marketing API use case in your Meta app and register this callback.',
      'Obtain ads_read access and authorize a person who can view the intended ad account.',
      'This adapter imports reports only. It cannot create campaigns, change budgets or spend money.',
    ],
  },
  linkedin: {
    id: 'linkedin',
    name: 'LinkedIn Pages',
    credentialGroup: 'linkedin',
    scopes: ['rw_organization_admin', 'r_organization_social', 'w_organization_social'],
    capabilities: ['analytics:read', 'publish:text', 'publish:image', 'account:read'],
    docsUrl: 'https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access',
    description:
      'Select an administered organization, import Page statistics and publish an approved post.',
    requirements: [
      'Create a LinkedIn developer app, verify its associated Page and register this callback.',
      'Request Community Management API access and the listed organization scopes.',
      'Authorize a person with an eligible Page administration role. LinkedIn decides development/standard access; connecting here cannot bypass that decision.',
    ],
  },
  linkedin_member: {
    id: 'linkedin_member',
    name: 'LinkedIn personal profile',
    credentialGroup: 'linkedin',
    scopes: ['openid', 'profile', 'w_member_social'],
    capabilities: ['publish:text', 'publish:image', 'account:read'],
    docsUrl:
      'https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin',
    description:
      'Publish an approved text or image post as the member who authorizes the connection.',
    requirements: [
      'Enable Sign In with LinkedIn using OpenID Connect and Share on LinkedIn for your developer app.',
      'Register this callback URL and authorize the profile owner.',
      'Member analytics/read-back access is not included in self-serve Share on LinkedIn. Ambiguous delivery must be inspected before a new post is created.',
    ],
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);
export const providerGroup = (id) => PROVIDERS[id]?.credentialGroup;
export const credentialKey = (id) =>
  providerGroup(id) === 'meta' ? 'instagram' : providerGroup(id);
export const platformFor = (id) =>
  ({ google_business: 'google_business', linkedin_member: 'linkedin' })[id] ?? id;
