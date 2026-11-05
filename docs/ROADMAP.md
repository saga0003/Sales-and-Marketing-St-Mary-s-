# Roadmap after version 0.3

Version 0.3 implements the next working layer of the school’s marketing
workspace: review notifications, clearer typography, private video/carousel
assets, additional official provider adapters, recurring reporting, bounded
research monitoring, owned-site SEO checks and richer shared documents.

The next priority is a controlled production pilot with the school’s real
accounts and sources. Shipping adapter code does not grant Google, Meta or
LinkedIn access, prove that a source never changes its markup, or establish
admissions attribution. The application makes those dependencies visible.

## What is implemented now

| Workstream                 | Implemented in v0.3                                                                                                                                      | Boundary                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Readable interface         | Browser-relative text scale, generally 16px body/inputs and 14px compact metadata; retained light/navy/violet design; wrapping and responsive navigation | Targeted usability improvements, not a full accessibility certification                               |
| Team review                | Personal accounts, revision comments/history, contributor/manager roles, exact-revision approval, reject/request-changes and persistent audit trail      | No public self-registration or automatic invitation email                                             |
| Notifications              | Per-user inbox, unread count, event routing, read controls, optional sound and desktop alerts                                                            | Open-workspace polling; no closed-browser push, SMS or email delivery                                 |
| Images and videos          | Private immutable image uploads, ordered carousel assets, direct MP4 uploads with validation and hashes                                                  | 3 MiB image input, 40 MiB video/ten-minute limit; no video editor/transcoder                          |
| Publication                | Durable approval-bound jobs for supported Instagram, Facebook Page, YouTube, Business Profile and LinkedIn formats                                       | Requires authorized accounts, provider access and publication switch; unsupported formats are blocked |
| Provider reporting         | GA4, Search Console, owned social/Business Profile data, Google Ads and Meta Ads reports; CSV export                                                     | Read-only ads; metrics retain provider meanings rather than a fabricated cross-platform total         |
| Recurring reporting        | Per-account opt-in, 6–168 hour interval, default 24 hours; one due account per cron run                                                                  | 28-date window ending two UTC dates ago; provider processing lag still applies                        |
| Official-source monitoring | Durable RSS/Atom/HTML watches, official-source catalog, visible check/error states, deduplication and metadata history                                   | Bounded public pages/feeds; not every examination board or every PDF is covered                       |
| Competitor monitoring      | Public YouTube channel upload feeds and permitted public website/feed watches                                                                            | No arbitrary Instagram/Facebook/LinkedIn login scraping or private competitor analytics               |
| Research workflow          | Notice → unverified brief → draft → manager review; corrections clear linked brief verification                                                          | Fetched metadata is not proof of the claim; existing posts are not silently rewritten                 |
| SEO                        | Ownership challenge, same-origin single-page audits and authorized Search Console reports                                                                | No whole-site rendered crawl, Core Web Vitals engine or guaranteed indexing                           |
| AEO/GEO                    | Reproducible prompt and dated observation register, source citations, evidence and saved prompt context                                                  | Manually entered observations; no automated AI answer collection or universal visibility score        |
| Shared documents           | Paragraphs, headings, bullets, checklists, quotes, saved versions and conflict protection                                                                | No CRDT/live co-editing, relational databases, nested workspaces or full Notion parity                |

See [API.md](API.md) for actual endpoints,
[CONNECTING-ACCOUNTS.md](CONNECTING-ACCOUNTS.md) for setup,
[INTELLIGENCE-GUIDE.md](INTELLIGENCE-GUIDE.md) for source/competitor operation and
[TYPE-AND-UX.md](TYPE-AND-UX.md) for typography decisions.

## Production gate 1: team acceptance

Use manager and contributor accounts in separate browser sessions. A test email
need not already have a Supabase Auth account: the workspace uses its own
email/password sessions. A manager creates the account and supplies its
single-use setup link. That link expires after 24 hours; application access
continues through normal sign-in after activation.

Run one ordinary content week in the application:

1. Upload a test image, save a draft with **no publishing destinations**, leave
   Content and reopen it. Confirm caption and media persist.
2. Submit as the contributor. Confirm the manager’s inbox receives the event.
3. Request changes with a clear note. Confirm the contributor receives the
   decision and can identify the feedback and revision.
4. Revise, resubmit and approve. Verify that the previous approval cannot cover
   newly edited content.
5. Opt into sound and desktop alerts separately. Confirm browser permission,
   mute controls and read/unread behavior in the intended browsers.
6. Open one document in two sessions. Save in one, then try saving the old
   version in the other. A conflict must preserve the teammate’s work.
7. Review the interface at narrow widths and with 200% browser text/zoom.
   Confirm that navigation, dialogs and publishing destinations remain usable.

**Exit condition:** staff can complete the workflow without guidance, the
manager sees decisions that need attention and no interface-only approval sends
content externally.

This gate should also establish the exact institution names, team owners,
languages and who is responsible for reviewing time-sensitive academic claims.

## Production gate 2: authorize and reconcile owned accounts

The application already implements OAuth authorization, account discovery,
exact account selection, connection tests and encrypted credential storage.
The remaining setup is the school’s provider-side developer access and consent.

Configure one provider family at a time using the connection guide. Register
the application’s exact callbacks, enable relevant APIs and obtain the access
levels required for the intended accounts. Then the manager uses **Connect**,
grants permissions, selects the specific account/property/location and tests it.
The recurring staff workflow can be a few clicks after this operator setup;
the application cannot approve its own provider permissions.

Prioritize:

1. **GA4 and Search Console.** Confirm the school’s website already has GA4
   installed and the correct Search Console property verified. Connecting an
   account here does not install a tracking tag or define enquiry events.
2. **Instagram and Facebook.** Verify the exact professional Instagram account,
   associated Page and manager access. Reauthorize older connections when new
   publishing/insights scopes are needed.
3. **Business Profile and YouTube.** Select the correct school location/channel,
   check project access and quota, then review reporting and video visibility.
4. **Google Ads and Meta Ads.** Start with reporting, the intended customer/ad
   account, account currency and agreed conversion definitions.
5. **LinkedIn.** Separate personal posting from organization posting/reporting.
   Organization capabilities depend on the provider’s approved product access.

For each reporting connection, import a short explicit date range and compare
with the provider’s own interface using identical account, dates, timezone and
attribution settings. Separate account-wide totals from top-page/query/campaign
tables. An unavailable metric must stay unavailable, not become zero.

Only after this comparison, enable recurring reports. The automatic schedule is
off by default, imports 28 inclusive dates with a two-day UTC-date lag and uses
one bounded account per worker invocation. A transient failure is retried at the
configured interval. Permission/expired-auth errors need a connection test or
reauthorization. Old successful data remains labelled with its import time.

**Exit condition:** each enabled report reconciles to the provider and its owner
understands the definitions. Enquiries, platform-reported conversions and
confirmed admissions remain distinct.

## Production gate 3: controlled real publication

The implemented format matrix is deliberately explicit:

| Destination                  | Enabled adapter format                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| Instagram                    | One image; 2–10 image carousel; one validated 9:16 MP4 Reel                                     |
| Facebook Page                | Text or one image in Post format                                                                |
| YouTube                      | One validated MP4 in Video format, with approved visibility/audience/synthetic-content settings |
| Google Business Profile      | Text or one image in Post format, for eligible locations                                        |
| LinkedIn organization/member | Text or one image in Post format, subject to granted permissions                                |

Use a designated test account or a clearly approved real post. Confirm the
actual destination and media preview before the manager approves. Start with
one destination, then verify its remote post ID/URL and the visible result.
A YouTube pilot should use the visibility selected by its responsible manager.

Exercise an eligible failure/retry and a cancellation without creating duplicate
posts. If the provider accepted a send but its response was lost, the job must
remain ambiguous until inspected/reconciled. A worker attempt alone must never
appear as confirmed publication. LinkedIn member read-back restrictions need
manual inspection where the provider cannot verify the result.

**Exit condition:** each enabled destination publishes an approved revision
once, reports the outcome accurately and makes an actionable failure visible.
Enable further formats/platforms only after proving this path with real access.

## Production gate 4: official research and competitor baseline

Begin with a small relevant set: NTA, the school’s board, NMC and MCC, then the
state counselling/examination authorities applicable to the school. The catalog
provides starting URLs; a manager must confirm that each selected page covers
the required exam, course, academic year and geography.

The first successful source scan is a **baseline**, not a stream of newly issued
announcements. Review that baseline, choose keyword filters and set a reasonable
interval. Watches record actual success/error times, detected metadata and
changes. PDF links can be retained as evidence, but this version does not
extract or compare their body text.

For a real notice, open the official source and verify applicability/date before
promoting its brief to content. A medical-college proposal, permission,
sanctioned intake and counselling-round vacancy are different claims. No
automatically inferred seat number should reach a marketing caption.

Add a competitor’s YouTube **channel ID** for public upload monitoring, or an
eligible public website/feed. An Instagram/Facebook/LinkedIn profile bookmark
does not acquire analytics or create a scraping session. Record useful manual
observations with evidence when official access is unavailable.

**Exit condition:** a genuine official update produces one evidence-linked
brief; a correction invalidates the linked verification; collection failures
remain visible; no source item publishes without normal review.

## Production gate 5: operation and recovery

Keep the production database and private object storage durable. SQLite and
local media are development options, not Vercel persistence. Supabase-hosted
PostgreSQL/private storage are separate from the application’s custom login.

Verify migrations, database backups and a restore into an isolated environment.
Include media inventory and access credentials in the recovery plan without
placing secrets in the repository. Check that incomplete uploads are cleaned
up, completed immutable assets remain readable and workspace quotas are
understandable to staff.

Verify all three protected workers in the deployed environment:

- Publication: at most one due job per invocation; configured every five minutes.
- Intelligence: at most two due watches and bounded media cleanup; every fifteen
  minutes.
- Reports: at most one due account; every fifteen minutes.

These are requested Vercel schedules. Check the actual hosting plan’s support,
logs, duration and overdue work; more accounts/watches may require a larger
worker budget or queue service. Monitor the workers themselves so an empty
result is distinguishable from a worker that never ran.

**Exit condition:** a restore works, provider/source failures can be diagnosed,
and the team knows who owns access, billing, worker health and corrections.

## Next implementation priorities after the pilot

### 1. Evidence extraction and structured academic facts

Add original-document snapshots, PDF text/table extraction and OCR only after
testing actual NMC/MCC/board documents. Preserve document hash, page, row,
academic year, quota/category and evidence for every extracted value. Handle
withdrawals and corrigenda explicitly. Flag affected briefs and unpublished
drafts for a person to review; do not silently rewrite an approved caption.

This is a substantial new component. Current link monitoring cannot substitute
for validated seat-table extraction. A parser that cannot read a table should
produce an actionable review state rather than a guessed total.

### 2. Notification delivery beyond an open browser

Add transactional email and/or opt-in web push when the team confirms channels,
recipient rules and frequency. Include digests and escalation only for agreed
events. Setup-link delivery needs a verified sender and email configuration.
Keep the inbox authoritative so failed external delivery does not lose a review
decision.

### 3. Reporting history and admissions attribution

Current provider imports retain the latest successful report for each
connection. Add a historical reporting warehouse only when trend comparisons
need it, with stable metric definitions and late-arriving corrections. A CRM
adapter should begin with minimal approved enquiry/admission fields and a
documented deduplication/identity rule.

No CRM/Odoo/SalesOS connection is currently implemented. Paid-platform
conversions must not be labelled confirmed admissions or summed across
platforms without deduplication.

### 4. Deeper SEO and scheduled AEO/GEO studies

Extend verified-site checks to bounded crawling, rendered-page inspection,
Core Web Vitals and recurring tasks if the pilot identifies those needs.
Preserve URL-level findings and fix history.

Automated AI visibility studies need an agreed prompt set, actual provider APIs,
paid usage budget where applicable, language/location controls and reproducible
evidence. Record observations and sampling limits; do not turn a small prompt
sample into a universal ranking or guaranteed result. ChatGPT Pro access is not
an application API credential.

### 5. Additional media, publishing and document features

Prioritize formats the team actually uses: larger uploads, transcoding,
captions, video editing, additional provider formats and approved cross-post
variants. Any new adapter must preserve exact-revision approval and ambiguous
delivery handling.

For documents, add richer organization, links between records and live
co-editing only after observing workflow friction. Version-conflict protection
and saved history are already present; a full Notion-compatible data model is
not.

### 6. Advertising changes with their own approval controls

Google Ads and Meta Ads are read-only in this release. Campaign creation,
creative updates, audience changes and budget/bid automation require a separate
design: explicit accounts, spend bounds, dry-run previews, manager approval,
idempotency, audit history and rollback/reconciliation behavior.

Do not reinterpret a content-post approval or a reporting OAuth permission as
permission to spend money.

## Open-source reuse

This release extends the existing application and focused adapters; it does not
fork a second social scheduler or document suite. See
[OPEN-SOURCE-DECISIONS.md](OPEN-SOURCE-DECISIONS.md) for the repositories already
considered and the reasons.

Revisit a maintained external component when there is a demonstrated gap:
operator-managed automation, PDF/OCR extraction or real-time documents are
plausible candidates. Evaluate the actual version, licence, API, account model,
deployment cost and data export path first. Public source code does not make
hosting, provider access, API usage or enterprise features free.

An added service should receive narrowly scoped access and call the existing
approval-safe workflow. It must not create a second, independent publication
path that can send unapproved school content.

## Release claims and effort estimates

Version 0.3 provides working application code and local automated coverage of
the workflows above. Live provider acceptance depends on the school’s actual
accounts and the production checks described here. Release notes should list
what was actually connected, imported and published; mock-provider tests are
not evidence of live account authorization.

Estimate the next increment after those pilot results, separating coding effort
from provider review/access waiting time and ongoing operation. The current
product is a tailored school workspace with explicit supported functions, not
an exact copy of Metricool or Notion.
