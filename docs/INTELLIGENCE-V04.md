# Intelligence v0.4: competitor evidence, exams and career routes

This release adds a durable research workflow without a paid scraping service or a background language-model bill. The user-facing screens are **Intelligence → Research queue** and **Intelligence → Exams & careers**. The existing **Monitoring** screen remains the notice inbox for official-source and YouTube feed watches.

## What each action actually does

| Action                                                       | Result                                                                                | What the status means                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Research now on a public competitor website                  | Performs a bounded public-page text check; creates a paused one-off monitor if needed | A successful first check is a baseline; subsequent checks can detect text changes                         |
| Research now on a YouTube competitor with a configured watch | Runs the existing public-feed watcher                                                 | New/corrected metadata enters the notice inbox; existing first-scan items remain baseline items           |
| Research GMB, or Research now on other social profiles       | Saves a deduplicated research request                                                 | **Needs research** means no profile inspection happened merely by pressing this button                    |
| Record evidence                                              | Saves the observed time, source URLs, summary, optional metrics and recent item links | All observations remain unverified; the first observation is a baseline                                   |
| Open research in ChatGPT                                     | Opens a user-initiated prompt for a connected workspace MCP app                       | Requires that app to be connected in ChatGPT; a queued request does not wake a background ChatGPT session |
| Request research on an exam                                  | Queues a check of the exam’s official references                                      | The guide is not silently rewritten or verified                                                           |
| Mark this revision reviewed                                  | A manager confirms they inspected the saved sources                                   | Review applies to this saved revision; it is separate from content approval and publishing                |

None of these research actions publishes a social post, changes advertising spend, or enables a paid service.

## Test a competitor profile

1. Open **Intelligence → Competitors → Add competitor**. Save each website, channel, Page or Business Profile as a separate reference. Choose its actual platform, including **Google Business** where appropriate.
2. Press **Research GMB** or **Research now**. A supported public source is checked; an unsupported profile creates a clearly pending request.
3. In **Research queue**, open the request. The panel shows requested time, source-observed time and result-recorded time separately. The last two are empty until there is evidence.
4. Inspect the source yourself, or choose **Open research in ChatGPT** after connecting the workspace MCP app. The prompt includes the public reference URL and request ID; it does not include API secrets or private credentials.
5. Choose **Record profile evidence**. Enter the actual observation time, a summary and exact source URLs. Optional values include followers, review count, rating and post count. Leave unavailable numbers blank; entering zero asserts that zero was observed.
6. Add exact links to recent posts, reviews or updates where available. Publication time is optional and should be supplied only when the source shows it.
7. Save. The first observation says **First observed baseline**. A later observation compares matching metrics and newly observed links with the earlier evidence. No deletion is inferred when an item disappears from a limited sample.
8. Return through **Competitors → Evidence & history**, or **Research queue → Profile evidence**, to compare each profile independently.

Evidence is append-only. To correct a prior note, record a new explicitly labelled correction with the source and observation date. Historical entries do not masquerade as a current change. The service accepts an idempotency key to prevent an interrupted form submission or MCP retry from creating duplicate observations.

For content use, create a source-linked research brief and follow the existing manager review and post approval workflow. Recording a profile observation does not by itself verify a public marketing claim.

## Test public webpage changes

1. Add the competitor with **Website** as its platform.
2. Open **Research queue → Webpage changes → Monitor webpage**.
3. Choose a focused HTTPS admissions, news or notice page. Save the monitor with a practical interval: 24 hours is the default.
4. Choose **Check now**. The first successful response establishes the baseline; existing content is not labelled as newly published.
5. Choose **Compare changes** to inspect the saved text. After a real page update, a later check records added and removed text blocks and any title change. The first 12 changed blocks per side are shown.
6. Pause or resume scheduled checks in the card, or change the URL in **Settings**. A URL change starts a new baseline while retaining the bounded earlier snapshot history.

The reader removes scripts, navigation, footers, forms and other common surrounding content. It prefers the page’s main content element, then the body. Rotating body content can still change; a text difference is evidence to inspect, not a verified claim about admissions or a competitor’s strategy. It does not execute JavaScript or sign into a website.

The system respects public access and robots restrictions, validates every redirect and resolved address, and blocks private/reserved network destinations. A failed check keeps existing evidence intact and reports a separate attempted-check time. It never updates the successful-check time when no readable source was obtained.

### Capacity and timing

| Limit                        | Baseline setting                                                     |
| ---------------------------- | -------------------------------------------------------------------- |
| Public-page monitors         | 20 per workspace                                                     |
| Page interval                | Default 24 hours; configurable 6–168 hours                           |
| Webpages per scheduled sweep | At most 1                                                            |
| Page history                 | 30 baseline/changed snapshots per monitor                            |
| Text retained per snapshot   | First 60,000 characters; the hash covers the normalized fetched text |
| Manual repeat check          | At least 1 minute between attempts on the same page                  |
| Worker claim                 | Persisted 90-second lease with fencing against stale writes          |
| Pending assisted research    | At most 100 requests; one pending request per target                 |
| Profile observation view     | Latest 100 observations per profile                                  |

The interval is a minimum delay before a source is eligible, not a promise that the hosting scheduler runs at that frequency. A daily scheduler produces daily sweeps; many due sources can take several sweeps. The UI distinguishes scheduled polling from instant notifications. YouTube push subscriptions, when explicitly enabled and verified, are covered separately by their opt-in controls.

## Build the exam registry

Open **Intelligence → Exams & careers → Exam registry → Add exam**. Save:

- Exam, board or counselling name and category.
- Relevant streams: Science, Commerce, Humanities, Vocational or Any.
- Description and academic year/cycle.
- Eligibility, subject, age, category and exception notes. Unknown details should remain explicitly unconfirmed.
- One or more exact original-source references, with readable labels.
- Milestones such as application, exam, result or counselling dates, with their source and correction notes.
- Existing official-source watches from **Monitoring** that should inform this guide.

An exam can be a draft, tracking or archived. Contributors can create and edit guides; managers can archive and review them. Archive through the edit form rather than deleting accumulated guidance. The registry supports up to 500 exam records.

Choose **Request research** to send its references to the research queue. A completed research request is stored evidence, not an automatic edit to dates or eligibility. Edit the exam deliberately using that evidence, then ask a manager to use **Review → Mark this revision reviewed**.

Saving changes increments the revision and clears the review status. Concurrent edits require the displayed revision and return a conflict instead of overwriting a colleague’s work. A new or corrected notice from a linked official-source watch also clears relevant exam and linked career-pathway review. The existing source watcher compares available link/feed metadata; it does not interpret the full contents of every linked PDF or automatically verify seat counts.

## Build career pathways

Open **Exams & careers → Career pathways → Add pathway**. The guide stores this structure:

**School stream → field → one or more entry routes → education / qualification → outcomes / further routes.**

For each entry route, add a name, how students enter, subject/age requirements, linked registry exams, education and outcomes, and exact source URLs. The overall pathway also has its own academic year, eligibility notes, reference list and draft/active/archived state. Up to 250 pathways and 12 routes per pathway are supported.

The suggested fields are planning prompts only. The release does not seed an apparently authoritative catalogue of current Science/Commerce eligibility. A manager can mark a pathway reviewed only when it has at least one entry route, supporting sources and reviewed, unarchived linked exams. Editing a linked exam or detecting a relevant later source update clears the pathway’s review state.

This is the baseline for a larger career guide: future work can add richer student-facing route exploration, local course/college catalogues, admissions-round comparisons and accessibility/language options without losing the original sources or review trail.

## Notifications and approval boundaries

All significant changes use the workspace audit/notification pipeline. Events include webpage changes, competitor research requests, recorded competitor changes, research results, exam changes and career-guide changes. Their delivery follows the user’s existing notification preferences. A first source scan is deliberately a baseline, not a flood of “new today” alerts.

Source review and post approval remain distinct. Automated checks and MCP writes cannot grant manager approval, mark exam facts verified, publish content or alter ad budgets. A research result written by ChatGPT is an evidence draft with citations and observation time.

## Platform constraints and free operation

Google’s Business Profile reviews method applies to an authorized verified location and uses Business Profile OAuth access. It is not an API for unrestricted collection of competitor reviews. [Official reviews API](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list)

Google Places API requires billing to be enabled. It is not activated by this release, consistent with the request to avoid paid software and services. [Places usage and billing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)

YouTube supports push notifications for uploads and changes to video titles/descriptions through WebSub/PubSubHubbub. The official channel topic is `https://www.youtube.com/xml/feeds/videos.xml?channel_id=CHANNEL_ID`. A manager must opt in for a configured channel watch, the hub must verify the callback, and signed payloads must pass validation before they can update evidence. A pending hub subscription is not described as active. [YouTube push notifications](https://developers.google.com/youtube/data/guides/push_notifications)

This release does not implement unrestricted background scraping of Instagram, Facebook, LinkedIn or Google Maps profiles. Those targets remain useful in the saved research queue, with manual/MCP evidence and per-profile comparisons. If a platform later grants an appropriate authorized API, its reader can feed the same evidence model without changing the approval workflow.

## Integration contract

`registerIntelligence()` returns `services.monitoring` and `services.education` in addition to the existing watches/sites/answers services. All user-initiated service writes validate the actor and payload internally; the HTTP endpoints additionally enforce session and CSRF protection.

### Monitoring services

```text
listPageMonitors()
pageSnapshots(monitorId)
createPageMonitor(input, actor)                  manager
updatePageMonitor(id, patch, actor)              manager
removePageMonitor(id, actor)                     manager
checkPage(id, { actor, dueOnly })                manager or internal scheduler
runDue({ limit: 1, actor })

researchRequests({ status, limit })
researchContext(requestId)                      exact lookup, target + prior evidence
requestResearch({ targetType, targetId, question? }, actor)
recordResearchResult(id, { summary, evidenceUrls, observedAt, expectedRevision }, actor)
cancelResearch(id, actor)                       requester or manager
observations(competitorId)
recordObservation(competitorId, input, actor)    always unverified
researchCompetitor(id, { question? }, actor)
```

Observation input includes `observedAt`, `summary`, nonempty `evidenceUrls`, optional `metrics`, optional `recentItems`, optional matching `requestId`, and an optional `idempotencyKey`. The last three preserve retries and connect an observation to its request. The schemas are exported from `research.mjs` as `competitorObservationSchema`, `researchRequestSchema` and `researchResultSchema`.

MCP tools use the same services. `get_research_context` can retrieve an exact request even if it is older than the list window. `record_competitor_observation` and `record_research_result` never accept a verification flag. A manager’s normal authenticated UI is the route to source verification.

### Education services

```text
listExams() / getExam(id)
createExam(input, actor)
updateExam(id, { expectedRevision, ...patch }, actor)
verifyExam(id, { expectedRevision }, actor)      manager UI only; not an MCP write tool

listPathways() / getPathway(id)
createPathway(input, actor)
updatePathway(id, { expectedRevision, ...patch }, actor)
verifyPathway(id, { expectedRevision }, actor)   manager UI only; not an MCP write tool
```

Exported schemas: `examSchema`, `examPatchSchema`, `pathwaySchema`, `pathwayPatchSchema`. Omitted PATCH fields are preserved. All actual edits clear review state.

### HTTP routes

All paths below are relative to `/api/intelligence`:

| Route                                                                        | Purpose                                               |
| ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| `GET /monitoring`                                                            | Page monitor list, recent requests, capacity settings |
| `POST /page-monitors`                                                        | Create a page monitor                                 |
| `PATCH /page-monitors/:id`, `DELETE /page-monitors/:id`                      | Manager settings/removal                              |
| `GET /page-monitors/:id/snapshots`, `POST /page-monitors/:id/run`            | Evidence history or bounded manual check              |
| `GET/POST /research-requests`                                                | List or create assisted requests                      |
| `GET /research-requests/:id`                                                 | Exact research context                                |
| `POST /research-requests/:id/result`, `POST /research-requests/:id/cancel`   | Record cited result or cancel pending request         |
| `POST /competitors/:id/research`                                             | Choose supported direct check or assisted request     |
| `GET/POST /competitors/:id/observations`                                     | Per-profile evidence                                  |
| `GET /education`                                                             | Exams, pathways, stream labels and planning prompts   |
| `GET/POST /exams`, `GET/PATCH /exams/:id`, `POST /exams/:id/verify`          | Exam registry and separate manager review             |
| `GET/POST /pathways`, `GET/PATCH /pathways/:id`, `POST /pathways/:id/verify` | Career registry and separate manager review           |

## Migration and validation

`server/intelligence/migration-v2.sql` is additive. It creates page monitors/snapshots, research requests/observations, exam registry/watch links and career pathways. It retains existing notices and watches. `migration-v3.sql` adds YouTube push subscription state; the final additive `intelligence_extensions_version` marker is 3. Startup prefers this marker and falls back to the legacy marker for earlier local databases. A hosted rollout can retain `intelligence_schema_version = 1` for old v0.3 cold starts and rollback compatibility while setting the additive marker to 3. Apply migrations in order within the hosted migration transaction before deploying when automatic migrations are disabled.

Tests cover baseline semantics, ignored navigation churn, bounded snapshot retention, SSRF/social-target restrictions, cooldowns, durable worker fencing, evidence idempotency, historical observations, future timestamps, exact request lookup, optimistic revisions, manager-only review, contributor draft writes, source-change invalidation and HTTP session/CSRF protection. Browser checks exercise the real exam form, source-linked requests, profile observations and career route editor in an isolated demo workspace.
