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
}
export interface ProviderSetup {
  id: 'google' | 'instagram';
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
  provider: 'google' | 'instagram';
  accountId: string | null;
  accountName: string;
  institution: string;
  status: 'awaiting_selection' | 'connected' | 'needs_attention' | 'disconnected';
  capabilities: string[];
  connectedBy: string;
  createdAt: string;
  lastTestAt: string | null;
  lastSyncAt: string | null;
  error: string | null;
}
export interface MediaAsset {
  id: string;
  name: string;
  mimeType: string;
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
  platform: 'instagram';
  status: 'queued' | 'processing' | 'published' | 'failed' | 'needs_reconciliation' | 'cancelled';
  scheduledAt: string;
  attempts: number;
  error: string | null;
  remoteId: string | null;
  remoteUrl: string | null;
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
