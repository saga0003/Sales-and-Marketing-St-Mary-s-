export type ProviderId =
  | 'google'
  | 'search_console'
  | 'youtube'
  | 'google_business'
  | 'google_ads'
  | 'instagram'
  | 'facebook'
  | 'linkedin'
  | 'linkedin_member'
  | 'meta_ads';
export type Role = 'manager' | 'contributor';
export type Platform = 'instagram' | 'facebook' | 'youtube' | 'linkedin' | 'google_business';
export type PostStatus =
  'draft' | 'in_review' | 'changes_requested' | 'approved' | 'scheduled' | 'published' | 'rejected';
export type View =
  'overview' | 'content' | 'intelligence' | 'performance' | 'workspace' | 'settings';
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  initials: string;
  active?: boolean;
}
export interface PublicationOptions {
  youtubePrivacy?: 'private' | 'unlisted' | 'public';
  madeForKids?: boolean;
  containsSyntheticMedia?: boolean;
}
export interface Post {
  id: string;
  title: string;
  caption: string;
  platforms: Platform[];
  format: 'Post' | 'Carousel' | 'Reel' | 'Video' | 'Article';
  institution: string;
  status: PostStatus;
  scheduledAt: string | null;
  language: 'English' | 'Kannada' | 'English + Kannada';
  ownerId: string;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  approvedRevision?: number | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  feedback?: string;
  sourceUrl?: string;
  mediaUrl?: string;
  assetId?: string | null;
  assetIds?: string[];
  publicationOptions?: PublicationOptions;
  destinationIds?: string[];
  palette: 'violet' | 'navy' | 'sage' | 'peach';
  sample?: boolean;
}
export type PostInput = Pick<
  Post,
  | 'title'
  | 'caption'
  | 'platforms'
  | 'format'
  | 'institution'
  | 'scheduledAt'
  | 'language'
  | 'palette'
> & {
  sourceUrl?: string;
  mediaUrl?: string;
  assetId?: string | null;
  assetIds?: string[];
  publicationOptions?: PublicationOptions;
  destinationIds?: string[];
  revision?: number;
};
export interface Opportunity {
  id: string;
  title: string;
  summary: string;
  source: string;
  sourceUrl: string;
  category: 'Exam update' | 'Board update' | 'Medical seats' | 'Competitor' | 'Content idea';
  publishedAt: string;
  verified: boolean;
  status: 'new' | 'saved' | 'drafted' | 'dismissed';
  priority: 'high' | 'medium' | 'low';
  audience: string;
  contentAngle: string;
  sourceKind: 'official' | 'competitor' | 'sample';
}
export interface Competitor {
  id: string;
  name: string;
  platform: Platform | 'website';
  url: string;
  category: string;
  notes: string;
  monitoringStatus: 'manual' | 'ready' | 'paused';
  lastCheckedAt?: string | null;
  sample?: boolean;
}
export interface Source {
  id: string;
  name: string;
  url: string;
  category: string;
  status: 'manual' | 'ready' | 'paused';
  lastCheckedAt?: string | null;
}
export interface Task {
  id: string;
  title: string;
  owner: string;
  dueDate: string;
  status: 'todo' | 'in_progress' | 'done';
  priority: 'high' | 'medium' | 'low';
}
export interface WorkspaceDocument {
  version: number;
  id: string;
  title: string;
  category: string;
  content: string;
  updatedAt: string;
}
export interface Integration {
  id: string;
  name: string;
  category: string;
  description: string;
  status: 'not_connected' | 'configured' | 'needs_attention';
  docsUrl: string;
}
export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  entityId: string;
  createdAt: string;
  detail: string;
}
export interface Campaign {
  id: string;
  name: string;
  platform: 'Meta Ads' | 'Google Ads';
  status: 'active' | 'paused' | 'draft';
  spend: number;
  impressions: number;
  clicks: number;
  enquiries: number;
  sample: boolean;
}
export interface MetricPoint {
  date: string;
  reach: number;
  engagement: number;
  enquiries: number;
}
export interface Analytics {
  sample: boolean;
  points: MetricPoint[];
  campaigns: Campaign[];
  channels: { platform: Platform; followers: number; reach: number; engagement: number }[];
}
export interface WorkspaceData {
  user: User;
  users: User[];
  teamUsers?: User[];
  demoMode: boolean;
  evaluationMode?: boolean;
  storage?: { driver: 'postgres' | 'sqlite'; persistent: boolean };
  csrfToken: string;
  posts: Post[];
  opportunities: Opportunity[];
  competitors: Competitor[];
  sources: Source[];
  tasks: Task[];
  documents: WorkspaceDocument[];
  integrations: Integration[];
  audit: AuditEntry[];
  analytics: Analytics;
  publishingEnabled: boolean;
  providerSetup: ProviderSetup[];
  connections: Connection[];
  mediaAssets: MediaAsset[];
  publicationJobs: PublicationJob[];
  websiteAnalytics: WebsiteReport[];
  platformAnalytics: PlatformReport[];
  notifications: WorkspaceNotification[];
  unreadNotificationCount: number;
  notificationPreferences: NotificationPreferences;
  intelligence: IntelligenceData;
}
export interface ProviderSetup {
  id: ProviderId;
  credentialGroup?: 'google' | 'meta' | 'linkedin';
  docsUrl?: string;
  capabilities?: string[];
  credentialFields?: {
    key: string;
    label: string;
    required: boolean;
    secret: boolean;
    placeholder?: string;
  }[];
  name: string;
  configured: boolean;
  canConfigure: boolean;
  redirectUri: string;
  scopes: string[];
  description: string;
  requirements: string[];
  error?: string;
}
export interface Connection {
  id: string;
  provider: ProviderId;
  accountId: string | null;
  accountName: string;
  institution: string;
  status: 'awaiting_selection' | 'connected' | 'needs_attention' | 'disconnected';
  capabilities: string[];
  connectedBy: string;
  createdAt: string;
  lastTestAt: string | null;
  lastSyncAt: string | null;
  autoSync?: boolean;
  syncIntervalHours?: number;
  nextSyncAt?: string | null;
  error: string | null;
}
export interface MediaAsset {
  id: string;
  name: string;
  mimeType: string;
  kind?: 'image' | 'video';
  duration?: number | null;
  size: number;
  sha256: string;
  width: number;
  height: number;
  url: string;
  ownerId: string;
  createdAt: string;
}
export interface PublicationJob {
  id: string;
  postId: string;
  revision: number;
  connectionId: string;
  accountName: string;
  platform: Platform;
  status: 'queued' | 'processing' | 'published' | 'failed' | 'needs_reconciliation' | 'cancelled';
  scheduledAt: string;
  attempts: number;
  error: string | null;
  remoteId: string | null;
  remoteUrl: string | null;
  remoteVisibility?: string | null;
  providerStatus?: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface WebsiteReport {
  connectionId: string;
  accountName: string;
  institution: string;
  provider: 'ga4';
  startDate: string;
  endDate: string;
  importedAt: string;
  totals: { users: number; sessions: number; views: number; keyEvents: number };
  daily: { date: string; users: number; sessions: number; views: number; keyEvents: number }[];
  pages: { path: string; sessions: number; views: number; keyEvents: number }[];
  sources: { source: string; sessions: number; keyEvents: number }[];
}
export const institutions = [
  'St. Mary’s ISC',
  'St. Mary’s ICSE',
  'St. Mary’s State Board',
  'St. Mary’s Kids',
  'Cambridge MGS',
];

export interface WorkspaceNotification {
  id: string;
  kind: string;
  title: string;
  message: string;
  entityType: string;
  entityId: string;
  actorName: string;
  actorId?: string;
  createdAt: string;
  readAt: string | null;
}
export interface NotificationPreferences {
  sound: boolean;
  desktop: boolean;
}
export interface NotificationInbox {
  notifications: WorkspaceNotification[];
  unreadCount: number;
  preferences: NotificationPreferences;
}
export interface PlatformReport {
  connectionId: string;
  accountName: string;
  institution: string;
  provider: ProviderId;
  startDate: string;
  endDate: string;
  importedAt: string;
  currency?: string;
  summary: {
    key: string;
    label: string;
    value: number;
    unit?: 'count' | 'currency' | 'percent' | 'seconds' | 'minutes';
  }[];
  tables: {
    key: string;
    label: string;
    columns: {
      key: string;
      label: string;
      type?: 'text' | 'number' | 'currency' | 'percent' | 'url';
    }[];
    rows: Record<string, string | number | null>[];
    truncated?: boolean;
  }[];
  notes: string[];
}
export interface IntelligenceWatch {
  id: string;
  kind: 'source' | 'competitor';
  resourceId: string;
  name: string;
  platform: string | null;
  mode: 'rss' | 'html' | 'youtube';
  url: string;
  keywords: string[];
  intervalHours: number;
  active: boolean;
  status: 'ready' | 'running' | 'paused' | 'error';
  lastCheckedAt: string | null;
  nextCheckAt: string;
  error: string | null;
  lastNewCount: number;
  noticeCount: number;
  createdAt: string;
}
export interface IntelligenceNotice {
  id: string;
  watchId: string;
  watchName: string;
  kind: 'source' | 'competitor';
  title: string;
  url: string;
  excerpt: string;
  publishedAt: string | null;
  detectedAt: string;
  updatedAt: string;
  changeKind: 'discovered' | 'updated';
  baseline: boolean;
  status: 'new' | 'saved' | 'dismissed';
  opportunityId: string | null;
  contentHash: string;
}
export interface SourceCatalogItem {
  id: string;
  name: string;
  url: string;
  category: string;
  mode: 'html' | 'rss';
  keywords: string[];
  note: string;
}
export interface SiteVerification {
  id: string;
  origin: string;
  status: 'pending' | 'verified';
  verificationUrl: string;
  verificationToken: string;
  metaTag: string;
  verifiedAt: string | null;
  lastAuditAt: string | null;
}
export interface SeoFinding {
  id: string;
  severity: 'issue' | 'warning' | 'pass' | 'info';
  title: string;
  detail: string;
}
export interface SeoAudit {
  id: string;
  siteId: string;
  url: string;
  fetchedUrl: string;
  checkedAt: string;
  statusCode: number;
  title: string;
  description: string;
  canonical: string | null;
  headings: { level: number; text: string }[];
  structuredDataTypes: string[];
  imageCount: number;
  imagesWithoutAlt: number;
  internalLinkCount: number;
  externalLinkCount: number;
  robots: string;
  findings: SeoFinding[];
}
export interface AnswerPrompt {
  id: string;
  prompt: string;
  intent: string;
  institution: string;
  locale: string;
  language: string;
  targetUrl: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface AnswerObservation {
  id: string;
  promptId: string;
  provider: string;
  model: string;
  checkedAt: string;
  answerExcerpt: string;
  mentioned: boolean;
  cited: boolean;
  citationUrls: string[];
  evidenceUrl: string;
  notes: string;
  recordedBy: string;
  createdAt: string;
  promptSnapshot?: AnswerPrompt;
}
export interface IntelligenceData {
  watches: IntelligenceWatch[];
  notices: IntelligenceNotice[];
  sourceCatalog: SourceCatalogItem[];
  siteVerifications: SiteVerification[];
  seoAudits: SeoAudit[];
  answerPrompts: AnswerPrompt[];
  answerObservations: AnswerObservation[];
  automation: { enabled: boolean; minimumIntervalHours: number; maxWatchesPerRun: number };
}
