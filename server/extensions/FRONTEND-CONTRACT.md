# Phase two integration contract

These are real integration records. Empty arrays mean no account has been connected or data imported. They must not be replaced with sample/live-looking data.

```ts
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
```

Bootstrap adds `providerSetup`, `connections`, `mediaAssets`, `publicationJobs`, `websiteAnalytics`, and the real `publishingEnabled` flag. Post/revision fields are `assetId: string | null` and `destinationIds: string[]`.

## API

- `GET /api/connections` → `{ providers, connections }`.
- `PUT /api/connections/providers/:provider` → `{ provider }`, body `{ clientId, clientSecret }`; manager only.
- `POST /api/connections/authorize` → `{ url }`, body `{ provider, institution }`; manager only.
- OAuth callback redirects to `/#settings?connected=<id>` or `/#settings?connection_error=<safe code>`.
- `GET /api/connections/:id/accounts` → `{ accounts: [{ id, name, kind: 'ga4' | 'instagram', platform?, timezone? }] }`.
- `POST /api/connections/:id/select` with `{ accountId }`, `/test`, `/sync` (optional `{ startDate, endDate }`), or `DELETE /api/connections/:id`; all manager only. Refresh bootstrap after mutations.
- `GET /api/media` → `{ assets, storage: { configured, maxBytes: 3145728, accept: ['image/jpeg','image/png','image/webp'] } }`.
- `POST /api/media` accepts raw file bytes, image Content-Type, `x-file-name: encodeURIComponent(file.name)`, CSRF header. Returns `MediaAsset`. The server decodes and normalizes the image to JPEG before preview/review, strips metadata, and stores immutable bytes. Transparent areas become white. It never changes the image after approval.
- `GET /api/media/:id/content` requires an authenticated authorized workspace user.
- `POST /api/posts/:id/publications` with `{ revision, scheduledAt? }` queues/reuses exact approved jobs. Returns `{ jobs }`.
- `POST /api/publications/:id/retry` and `/cancel` return the job.
- `POST /api/publications/:id/reconcile` with `{ remoteId }` checks the media against the connected account and approved caption before recording success. Ambiguous sends are never retried automatically.
- `POST /api/jobs/run` is an explicit manager action; disabled unless the server has `PUBLISHING_ENABLED=true`. Cron `GET /api/jobs/run` additionally requires `Authorization: Bearer <CRON_SECRET>`.

Google OAuth requests only Analytics read access. Instagram uses Facebook Login for a professional Instagram account linked to a Facebook Page; the Meta app needs the listed permissions and appropriate app review/access. Unavailable providers remain setup-required. Uploading an image or approving a draft never bypasses provider credentials, the publishing switch, or the durable queue.
