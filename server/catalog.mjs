// A catalog is not a connection. This release never stores provider credentials,
// fetches these services, imports live metrics, or publishes externally.
export const integrations = [
  {
    id: 'meta',
    name: 'Meta',
    category: 'Social & ads',
    description:
      'Instagram and Facebook publishing, account insights and ad reporting. Live connector is not implemented in this release.',
    docsUrl: 'https://developers.facebook.com/docs/',
  },
  {
    id: 'google_ads',
    name: 'Google Ads',
    category: 'Paid marketing',
    description:
      'Campaign spend, clicks and conversions. Requires account authorization and a developer token; live connector is not implemented.',
    docsUrl: 'https://developers.google.com/google-ads/api/docs/start',
  },
  {
    id: 'search_console',
    name: 'Search Console',
    category: 'SEO',
    description:
      'Search queries, landing pages and organic performance. Live connector is not implemented.',
    docsUrl: 'https://developers.google.com/webmaster-tools/',
  },
  {
    id: 'google_analytics',
    name: 'Google Analytics',
    category: 'Analytics',
    description: 'Website traffic and enquiry events from GA4. Live connector is not implemented.',
    docsUrl: 'https://developers.google.com/analytics/devguides/reporting/data/v1',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    category: 'Social & intelligence',
    description:
      'Channel publishing and permitted public video information. Live connector is not implemented.',
    docsUrl: 'https://developers.google.com/youtube/v3',
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    category: 'Social',
    description:
      'Authorized company-page publishing and permitted insights. Live connector is not implemented.',
    docsUrl: 'https://learn.microsoft.com/en-us/linkedin/marketing/',
  },
  {
    id: 'wordpress',
    name: 'WordPress',
    category: 'Website',
    description:
      'Website drafts and publishing after manager approval. Live connector is not implemented.',
    docsUrl: 'https://developer.wordpress.org/rest-api/',
  },
  {
    id: 'odoo',
    name: 'Odoo / SalesOS',
    category: 'Admissions',
    description: 'Enquiries, visits and admissions attribution. Live connector is not implemented.',
    docsUrl: 'https://www.odoo.com/documentation/',
  },
].map((item) => Object.freeze({ ...item, status: 'not_connected' }));

export const emptyAnalytics = () => ({ sample: false, points: [], campaigns: [], channels: [] });
