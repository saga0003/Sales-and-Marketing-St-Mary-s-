# Roadmap to a connected school marketing workspace

## Starting point

Version 0.2 adds shared PostgreSQL persistence, personal account setup/recovery, manager-controlled access, private image uploads, revision comments/history, Google Analytics 4 imports and an Instagram single-image publishing adapter. Vercel runs the UI/API and a bounded five-minute publishing worker; Supabase holds the private application schema and image bucket. Production starts empty. Google and Meta applications and school accounts must still be authorized before real reports or posts are possible. Advertising, automatic news/competitor monitoring, Search Console and AI services remain future work.

The first two implementation slices are the shared team foundation and the initial GA4/Instagram connections. The numbered workstreams below describe the broader roadmap; they are not a claim that every original requirement is complete.

The next stages should make one complete workflow useful at a time. Keep the portal as the place where people work and approve decisions; connect specialist services behind it rather than merging several repositories into one codebase.

## Prioritized delivery phases

### 1. Run a small internal pilot

Use a separate production database behind HTTPS. Create real team accounts, confirm role boundaries, verify backups and test a full draft → review → requested changes → revised approval → local plan workflow with the people who will use it.

Account setup/recovery, password changes, manager-controlled account deactivation, shared revision history and comments are implemented. Keep demonstration records out of the production database. Review the school’s actual institution names, publishing languages, content formats and responsibilities. A restore drill and an ordinary week of team use remain pilot exit checks.

**Exit condition:** the team can use the workspace for a normal content week, a contributor cannot approve their own work, changed content requires fresh approval, and an isolated restore recovers the workspace.

### 2. Add official-source research and a limited competitor feed

Start with a named source list relevant to the school and its students. NTA and exam-specific notices, NMC, MCC, Karnataka KEA/KSEAB, CBSE and CISCE are sensible candidates, subject to the school’s actual boards and programmes. Start with a manageable set of pages rather than claiming coverage of every Indian examination.

Implement a source registry with jurisdiction, exam/course, academic year, collection method and owner. Fetch only through permitted access paths. Store an original HTML/PDF snapshot, content hash, source URL, published/fetched dates and the evidence used by a brief. Extract PDF text and tables, route unreadable or ambiguous files for human review, and deduplicate repeat notices.

Treat revisions, withdrawals and corrigenda as first-class events. A correction should flag affected briefs and unpublished drafts for review. Keep medical-college applications/proposals, permissions, sanctioned intake and counselling-round availability separate. A proposed college or an invitation to apply for increased intake is not an approved seat increase.

For competitors, begin with public websites and a small set of YouTube channels using supported access. Add Instagram, Facebook and LinkedIn collection only after verifying what each current API and account type allows. Public profile visibility does not provide private reach, leads, audience demographics or account analytics.

AI assistance can later classify relevance and propose a parent-friendly angle, but the draft must retain evidence and a human review state. Source verification must not silently imply approval of the resulting marketing content.

**Exit condition:** a real official update produces one evidence-linked brief; a corrected notice flags the previous interpretation; collection failures are visible; nothing is posted automatically.

### 3. Connect one publishing channel end to end

Choose the school’s first real channel based on account ownership, supported formats and API access. A publishing service or adapter may reduce integration work, but the portal remains responsible for approval.

Add account authorization, credential storage, connection health, media handling and format validation. Store approved media as immutable assets with checksums; approval of a URL alone must not authorize changed remote image or video bytes. Create a durable publication job only for an approved revision. Before sending, recheck the exact revision, approval, scheduled time and account. Store the remote post ID and result. Use idempotency and reconciliation so retries do not create duplicate posts. Expose failed jobs and manual retry/cancel actions.

Do not mark a post as published merely because it was queued or an HTTP request was attempted. Revoke queued work when approved content changes. Decide how deletions/cancellations are handled when a provider has already accepted the post.

**Exit condition:** a manager-approved test post appears once on the chosen real channel, its remote URL is recorded, unauthorized or changed content is blocked, and failures remain reviewable. Add further platforms only after this works reliably.

### 4. Bring reporting into one view

Connect owned-account reporting before adding automated advertising changes. Prioritize the sources that answer concrete questions: Search Console and website analytics, social account results, Meta/Google campaign reporting, and the admissions CRM where permitted.

Store provider, account, campaign, post, date, timezone, currency and attribution definition with each metric. Distinguish platform-reported conversions, deduplicated enquiries and confirmed admissions. Do not sum platform reach into a claim about unique people. Preserve reporting lag and refresh time in the interface.

An Odoo/SalesOS adapter is a future integration, not a current connection. Start by specifying the minimum approved fields and identity matching needed to link campaign enquiries to admissions. Do not copy unnecessary student data into the marketing application.

**Exit condition:** the dashboard reconciles a small date range to the original provider reports and clearly labels what an enquiry or conversion means. Sample data is replaced only for connected sources.

### 5. Add practical SEO, AEO and GEO workflows

Create recurring website checks, Search Console reviews and content tasks. Focus on useful admissions/programme pages, crawl/index issues, clear factual answers, source dates and accurate organization/course information. Treat local search visibility as a distinct workstream from generative-engine visibility.

For AEO/GEO experiments, use a defined set of parent/student questions and record the model/provider, prompt, locale, date, cited sources and observed answer. Report a sampled visibility study, not a universal AI ranking or a guaranteed position. API use, search data, hosting and model inference can incur costs even when orchestration code is free.

**Exit condition:** a recurring review produces evidence-backed tasks, and improvements can be compared against a documented baseline rather than an opaque generated score.

### 6. Add controlled advertising operations and broader collaboration

After reliable read-only reporting, consider campaign/ad creation and changes through approved account APIs. Use explicit manager approval for the exact creative, audience, destination and spending change. Set budget limits, audit changes and provide a pause/rollback procedure where the provider supports it. Provider app review, account permissions and billing are external dependencies.

Expand the knowledge workspace when real usage justifies it: version history, attachments, linked structured records and collaborative editing. Decide whether these belong in this application or in an integrated team wiki. Do not promise a complete Notion replacement from the current plain-text documents feature.

**Exit condition:** an approved bounded campaign change is traceable to the actual provider state, and collaboration additions solve an observed team need.

## Adapter architecture

Keep domain records and workflow decisions independent of provider-specific SDKs. Suggested boundaries are:

| Adapter            | Input                                     | Output and obligations                                         |
| ------------------ | ----------------------------------------- | -------------------------------------------------------------- |
| Source collector   | Registered source and collection cursor   | Snapshot, provenance, observed changes and collection errors   |
| Document extractor | Stored HTML/PDF/image evidence            | Text/tables with page references and extraction quality flags  |
| Brief assistant    | Evidence and editorial guidance           | Proposed summary/angle; cannot verify facts or approve content |
| Publisher          | Approved revision, destination and media  | Job state, provider post ID/URL and verified result            |
| Analytics reader   | Authorized account and reporting window   | Normalized metrics with source/attribution metadata            |
| Ads operator       | Specifically approved campaign change     | Provider result, spend controls and audit event                |
| CRM reader         | Approved minimal enquiry/admission fields | Attribution linkage without broad student-data copying         |

Persist job state, retries, idempotency keys and the last successful collection. Add monitoring of the workers themselves so a missing update is distinguishable from a failed job. OAuth scopes, token rotation and provider limits belong in each adapter's documentation.

SQLite remains available for local development. The hosted application now requires PostgreSQL, uses transaction-scoped schema settings for pooled connections and persists publication jobs in that database. Images are stored separately in private object storage. The deployment must not use ephemeral Vercel files as its production database or media store. See the deployment instructions and provider adapter documentation before enabling additional accounts.

## Candidate repositories to evaluate

These are due-diligence candidates, not installed dependencies, endorsements of a particular free plan, or guarantees that every requested feature is included. Check the exact release, licence files, self-hosted edition, API access and maintenance at the point of integration.

| Candidate                                                                                     | Possible role                                        | Evaluation that must happen first                                                                                     |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [Postiz](https://github.com/gitroomhq/postiz-app)                                             | Social publishing service behind the approval portal | Current self-host/API capabilities, platform coverage, approval boundary, media handling and licence obligations      |
| [Mixpost](https://github.com/inovector/mixpost)                                               | Alternative publishing service                       | Features in the exact free/commercial edition, API availability and account/provider requirements                     |
| [n8n](https://github.com/n8n-io/n8n)                                                          | Orchestration for collection and reporting           | Sustainable-use terms, required paid governance features and safe separation of staff UI from workflow administration |
| [Activepieces](https://github.com/activepieces/activepieces)                                  | Alternative orchestration                            | Current core/enterprise boundary, required connectors, versioning and operational support                             |
| [changedetection.io](https://github.com/dgtlmoon/changedetection.io)                          | Detection of public notice-page changes              | Access rules, browser/PDF support, selector stability, volume and failure handling                                    |
| [FreshRSS](https://github.com/FreshRSS/FreshRSS) / [RSSHub](https://github.com/DIYgod/RSSHub) | Feed collection where sources permit it              | Available feeds/routes, reliability, authentication requirements and source terms                                     |
| [Docling](https://github.com/docling-project/docling)                                         | PDF/document extraction                              | Accuracy on actual notice tables, OCR/model licences, runtime needs and page-level evidence                           |
| [BookStack](https://www.bookstackapp.com/)                                                    | Separate team wiki with an integration layer         | Current supported APIs, authentication, permissions and whether another UI improves the team's workflow               |

A public repository is not a promise of no-cost hosting, free platform access or unrestricted licensing. Do not adopt legacy free-server instructions without checking the current project. In particular, a product's open client or core does not prove that its maintained multiuser server, API, SSO or review features are free.

## Practical acceptance tests for future automation

- A source changes twice: the system records both versions and identifies the newer correction.
- A parser cannot read a seat table: the item goes to review with the original file, rather than inventing a number.
- A contributor attempts to approve or change another author's locked draft: the server rejects it.
- A manager approves revision 3 and someone edits to revision 4: queued publication for revision 3 cannot proceed unnoticed.
- A provider accepts a post but the response is lost: retry reconciles the existing remote post instead of publishing a duplicate.
- Credentials expire or a collector stops: the application shows an actionable failure and the last successful result.
- Two advertising platforms claim the same enquiry: the system preserves attribution sources and does not label their sum as confirmed admissions.
- A new source or channel is added: it stays unconnected/manual until its actual collector or publisher succeeds.

Implementation estimates should be made after the first source set, channel, account permissions and hosting approach are selected. Platform approvals and access restrictions can dominate calendar time; a repository alone cannot remove them.
