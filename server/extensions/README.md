# Provider integrations, private media and approved publishing

This release implements ten connection services using three shared developer applications: Google (GA4, Search Console, YouTube, Business Profile and Ads), Meta (Instagram, Facebook Pages and Ads), and LinkedIn (organization and member). Provider credentials, account selections, reports and publication jobs are real persisted records. Empty or unavailable data must remain empty or unavailable in the product.

See [the account connection guide](../../docs/CONNECTING-ACCOUNTS.md) for school-administrator setup, exact permissions, current provider approval requirements, media limits and a live-account pilot. See [the frontend contract](./FRONTEND-CONTRACT.md) for types and endpoints.

## Configuration

| Variable                                       | Purpose                                                                                                                                                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ORIGIN`                                   | Exact trusted HTTPS application origin. Callback URLs are built from this value; forwarded hosts are not trusted. Localhost HTTP is allowed for development.                                                                                      |
| `CREDENTIAL_ENCRYPTION_KEY`                    | Stable 32-byte key encoded as 64 hexadecimal characters or standard base64. Encrypts secrets and tokens with AES-256-GCM and record-specific authenticated data. Changing it requires reconnecting accounts unless existing data is re-encrypted. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`     | Optional fallback application credentials shared by all Google services. Database settings take precedence.                                                                                                                                       |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID`                 | Optional 10-digit manager context for Google Ads. Manager paths discovered for a selected account are retained with its encrypted credentials.                                                                                                    |
| `GOOGLE_ADS_API_VERSION`                       | Pinned REST version, default `v26`. Google now manages API access through the Cloud project; a legacy developer token is not required by the current flow.                                                                                        |
| `META_APP_ID`, `META_APP_SECRET`               | Optional fallback credentials shared by Instagram, Facebook Pages and Meta Ads.                                                                                                                                                                   |
| `META_API_VERSION`                             | Pinned Graph version, default `v25.0`. Review provider lifecycle before changing it.                                                                                                                                                              |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | Optional fallback credentials shared by organization and member connections.                                                                                                                                                                      |
| `LINKEDIN_API_VERSION`                         | Pinned Community Management REST version, default `202610`.                                                                                                                                                                                       |
| `MEDIA_BROKER_URL`, `MEDIA_BROKER_PRIVATE_KEY` | Supabase storage broker endpoint and Ed25519 PKCS#8 signing key. The broker holds only the matching public key and performs narrowly scoped private-bucket operations. The application never receives the Supabase service-role key.              |
| `BLOB_READ_WRITE_TOKEN` or `BLOB_STORE_ID`     | Alternative private Vercel Blob image storage if the broker is absent. Direct production video uploads require the Supabase broker path in this release.                                                                                          |
| `PUBLISHING_ENABLED`                           | Only literal `true` enables external sends; defaults off. An approved revision, usable destination and deliverable private storage are still required.                                                                                            |
| `CRON_SECRET`                                  | Bearer credential for the independently protected publishing, monitoring and reporting cron endpoints. It does not bypass content approval.                                                                                                       |

Do not expose server credentials through `VITE_*` variables. Application credentials can instead be saved by a manager in Connections. Initial setup needs the client ID and secret; later updates can omit unchanged fields. Credentials are shared by group, but each service uses its own callback and consent scopes. Changing a group's client ID invalidates its outstanding OAuth attempts and requires reconnecting affected resources.

## Schema and deployment

Extension schema version **2** expands provider checks, allows text-only publication jobs, adds ordered-media publication support metadata, private-video metadata, generic reports and opt-in report schedules. Apply the core migrations first, then the extension migration and intelligence migration. Existing v1 connection IDs, encrypted credentials, media IDs, reports, job payloads and hashes are retained.

For a production role without DDL rights, apply `migration-v2.postgres.sql` once, inside the application's private schema and a migration transaction, before deploying with automatic migrations disabled. Ensure the new `platform_reports` table belongs to, or is explicitly granted to, the application role. Startup with `migrate: false` checks the schema marker and performs no DDL. New local databases use `schema.sql`; the SQLite v1 upgrade rebuilds only the two tables whose constraints changed and checks foreign keys before serving traffic.

The current Vercel configuration gives the worker a 180-second maximum duration. Normal provider requests have a 20-second timeout; image upload preparation can use 60 seconds, and the bounded YouTube video transfer can use 120 seconds. The hosting plan must support the configured cron frequency and function duration.

| Worker                       | Current schedule      | Bound                                                                      |
| ---------------------------- | --------------------- | -------------------------------------------------------------------------- |
| `GET /api/jobs/run`          | Every five minutes    | At most one due publication                                                |
| `GET /api/reports/cron`      | Every fifteen minutes | At most one explicitly enabled reporting account                           |
| `GET /api/intelligence/cron` | Every fifteen minutes | Bounded monitoring plus abandoned-upload cleanup; separate from publishing |

All GET workers require `Authorization: Bearer <CRON_SECRET>`. The publishing worker also has an explicit manager/CSRF-protected POST action. Do not combine video delivery and monitoring/report imports into one invocation. A due time is eligibility for processing, not a promise of exact delivery to the minute.

## Authorization and reporting

OAuth state is random, hashed in the database, bound to the initiating manager session, expires after ten minutes and is single-use. Google uses S256 PKCE and offline access. Required scopes are checked when providers return scope/permission information. Secrets never appear in bootstrap or account-discovery responses; discovered Page access tokens and provider-specific account context remain server-side.

Google access refreshes when a valid refresh token was issued. LinkedIn refreshes only when that application/product has received a usable refresh token. Meta expiration requires reconnection. Conditional credential updates avoid overwriting a concurrent authorization renewal. A service/resource is selected explicitly after OAuth; the app never treats an arbitrary pasted account ID as proof of access.

GA4 persists its established report shape in `website_reports`; other providers use `platform_reports`. Both preserve the account, institution, requested dates and import timestamp. Generic reports carry currency, labelled metrics, typed tables, truncation flags and semantic notes. CSV export uses the persisted report and escapes formula-leading text cells.

Automatic imports are off by default. A manager can enable a reporting-capable connected account at a 6–168 hour interval, default 24. Automatic runs use 28 inclusive dates ending two UTC calendar dates ago, avoiding an unfinished day across account time zones. Manual requests keep explicit dates, up to 90 days; Instagram further limits its insights window to 30 days. Provider reporting delays and attribution revisions still apply.

Manual and scheduled imports share a durable five-minute lease. A late worker cannot replace a newer report or invalidate its connection health. An expired lease can be reclaimed. Transient/rate-limit failures release the lease and retry at the configured interval; permission or expired-authorization failures mark the account as needing attention until access is restored. A report schedule never creates or changes advertisements.

Report semantics deliberately avoid common aggregation errors: GA4 users and YouTube average duration use provider aggregate queries; Meta account reach is not summed from campaign reach; conversion action types are not collapsed into a fictional admissions total; Facebook engagement is labelled as a snapshot on posts created in the selected window; unique LinkedIn impressions are not added across dates. The guide records these limits.

## Private media and broker protocol

On Vercel, storage must be configured; the server refuses ephemeral-filesystem fallback. Local development uses a private directory beside SQLite. Local files cannot be delivered to public providers by this adapter.

Images are fully decoded, checked, normalized to JPEG, stripped of metadata and made immutable before preview/approval. Videos are uploaded directly to the private Supabase bucket through a prepared single-object URL, then size/container/codec/track metadata are validated before an asset record is committed. This release accepts MP4 H.264 with optional AAC, maximum 40 MiB and ten minutes. No provider upload receives a raw unvalidated reservation.

Draft access is limited to its author and managers; assets attached to shared review content are available to the signed-in team. Authorized video previews use expiring signed URLs. Before delivery, the worker reads the stored asset and verifies its size and SHA-256 against the approved metadata. Provider-fetch URLs last one hour and are scoped to the exact object.

The workspace has a 200-item / 512 MiB allowance. Atomic reservations share a PostgreSQL advisory lock with video preparation. Every unfinished video reserves its maximum possible 40 MiB, even if a client declares fewer bytes; unfinished images reserve the normalized size. Expired reservations count until physical-object cleanup succeeds, preventing abandoned signed uploads from bypassing the quota. Completed assets use their validated size. Cleanup is bounded and must not remove an object referenced by a committed asset.

The application serializes each broker command once and signs `<unix-seconds>.<sha256-hex-of-raw-json>` using Ed25519. The broker checks a 60-second clock window and allows only narrow operations: `put`, `read`, `signedUrl`, `prepareVideoUpload`, and `removeExpiredUpload`. Paths are immutable `assets/asset_<opaque-id>.jpg` or `.mp4` inside the private bucket. Existing paths cannot be overwritten. Returned signed URLs must match the expected HTTPS broker origin and storage route/path. The frontend never receives the broker signing key or Supabase service-role key.

## Exact-revision publication lifecycle

Supported sends are Instagram image/carousel/Reel, Facebook Page text/image, LinkedIn organization/member text/image, Business Profile local text/image update and YouTube MP4 upload. Advertising adapters are read-only. The connection's actual capabilities, institution, platform, caption/media limits and explicit YouTube options are checked on approval and again before delivery.

A job uniquely identifies the post revision and selected connection. Its versioned approved payload binds title, caption, format, institution, destination account, ordered media IDs/hashes/dimensions/duration, platform options and manager approval. Editing clears approval and cancels pending jobs. Legacy approved Instagram jobs retain their original payload/hash compatibility.

The worker atomically claims a leased job, checks the exact approved revision and active approving manager, validates account access and media integrity, and persists preparation state. Instagram containers are reused when processing is incomplete. LinkedIn image URNs are retained between preparation and posting. An irreversible send is marked before the provider call. Provider-confirmed IDs remain recorded even if a later permalink lookup fails. YouTube additionally records returned privacy and processing state: upload confirmation is distinct from public availability.

A definite pre-send failure is manually retryable. An ambiguous response or worker crash after the send marker becomes `needs_reconciliation`; it cannot be blindly retried, cancelled, edited or disconnected. Reauthorizing the same account remains available to recover expired access. A partial multi-destination success is retained, and delivered content cannot be edited into a second send.

Manager-assisted reconciliation checks the returned resource belongs to the connected account, matches the approved caption and plausible send time, and for YouTube also matches the title. Media identity still requires visual inspection where providers recompress content. LinkedIn member self-serve scopes do not permit post read-back, so those ambiguous sends remain an operator investigation; the code does not request restricted permissions or silently resend.

Disconnecting deletes the local connection tokens and imported reports and cancels pending jobs. It does not revoke a provider-wide application grant that may also support other connected resources. Full revocation is done in the provider's account settings.

## Hooks and tests

`registerExtensions(app, context)` returns `bootstrap`, `validatePost`, `onPostChanged`, `onPostTransition`, `storage` and `syncDueReports`. Core post hooks execute inside the core transaction and only validate or enqueue local records; no external publish call occurs inside a content mutation transaction. Private media registration and the protected reporting cron are wired by core.

Run:

```sh
node --test server/extensions/providers-v3.test.mjs server/extensions/extensions.test.mjs
```

The suite uses in-memory SQLite, temporary private media and mocked provider HTTP. It covers legacy migrations, per-service consent scopes, encrypted state, redaction, role/resource discovery, provider report semantics, upload-host validation, privacy/audience declarations, media order integrity, exact approvals, worker exclusivity, partial deliveries, crash recovery, reconciliation, report schedules and stale-worker fencing. It makes no live OAuth grant, advertisement change or social post. Complete the guide's live pilot with the school's own authorized developer apps before routine use.
