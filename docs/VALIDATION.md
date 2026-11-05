# Version 0.3 release validation

Validation date: **5 November 2026**. This release adds readable typography, durable review notifications, structured documents, official-source monitoring, owned-site checks, answer evidence, more account connectors and media formats, and optional scheduled report imports.

Hosted application: [St. Mary’s Marketing Workspace](https://stmarys-marketing-workspace.vercel.app/).

## Automated checks

- `npm test`: **110 passing tests**, no failures or skipped tests.
- `npm run build`: passed, including TypeScript compilation.
- Global Prettier formatting and `git diff --check`: passed.
- `npm audit --omit=dev`: zero known production dependency vulnerabilities at the time of the check.
- GitHub Actions: [source release verification](https://github.com/saga0003/Sales-and-Marketing-St-Mary-s-/actions/runs/41947272730) completed successfully.

The tests use actual HTTP requests against isolated local application databases, controlled provider responses and storage-signature checks. Coverage includes accounts and CSRF, role/ownership permissions, exact-revision approval, concurrent editing, per-user inbox privacy, document conflicts/history, immutable ordered media, MP4 validation, shared upload reservations, provider discovery/reporting, publication recovery, scheduled-import leases, source-fetch safety, source baselines/corrections, SEO ownership and answer evidence.

Provider fixture tests do not establish that a school has completed provider approval or that an actual social post was published. No live Google, Meta or LinkedIn authorization is fabricated by this release.

## Real cloud storage check

The existing narrow Supabase media broker was updated while retaining its own Ed25519 request authentication and private bucket. The real cloud check confirmed:

| Boundary                                    | Observed result                                                     |
| ------------------------------------------- | ------------------------------------------------------------------- |
| Bucket initialization                       | Private, with 40 MiB video allowance and JPEG/MP4 MIME restrictions |
| Unsigned broker request                     | HTTP 401                                                            |
| Signed direct MP4 upload                    | HTTP 200                                                            |
| Reuse of upload link to overwrite an object | Rejected with HTTP 400                                              |
| Signed video download                       | SHA-256 matched the original fixture bytes                          |
| Test cleanup                                | The disposable video object was removed                             |

Image normalization still accepts at most 3 MiB input. A video must pass application validation before becoming an approved asset; a successful raw storage upload alone is insufficient.

## Browser and visual checks

The actual app ran in an isolated local sample workspace through the managed browser preview. Checks included notification opening/preferences, saved document blocks/checklists, version history, composer behavior and monitoring interfaces. The supplied violet/navy visual direction is retained.

A final notification navigation check used two roles and a different starting school filter. The manager's submission alert opened the exact post in Approvals with review controls. After requesting changes, the older alert opened the post's current details; the contributor's changes-requested alert opened an enabled editor for revision and resubmission. This was a real local browser workflow, not a simulated click test against a mocked component.

At **320 CSS pixels**, the main navigation uses two columns and Performance tabs wrap. The tested inner viewport measured 305 pixels after its scrollbar, with equal client and scroll widths. The notification panel fits that narrow viewport. A 390-pixel layout was also reviewed.

An enlarged layout was reviewed with a 674-pixel iframe rendered at twice its size. This was an explicit layout simulation; it was **not** a successful native-browser 200% zoom test. A formal accessibility audit, screen-reader coverage and native mobile/Safari uploads remain acceptance work.

## Hosted release checks

The code release was built and promoted on the existing Vercel project. Production uses core schema version 3, provider extension version 2 and intelligence version 1. All 35 private-schema tables are owned by the restricted application role. The `anon` and `authenticated` Data API roles have no schema usage; the Supabase security advisor returned no findings.

**41 hosted acceptance checks passed** through the actual Vercel HTTP API and Supabase storage, using two disposable workspace accounts:

| Workflow                    | Observed result                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Public login and API health | Normal staff login loads; health confirms persistent PostgreSQL                                                             |
| Anonymous access            | Workspace bootstrap returns HTTP 401                                                                                        |
| Test email setup            | Manager creates a private contributor setup link; activation succeeds; replay returns HTTP 400                              |
| Permissions                 | Contributor cannot create users or mark the manager's notification read                                                     |
| Image-backed draft          | Saved, reloaded, submitted, revised and approved with no publishing destination                                             |
| Review notifications        | Manager receives submission; contributor receives change-request feedback and approval                                      |
| Preferences and read state  | Sound preference persists and individual notification read marking succeeds                                                 |
| Exact review revision       | Revised draft becomes revision 2; manager approval records revision 2                                                       |
| External publishing         | No publication job is created for the internal test                                                                         |
| Shared document             | Structured version 1 saves, teammate saves version 2, stale overwrite returns HTTP 409 and both versions remain in history  |
| Private video               | Signed MP4 upload commits after validation; completion is idempotent; authorized temporary delivery matches the stored hash |
| Scheduled workers           | All three unsigned cron routes return HTTP 401; all three authorized bounded invocations return HTTP 200                    |
| Existing media              | The user's pre-release private image remains readable and its SHA-256 is unchanged                                          |
| Providers                   | All ten services are visible with honest unconfigured states; no account is shown as connected                              |

Browser inspection of the hosted canonical URL also confirmed the school's own sign-in form, with no Vercel account wall. The actual email/password inputs render at 16px with 24px line height; labels render at 14px. See [hosted login](images/v03-hosted-login.jpg) and [local narrow inbox](images/v03-mobile-inbox.jpg). The latter uses an isolated sample workspace.

Vercel Standard Protection covers preview/generated deployment URLs; the canonical production URL reaches the application's own authentication. No provider account was authorized, no social post was sent and no advertising changes were made during validation.

A pre-upgrade record snapshot was taken for the rollout. The original account, post and media fingerprints matched after migration. This rollout snapshot is not a substitute for an ongoing managed backup and restore procedure.

The two disposable QA accounts have been **deactivated**, and a final database check confirmed that the two original accounts, original post and original media fingerprints are unchanged. There are no publication jobs. Permanent removal of the labelled QA records required a database-service confirmation that expired before completion, so the test post, document and uploads remain retained. Their inactive accounts cannot sign in; those records are not evidence of real school activity.

## Official-source rollout

Five active official-source watches were added through the authenticated manager API: NTA, CBSE, CISCE, NMC and MCC undergraduate current events. Four collectors produced **110 baseline links**: 80 from CBSE, 12 from CISCE, six from NMC and 12 from MCC. The NMC items include actual seat-matrix and new-college application notice links, not invented seat totals. All initial findings are labelled **Baseline**; they are not represented as newly published today.

NTA's current-notices homepage is reachable and the final hosted check completed without a reader error, but it extracted **zero usable notice items**. Its watch is configured; useful automatic NTA collection is not yet verified. Continue checking the official NTA website manually until a suitable feed or notice adapter is validated. Do not interpret a successful fetch with zero items as proof that no new announcement exists.

The live checks identified compressed responses and oversized inert HTML metadata. The reader now streams gzip, deflate and Brotli with independent encoded/decoded limits and scans complete tag boundaries without interpreting attributes from tags over 16 KiB. Regressions cover fake nested anchors and oversized ownership challenges. The one-MiB document budget, deadlines, robots rules and DNS protections remain in place.

## Provider acceptance still required

For each desired service, configure the school's developer application, grant eligible access and select the intended resource. Compare a small report period with the provider. Approve one deliberately chosen live test per publishing format, inspect its remote ID and actual result, and verify recovery behavior before depending on scheduled publishing.

Google Ads and Meta Ads are reporting only. Other social competitor profiles remain manual when no authorized API is implemented. AEO/GEO entries are observations entered by the team, not an automated universal rank. Notice-page detection does not parse every PDF or verify a medical-seat claim.

See [USER-GUIDE.md](USER-GUIDE.md), [CONNECTING-ACCOUNTS.md](CONNECTING-ACCOUNTS.md), [INTELLIGENCE-GUIDE.md](INTELLIGENCE-GUIDE.md), and [ROADMAP.md](ROADMAP.md).
