export type EducationStream = 'Science' | 'Commerce' | 'Humanities' | 'Vocational' | 'Any';
export type ReferenceLink = { label: string; url: string };
export type Milestone = { label: string; date?: string; notes: string; referenceUrl: string };
export type EntryRoute = {
  name: string;
  method: string;
  examIds: string[];
  requirements: string;
  education: string;
  outcomes: string;
  referenceUrls: string[];
};
export interface EducationRecord {
  id: string;
  name: string;
  description: string;
  academicYear: string;
  eligibilityNotes: string;
  referenceLinks: ReferenceLink[];
  revision: number;
  verification: 'verified' | 'unverified';
  verifiedAt: string | null;
  verifiedBy: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ExamRecord extends EducationRecord {
  category: 'Entrance' | 'Board' | 'Counselling' | 'Scholarship' | 'Recruitment' | 'Other';
  streams: EducationStream[];
  milestones: Milestone[];
  watchIds: string[];
  status: 'draft' | 'tracking' | 'archived';
}
export interface CareerPathway extends EducationRecord {
  stream: EducationStream;
  field: string;
  entryRoutes: EntryRoute[];
  status: 'draft' | 'active' | 'archived';
}
export interface EducationData {
  exams: ExamRecord[];
  pathways: CareerPathway[];
  streams: EducationStream[];
  starterFields: Record<EducationStream, string[]>;
}
export interface ResearchRequest {
  id: string;
  targetType: 'competitor' | 'exam';
  targetId: string;
  targetName: string;
  targetUrl: string;
  platform: string | null;
  question: string;
  status: 'pending' | 'completed' | 'cancelled';
  displayStatus: string;
  revision: number;
  requestedAt: string;
  requestedBy: string;
  updatedAt: string;
  completedAt: string | null;
  observedAt: string | null;
  resultSummary: string | null;
  evidenceUrls: string[];
  verification: 'unverified';
}
export interface RecentItem {
  title: string;
  url: string;
  publishedAt?: string;
}
export type ObservationMetrics = Partial<
  Record<'followers' | 'reviewCount' | 'rating' | 'postCount', number>
>;
export interface CompetitorObservation {
  id: string;
  competitorId: string;
  observedAt: string;
  summary: string;
  evidenceUrls: string[];
  metrics: ObservationMetrics;
  recentItems: RecentItem[];
  comparison: {
    baseline: boolean;
    historical: boolean;
    comparedWithId: string | null;
    metricChanges: { key: string; previous: number; current: number; delta: number }[];
    newItems: RecentItem[];
    summaryChanged: boolean;
  };
  requestId: string | null;
  recordedBy: string;
  recordedAt: string;
  verification: 'unverified';
}
export interface PageMonitor {
  id: string;
  competitorId: string;
  name: string;
  platform: string;
  url: string;
  intervalHours: number;
  active: boolean;
  generation: number;
  status: 'running' | 'paused' | 'error' | 'ready' | 'awaiting_baseline';
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  nextCheckAt: string;
  error: string | null;
  snapshotCount: number;
  createdAt: string;
}
export interface PageSnapshot {
  id: string;
  monitorId: string;
  generation: number;
  url: string;
  title: string;
  contentText: string;
  contentHash: string;
  baseline: boolean;
  fetchedAt: string;
  verification: 'unverified';
  comparison: {
    baseline: boolean;
    added: string[];
    removed: string[];
    addedCount: number;
    removedCount: number;
    titleChanged: boolean;
    truncated: boolean;
    scope: string;
  };
}
export interface MonitoringData {
  pageMonitors: PageMonitor[];
  researchRequests: ResearchRequest[];
  limits: {
    maxMonitors: number;
    minimumIntervalHours: number;
    maxPerRun: number;
    snapshotsPerMonitor: number;
  };
}
export interface ResearchNowResult {
  mode: 'assisted' | 'webpage' | 'youtube';
  reason?: string;
  request?: ResearchRequest;
  existing?: boolean;
  result?: {
    baseline?: boolean;
    skipped?: boolean;
    changed?: boolean;
    added?: number;
    updated?: number;
  };
}
