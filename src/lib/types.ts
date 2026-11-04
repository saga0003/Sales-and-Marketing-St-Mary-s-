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
> & { sourceUrl?: string; mediaUrl?: string; revision?: number };
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
  demoMode: boolean;
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
}
export const institutions = [
  'St. Mary’s ISC',
  'St. Mary’s ICSE',
  'St. Mary’s State Board',
  'St. Mary’s Kids',
  'Cambridge MGS',
];
