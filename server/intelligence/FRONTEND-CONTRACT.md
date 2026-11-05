# Intelligence, SEO, and answer visibility contract

All routes require an authenticated workspace session and the normal CSRF header for writes. Manager-only actions are indicated below. Existing `sources`, `competitors`, `opportunities`, and opportunity-to-post APIs stay compatible.

Bootstrap adds `intelligence: IntelligenceData` (empty arrays are real empty state). Refresh bootstrap after successful writes.

```ts
interface IntelligenceWatch {
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
interface IntelligenceNotice {
  id: string;
  watchId: string;
  watchName: string;
  kind: 'source' | 'competitor';
  title: string;
  url: string;
  excerpt: string;
  publishedAt: string | null; // A publisher-supplied date, not the detection date.
  detectedAt: string;
  updatedAt: string;
  changeKind: 'discovered' | 'updated';
  baseline: boolean; // Present on the initial scan; not claimed to be newly published.
  status: 'new' | 'saved' | 'dismissed';
  opportunityId: string | null;
  contentHash: string;
}
interface SourceCatalogItem {
  id: string;
  name: string;
  url: string;
  category: string;
  mode: 'html' | 'rss';
  keywords: string[];
  note: string;
}
interface SiteVerification {
  id: string;
  origin: string;
  status: 'pending' | 'verified';
  verificationUrl: string;
  verificationToken: string; // Public ownership challenge, not an account credential.
  metaTag: string;
  verifiedAt: string | null;
  lastAuditAt: string | null;
}
interface SeoFinding {
  id: string;
  severity: 'issue' | 'warning' | 'pass' | 'info';
  title: string;
  detail: string;
}
interface SeoAudit {
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
interface AnswerPrompt {
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
interface AnswerObservation {
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
}
interface IntelligenceData {
  watches: IntelligenceWatch[];
  notices: IntelligenceNotice[]; // Latest 200.
  sourceCatalog: SourceCatalogItem[];
  siteVerifications: SiteVerification[];
  seoAudits: SeoAudit[]; // Latest 30.
  answerPrompts: AnswerPrompt[];
  answerObservations: AnswerObservation[]; // Latest 200.
  automation: { enabled: boolean; minimumIntervalHours: number; maxWatchesPerRun: number };
}
```

## Watches and notice inbox

- `GET /api/intelligence` returns `IntelligenceData`.
- `POST /api/intelligence/catalog/:id` (manager) adds an official source and its active watch; repeated calls return the same watch. Returns `{ watch, source }`.
- `POST /api/intelligence/watches` (manager) body `{ kind, resourceId, mode, url?, keywords?: string[], intervalHours?: number, active?: boolean }`; returns `{ watch }`. `url` is the feed or notice page, defaulting to the saved resource URL. For YouTube use an exact `UC...` channel ID or a `/channel/UC...` URL; an `@handle` alone is not a channel ID. YouTube mode may only monitor a YouTube competitor. Other social-platform profile pages require manual review (not arbitrary HTML scraping).
- `PATCH /api/intelligence/watches/:id` (manager) body partial `{ url, keywords, intervalHours, active }`.
- `DELETE /api/intelligence/watches/:id` (manager) removes a watch and its notice inbox; already-created briefs/posts remain.
- `POST /api/intelligence/watches/:id/run` (manager) runs one watch now; returns `{ watch, added, updated, baseline, skipped? }`. Minimum one minute between manual runs. `409` means another run is active; `429` means wait before retrying. A blocked/failed source is recorded with a helpful error; the previous notices remain.
- `POST /api/intelligence/run` (manager) processes up to two due watches. Cron uses the same bounded worker.
- `PATCH /api/intelligence/notices/:id` body `{ status: 'new' | 'saved' | 'dismissed' }`.
- `POST /api/intelligence/notices/:id/brief` body optional `{ audience, contentAngle, priority }`; returns `{ opportunity }`. This is idempotent. The brief is unverified and preserves publisher/detection dates and the original URL. Existing manager verification and `POST /api/opportunities/:id/draft` complete the flow.

## Owned-site checks

- `POST /api/intelligence/sites` (manager) body `{ url }` returns `{ site }`. The exact HTTPS origin is registered.
- `POST /api/intelligence/sites/:id/verify` (manager) reads the exact challenge file or checks the homepage meta token. Returns `{ site }` or a clear not-yet-verified error. Display the token and either file URL/content or `metaTag` for the website administrator.
- `POST /api/intelligence/sites/:id/audit` (manager) body `{ url? }`, same verified origin only. Returns `{ audit }`. One page per request, respects robots, no automatic crawling, no promise of rankings. At least 60 seconds between audits.
- `DELETE /api/intelligence/sites/:id` (manager) removes the site's stored audit records.

## AEO/GEO answer observation log

- `POST /api/intelligence/answer-prompts` body `{ prompt, intent, institution, locale, language, targetUrl, active? }` returns `{ prompt }`.
- `PATCH /api/intelligence/answer-prompts/:id` same fields optional.
- `DELETE /api/intelligence/answer-prompts/:id` (manager).
- `POST /api/intelligence/answer-observations` body `{ promptId, provider, model, checkedAt, answerExcerpt, mentioned, cited, citationUrls, evidenceUrl, notes }` returns `{ observation }`.
- `DELETE /api/intelligence/answer-observations/:id` (manager).

These are manually recorded reproducible observations. The app does not pretend to run ChatGPT/Gemini/other providers in the background or calculate a universal GEO rank. Show citations/mentions per recorded prompt with sample counts, and distinguish no observations from zero mentions. Never label this log as automatic AI monitoring.
