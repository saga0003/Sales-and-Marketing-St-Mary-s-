# Workspace API

This release provides a persistent team workspace, source and competitor bookmarks,
content drafting, revision-specific manager approval, local scheduling, tasks,
documents, and an audit trail. It does **not** connect to a social network, fetch
live news, import analytics, send messages, or publish externally.

`publishingEnabled` is always `false`. A post in `scheduled` is a **local plan**.
The server never turns it into `published`, even after its planned time passes.
There is no publication endpoint or background publisher.

## Runtime and startup

- Node.js 24 or newer; ES modules (`.mjs`).
- Express 5, Zod 4, and Node's built-in `node:sqlite`.
- `server/index.mjs` is the executable entry point.
- `server/app.mjs` exports `createApp(options)` for integration tests.
- Port defaults to `3001`; bind address defaults to `0.0.0.0`.
- Built frontend files are served from `dist/` if `dist/index.html` exists at startup.
- In development, Vite should proxy `/api` with `changeOrigin: false`.

### Configuration

| Variable                   | Default                                              | Purpose                                                                                                                     |
| -------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `DEMO_MODE`                | `false`                                              | Set explicitly to `true` for a sample workspace with automatic demo sign-in.                                                |
| `DATABASE_PATH`            | `data/workspace.sqlite` relative to the project      | Persistent SQLite database. Use a durable volume on a server.                                                               |
| `PORT`                     | `3001`                                               | HTTP listening port.                                                                                                        |
| `BIND_ADDRESS`             | `0.0.0.0`                                            | HTTP listening address.                                                                                                     |
| `BOOTSTRAP_ADMIN_EMAIL`    | None                                                 | Required when creating the first production workspace.                                                                      |
| `BOOTSTRAP_ADMIN_PASSWORD` | None                                                 | Required on first production initialization; 12–256 characters.                                                             |
| `BOOTSTRAP_ADMIN_NAME`     | `Workspace manager`                                  | Initial production manager's display name.                                                                                  |
| `APP_ORIGIN`               | Current request origin                               | Optional exact trusted HTTP(S) application origin for mutation checks. Set it to the public application URL behind a proxy. |
| `COOKIE_SECURE`            | `true` when `NODE_ENV=production`, otherwise `false` | Mark session cookies `Secure`; use `true` for public HTTPS deployments.                                                     |
| `TRUST_PROXY`              | `false`                                              | Set to `true` only when running behind exactly one trusted reverse proxy.                                                   |

Boolean environment values accept `true`/`false` or `1`/`0`. Invalid values fail
startup. There are no default production credentials. Bootstrap credentials are
used only when initializing an empty production database; changing the variables
does not silently change an existing account's password.

### Demo and production data

Demo mode seeds an **empty** database once. It includes illustrative posts,
opportunities, tasks, documents, campaigns and analytics. Official-source URLs
are bookmarks, not evidence that a notice has been checked. Competitor examples
are explicitly fictional. All integrations remain disconnected.

An unauthenticated demo bootstrap creates a manager session. The demo role
switch allows trying the contributor workflow. Demo accounts have random,
unpublished passwords, so they cannot accidentally become known production
credentials. People opening the same demo deployment share its sample records.
Use production mode for real team work.

The database stores its mode. A demo database cannot be reopened in production,
or vice versa. Use a separate `DATABASE_PATH`. Restarting the application does
not reinsert deleted examples or overwrite edited records.

A new production workspace contains its initial manager and an initialization
audit entry. Content, watchlists, source bookmarks, tasks, documents and analytics
start empty. No illustrative figures are returned in production.

## Request conventions

All endpoints are same-origin under `/api`. Send JSON bodies with
`Content-Type: application/json`. Bodies are limited to 256 KiB. Unknown input
fields are rejected; client-supplied roles, ownership, approval fields and
publication states are never accepted as post input.

Successful list reads use `GET /api/bootstrap`. It returns the `WorkspaceData`
shape in `src/lib/types.ts`, including the current user, active team members,
all workspace collections, the latest 150 audit entries, integration status,
analytics, `demoMode`, `publishingEnabled`, and a session CSRF token.

Successful entity creation/update endpoints return the **entity directly**.
Creation uses HTTP `201`; updates and transitions use `200`. Deletes return
`{ "ok": true }`. The UI can reload bootstrap after a mutation to refresh
related records and the audit trail.

### Authentication and CSRF

Production authentication uses email and password. Passwords are hashed with
scrypt using independent random salts. The browser receives an opaque session
cookie named `smis_session`; its value is hashed before storage in SQLite.
Cookies are `HttpOnly`, `SameSite=Lax`, scoped to `/`, and optionally `Secure`.
Sessions expire after 12 hours and survive application restarts.

Every authenticated mutation—including logout and the demo role switch—requires:

```http
x-csrf-token: <csrfToken returned by bootstrap or login>
```

The token must match the active session. Login and demo role switching rotate
both the session cookie and CSRF token and revoke the previous session for that
browser. An `Origin` or `Referer` header, when supplied, must match `APP_ORIGIN`
or the application's request origin. Cross-site Fetch Metadata is rejected.
Non-browser API clients may omit `Origin` but still need the session cookie and
CSRF token for authenticated mutations. The API does not enable cross-origin
access.

The login endpoint is unauthenticated and origin-checked. A process-local limiter
limits sign-in attempts by both IP address and account. For a multi-instance
deployment, use a shared limiter at the edge or replace this store with a shared
implementation.

## Endpoints

### Session and team

| Method and route           | Body                              | Result / access                                                                                                                   |
| -------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`          | None                              | `{status:"ok", demoMode, publishingEnabled:false}`. No authentication required.                                                   |
| `GET /api/bootstrap`       | None                              | `WorkspaceData`. Production returns `401 {error, demoMode:false}` without a session. Demo creates a manager session when missing. |
| `POST /api/auth/login`     | `{email, password}`               | `{user, csrfToken}` plus session cookie.                                                                                          |
| `POST /api/auth/logout`    | None                              | `{ok:true}` and revoked/cleared current session. Requires CSRF.                                                                   |
| `POST /api/auth/demo-role` | `{role:"manager"\|"contributor"}` | `{user, csrfToken}` with a new demo session. Demo only; production returns `404`.                                                 |
| `POST /api/users`          | `{name, email, role, password}`   | Creates a team member. Manager only. Password must be at least 12 characters. No invitation email is sent.                        |

User records returned to the browser contain only `id`, `name`, `email`, `role`
and derived `initials`. Password hashes and session storage are never exposed.
The first release does not include password recovery, account editing, or
account removal endpoints.

### Content

| Method and route                 | Body                                                | Result                                                                     |
| -------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| `GET /api/posts/:id`             | None                                                | A `Post`. Any authenticated team member may read team content.             |
| `POST /api/posts`                | `PostInput` without `revision`                      | A new draft at revision `1`, owned by the authenticated user.              |
| `PATCH /api/posts/:id`           | Changed `PostInput` fields plus required `revision` | Updated `Post`; content changes increment the revision and reset approval. |
| `POST /api/posts/:id/transition` | `{action, revision, feedback?, scheduledAt?}`       | Updated `Post` after a permitted state change.                             |

Example creation input:

```json
{
  "title": "Questions to bring on a campus visit",
  "caption": "Ask about subjects, student support and how progress is shared.",
  "platforms": ["instagram", "facebook"],
  "format": "Carousel",
  "institution": "St. Mary’s ISC",
  "scheduledAt": null,
  "language": "English",
  "palette": "navy",
  "sourceUrl": "",
  "mediaUrl": ""
}
```

Important field rules:

- Titles are 1–180 characters. Captions may be empty while drafting and are
  limited to 12,000 characters; submitting requires nonempty content.
- Platforms are unique selections from `instagram`, `facebook`, `youtube`,
  `linkedin`, and `google_business`; choose at least one.
- Formats are `Post`, `Carousel`, `Reel`, `Video`, or `Article`.
- Language is `English`, `Kannada`, or `English + Kannada`.
- Palette is `violet`, `navy`, `sage`, or `peach`.
- `scheduledAt` is an ISO 8601 datetime with a time zone, or `null`. The server
  normalizes it to UTC. The frontend displays India Standard Time.
- `sourceUrl` and `mediaUrl` may be empty. Otherwise they must be complete HTTP(S)
  URLs without embedded credentials. The API stores them and does not fetch them.
- `ownerId`, `status`, approval fields, timestamps and sample flags are assigned
  server-side. A browser cannot set `published`.

### Revision and permission rules

A content revision describes the title, copy, channels, format, institution,
language, preview, source, media and planned date saved through the editor.

Contributors may create drafts and edit or submit their **own** records in
`draft`, `changes_requested` or `rejected`. They cannot edit another author's
content, change an item under review, approve, reject, or schedule.

Managers may edit any non-published draft. An actual content edit increments its
revision, changes its status to `draft`, clears approval metadata, and removes
its active local queue state. The intended date may remain available as a
planning field, but the post is no longer `scheduled`. An unchanged PATCH does
not create a spurious revision. Published content cannot be edited in this
release.

Every edit and transition compares the submitted revision with the stored
revision **inside a database transaction**. A mismatch returns `409
stale_revision`; it never overwrites the newer content. The frontend must reload
the current draft and ask the user to review it.

### State transitions

| Action            | Allowed current state                    | Who               | Result                                                                   |
| ----------------- | ---------------------------------------- | ----------------- | ------------------------------------------------------------------------ |
| `submit`          | `draft`, `changes_requested`, `rejected` | Author or manager | `in_review`; clears previous active feedback.                            |
| `approve`         | `in_review`                              | Manager           | `approved`, with `approvedRevision`, `approvedBy` and `approvedAt`.      |
| `request_changes` | `in_review`, `approved`, `scheduled`     | Manager           | `changes_requested`; requires feedback; clears approval and queue state. |
| `reject`          | `in_review`, `approved`, `scheduled`     | Manager           | `rejected`; requires feedback; clears approval and queue state.          |
| `schedule`        | `approved` with exact current approval   | Manager           | `scheduled`, only with a future datetime. Local planning only.           |
| `unschedule`      | `scheduled`                              | Manager           | `approved`; clears the planned datetime.                                 |

Approval and other workflow transitions do not increment the **content**
revision. Their decisions are appended to the audit trail. Scheduling normally
uses the saved `scheduledAt`; a manager can also explicitly supply a future
`scheduledAt` in the scheduling transition. That scheduling action is separately
audited and does not change the approved copy or destinations.

There is no `publish` action. A future connector must implement provider
authorization, account binding, delivery/retry handling and external publication
confirmation before any live publishing feature is enabled. It must retain the
revision checks and cannot treat a queued job as a successful publication.

### Intelligence

| Method and route                    | Body                                                                                                        | Result / rules                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `POST /api/opportunities`           | `{title, summary, source, sourceUrl, category, audience, contentAngle, priority, sourceKind, publishedAt?}` | Creates a manual research brief. Any authenticated team member; always `status: "new"`, `verified: false`. |
| `PATCH /api/opportunities/:id`      | `{status?:"new"\|"saved"\|"dismissed", verified?:boolean}`                                                  | An `Opportunity`. Only managers may change `verified`.                                                     |
| `POST /api/opportunities/:id/draft` | `{institution?, platforms?, format?, language?}` or `{}`                                                    | A new `Post`, or the existing draft if this opportunity was already converted.                             |

Team members can add real research briefs in production without a live ingestion
connector. `source` is the publisher's name, and `sourceUrl` is a required HTTP(S)
link without embedded credentials. `sourceKind` is either `official` or
`competitor`; this is a **manual classification, not verification**. The server
does not open the link. A manager must separately record verification after
reviewing the original evidence. Client-supplied `id`, `status`, `verified` and
other server-owned fields are rejected.

Categories are `Exam update`, `Board update`, `Medical seats`, `Competitor`, and
`Content idea`; priority is `high`, `medium`, or `low`. Title and publisher are
limited to 180 characters, summary to 6,000, audience to 300, and content angle
to 2,000. All are required and must be nonempty. `publishedAt` accepts an optional
ISO 8601 datetime with a time zone. When omitted, it defaults to the record's
creation time; that default is not proof of when the publisher issued a notice.
Creation and its audit entry are committed in one transaction.

Draft generation here is a deterministic brief builder, not an AI service. It
retains the source URL, summary and proposed angle, marks pending verification,
and includes an explicit sample notice when appropriate. A manager marking a
sample opportunity verified does not change `sourceKind: "sample"` into official
evidence. Retrying the draft action returns the same post rather than creating
duplicates. Changing an opportunity later does not silently rewrite its draft.

Production has no live ingestion service yet. Adding a source or competitor is
a bookmark operation; it does not start a watcher or claim the source was checked.

### Watchlists, tasks and documents

Authenticated team members can collaborate on these records. All mutations are
audited. Each collection supports `POST /api/<collection>`, `PATCH
/api/<collection>/:id`, and `DELETE /api/<collection>/:id`. PATCH accepts any
nonempty subset of its writable fields; omitted values are retained.

| Collection    | Writable fields                                                    | Creation defaults / notes                                                                                                 |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `competitors` | `name`, `platform`, `url`, `category`, `notes`, `monitoringStatus` | Platform also accepts `website`. Category defaults to `Education`, notes to empty, monitoring to `manual`.                |
| `sources`     | `name`, `url`, `category`, `status`                                | Status defaults to `manual`.                                                                                              |
| `tasks`       | `title`, `owner`, `dueDate`, `status`, `priority`                  | `dueDate` is a real `YYYY-MM-DD` calendar date. Status defaults to `todo`; priority to `medium`. Owner is a display name. |
| `documents`   | `title`, `category`, `content`                                     | Content defaults to empty and can contain up to 100,000 characters of plain text/Markdown.                                |

Watchlist status is limited to `manual` or `paused`. `ready` is deliberately
rejected while no monitoring worker exists. `lastCheckedAt` cannot be supplied
by a browser. Task status is `todo`, `in_progress`, or `done`; priority is `high`,
`medium`, or `low`.

Documents are stored as text, not executed or rendered as trusted HTML. The
first release supports whole-document updates, not simultaneous character-level
collaboration. Concurrent document/task edits follow the last successful save;
content posts have the stronger revision-conflict protection described above.

## Error format

API errors return JSON:

```json
{
  "error": "This draft has changed since you opened it. Refresh and review the latest revision.",
  "code": "stale_revision"
}
```

| Status | Meaning                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------- |
| `400`  | Malformed JSON.                                                                                 |
| `401`  | Missing/expired session or invalid login.                                                       |
| `403`  | Invalid CSRF/origin, or insufficient role/ownership.                                            |
| `404`  | Unknown record/endpoint, including the production demo-role endpoint.                           |
| `409`  | Stale content revision, invalid workflow state, missing current approval, or duplicate account. |
| `413`  | Request body exceeds the size limit.                                                            |
| `422`  | Invalid input, missing feedback/content, or invalid scheduling time.                            |
| `429`  | Sign-in attempt limit. A `Retry-After` header is supplied for a timed limit.                    |
| `500`  | Unexpected failure. Responses do not disclose database details or credentials.                  |

## Persistence and migrations

Schema migrations are ordered SQL files under `server/migrations/`. Applied
versions are recorded in `schema_migrations`. SQLite uses foreign keys, WAL
mode, a busy timeout, and transactions for content decisions and audit writes.

`post_revisions` preserves the exact saved content of each revision. `audit_log`
preserves actor, action, entity, time and a human-readable decision note. Passwords,
session cookies, CSRF tokens and provider secrets are never included in audit
details. This application currently stores no provider secrets at all.

Run only one application instance against a local database file for this first
release. Keep the database on durable storage and restrict filesystem access.
Use a SQLite-aware backup process, or stop the service before taking a file
backup; copying only the database file while WAL writes are active can miss
recent transactions. Deployment on an ephemeral serverless filesystem will
not provide durable collaboration.

## Verification

Run:

```sh
node --test server/app.test.mjs
```

The integration suite uses real HTTP requests and temporary/in-memory SQLite
databases. It verifies:

- Explicit demo/production separation and absence of production sample metrics.
- Password login, protected cookies and independent team-member sessions.
- CSRF and origin enforcement, plus revoked tokens after demo role switching.
- Server-side contributor ownership and review restrictions.
- Revision-bound approvals, invalidation on edit and rejection of stale writes.
- Future-only scheduling that never claims external publication.
- Reviewer feedback and resubmission.
- Manual production research briefs, with separate manager verification.
- Preserved source provenance and duplicate-safe opportunity-to-draft conversion.
- URL/date validation and partial workspace updates.
- Database/session/audit persistence without re-seeding on restart.

# Version 0.2 additions

The authenticated bootstrap response now includes `teamUsers` (manager only), `providerSetup`, `connections`, `mediaAssets`, `publicationJobs`, `websiteAnalytics`, `evaluationMode` and `storageMode`. Provider application secrets and account tokens never appear in these responses.

| Endpoint                                   | Purpose                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `POST /api/auth/setup`                     | Redeem a personal, expiring, single-use setup/recovery token and choose a password |
| `POST /api/auth/password`                  | Change password after verifying the current password; rotate sessions              |
| `PATCH /api/users/:id`                     | Manager-controlled name, role and active status                                    |
| `POST /api/users/:id/setup-link`           | Issue a replacement setup/recovery link; does not send email                       |
| `GET/POST /api/posts/:id/comments`         | Read or add revision-linked review discussion                                      |
| `GET /api/posts/:id/history`               | Saved revision snapshots and changes                                               |
| `POST /api/posts/:id/duplicate`            | Create a new unapproved draft                                                      |
| `GET /api/connections`                     | Provider setup requirements and authorized account states                          |
| `PUT /api/connections/providers/:provider` | Encrypt manager-provided Google or Meta application credentials                    |
| `POST /api/connections/authorize`          | Start session-bound OAuth authorization                                            |
| `GET /api/connections/:id/accounts`        | Discover accessible GA4 properties or eligible Instagram accounts                  |
| `POST /api/connections/:id/select`         | Map the exact account/property to its institution                                  |
| `POST /api/connections/:id/test`           | Check provider access without publishing                                           |
| `POST /api/connections/:id/sync`           | Import GA4 reports for an explicit date range                                      |
| `DELETE /api/connections/:id`              | Disconnect an account, subject to in-flight publication safeguards                 |
| `GET/POST /api/media`                      | List authorized media or upload raw image bytes, at most 3 MiB                     |
| `GET /api/media/:id/content`               | Authenticated private image retrieval                                              |
| `POST /api/posts/:id/publications`         | Ensure durable jobs for the exact approved revision and destinations               |
| `POST /api/publications/:id/retry`         | Retry an eligible, unambiguous failure/cancellation                                |
| `POST /api/publications/:id/cancel`        | Cancel a job that has not been sent                                                |
| `POST /api/publications/:id/reconcile`     | Verify a remotely published media ID after an ambiguous send                       |
| `POST /api/jobs/run`                       | Manager-triggered processing of one due job                                        |
| `GET /api/jobs/run`                        | Same bounded worker, authenticated by the server-only cron secret                  |

Manager approval automatically creates jobs when an approved revision has real publishing destinations. A local content plan without a destination does not send anything. Content edits revoke approval and cancel eligible pending jobs. The server prevents edits during an active or ambiguous send. See [the provider contract](../server/extensions/FRONTEND-CONTRACT.md) for exact payloads and [adapter operations](../server/extensions/README.md) for prerequisites and failure handling.
