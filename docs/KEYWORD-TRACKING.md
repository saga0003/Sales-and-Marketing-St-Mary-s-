# Keyword trends: Google Search, AEO and GEO

The **Performance → Keyword trends** screen keeps three different kinds of evidence separate:

| View                   | What it measures                                                                                                             | How it gets data                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Google Search          | Search Console average position, impressions, clicks and click-through rate for an exact query and selected property/filters | An authorized Search Console connection, with optional daily imports                                       |
| Recorded search checks | Positions a team member or an authorized MCP client recorded with a source and notes                                         | Manual or MCP evidence; never treated as a verified Search Console API import                              |
| AEO / GEO evidence     | Whether an observed answer mentioned the school or cited its target website                                                  | A recorded answer with its actual provider, model, prompt, location, language, timestamp and citation URLs |

No paid rank tracking service or model API is called. This module does not need an OpenAI API key. A ChatGPT subscription does not itself supply background API credits; here, ChatGPT can help research and record evidence through an authorized MCP connection instead.

## Add a keyword

1. Open **Performance → Keyword trends → Add keyword** as a manager.
2. Enter the exact query, choose the school, and optionally select a connected Search Console property.
3. Choose the country, device and search type. A blank country includes all countries. The default country in the form is India (`ind`). An optional page URL restricts the query to that exact page.
4. Save. Without a connected property the track remains **Awaiting connection**, and the graph stays empty. You can still record research evidence.
5. To receive Google data, connect the relevant property in **Settings → Connections**, return to the keyword's settings, select it, and choose **Check now**. You can enable **Daily imports** when access is ready.

Each combination of query, school, property, country, device, search type and page is its own track. The same query can be tracked for multiple schools or properties, or for mobile and desktop separately. Do not combine these into one graph when comparing results. A saved query or filter cannot be silently changed; create a new track for a different combination. A replacement connection must point to the same school and property as the existing history.

Search Console's `equals` query filter is case-sensitive. If a query has no returned rows, first compare its spelling, case, property and filters with the actual Search Console report.

## Read the Google chart correctly

The headline is **average position**, not a universal live Google rank. Google calculates it from impressions for the chosen property and filters. It can differ across people, devices, countries, pages and dates. Moving from 12 to 8 is an improvement of 4 positions. The chart places better (lower) values higher on the graph.

The movement indicator compares the last two dates that contain an actual position and states those dates. If they are not consecutive days, it is not presented as a one-day change. A missing row appears as a gap and is never changed into rank zero, a guaranteed absence from Google, or zero impressions. Search Console does not return all possible query data, including privacy-limited queries.

The first successful import requests 28 days. Later imports refresh the latest 7 days, so corrections overwrite the same keyword/date instead of duplicating it. The request uses finalized data (`dataState: final`) and ends three **Pacific Time calendar days** before the current day. This is a conservative reporting buffer, not a guarantee that Google has returned every row. The UI shows the latest reported date, any newer missing dates, and the time of the last successful import.

Cards show up to 90 days. **Evidence history** retains up to 400 days of API samples and offers a CSV export. Imported metrics are never replaced by a handwritten estimate.

## Daily refresh and notifications

Daily imports are opt-in for each keyword. They require a connected Search Console property and the server's authenticated scheduled worker. Opening a chart refreshes the displayed workspace data; it does not call Google.

The worker shares the existing report schedule and processes at most **3 due tracks per invocation**. A successful track becomes due again after **24 hours**. The workspace supports **60 tracks**. With the configured 15-minute report schedule, a newly enabled batch of 60 normally needs approximately five hours to pass through the queue, plus provider response times and any failures. The dashboard reports each track's own last import and next due time rather than promising one simultaneous refresh.

Failed requests preserve earlier history. Retries wait 30 minutes, then increase up to 24 hours. A persisted lease prevents overlapping workers from querying the same track, and the result is discarded if its identity or settings changed while the request was in flight. Provider permissions and rate limits still apply. A manual **Check now** is limited to once per track every five minutes.

Changed Google positions, an import that needs attention, and recorded evidence create workspace notifications through the existing notification system. Notification delivery and sounds follow the user's workspace notification settings. An unchanged import does not create a stream of duplicate alerts.

## Record search evidence without a provider connection

Choose **Recorded search checks → Record a search check**, then provide the source date, observed position, source URL and an explanation of the measurement. Clicks and impressions are optional. Record the real device/location/query used in the notes when checking an ordinary search result.

The graph uses the latest recorded check for each date with the track's exact current identity. Earlier checks remain in **Evidence history**, including their original school, property and filter snapshot. If a previously unbound keyword is later connected to a property, old unbound evidence remains available but is not relabelled as property data on the current chart.

Manual records and MCP records are labelled by their source. They are evidence submitted by a researcher; the app does not independently verify that a pasted position is true. Exact retries are deduplicated. The free baseline caps this evidence at 200 records per track and provides an export; it does not silently delete evidence to make space.

## AEO / GEO: record an actual answer

In the keyword settings, save the exact question you want to test, the target website, location and language. Then choose **AEO / GEO evidence → Record an answer**.

Enter the actual provider and model name displayed by that service (or `Not disclosed`), the time the answer was checked, the answer excerpt, whether the school was mentioned, and the citation URLs actually returned. The time field is labelled **India time**. Optional evidence links and notes make later review easier. The app will reject a “target cited” claim if none of the citation URLs belongs to the saved target host. It will also reject the reverse mismatch. A `www` prefix is treated as the same host; unrelated subdomains are not automatically counted as the target.

The graphs show:

- **Mention rate:** checks that mention the school ÷ checks recorded for that date.
- **Citation rate:** checks that cite the target website ÷ checks recorded for that date.

For example, one mention in two recorded checks is 50%. This is a rate across those recorded checks, not a market-wide visibility score or a Google position. The number of checks and the exact context are visible alongside the chart. Changing the prompt, provider, model, target, location or language creates a separate series. Earlier observations keep their original context.

There is no hidden daily AI scan. A team member or an authorized MCP client must perform and record the actual check. Do not invent an observation, a model name, a citation or an observation date. The baseline allows 20 distinct answer contexts and 200 answer observations per keyword; CSV exports include the original context and evidence.

**Copy research task** prepares a prompt with the saved query and context for ChatGPT. With the workspace MCP integration enabled, an authorized client can list tracks and submit sourced observations. Provider imports remain an authorized manager operation. MCP submission cannot turn manual research into verified Google API history.

## Quick acceptance test

1. Add a keyword without a property. Confirm it says **Awaiting connection** and shows no fabricated Google numbers.
2. Record two search checks on different dates with real source links. Confirm they appear only in **Recorded search checks**, that a lower position is shown as an improvement, and that missing dates remain gaps.
3. Open **Evidence history**, inspect the source and original identity, and export a CSV. Leave the screen and return to confirm persistence.
4. Save an answer prompt and target URL, then record a genuine answer. A mention without a target citation should increase only the mention rate. A target citation should count only when its URL is present.
5. Record another check under a different model or after changing the prompt. Confirm that it appears in a separate answer series.
6. When Search Console is configured, choose **Check now**. Compare the property's query and filters against Google Search Console for the exact report dates displayed. Enable daily imports and verify the scheduled worker advances `last import` and `next due` without requiring the browser to remain open.

The automated test suite uses injected provider fixtures. These tests verify query isolation, missing data, correct deltas, deduplication, permission checks, limits, overlapping workers and stale-result rejection; they do not certify a real Google account's permissions.

## Implementation and integration

`server/rankings/schema.sql` is an additive migration. `registerRankings(app, context)` registers the authenticated API and returns `services.keywords`, `runDue` and a lightweight bootstrap summary. The server supplies `extensions.withSearchConsole` so token refresh and account validation stay in the provider layer. Tokens and client secrets are never returned to this module's UI.

Routes use the `/api/rankings` prefix:

| Method and route                         | Permission                       | Purpose                                                       |
| ---------------------------------------- | -------------------------------- | ------------------------------------------------------------- |
| `GET /`                                  | Signed-in user                   | List tracks, chart series, bounds and automation availability |
| `GET /keywords/:id`                      | Signed-in user                   | Full retained history and evidence                            |
| `POST /keywords`                         | Manager                          | Add a track                                                   |
| `PATCH /keywords/:id`                    | Manager                          | Update connection, opt-in and answer context                  |
| `DELETE /keywords/:id`                   | Manager                          | Remove a track and its retained evidence                      |
| `POST /keywords/:id/sync`                | Manager                          | Bounded authorized Google import                              |
| `POST /keywords/:id/search-observations` | Signed-in contributor or manager | Record sourced manual evidence                                |
| `POST /keywords/:id/answer-observations` | Signed-in contributor or manager | Record an actual answer observation                           |

The service exports `keywordCreateSchema`, `searchEvidenceSchema` and `answerEvidenceSchema` for the MCP layer. Transport-owned provenance distinguishes MCP from form submissions. Mutations check the user's active role in the database; sending a role or provenance in an input payload cannot grant access.

## Primary references

- [Google Search Console Search Analytics query API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query): exact filters, dimensions, final data, date boundaries, aggregation and response metrics.
- [Google Search Console API usage limits](https://developers.google.com/webmaster-tools/limits): per-site/user/project limits, load quotas and recommendations to bound date windows and avoid repeated historic queries.

Future upgrades can add a reviewed archive/retention control, additional zero-cost evidence sources, and scheduled answer checks through an explicitly authorized research client. They must preserve evidence provenance and disclose any external service cost before enabling it.
