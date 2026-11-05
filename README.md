# St. Mary’s Marketing Workspace

A shared school marketing workspace for content, manager approval, account reporting, competitor research, exam updates and career pathways. Staff prepare work in one place; managers review the exact revision before a connected destination can publish. React serves the interface, Express enforces permissions and workflow, and PostgreSQL stores the hosted workspace. SQLite remains available for local development and a single native server.

**Version 0.4 adds owner application administration, consent-based account selection, multiple-account separation, webpage comparisons, a research queue, reviewed exam and career guides, keyword trend charts, ChatGPT MCP access, and a storage/account information screen.** The [v0.4 user guide](docs/V04-USER-GUIDE.md) contains the 15-minute test, connection instructions, Supabase/storage details and ChatGPT setup.

Provider applications are configured once by the workspace owner; ordinary connection cards do not ask staff for secrets or callback URLs. The inspected workspace currently has **zero configured Google, Meta or LinkedIn applications**, so real authorization, provider imports and publishing still require that owner setup and provider permissions. Saved reports and research retain their source and account identity; empty connections and charts do not invent data. This release adds no paid connection broker, scraping service or OpenAI API calls. Existing hosting and storage remain subject to their plans and limits. Deployment and live-account acceptance are confirmed separately from this repository description.

## What is implemented

| Area                  | Working behavior                                                                                                                                                                                          | Current boundary                                                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content and approvals | Drafts, comments, immutable revisions, manager approval/rejection/change requests, calendar and approval-bound publication jobs                                                                           | Editing approved text, media, destinations or publication choices requires fresh approval. Empty destinations keep a review inside the workspace.                                               |
| Connections           | Owner-only Google/Meta/LinkedIn application settings; generated shared callback; provider consent and multiple-resource selection; separate school/resource identities                                    | Provider registration, product access and approval still apply. Configuration is currently absent in the inspected workspace. Credentials are not supplied by the software.                     |
| Notifications         | Persistent per-user inbox, unread counts, review/source/task/document events, optional sound and browser notifications                                                                                    | Sound requires a user gesture; visible tabs poll about every 20 seconds. No email or closed-browser push.                                                                                       |
| Team                  | Manager-created accounts, 24-hour single-use setup/recovery links, password changes, session revocation                                                                                                   | App-managed authentication backed by PostgreSQL, not Supabase Auth. A login email is not a mailbox. Email delivery, SSO and MFA are not configured.                                             |
| Reporting             | GA4, Search Console, YouTube, Google Business Profile, Facebook, Instagram, LinkedIn organization, Meta Ads and Google Ads adapters; account-specific reports, CSV exports and optional scheduled imports | Eligible accounts and provider access are required. Ads are reporting only; comparisons must retain date, currency and attribution context.                                                     |
| Publishing            | Instagram image/carousel/Reel, Facebook Page text/image, LinkedIn member/organization text/image, Google Business Profile standard text/image, YouTube MP4                                                | No Stories, Facebook video, LinkedIn video, automatic transcoding or ad campaign changes. Live sending requires configured connections and deliberate approval.                                 |
| Media and storage     | Private images and validated immutable H.264/AAC MP4 files; authenticated previews, temporary delivery URLs and a usage/project screen                                                                    | 3 MiB image input, 40 MiB/10-minute video, 200 committed or reserved items and 512 MiB app quota. Provider plan limits also apply.                                                              |
| Source monitoring     | Scheduled RSS/Atom/HTML notice monitoring, source catalog, baseline/history/deduplication, briefs and manager verification                                                                                | Linked PDFs are not parsed. A changed notice does not establish a verified exam date, approval status or seat count.                                                                            |
| Competitor research   | Website text snapshots and comparisons, public YouTube feeds, opt-in push controls, a research queue and dated profile evidence                                                                           | Social/GMB research requires actual source inspection by the team or an active ChatGPT session. Push remains pending until verified. No universal instant alerts or private competitor metrics. |
| Exams and careers     | Multiple exam guides, official references, milestones, linked source watches, career routes, revision history and manager review                                                                          | The registry starts from entered sources and reviewed evidence; it is not a complete or automatically verified admissions database. Source changes can invalidate review.                       |
| Keyword trends        | Per-keyword charts from daily finalized Search Console data, separate recorded search checks, and contextual AEO/GEO observations                                                                         | Direct Google checks use a three-day reporting offset. Missing data is not rank zero. No paid SERP service or universal AI-answer rank.                                                         |
| Website checks        | Owned-origin single-page HTML audits, findings and task creation                                                                                                                                          | A bounded page check, not a full-site crawler or a search ranking guarantee.                                                                                                                    |
| ChatGPT and MCP       | OAuth-based connection with read access and optional draft/research permissions; 30-day grants and revocation                                                                                             | Requires an active supported ChatGPT session. No automatic background AI, OpenAI API calls, social publication, approvals, credential management or ad spending through MCP.                    |
| Workspace             | Tasks, categories, paragraph/heading/list/checklist/quote blocks, version history, restore and stale-edit conflicts                                                                                       | No real-time co-editing, Notion databases or arbitrary embedded code.                                                                                                                           |

The interface follows the supplied visual direction: light surfaces, dark navigation, violet accents, a review list beside selected content and responsive layouts. [Earlier interface previews](docs/images/overview-1793779635887.jpg) contain illustrative records. Hosted evaluation mode uses authenticated accounts and real saved data; it does not enable anonymous demo sign-in.

## Approval and publication

1. The author writes a draft, attaches immutable media and selects the intended connected destinations. Leaving destinations empty keeps the review inside the workspace.
2. A manager approves that exact revision or returns it with feedback. The other participant receives an inbox notification.
3. An approved, publishable revision creates one durable job per destination. A future scheduled time delays eligibility.
4. The worker rechecks approval, the active approving manager, destination, saved payload and media hashes. Success requires a confirmed provider ID. YouTube records returned privacy and processing state.
5. An ambiguous result after sending is held for reconciliation. The worker does not blindly repeat an uncertain publication. Editing invalidates approval and cancels pending jobs; processing or uncertain jobs require resolution first.

`PUBLISHING_ENABLED=true` and private cloud delivery are required for live worker sends. **Approving a valid connected destination can result in a real external post.** The five-minute publication worker processes at most one due job per invocation. Separate fifteen-minute workers check up to two due intelligence watches and one opted-in analytics account. Watch intervals are at least six hours; reports default to daily after a manager enables automatic import. Queue backlog, provider processing and outages can delay work.

See [account setup](docs/CONNECTING-ACCOUNTS.md) for each provider's prerequisites and [developer operations](server/extensions/README.md) for credential storage, worker behavior and recovery. No advertising campaign creation, budget changes or ad spending is implemented.

## Local development

Use **Node.js 24.x** and npm. Dependencies are locked. Local development uses Node’s built-in SQLite; no separate SQLite server is needed.

```sh
nvm install
nvm use
npm ci
NODE_ENV=development DEMO_MODE=true DATABASE_URL= DATABASE_PATH=./data/demo.sqlite \
  AUTO_MIGRATE=true COOKIE_SECURE=false APP_ORIGIN=http://localhost:5173 \
  npm run dev -- --port 5173
```

Open **http://localhost:5173**. Vite proxies `/api` to port 3001. The demo seeds labelled sample records and offers a manager/contributor switch. Keep it on a private development machine: anyone with access can enter. It does not automatically connect to providers or send posts.

The development script reads `.env` and respects shell overrides. The command above clears `DATABASE_URL` and selects a separate demo database. Demo and production mode markers cannot be mixed. `DEMO_MODE=true` is rejected on Vercel.

```sh
npm run check
npm test
npm run build
npm run format:check
```

Tests cover account setup and revocation, CSRF/origin checks, role/ownership rules, approval revisions, concurrent edits, collaboration, durable rate limits and async transaction isolation. Provider tests exercise encrypted credentials, OAuth state, private media, GA4 aggregation and publication recovery using injected provider responses. They do not contact school accounts or publish. Hosted PostgreSQL, OAuth consent and actual delivery also require verification in the deployment with authorized accounts.

## Vercel deployment

`vercel.json` builds `dist/` with Vite and serves static files from the CDN. `api/index.mjs` routes `/api/*` to one memoized asynchronous Express application. All durable records, sessions, rate limits and jobs live in PostgreSQL; no SQLite file is created on Vercel.

Configuration: Node 24.x through package/project settings, Fluid Compute, Mumbai `bom1`, a 180-second API duration, a five-minute publication cron and separate fifteen-minute intelligence/reporting crons. Official references: [Node functions](https://vercel.com/docs/functions/runtimes/node-js), [Express](https://vercel.com/docs/frameworks/backend/express), [Vite routing](https://vercel.com/docs/frameworks/frontend/vite), [duration limits](https://vercel.com/docs/functions/configuring-functions/duration). Five-minute cron requires Pro/Enterprise; [Hobby supports daily cron](https://vercel.com/docs/cron-jobs/usage-and-pricing).

### Private PostgreSQL setup

Use a dedicated database/project near the function region and a restricted application login. A database administrator should pre-create `smis_marketing`, grant the app role `CONNECT` to the database and `USAGE`/`CREATE` on **only that schema**. The app role owns the tables it creates. It needs neither superuser privileges, role/database creation nor ownership of the whole database/schema.

Do not grant the app role access to other applications’ schemas. Keep `smis_marketing` outside the public Data API exposed-schema list and grant no `anon`/`authenticated` access to its tables. This application uses its own server sessions and a direct database connection. Do not put a PostgreSQL superuser, Supabase service-role key or privileged project key in the app runtime or browser.

Use the transaction pooler’s prescribed username, host and port with verified TLS, for example `sslmode=verify-full`. The adapter issues `SET LOCAL search_path` inside every transaction; it does not depend on persistent connection session settings. Request-local clients, row locks and revision compare-and-swap protect concurrent work. Core and extension migrations use the same transaction-scoped advisory lock.

### Environment

`.env.example` lists every supported setting. Put hosting secrets in Vercel environment settings, never source files or `VITE_*` variables. Production and preview should use separate databases and credentials; leave a preview unconfigured until isolated credentials are available.

| Variable                                             | Purpose                                                                                                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                       | Restricted PostgreSQL connection string; required on Vercel                                                                                    |
| `DATABASE_SSL_CA`                                    | Optional trusted provider root CA in PEM format; TLS certificate and hostname verification stay enabled                                        |
| `DATABASE_SCHEMA=smis_marketing`                     | Private application schema                                                                                                                     |
| `AUTO_MIGRATE=true`                                  | Initial deployment/reviewed migration rollout only; switch to `false` and redeploy after success                                               |
| `DEMO_MODE=false`, `EVALUATION_MODE=true`            | Authenticated evaluation, without sample seeding or login bypass                                                                               |
| `APP_ORIGIN`                                         | Canonical HTTPS origin without path; used for OAuth callbacks and account links                                                                |
| `COOKIE_SECURE=true`, `TRUST_PROXY=true`             | HTTPS cookies and trusted hosting proxy                                                                                                        |
| `NODEJS_HELPERS=0`                                   | Express owns JSON/raw image parsing; [official helper opt-out](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration) |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`      | Initial manager identity                                                                                                                       |
| `BOOTSTRAP_SETUP_TOKEN`                              | Random single-use first-login token; manager chooses the password                                                                              |
| `CREDENTIAL_ENCRYPTION_KEY`                          | Fresh 32-byte base64/hex key, preserved across deployments                                                                                     |
| `MEDIA_BROKER_URL`, `MEDIA_BROKER_PRIVATE_KEY`       | Dedicated signed broker for private cloud media; see provider guide                                                                            |
| `BLOB_READ_WRITE_TOKEN` / `BLOB_STORE_ID`            | Alternative private Vercel Blob configuration                                                                                                  |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`           | Optional shared Google-family OAuth app credentials; Settings can save them encrypted instead                                                  |
| `META_APP_ID`, `META_APP_SECRET`, `META_API_VERSION` | Optional Meta app settings; API version is pinned in the example                                                                               |
| `PUBLISHING_ENABLED`                                 | Gate for processing approved live jobs                                                                                                         |
| `CRON_SECRET`                                        | Distinct random secret required by all three scheduled GET worker endpoints                                                                    |

Generate unique setup/cron tokens using 32 random bytes encoded as base64url. Do not reuse them as encryption keys. Preserve the encryption key separately: replacing it without migrating ciphertext makes saved provider credentials unreadable.

### First login and team access

Deploy initially with `AUTO_MIGRATE=true`. Startup applies missing migrations and creates an empty production workspace. Give the initial manager a private link using the configured origin and token:

```text
https://your-workspace.example/#setup?token=YOUR_PRIVATE_TOKEN
```

The link expires 24 hours after initialization and works once. The manager chooses a password of at least 12 characters. The fragment keeps the token out of ordinary page request URLs. Do not publish the full link in the repository, tickets or logs. `/api/config` contains public login settings, never the token or initial email.

After successful initialization, set `AUTO_MIGRATE=false`, remove the consumed bootstrap token and redeploy. Normal starts check schema versions without DDL. Changing bootstrap values does not reset an account. A failed connection never triggers dropping data or inserting demo records.

Managers add colleagues and create setup/recovery links in **Settings → Team**. New links invalidate earlier unused links. Consuming a link or changing a password revokes older sessions; deactivation also revokes pending links. Links are displayed once for manual sharing. No email is sent.

### Verify the deployment

Check `/api/health` for PostgreSQL persistence and `/api/config` for evaluation settings. Unauthenticated `/api/bootstrap` must return 401. Complete first login, create a draft, refresh and open another session to verify shared persistence. Test raw upload and preview. Health confirms initialization, not a successful provider connection.

Configure the Google, Meta or LinkedIn application and exact callback URLs shown in Settings. Authorize a school account, select the intended resource, test the connection and import a small report period. Enable automatic imports only after comparing a report with its provider. Validate each publishing format with a deliberately approved test item and inspect the actual remote result. Use two separate workspace accounts to verify review notifications; an actor does not notify themselves. See the full test guide for precise steps.

## Native Node and Docker

For one native server, copy `.env.example` to `.env`, restrict permissions, leave `DATABASE_URL` empty and select a production SQLite path. Configure bootstrap access and an HTTPS reverse proxy, then:

```sh
npm ci
npm run build
AUTO_MIGRATE=true npm start
```

After initialization, normal `npm start` uses the example’s `AUTO_MIGRATE=false`. Native Express serves both UI and API. Bind to loopback behind the trusted proxy; secure cookies require HTTPS. An explicitly local HTTP test can set `COOKIE_SECURE=false`.

The existing `Dockerfile` and `compose.yaml` offer single-server SQLite with a named volume. Compose currently requires explicit bootstrap password credentials; token-only setup uses native Node or Vercel. Review `docker compose config`, supply a host HTTPS proxy and preserve the data volume. Do not run multiple containers against one SQLite file. Vercel uses PostgreSQL instead.

## Backups and upgrades

Back up the private PostgreSQL schema and media store using the provider’s supported process; verify restore into an isolated environment. Sessions, password hashes, encrypted credentials and audit history are application data. Preserve the encryption key separately and confirm the selected plan’s retention/recovery capabilities.

For SQLite, stop the service and back up the whole data directory/volume, including media. Do not copy only the main database file while WAL writes are active. Database files, media and `.env` are excluded from git and Docker build context.

Before an upgrade, take a restorable backup, review pending SQL and temporarily enable `AUTO_MIGRATE=true`. Verify the release, then disable it. Rolling back application code does not reverse a schema migration. Recovery does not automatically reset credentials, replace schemas or re-seed data.

## Code map and next phases

| Location                                       | Purpose                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/pages/`, `src/components/`, `src/styles/` | Screens, readable type scale, inbox, editor, media and account controls            |
| `src/lib/workspace.tsx`                        | Authenticated state, API client and non-disruptive notification polling            |
| `server/app.mjs`, `server/auth.mjs`            | Accounts, sessions, core workflow and approvals                                    |
| `server/notifications.mjs`                     | Per-recipient event routing and inbox preferences                                  |
| `server/database.mjs`, `server/migrations/`    | Async PostgreSQL/SQLite adapter and core schema                                    |
| `server/media.mjs`, `server/video.mjs`         | Direct video upload reservations, validation and cleanup                           |
| `server/extensions/`                           | OAuth, provider discovery, reports, media delivery and publication jobs            |
| `server/intelligence/`                         | Safe public-source fetches, monitoring, ownership verification and answer evidence |
| `supabase/functions/marketing-media/`          | Narrow signed broker for the private media bucket                                  |
| `api/index.mjs`, `vercel.json`                 | Hosted API entry, routing and cron configuration                                   |

Next production work is account onboarding and actual provider acceptance tests, reliable backups and restore practice, email/MFA, account-specific report comparisons, richer supported publishing formats and selected workflow improvements. Broad ad management, continuous multi-platform competitor analytics, a full SEO crawler and real-time Notion-style collaboration remain separate projects. See [the roadmap](docs/ROADMAP.md) and [open-source decisions](docs/OPEN-SOURCE-DECISIONS.md).

## Evaluation walkthrough

See [the v0.4 user guide](docs/V04-USER-GUIDE.md) for owner activation, team access, the two-account review/notification walkthrough, connection prerequisites, research, keywords and ChatGPT. Consult [the validation record](docs/VALIDATION.md) for the checks and deployment status of its stated release; a guide or feature entry alone does not certify live provider access.

The hosted database grants the dedicated `smis_marketing_app` role to the project’s existing administrative `postgres` role for project-owner maintenance. Anonymous and authenticated Data API roles have no access to the private application schema. Runtime connections still use the dedicated application role.
