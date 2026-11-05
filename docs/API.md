# Workspace API — version 0.3

This release supports a persistent team workspace, revision-specific approvals,
private images and MP4 videos, durable publishing jobs, provider reports, an
in-app notification inbox, monitored research sources, verified-site SEO checks
and an AEO/GEO observation register. An implemented connector is not an
authorized account: live provider operations require the relevant developer app,
permissions, account selection and healthy connection.

The authoritative client types are in `src/lib/types.ts`. The detailed provider
and intelligence contracts are in
[extensions/FRONTEND-CONTRACT.md](../server/extensions/FRONTEND-CONTRACT.md) and
[intelligence/FRONTEND-CONTRACT.md](../server/intelligence/FRONTEND-CONTRACT.md).
See [Connecting accounts](CONNECTING-ACCOUNTS.md) for provider setup and
[the intelligence guide](INTELLIGENCE-GUIDE.md) for monitoring limits.

## Runtime and persistence

- Node.js 24, Express 5, ES modules and Zod validation.
- SQLite for a local persistent server; PostgreSQL for Vercel. Hosted startup
  rejects missing `DATABASE_URL` and automatic-sign-in `DEMO_MODE`.
- The browser uses the application’s email/password login. Supabase can host
  PostgreSQL and private media; this release does **not** use Supabase Auth.
- Core migrations are under `server/migrations/`; provider and intelligence
  migrations have separate version markers in `workspace_metadata`.
- Hosted deployments normally set `AUTO_MIGRATE=false`; apply all required
  migrations before deploying. Initialization fails on a missing module version.
- `APP_ORIGIN` supplies the canonical application origin, account setup links and
  provider callbacks. `CREDENTIAL_ENCRYPTION_KEY` encrypts provider credentials.
- `PUBLISHING_ENABLED=true` enables external publication. The bootstrap
  `publishingEnabled` flag reflects this switch. Disabled publication does not
  turn scheduled plans into published posts.
- `CRON_SECRET` protects all three background-worker routes.
  `INTELLIGENCE_AUTOMATION_ENABLED=false` disables scheduled source checks.
- Local `DEMO_MODE=true` contains labelled examples and permits automatic demo
  sign-in. Hosted evaluation uses authenticated `EVALUATION_MODE`; it does not
  authorize social accounts or substitute sample metrics for provider reports.

Password hashes, session tokens, provider client secrets and account credentials
never appear in normal API responses or audit details. Private media bytes live
in the configured storage service, with metadata and immutable content hashes in
the database.

## Request conventions

All routes below are same-origin under `/api`. JSON bodies use
`Content-Type: application/json` and have a 256 KiB limit; raw media upload routes
have separate limits. Unknown input fields are rejected.

Except for public configuration, sign-in/setup, the OAuth callback and
secret-protected cron routes, endpoints require an active authenticated session.
A **manager** restriction below is enforced on the server. All authenticated
mutations also require:

```http
x-csrf-token: <csrfToken returned by login or bootstrap>
```

The session cookie is `smis_session`: opaque, hashed in the database, HttpOnly,
SameSite=Lax and Secure on configured HTTPS production deployments. The default
session lifetime is 12 hours. Supplied Origin/Referer and Fetch Metadata must pass
the application’s origin checks. There is no cross-origin public API.

Login/setup/password attempt limits are stored in the database. Passwords use
scrypt with per-password salts. Account setup links are single-use and expire
after 24 hours; this expiry applies to the link, not the application or its data.
Email delivery and public self-registration are not implemented.

Creation usually returns HTTP 201 and updates HTTP 200. Response envelopes vary:
core records generally return the entity directly, while lists, monitoring and
job routes use the envelopes documented below. Do not assume every endpoint has
the same wrapper. Deletes normally return `{ok:true}`.

### Bootstrap

`GET /api/bootstrap` returns the current user, CSRF token, team and workspace
collections, audit history, provider setup state, connections, media assets,
publication jobs, website analytics and platform reports. It also includes
notifications/preferences, the `intelligence` object, storage status,
`demoMode`, `evaluationMode` and `publishingEnabled`.

Production returns 401 without a session. Only explicitly configured local demo
mode creates a demo session automatically. Refresh bootstrap after a mutation
when the UI needs associated records, decisions or new notifications.

## Session and team

| Method and route                 | Body                              | Result / access                                                                              |
| -------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------- |
| `GET /api/health`                | None                              | Public runtime status, mode and storage driver/persistence.                                  |
| `GET /api/config`                | None                              | Public workspace/login/setup configuration; no credentials.                                  |
| `GET /api/bootstrap`             | None                              | Current authenticated workspace.                                                             |
| `POST /api/auth/login`           | `{email,password}`                | `{user,csrfToken}` and session cookie.                                                       |
| `POST /api/auth/setup`           | `{token,password}`                | Redeem setup/recovery token and establish access.                                            |
| `POST /api/auth/logout`          | Empty                             | Revoke/clear the current session.                                                            |
| `POST /api/auth/password`        | `{currentPassword,password}`      | Change password and rotate sessions. New password: 12–256 characters.                        |
| `POST /api/auth/demo-role`       | `{role:"manager"\|"contributor"}` | Local demo only; returns a rotated session/CSRF token.                                       |
| `GET /api/team`                  | None                              | All team accounts; manager only.                                                             |
| `POST /api/users`                | `{name,email,role,password?}`     | Manager creates a user. Without password, response includes a personal setup URL and expiry. |
| `PATCH /api/users/:id`           | Partial `{name,role,active}`      | Manager edits access; last-manager/self-access safeguards apply.                             |
| `POST /api/users/:id/setup-link` | `{purpose?:"setup"\|"recovery"}`  | Manager issues a replacement link; no email is sent.                                         |

Use a second email address and a separate browser session for a contributor
acceptance test. A setup URL is an access credential and should be shared only
with its intended recipient.

## Content and approval

| Method and route                 | Body                                       | Result                                                              |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------- |
| `GET /api/posts/:id`             | None                                       | Post visible to the authenticated workspace.                        |
| `POST /api/posts`                | Post input                                 | New draft, revision 1, owned by the caller.                         |
| `PATCH /api/posts/:id`           | Changed fields plus required `revision`    | Updated post; editing increments the revision and revokes approval. |
| `POST /api/posts/:id/transition` | `{action,revision,feedback?,scheduledAt?}` | Validated state transition.                                         |
| `POST /api/posts/:id/duplicate`  | Empty                                      | Independent unapproved draft.                                       |
| `GET /api/posts/:id/history`     | None                                       | Saved revision history.                                             |
| `GET /api/posts/:id/comments`    | None                                       | Review discussion.                                                  |
| `POST /api/posts/:id/comments`   | `{body,revision}`                          | Comment attached to the specified revision.                         |

Example draft with no external publishing destination:

```json
{
  "title": "Questions to bring on a campus visit",
  "caption": "Ask about subjects, student support and how progress is shared.",
  "platforms": ["instagram"],
  "format": "Post",
  "institution": "St. Mary’s ISC",
  "scheduledAt": null,
  "language": "English",
  "palette": "violet",
  "sourceUrl": "",
  "mediaUrl": "",
  "assetIds": [],
  "destinationIds": []
}
```

A platform selection describes the content; `destinationIds` selects actual
authorized accounts. Destinations may be empty throughout an interface-only
review test.

Titles are at most 180 characters and captions 12,000; publishing adapters apply
stricter platform limits. Formats are `Post`, `Carousel`, `Reel`, `Video` and
`Article`, but not every format can be published to every destination. Ordered
`assetIds` supports at most ten unique immutable attachments. The legacy
`assetId` remains supported for a single attachment. `mediaUrl` alone is not an
approved uploaded asset.

Transition actions are `submit`, `approve`, `reject`, `request_changes`,
`schedule` and `unschedule`. Contributors can edit/submit their own eligible
drafts; managers make review decisions. Rejection/change requests require useful
feedback. Submission needs nonempty content. Stale revisions return 409.
Scheduling requires the current approved revision and a future timestamp.

Approval binds the exact caption, ordered media hashes, destination accounts and
publication options. Edits invalidate that approval and cancel eligible pending
jobs. Active or ambiguous sends block unsafe edits. Approval without destinations
stays inside the workspace. Approval with real destinations creates durable jobs
subject to the publication switch and adapter validation.

YouTube video approval additionally requires:

```json
{
  "publicationOptions": {
    "youtubePrivacy": "private",
    "madeForKids": false,
    "containsSyntheticMedia": false
  }
}
```

The manager must choose those values for the actual video; they are not inferred.

## Notifications

| Method and route                       | Body                      | Result                                                                                    |
| -------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------- |
| `GET /api/notifications`               | None                      | `{notifications,unreadCount,preferences}`; latest 100 notifications for the current user. |
| `POST /api/notifications/:id/read`     | `{}`                      | Mark that user’s notification read.                                                       |
| `POST /api/notifications/read-all`     | `{}`                      | Mark current notifications read through the server timestamp.                             |
| `PATCH /api/notifications/preferences` | Partial `{sound,desktop}` | `{preferences}`; persisted per user.                                                      |

Review decisions, comments, content/publication changes, document/task updates
and selected research/connection failures create durable inbox entries in the
same transaction as their audit event. Recipients depend on the event:
managers, the post owner/comment participants, task assignees or the active team.
The actor does not receive their own notification.

Sound and browser desktop preferences default off. The frontend polls while
open; browser permission/user interaction is needed for desktop alerts and
sound. This is not an email/SMS service or a service-worker push system that
guarantees alerts after the application closes.

## Shared resources and documents

Each collection below supports `POST /api/<collection>`,
`PATCH /api/<collection>/:id` and `DELETE /api/<collection>/:id`.
Authenticated members can collaborate; mutations are audited.

| Collection    | Writable fields                                     | Notes                                                                                       |
| ------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `sources`     | `name,url,category,status`                          | Create/update status is `manual` or `paused`; actual watches establish monitored readiness. |
| `competitors` | `name,platform,url,category,notes,monitoringStatus` | Platform includes `website`. A bookmark alone starts no monitoring.                         |
| `tasks`       | `title,owner,dueDate,status,priority`               | Real YYYY-MM-DD due date; status `todo/in_progress/done`.                                   |
| `documents`   | `title,category,content`                            | At most 100,000 content characters; PATCH also requires `expectedVersion`.                  |

Document content accepts legacy text/Markdown or a JSON string with this
validated block structure:

```json
{
  "schema": "stmarys.blocks",
  "version": 1,
  "blocks": [
    { "id": "intro", "type": "heading", "text": "Admissions campaign" },
    { "id": "review", "type": "checklist", "text": "Review the source", "checked": false }
  ]
}
```

Supported types: `paragraph`, `heading`, `bullet`, `checklist`, `quote`.
There are at most 100 blocks, unique block IDs and 10,000 text characters per
block. Content is plain data, not executable/trusted HTML.

A document entity has its own increasing `version`, separate from the block
format’s version. PATCH must send that entity’s current `expectedVersion`.
Conflicts return 409 `stale_document`; clients must review the latest version
before retrying. `GET /api/documents/:id/history` returns `{revisions}` with up to
50 saved snapshots. This implements safe whole-document saves and history, not
simultaneous character-level collaboration or Notion database relations.

## Research briefs

| Method and route                    | Body                                                                                    | Result                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `POST /api/opportunities`           | `{title,summary,source,sourceUrl,category,publishedAt?,audience,contentAngle,priority}` | Unverified brief with provenance.                  |
| `PATCH /api/opportunities/:id`      | Supported status/verification changes                                                   | Managers alone can mark evidence verified.         |
| `POST /api/opportunities/:id/draft` | Empty                                                                                   | Duplicate-safe deterministic draft from the brief. |

Categories are `Exam update`, `Board update`, `Medical seats`, `Competitor`
and `Content idea`. Priority is `high`, `medium` or `low`. Recording a URL or
detecting a new link does not verify its claims. The draft builder does not call
an AI service. A later brief/source change does not silently rewrite an existing
draft or reapprove it.

## Intelligence: sources, competitors, SEO and AEO/GEO

`GET /api/intelligence` returns:
`{watches,notices,sourceCatalog,siteVerifications,seoAudits,answerPrompts,answerObservations,automation}`.
The same object is included in bootstrap.

### Watch and notice routes

| Method and route                            | Body                                                           | Result / access                                                          |
| ------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `GET /api/intelligence/watches`             | None                                                           | `{watches}`.                                                             |
| `POST /api/intelligence/watches`            | `{kind,resourceId,mode,url?,keywords?,intervalHours?,active?}` | `{watch}`; manager.                                                      |
| `PATCH /api/intelligence/watches/:id`       | Partial `{url,keywords,intervalHours,active}`                  | Updated watch; manager.                                                  |
| `DELETE /api/intelligence/watches/:id`      | None                                                           | Remove watch/notices; created briefs/posts remain; manager.              |
| `POST /api/intelligence/watches/:id/run`    | Empty                                                          | Check one watch; manager. Includes added/updated/baseline/skipped state. |
| `POST /api/intelligence/run`                | Empty                                                          | Bounded due sweep; manager.                                              |
| `POST /api/intelligence/catalog/:id`        | Empty                                                          | Idempotently add the catalog source and watch; manager.                  |
| `GET /api/intelligence/notices`             | None                                                           | Latest notice inbox.                                                     |
| `PATCH /api/intelligence/notices/:id`       | `{status:"new"\|"saved"\|"dismissed"}`                         | Update inbox state.                                                      |
| `GET /api/intelligence/notices/:id/history` | None                                                           | Retained detected metadata revisions.                                    |
| `POST /api/intelligence/notices/:id/brief`  | Optional `{audience,contentAngle,priority}`                    | `{opportunity}`; duplicate-safe, initially unverified.                   |

`kind` is `source` or `competitor`; `resourceId` refers to its existing bookmark.
`mode` is `rss`, `html` or `youtube`. YouTube requires a channel ID or
`/channel/` URL; handles alone are not resolved.

Watches accept public HTTPS pages/feeds, 6–168 hour intervals and keyword filters.
Limits are 50 watches, 80 matching entries per scan and two due watches per
scheduled invocation. The first successful scan is a baseline, including after
an earlier failure. Detected time and publisher time remain distinct.
Title/link/excerpt changes create history and clear linked brief verification.
HTML monitoring does not parse PDF contents or detect every same-URL PDF rewrite.

Network reads enforce private-network/DNS/redirect protection, pinned checked
addresses, robots rules, timeouts and bounded responses. Durable claims fence
stale workers; errors preserve previous results and back off. Instagram,
Facebook and LinkedIn arbitrary competitor-profile scraping is not implemented.
Their saved profiles remain manual unless an explicitly supported public feed
is used. No private competitor reach, ad spend or lead data is invented.

### SEO routes

| Method and route                          | Body     | Result / access                                     |
| ----------------------------------------- | -------- | --------------------------------------------------- |
| `GET /api/intelligence/sites`             | None     | `{sites,audits}`.                                   |
| `POST /api/intelligence/sites`            | `{url}`  | Register exact HTTPS origin and challenge; manager. |
| `POST /api/intelligence/sites/:id/verify` | Empty    | Verify ownership; manager.                          |
| `POST /api/intelligence/sites/:id/audit`  | `{url?}` | `{audit}`; same verified origin, manager.           |
| `DELETE /api/intelligence/sites/:id`      | None     | Remove registration; manager.                       |

Ownership uses the supplied token in the exact
`/.well-known/stmarys-marketing-verification.txt` file or an actual homepage-head
`stmarys-marketing-verification` meta tag. Verification expires after 30 days.
The audit checks fetched HTML metadata, headings, canonical URLs, language,
images, links, robots declarations and JSON-LD. It is a single-page check with
stored evidence, not a rendered-browser crawl, Core Web Vitals test, indexing
guarantee or fabricated SEO score. Search Console reporting is a separate
authorized provider connection.

### AEO/GEO routes

| Method and route                                   | Purpose                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| `GET/POST /api/intelligence/answer-prompts`        | Read/create reproducible test prompts.                              |
| `PATCH /api/intelligence/answer-prompts/:id`       | Edit prompt, intent, institution, language, locale and target URL.  |
| `DELETE /api/intelligence/answer-prompts/:id`      | Remove prompt; manager.                                             |
| `GET/POST /api/intelligence/answer-observations`   | Read/store dated provider/model results with excerpts and evidence. |
| `DELETE /api/intelligence/answer-observations/:id` | Remove observation; manager.                                        |

Observations include the prompt snapshot, date, language/location context,
provider/model, whether the institution was mentioned, citation URLs and an
evidence URL. A claimed target citation must match the target website.
These are manually recorded observations; this release neither calls AI search
providers on a schedule nor claims a universal GEO ranking.

## Provider connections and reports

Supported provider IDs:

| ID                | Reporting                                            | Implemented publication                          |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------ |
| `google`          | GA4 property traffic, acquisition, pages, key events | None                                             |
| `search_console`  | Search clicks, impressions, queries and pages        | None                                             |
| `youtube`         | Authorized channel analytics                         | One MP4 in Video format                          |
| `google_business` | Selected location performance                        | Text or one image, Post format                   |
| `google_ads`      | Account/campaign reporting                           | None; read-only                                  |
| `instagram`       | Professional-account insights                        | One image, 2–10 image carousel, or one Reel      |
| `facebook`        | Page/post metrics                                    | Page text or one image, Post format              |
| `meta_ads`        | Ad-account/campaign reporting                        | None; read-only                                  |
| `linkedin`        | Organization statistics, subject to access           | Organization text or one image, Post format      |
| `linkedin_member` | Not included                                         | Authorized member text or one image, Post format |

There are no campaign-creation, budget-change or ad-spend endpoints.
App credentials can be shared by a provider family, but each service requests its
own authorization scopes. Provider review, access grants and quotas still apply.

| Method and route                                | Body / result                                                                                       | Access                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------- |
| `GET /api/connections`                          | `{providers,connections}`                                                                           | Authenticated           |
| `PUT /api/connections/providers/:provider`      | Provider application configuration, including `clientId/clientSecret` and supported provider fields | Manager                 |
| `POST /api/connections/authorize`               | `{provider,institution}` → authorization URL                                                        | Manager                 |
| `GET /api/connections/oauth/:provider/callback` | OAuth callback with bound, expiring state                                                           | Session/state validated |
| `GET /api/connections/:id/accounts`             | Discover accessible accounts/properties/locations                                                   | Manager                 |
| `POST /api/connections/:id/select`              | `{accountId}` → exact institution mapping                                                           | Manager                 |
| `POST /api/connections/:id/test`                | Check permission without publishing                                                                 | Manager                 |
| `POST /api/connections/:id/sync`                | Optional `{startDate,endDate}` → stored report                                                      | Manager                 |
| `POST /api/connections/:id/sync-settings`       | `{autoSync,syncIntervalHours?}` → updated Connection                                                | Manager                 |
| `GET /api/connections/:id/report.csv`           | Export last imported report                                                                         | Authenticated           |
| `DELETE /api/connections/:id`                   | Disconnect; in-flight send safeguards apply                                                         | Manager                 |

Connection states include `awaiting_selection`, `connected`,
`needs_attention` and `disconnected`. An account selection cannot silently
retarget an existing approved destination to a different account.

Manual report imports accept at most 90 inclusive dates, with stricter provider
limits where necessary. Default manual dates are the 30 dates ending UTC
yesterday. Always use explicit dates when comparing with a provider dashboard.
Reports preserve provider/account, date range, import time, currency/timezone
where returned and metric definitions. Missing data is not presented as zero.
Unique-user/reach totals are not calculated by summing overlapping daily or
campaign counts.

Automatic importing defaults **off**, interval 24 hours. Enabling it requires a
healthy analytics-capable connection; intervals may be 6–168 hours. Each scheduled
run handles at most one due account using the same five-minute lease as manual
imports. The automatic window is 28 inclusive calendar dates ending two UTC
dates before the run. This two-day lag avoids importing an unfinished local day;
providers may still revise attribution or delayed data.

The connection exposes `autoSync`, `syncIntervalHours`, `nextSyncAt`,
`lastSyncAt` and `error`. Transient failures retain connected status and retry at
the configured interval. Permission/expired-auth failures require testing or
reauthorization. The latest successful report remains available after failure.
Scheduled failures notify managers.

## Private media

| Method and route                       | Body / result                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `GET /api/media`                       | Visible assets and image upload configuration.                                                                 |
| `POST /api/media`                      | Raw JPEG/PNG/WebP bytes, at most 3 MiB; appropriate Content-Type and URL-encoded `x-file-name`; returns asset. |
| `GET /api/media/:id/content`           | Authenticated, authorized private content retrieval.                                                           |
| `POST /api/media/uploads`              | `{name,mimeType:"video/mp4",size}` → upload ID, signed PUT URL, headers and expiry.                            |
| `PUT /api/media/uploads/:id/content`   | Local development upload fallback; unavailable on Vercel.                                                      |
| `POST /api/media/uploads/:id/complete` | `{}` → validated immutable video asset; repeated completed call is idempotent.                                 |

Images are decoded, normalized to JPEG and stripped of metadata before preview
and approval. Transparency becomes white. Approved bytes are immutable.

Videos use direct signed uploads to configured private storage, avoiding a large
Vercel request body. MP4 files are limited to 40 MiB and ten minutes, H.264 video
with optional supported AAC audio. Validation checks file structure and declared
tracks; it is not a transcoder or a full decode of every frame. Provider-specific
restrictions still apply: the Instagram adapter requires a 9:16 Reel, at least
320 pixels wide and 3–600 seconds long.

Direct-upload completion verifies the actual byte count, format and hash before
an asset becomes attachable. Pending uploads expire after two hours. Full
40 MiB reservations remain against the shared 200-asset/512 MiB allowance until
completion or confirmed expired-object cleanup. Completion claims prevent
duplicate validation races. A member may prepare at most 20 video uploads per
24-hour period.

The server keeps storage credentials private. Temporary media delivery URLs are
created only for provider delivery; the normal media library remains behind
workspace authorization. Local filesystem media is a development option.
Hosted video requires the configured private storage broker.

## Publication jobs and background workers

| Method and route                       | Body / result                                                        | Access      |
| -------------------------------------- | -------------------------------------------------------------------- | ----------- |
| `POST /api/posts/:id/publications`     | `{revision,scheduledAt?}` → `{jobs}` for exact approved destinations | Manager     |
| `POST /api/publications/:id/retry`     | Retry eligible unambiguous failure/cancellation                      | Manager     |
| `POST /api/publications/:id/cancel`    | Cancel an unsent eligible job                                        | Manager     |
| `POST /api/publications/:id/reconcile` | `{remoteId}`; verify a suspected remote result                       | Manager     |
| `POST /api/jobs/run`                   | Process one due publication job                                      | Manager     |
| `GET /api/jobs/run`                    | Same publication worker                                              | Cron secret |
| `GET /api/intelligence/cron`           | Up to two due watches and bounded expired-upload cleanup             | Cron secret |
| `GET /api/reports/cron`                | Up to one due account report                                         | Cron secret |

Cron authentication is `Authorization: Bearer <CRON_SECRET>`.
`vercel.json` requests publication checks every five minutes and intelligence/
report checks every fifteen minutes. Deployment-plan scheduling support, worker
duration and queue backlog affect actual execution time; these are bounded
workers, not exact-time delivery guarantees.

Job states are `queued`, `processing`, `published`, `failed`,
`needs_reconciliation` and `cancelled`. Jobs retain the exact approved content
snapshot, account and media hashes. Workers recheck approval, account and format
before sending. Provider confirmation is required before recording success.
An ambiguous send is not blindly retried: a manager must inspect/reconcile it.
Read-back limitations for a provider are shown rather than bypassed.

## Errors and verification

Errors return `{error,code}` with a safe user-facing message. Common statuses:
400 malformed JSON/setup token; 401 missing session/cron credential;
403 role/ownership/CSRF/origin; 404 missing record;
409 stale revision/document, conflicting lease/state or required reconnection;
413 oversized body; 422 invalid fields/unsupported format;
429 rate limit/cooldown; 503 missing configuration.

Core audit events and related notifications are durable. Migrations preserve
existing drafts and approvals; new source detection does not auto-publish.
Application integration tests use temporary databases and controlled provider
responses. They validate auth, approval/content hashes, durable jobs, report
semantics, concurrency, media, SSRF protection and source provenance. A passing
test suite does not establish authorization to a real provider.

```sh
npm test
npm run check
npm run build
```

Production acceptance still requires connecting the school’s actual accounts,
reconciling imported metrics against the same provider/date range and explicitly
approving controlled test publications. See [the roadmap](ROADMAP.md).
