# St. Mary’s Marketing Workspace

A shared school marketing workspace with drafts, manager approval, a content calendar, source-linked research, competitor watchlists, tasks, documents and account connections. React serves the interface; Express enforces permissions and workflow; PostgreSQL stores the hosted workspace. SQLite remains available for local development and a single native server.

**This version adds shared accounts and the first real connections: read-only GA4 website analytics and approved single-image Instagram publishing.** Provider connections require the school’s application credentials, authorization and account selection. A new production workspace starts empty. Saving a competitor or source URL creates a manual watchlist entry; it does not start an automated monitor.

## What is implemented

| Area                    | Working behavior                                                                                                                          | Current boundary                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Content and approvals   | Create, edit and duplicate drafts; manager approval, rejection and change requests; comments, immutable revision history and audit events | Edits to text, media or destinations invalidate approval. Contributors edit their own editable drafts.                                     |
| Planning and publishing | Calendar and durable jobs bound to the approved revision, image and destination                                                           | Live delivery supports a single image to an Instagram professional account through Meta; no Reels, carousels, video or other networks yet. |
| Team                    | Manager-created accounts, private setup/recovery links, password changes, deactivate/reactivate and session revocation                    | Links are shown for manual sharing; no emails are sent. No SSO or MFA.                                                                     |
| Performance             | Google OAuth, GA4 property selection, connection checks and manual import of real website reports                                         | GA4 only; no ads, Search Console, social engagement or CRM reporting yet.                                                                  |
| Media                   | Validated JPEG/PNG/WebP uploads, normalized immutable JPEG assets, authenticated previews and private cloud storage                       | Initial limit: 200 images, 3 MiB per input. Uploading does not publish.                                                                    |
| Research                | Source-linked briefs, manager verification and conversion into drafts                                                                     | Manual entry; no exam/news crawling, AI generation or automated fact checking.                                                             |
| Watchlists              | Competitor profiles and official-source URLs with notes                                                                                   | Manual review; no background scraping or change detection.                                                                                 |
| Workspace               | Tasks, owners, priorities, deadlines and searchable categorized documents                                                                 | Text documents; no Notion blocks or live co-editing.                                                                                       |

The interface follows the supplied visual direction: light surfaces, dark navigation, violet accents, a review list beside selected content and responsive layouts. [Earlier interface previews](docs/images/overview-1793779635887.jpg) contain illustrative records. Hosted evaluation mode uses authenticated accounts and real saved data; it does not enable anonymous demo sign-in.

## Approval and publication

1. The author writes a draft and attaches an uploaded image and connected destination when live Instagram publishing is intended.
2. A manager approves that exact revision or returns it with feedback.
3. An approved, publishable revision creates a durable job. A future scheduled time delays eligibility. Without a live destination, the item stays in local planning.
4. The worker rechecks approval, active approving manager, immutable media, account and payload. It records success only after Meta returns a publication ID.
5. An ambiguous timeout after sending is held for reconciliation, not blindly resent. Editing approved content invalidates approval and cancels pending jobs. Processing or uncertain jobs must be resolved first.

`PUBLISHING_ENABLED=true` and configured private cloud delivery are required to run the worker. **When enabled, approving a draft with a valid Instagram destination can result in an external post.** The deployment invokes the authenticated worker every five minutes; managers can also run due jobs in the application. One invocation processes at most one due job, so this initial release suits small school publishing volumes, with possible delay from scheduling, backlog and provider processing.

See [provider setup and operations](server/extensions/README.md) for OAuth scopes, callback URLs, storage and reconciliation. The [frontend integration contract](server/extensions/FRONTEND-CONTRACT.md) describes provider payloads. No advertising campaign creation or spending is implemented.

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

Configuration: Node 24.x through package/project settings, Fluid Compute, Mumbai `bom1`, a 180-second API duration and five-minute cron. Official references: [Node functions](https://vercel.com/docs/functions/runtimes/node-js), [Express](https://vercel.com/docs/frameworks/backend/express), [Vite routing](https://vercel.com/docs/frameworks/frontend/vite), [duration limits](https://vercel.com/docs/functions/configuring-functions/duration). Five-minute cron requires Pro/Enterprise; [Hobby supports daily cron](https://vercel.com/docs/cron-jobs/usage-and-pricing).

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
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`           | Optional GA4 OAuth app credentials; Settings can save them encrypted instead                                                                   |
| `META_APP_ID`, `META_APP_SECRET`, `META_API_VERSION` | Optional Meta app settings; API version is pinned in the example                                                                               |
| `PUBLISHING_ENABLED`                                 | Gate for processing approved live jobs                                                                                                         |
| `CRON_SECRET`                                        | Distinct random secret required by the GET worker endpoint                                                                                     |

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

Configure app credentials and callback URLs in the Google/Meta consoles, authorize the school account and select the intended property/account. Test the connection, then import GA4. Enable live publishing for the intended workflow and use an explicitly approved test post to validate delivery. A five-minute worker adds scheduling delay; queued work and provider processing can add more.

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

| Location                                    | Purpose                                                     |
| ------------------------------------------- | ----------------------------------------------------------- |
| `src/pages/`, `src/components/`             | Screens, team controls, composer and previews               |
| `src/lib/workspace.tsx`                     | Authenticated state, API client and notifications           |
| `server/app.mjs`, `server/auth.mjs`         | Accounts, sessions, core workflow and approvals             |
| `server/database.mjs`, `server/migrations/` | Async PostgreSQL/SQLite storage and core schema             |
| `server/extensions/`                        | Provider connections, private media, GA4 and Instagram jobs |
| `api/index.mjs`, `vercel.json`              | Hosted API entry and deployment configuration               |
| `docs/ROADMAP.md`, `docs/UX-RESEARCH.md`    | Broader product direction and interface rationale           |

Next integrations remain official-source ingestion, supported competitor monitoring, SEO/Search Console, ads reporting, additional publishing platforms/formats and richer documents. This is not a complete Metricool replacement. Each addition needs provider permissions, honest connection states, durable jobs where relevant and tests of its approval/data boundaries.

## Evaluation walkthrough

See [the user guide](docs/USER-GUIDE.md) for owner activation, team access, the ten-minute review walkthrough and connection prerequisites. The current hosted implementation was checked against [the release validation record](docs/VALIDATION.md).

The hosted database grants the dedicated `smis_marketing_app` role to the project’s existing administrative `postgres` role for project-owner maintenance. Anonymous and authenticated Data API roles have no access to the private application schema. Runtime connections still use the dedicated application role.
