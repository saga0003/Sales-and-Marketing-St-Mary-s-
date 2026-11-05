export interface SearchSample {
  date: string;
  position: number | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  availability: 'reported' | 'no_row';
  importedAt: string;
}
export interface RecordedSearchPoint {
  id: string;
  date: string;
  position: number;
  provenance: 'manual' | 'mcp';
}
export interface AnswerSeries {
  id: string;
  provider: string;
  model: string;
  prompt: string;
  targetUrl: string;
  locale: string;
  language: string;
  points: { date: string; checks: number; mentionRate: number; citationRate: number }[];
}
export interface KeywordTrack {
  id: string;
  keyword: string;
  institution: string;
  connectionId: string | null;
  propertyId: string;
  propertyName: string;
  country: string;
  device: 'all' | 'DESKTOP' | 'MOBILE' | 'TABLET';
  searchType: 'web' | 'image' | 'video' | 'news';
  pageUrl: string;
  answerPrompt: string;
  answerTargetUrl: string;
  answerLocale: string;
  answerLanguage: string;
  active: boolean;
  autoSync: boolean;
  nextSyncAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  status:
    | 'paused'
    | 'awaiting_connection'
    | 'needs_attention'
    | 'awaiting_data'
    | 'ready'
    | 'no_query_rows';
  canSync: boolean;
  searchHistory: SearchSample[];
  movement: {
    latest: SearchSample | null;
    previous: SearchSample | null;
    improvement: number | null;
    latestCheckedDate: string | null;
  };
  recordedSearchHistory: RecordedSearchPoint[];
  answerSeries: AnswerSeries[];
}
export interface SearchEvidence extends RecordedSearchPoint {
  clicks: number | null;
  impressions: number | null;
  evidenceUrl: string;
  notes: string;
  identitySnapshot: {
    keyword: string;
    institution: string;
    propertyId: string;
    country: string;
    device: string;
    searchType: string;
    pageUrl: string;
  };
  recordedBy: string;
  createdAt: string;
}
export interface AnswerEvidence {
  id: string;
  contextId: string;
  checkedAt: string;
  date: string;
  provider: string;
  model: string;
  prompt: string;
  targetUrl: string;
  locale: string;
  language: string;
  mentioned: boolean;
  cited: boolean;
  citationUrls: string[];
  answerExcerpt: string;
  evidenceUrl: string;
  notes: string;
  provenance: 'manual' | 'mcp';
  recordedBy: string;
  createdAt: string;
}
export interface KeywordDetail extends KeywordTrack {
  searchEvidence: SearchEvidence[];
  answerEvidence: AnswerEvidence[];
}
export interface KeywordData {
  keywords: KeywordTrack[];
  limits: {
    maxKeywords: number;
    reportingLagDays: number;
    maxPerRun: number;
    historyDays: number;
    chartDays: number;
  };
  automation: {
    enabled: boolean;
    intervalHours: number;
    reportingTimeZone: string;
    answerTimeZone: string;
    paidAiEnabled: false;
  };
}
