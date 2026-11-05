# Provider integration contract

All connections, imported reports and publication IDs are actual persisted records. Empty arrays mean no account or data exists yet. Provider configuration alone does not establish account access or provider approval.

## Types

```ts
export type ProviderId =
  | 'google'
  | 'search_console'
  | 'youtube'
  | 'google_business'
  | 'google_ads'
  | 'instagram'
  | 'facebook'
  | 'meta_ads'
  | 'linkedin'
  | 'linkedin_member';

export interface ProviderSetup {
  id: ProviderId;
  name: string;
  credentialGroup: 'google' | 'meta' | 'linkedin';
  configured: boolean;
  canConfigure: boolean;
  redirectUri: string;
  scopes: string[];
  capabilities: string[];
  docsUrl: string;
  description: string;
  requirements: string[];
  credentialFields?: {
    key: string;
    label: string;
    required: boolean;
    secret: boolean;
    placeholder?: string;
  }[];
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
  autoSync: boolean;
  syncIntervalHours: number;
  nextSyncAt: string | null;
  error: string | null;
}
export interface MediaAsset {
  id: string;
  name: string;
  mimeType: 'image/jpeg' | 'video/mp4';
  kind: 'image' | 'video';
  duration: number | null;
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
  platform: 'instagram' | 'facebook' | 'linkedin' | 'google_business' | 'youtube';
  status: 'queued' | 'processing' | 'published' | 'failed' | 'needs_reconciliation' | 'cancelled';
  scheduledAt: string;
  attempts: number;
  error: string | null;
  remoteId: string | null;
  remoteUrl: string | null;
  remoteVisibility: string | null;
  providerStatus: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface PlatformReport {
  connectionId: string;
  accountName: string;
  institution: string;
  provider: Exclude<ProviderId, 'google'>;
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
```

Bootstrap exposes `providerSetup`, `connections`, `mediaAssets`, `publicationJobs`, `websiteAnalytics`, `platformAnalytics`, and `publishingEnabled`. Post/revision records use ordered `assetIds: string[]`, legacy `assetId: string | null` as the first asset, `destinationIds: string[]`, and `publicationOptions` with optional `youtubePrivacy`, `madeForKids`, and `containsSyntheticMedia`.

## Connections and reports

- `GET /api/connections` → `{ providers, connections }`.
- `PUT /api/connections/providers/:provider` → `{ provider }`; manager only. Initial body `{clientId, clientSecret}`. Later partial updates preserve omitted fields. Google also accepts `loginCustomerId` (10 digits) and a legacy optional `developerToken`; the current setup does not require/advertise developer tokens. Credentials are shared by group. Refresh the full catalog after saving a group.
- `POST /api/connections/authorize` → `{url}`, body `{provider, institution}`; manager only. Navigate to the provider rather than collecting its account password in the app.
- OAuth redirects to `/#settings?connected=<id>` or `/#settings?connection_error=<safe code>`.
- `GET /api/connections/:id/accounts` → `{accounts:[{id,name,kind,platform?,timezone?,capabilities?}]}`. Only discovered resources are selectable; tokens and internal credentials are never returned.
- `POST /api/connections/:id/select` with `{accountId}` → `Connection`. Reauthorizing and selecting the same account renews its existing connection.
- `POST /api/connections/:id/test` → `Connection`. This does not publish.
- `POST /api/connections/:id/sync` with optional `{startDate,endDate}` → persisted `WebsiteReport` or `PlatformReport`. Requires reporting capability. At most 90 days; Instagram limits to 30. Empty body defaults to 30 dates ending UTC yesterday. An active report lease returns `report_import_running`.
- `POST /api/connections/:id/sync-settings` with `{autoSync:boolean,syncIntervalHours?:number}` → `Connection`. Manager only; integer interval 6–168 hours, default24; defaults off. Enabling requires healthy reporting access. Automatic imports use 28 inclusive dates ending two UTC dates ago. Show the two-day reporting lag and provider-quota implications. `nextSyncAt` is eligibility, not a punctuality guarantee.
- `GET /api/connections/:id/report.csv` → authenticated `text/csv` download of the persisted report, including provenance/notes/currency and formula-safe text.
- `DELETE /api/connections/:id` → `{ok:true}`; manager only. Deletes local tokens/reports and cancels pending jobs. It does not revoke the whole provider-side application grant.

Connection mutations need manager authorization and CSRF. Reports are visible to the authenticated workspace team. Refresh bootstrap after mutations. Display a selected-but-not-yet-imported date range separately from the saved report's actual range. Do not sum platform reach or conversion action types into invented totals. Provider notes and timestamps belong next to the figures.

Temporary provider failures retain connected status with an error and retry at the configured interval; missing permission/expired authorization requires attention and testing or reauthorization. The separate secret-authenticated `/api/reports/cron` processes one enabled due account per run, with a durable lease excluding overlapping manual/cron imports.

## Media

- `GET /api/media` → `{assets, storage:{configured,maxBytes:3145728,accept:['image/jpeg','image/png','image/webp']}}`.
- `POST /api/media` accepts raw image bytes, image Content-Type, `x-file-name: encodeURIComponent(file.name)` and CSRF. Returns `MediaAsset`. The reviewed bytes are normalized JPEG, with metadata removed and transparency flattened onto white.
- Core advanced-media routes: `POST /api/media/uploads` with `{name,mimeType:'video/mp4',size}` returns `{uploadId,uploadUrl,method:'PUT',headers,expiresAt}`. Upload exactly the selected bytes to that URL, then `POST /api/media/uploads/:id/complete` to validate and commit the immutable `MediaAsset`. Do not attach an unfinished reservation to a post. Local development uses the authenticated `/api/media/uploads/:id/content` PUT fallback.
- `GET /api/media/:id/content` requires session and asset authorization. Private cloud video previews redirect to an expiring signed URL. Never store that temporary URL as a permanent asset identifier.

Images are at most3MiB/24MP before normalization. Videos are MP4 H.264 with optional AAC, at most40MiB/10min. The workspace allowance is200items/512MiB including unfinished reservations. Selecting/uploading assets does not publish them.

## Publishing

Use actual account capabilities, not provider name alone, to offer destinations. Map `linkedin_member` to the `linkedin` post platform; GA4/Search Console/Ads are reporting-only. Destinations must belong to the post's institution. All media/order/options are bound to the approved revision.

| Destination          | Format                 | Requirements                                                                                                                                |
| -------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Instagram            | Post / Carousel / Reel | One JPEG / 2–10 matching-ratio JPEGs / one 9:16 MP4; caption≤2,200; images width≥320 and ratio0.8–1.91; Reel width≥320 and duration3–600sec |
| Facebook Page        | Post                   | Text or one JPEG; caption≤5,000                                                                                                             |
| LinkedIn Page/member | Post                   | Text or one JPEG; caption≤3,000                                                                                                             |
| Business Profile     | Post                   | Text or one JPEG; caption≤1,500; eligible location                                                                                          |
| YouTube              | Video                  | One MP4; title≤100 without angle brackets; description≤5,000; explicit privacy, madeForKids and containsSyntheticMedia                      |

Capabilities are `publish:text`, `publish:image`, `publish:carousel`, `publish:video`, `analytics:read` and `account:read`. An old connection may need reauthorization to obtain new capabilities.

- `POST /api/posts/:id/publications` with `{revision,scheduledAt?}` queues/reuses the exact approved jobs → `{jobs}`.
- `POST /api/publications/:id/retry` or `/cancel` → job. Ambiguous sends cannot be blindly retried/cancelled.
- `POST /api/publications/:id/reconcile` with `{remoteId}` checks resource ownership, text and time before recording success. Do not constrain the input to digits: Facebook IDs may contain `_`, LinkedIn uses a URN, GBP uses a resource path and YouTube an11-character ID. LinkedIn member self-serve read-back is unavailable and returns an explanatory error.
- `POST /api/jobs/run` is an explicit manager action. Secret-authenticated GET is reserved for the scheduled worker. Both need publishing enablement and all normal approval/integrity checks.

For YouTube, display **Upload confirmed** rather than assuming public availability. Show `remoteVisibility` and `providerStatus` when supplied. A confirmed ID, completed provider processing and public visibility are different facts. GBP can also moderate a newly created local post.

Partial delivery must remain visible. Already delivered content cannot be edited in place; duplicate it to create a new draft. The user must inspect the actual provider result when reconciling uncertain delivery.
