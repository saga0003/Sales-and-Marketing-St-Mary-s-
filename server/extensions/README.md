# Connections, private images and approved publishing

This extension adds genuine provider adapters to the existing review workflow. The local demo remains usable without any external credentials. External connections, website analytics and publication results start empty; no successful provider operation is simulated in the product.

## Deployment configuration

| Variable                                   | Purpose                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ORIGIN`                               | The exact HTTPS application origin, without a path. OAuth callback URLs are built from this trusted value; forwarded request hosts are never trusted for redirects. `http://localhost:<port>` is accepted for local development.                                                                                        |
| `CREDENTIAL_ENCRYPTION_KEY`                | 32 cryptographically random bytes encoded as 64 hexadecimal characters or standard base64. Required to save provider credentials and OAuth tokens. AES-256-GCM with record-specific additional authenticated data is used. Keep this key stable and backed up; changing it requires reauthorizing existing connections. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional server configuration for Google OAuth. A manager can instead enter these under Connections; database values take precedence.                                                                                                                                                                                   |
| `META_APP_ID`, `META_APP_SECRET`           | Optional server configuration for Meta Facebook Login. A manager can instead enter these under Connections.                                                                                                                                                                                                             |
| `META_API_VERSION`                         | Pinned Graph API version, default `v25.0`. Review Meta's version lifecycle before changing it.                                                                                                                                                                                                                          |
| `MEDIA_BROKER_URL`                         | Private storage broker HTTPS endpoint. This deployment uses a narrow Supabase Edge Function restricted to the application's media bucket.                                                                                                                                                                               |
| `MEDIA_BROKER_PRIVATE_KEY`                 | Ed25519 PKCS#8 PEM private key for signing broker commands. The matching public key is held by the broker. Never expose this private key in client environment variables.                                                                                                                                               |
| `BLOB_READ_WRITE_TOKEN` or `BLOB_STORE_ID` | Alternative private Vercel Blob storage configuration, used only if the broker is not configured. Store ID requires appropriate Vercel OIDC authorization.                                                                                                                                                              |
| `PUBLISHING_ENABLED`                       | Defaults off. Only the literal value `true` enables provider sends. Approval and queueing work while this is off.                                                                                                                                                                                                       |
| `CRON_SECRET`                              | Optional secret for authenticated `GET /api/jobs/run`. A constant-time bearer comparison is used. Without it, the GET worker endpoint rejects all requests.                                                                                                                                                             |

Use a Vercel function duration of 180 seconds for the initial one-job worker. A function invocation handles at most one due job. Provider calls time out after 20 seconds and broker calls after 25 seconds. This implementation does **not** install a scheduler: a manager can run one due job from the UI, or the operator can configure a scheduler compatible with their hosting plan. Timely posting requires a worker schedule; Vercel's plan limits must be checked before promising minute-level automation.

On Vercel, media storage must be configured. The server deliberately refuses to fall back to its ephemeral filesystem. Local development uses a private filesystem directory next to the SQLite database. Local files cannot be delivered to Instagram by this adapter.

## Google setup

1. Create a Google Cloud OAuth web application and enable the Analytics Admin and Analytics Data APIs.
2. Register the exact callback URL displayed by Connections: `APP_ORIGIN/api/connections/oauth/google/callback`.
3. Configure the OAuth consent screen, test users or production verification according to Google's requirements.
4. Save the client ID and secret, authorize using a Google account with access to the school's GA4 property, and choose the discovered property.
5. Test the connection, then import the desired date range (up to 90 days). Reports contain the selected date range, property name, institution and import time.

The only requested Google scope is `https://www.googleapis.com/auth/analytics.readonly`. The authorization code flow uses a session-bound, single-use state value and S256 PKCE. Tokens and provider client secrets remain on the server. Refresh-token updates use a conditional database write to avoid replacing a concurrently renewed authorization. Totals use a separate aggregate report; unique users are not incorrectly summed across days. The Analytics charts are separate from existing sample social/advertising metrics. Search Console and Google Ads are not connected by this extension.

## Instagram setup and supported format

The adapter uses **Instagram API with Facebook Login**. It discovers professional Instagram accounts linked to Facebook Pages the authorizing person can manage. Required scopes are `pages_show_list`, `pages_read_engagement`, `instagram_basic`, and `instagram_content_publish`. Meta app review and access requirements depend on app mode and who owns the connected accounts. Save the Meta application ID/secret and register the callback shown in Connections.

This first publisher supports a single image in `Post` format, caption length 1–2,200 characters, and a conservative supported aspect ratio range of 4:5 to 1.91:1 with width at least 320 pixels. Video, carousel, Reels, Stories, Facebook posting, paid ads and social insights are not implemented here. Connections displays genuine capabilities so these limitations remain visible.

Uploads accept JPEG, PNG and WebP, at most 3 MiB and 24 megapixels. The server verifies signatures, fully decodes the file, rejects animation and malformed content, strips metadata, flattens transparency onto white, and normalizes to JPEG at a maximum dimension of 2,160 pixels. This happens **before** the user previews and approves it. The approved immutable asset includes the final image's SHA-256 hash and dimensions. No transformation occurs after approval.

Draft image reads require a session and ownership or a manager role; images attached to submitted/approved/published content can be read by the signed-in team. Storage URLs and tokens are never exposed as permanent public asset URLs. Before publication, the worker reads and hashes the stored image again, then issues a one-hour read URL scoped to that object. The media library has an initial 200-image cap to bound storage growth; retention and deletion are a later operational feature.

## Durable publication lifecycle

Approving a post with an Instagram destination creates an idempotent job for that exact post revision, account and asset. A unique database key prevents duplicate queue entries. Existing planning-only posts without destinations keep their original local review behavior.

The job stores the approved caption, format, institution, destination account, image hash, approving manager and approval time. Editing the post clears approval and cancels queued jobs. The worker claims a job with a lease, verifies the currently approved revision and active approving manager, verifies the connected destination and image, creates the Instagram container, and persists its ID before attempting publication. It records `published` only when Meta confirms a media ID. A later permalink lookup failing cannot erase that confirmed ID.

An image container still processing returns the same job to the queue for a later run and reuses its recorded container. A worker that crashes before attempting publication becomes a manually retryable failure. A timeout, crash or ambiguous response after the publication attempt becomes `needs_reconciliation` and cannot be retried or cancelled blindly. Editing that post and disconnecting its account are blocked until the result is resolved. Reauthorizing the **same** account is permitted when needed to reconcile an expired authorization.

For reconciliation, a manager first inspects the actual Instagram post and image and submits its numeric media ID. The server verifies the media is on the connected account, the caption matches, and the timestamp is consistent with the attempt. It preserves a provider ID already received during the original attempt. This is an explicit manager-assisted recovery operation; the app does not infer image equality from Meta's recompressed public copy. If the provider never accepted a request and no published media exists, the job remains parked for operator investigation; there is deliberately no unsafe “send again” shortcut.

Disconnecting removes locally stored provider credentials, cancels queued jobs, and removes imported website reports. It does not revoke the application's entire provider-side grant, because that grant can also serve another connected school property. Full grant revocation can be performed from the provider's account permissions page.

## Storage broker protocol

The application serializes a command exactly once. It signs the UTF-8 string `<unix-seconds>.<sha256-hex-of-raw-json>` with Ed25519, then sends HTTPS POST with `x-marketing-timestamp` and `x-marketing-signature` (base64url). The broker verifies the signature and a 60-second clock window. The accepted commands are `put`, `read` and `signedUrl`; paths are immutable `assets/asset_<opaque-id>.jpg` within the application's private bucket. Uploading an existing path is forbidden. The application never receives the Supabase service-role key.

## Integration and tests

`registerExtensions(app, ctx)` is called after session parsing, before the global authenticated router. Every ordinary extension route explicitly uses the core authenticated/CSRF middleware; management routes also require a manager. The only public handlers are the session-bound OAuth callback and the separately secret-authenticated GET worker. The cron credential cannot bypass post approval or media validation.

The hook object supplies `bootstrap`, `validatePost`, `onPostChanged`, and `onPostTransition`. Core executes post hooks inside its transaction; hooks only validate or write local job records and never make provider network requests. SQL supports both the async SQLite and PostgreSQL adapters. Extension schema creation uses the same PostgreSQL advisory lock as core migrations to serialize cold starts.

Run `node --test server/extensions/*.test.mjs`. Tests use in-memory SQLite, private temporary media and fake provider HTTP; they never authenticate a real external account or publish content. Coverage includes OAuth replay/session controls, encrypted-secret tampering, token redaction, GA4 totals, media integrity, broker signatures, approval invalidation, job idempotency, concurrent claims, provider timeouts, crashed-worker recovery, account renewal and worker authorization.

## Primary implementation references

- [Google OAuth web-server authorization](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google Analytics property discovery](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list)
- [Google Analytics runReport API](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport)
- [Meta-maintained Instagram API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- [Instagram content publishing documentation](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/)
- [Vercel Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk)
- [Vercel Blob signed URLs](https://vercel.com/docs/vercel-blob/vercel-signed-urls)

The Google and Blob references and the Meta-maintained collection were checked during implementation. Meta's main documentation page was unavailable to the research browser; the maintained collection supplied the endpoint and permission details. Live OAuth/account compatibility still requires the school's application credentials and explicit account authorization.
