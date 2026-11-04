# Version 0.2 release validation

Validation date: **5 November 2026 (India Standard Time)**. This release combines a shared team workspace with the first real provider adapters: Google Analytics 4 reporting and approved Instagram single-image publication. It is an evaluation release, with explicit provider setup requirements.

Hosted application: [St. Mary’s Marketing Workspace](https://stmarys-marketing-workspace.vercel.app/).

## Automated checks

- `npm test`: **45 passing tests**, including real HTTP requests against isolated local databases, provider HTTP fixtures and broker signature tests.
- `npm run check` and `npm run build`: passed.
- `npm run format:check`: passed for source and documentation before final packaging.
- `npm audit --omit=dev`: zero known production dependency vulnerabilities after a targeted `@vercel/cli-config` override resolved its outdated nested Zod dependency. This is a point-in-time audit result.

Covered behavior includes personal setup links, expiry/replay checks, session rotation and revocation, team permissions, persistent login rate limits, concurrent revision checks, transaction isolation/savepoints, source provenance, and revision-linked comments/history.

Provider tests cover encrypted credentials, session-bound OAuth state, read-only Google scope and PKCE, paginated account discovery, distinct GA4 period totals, immutable media hashes, image decoding and normalization, approval-bound jobs, exclusive worker claims, retries, cancellation and uncertain-result reconciliation. The reschedule race and partially published multi-account revision race have dedicated regressions.

Provider HTTP tests use controlled fixtures. They do not establish that a school account has completed OAuth approval or that a real social post was published.

## Hosted API and cloud storage checks

The following checks ran against the Vercel application using disposable validation records in the new isolated Supabase project:

| Boundary                 | Observed result                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| API routing and database | Health returned HTTP 200 with `postgres` and `persistent: true`                                            |
| Anonymous access         | Bootstrap returned HTTP 401                                                                                |
| Personal setup           | An expiring test setup token accepted a new password and established a session                             |
| Sign-in                  | Subsequent password sign-in returned HTTP 200                                                              |
| Shared bootstrap         | Authenticated response returned the test user, empty production analytics and honest provider setup states |
| Raw media upload         | PNG upload returned HTTP 201 and stored a normalized JPEG with the expected dimensions                     |
| Content creation         | Image-backed draft saved with HTTP 201                                                                     |
| Review and approval      | Submit and approve returned the expected states for the exact revision                                     |
| Discussion/history       | Revision comment saved and two saved revisions were returned                                               |
| Revision protection      | Editing cleared approval; a stale write returned HTTP 409                                                  |
| Team setup               | Manager created a contributor with a personal setup link; no email was sent                                |
| Bounded worker           | Manager invocation completed with no due external jobs                                                     |

The initial manager’s setup token was kept unused for the owner. Temporary accounts and workflow records are removed after the persistence check.

The private Supabase image broker was also tested directly: upload, authenticated read and temporary signed delivery returned matching bytes; an unsigned broker request returned HTTP 401. The bucket is private and limited to normalized JPEGs of at most 3 MiB. Supabase’s security advisory check returned no findings for the new project.

The deployment uses verified database TLS with the trusted Supabase root certificate. Certificate verification was retained when resolving the initial trust-chain failure. The working transaction pooler is the project’s `aws-0-ap-south-1` endpoint. Only production receives production credentials.

## Browser and visual checks

The hosted login surface was opened through Vercel’s protected review link. Authenticated production workflows were exercised through the HTTP API. The initial owner password remains for the user to choose.

The actual development app was also exercised in an isolated sample workspace through the managed browser preview:

- A draft was created, saved, located in Content, submitted, and approved. The saved revision and approval record appeared in the detail panel.
- The content library, school selector, review controls, exact destination explanations and empty connection guidance rendered.
- A **390 × 844** iframe viewport exercised the responsive application itself. Navigation, filters, the composer and the media-picker dialog stayed within the phone-width layout. This was a responsive layout check, not device emulation or a scaled screenshot.
- The browser file-chooser upload check was interrupted and is not claimed as passed. The hosted raw-upload API and complete private storage path passed separately.

The committed content screenshot shows **demonstration records**. It illustrates the interface; it does not show live school analytics or connected social accounts.

## Deployment safeguards

- Vercel serves the Vite frontend and Express API; Supabase persists the private application schema and images.
- Automatic schema migration is used for initial provisioning and then disabled.
- A five-minute cron processes at most one due publication job per invocation. Manager-triggered execution uses the same approval checks.
- No provider credentials or user account tokens are stored in Git or the client bundle. Saved provider credentials are encrypted on the server.
- No Google or Meta account was authorized during validation, and no social post or advertising change was made.

## Remaining acceptance checks

The account owner must complete Google/Meta application setup and authorize eligible school accounts. Before relying on automated publication, approve a deliberately chosen real Instagram image post and reconcile its recorded ID/URL with the provider. Compare an imported GA4 period with the original property report.

A normal week of team use, backup/restore drill, native phone uploads, Safari/Firefox coverage, screen-reader testing and a formal accessibility audit remain pilot checks. Scheduled exam/news collection, competitor monitoring, Search Console, ad reporting/operations, other social publishers, video/carousels and a full Notion-style collaborative editor are not implemented by this release.

See [USER-GUIDE.md](USER-GUIDE.md), [ROADMAP.md](ROADMAP.md) and the [provider operations guide](../server/extensions/README.md).
