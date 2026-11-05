# Version 0.4 release validation

Validation date: **5 November 2026**. The release adds shared provider-app administration, multi-account connection selection, dated competitor research, webpage snapshots, exam/career records, daily keyword tracking, opt-in YouTube push, an authenticated MCP server, and storage/access explanations.

Application: [St. Mary's Marketing Workspace](https://stmarys-marketing-workspace.vercel.app/). Current instructions: [V04-USER-GUIDE.md](V04-USER-GUIDE.md). Earlier release evidence is retained in [VALIDATION-V03.md](VALIDATION-V03.md).

## Integrated checks

- **160 tests passed**, with no failures or skipped tests.
- Production build and TypeScript compilation passed.
- Prettier and whitespace checks passed.
- `npm audit --omit=dev` reported zero known production dependency vulnerabilities at the time of this check.
- Large Intelligence, Performance and Settings sections load on demand. The main JavaScript bundle is approximately 437 kB minified / 128 kB gzip; it no longer includes all three sections up front.

These are isolated local tests using real HTTP application endpoints and controlled provider responses. They establish implementation behavior; they do not claim a school provider account has granted access or that a real post has been published.

## Covered release boundaries

| Area                                | Evidence                                                                                                                                                                                                                                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connection UX and owner permissions | Missing app setup cannot masquerade as consent. The owner configures three application groups; other managers can connect resources but cannot change secrets. Common and legacy callbacks are tested.                                                                                                           |
| Multiple accounts                   | Atomic multi-selection, separate Page credentials/report identities, stable reconnection IDs, cross-school conflicts and stale selection rejection.                                                                                                                                                              |
| Keyword tracking                    | Exact property/query/school/filter identity, finalized provider dates, absent-row gaps, daily leases and bounded work, separated manual/MCP evidence, context-specific answer observations.                                                                                                                      |
| Research and education              | Real public-page baselines/diffs, SSRF/robots/size protections, revisions, source links, baseline semantics, retained failures, source-change invalidation, unverified research and manager-only source review.                                                                                                  |
| YouTube push                        | Subscription intent/challenge, exact channel/topic, signed raw bytes, delivery size, duplicate/older update rejection, correction handling, opt-in CSRF, renewal and lease fencing.                                                                                                                              |
| MCP                                 | Discovery, callback allowlist, encrypted client secrets, short abandoned registrations, first-login consent return, CSRF/session binding, PKCE, client/resource/redirect binding, scopes, token rotation/replay, revocation/deactivation, idempotent writes, no publish/approve tools, private report isolation. |
| Existing workflows                  | Team/login/recovery, content revision and review, publication reconciliation, notification privacy, media/video reservations, structured documents and current provider adapters.                                                                                                                                |

MCP draft/result notifications also reach the requesting manager once. A duplicate write retry does not duplicate the draft or its notification. A bearer token for MCP cannot access ordinary team-administration routes.

## Browser checks in the isolated demo

The UI was exercised through the actual application, with explicitly labelled synthetic local test records:

- Contributor versus owner connection navigation; three shared application groups; missing-configuration state and provider filtering.
- New ChatGPT and storage/access Settings screens.
- The new Settings navigation and ChatGPT screen at a real 390 px iframe viewport, with no body-level horizontal overflow.
- Keyword creation and two dated recorded observations, showing **12 → 8 / Improved 4**. The direct Google API view stayed empty, proving that manual evidence was not presented as an imported Google measurement.
- Exam creation/reopening, a cited exam research result that remains unverified, and a Commerce pathway with a structured entry route linked to the saved exam.
- Google Business research request, first evidence baseline and second observation displaying review-count and rating changes with separate observed/recorded times.

The keyword screenshot is a synthetic UI test, not a measurement of the school's rank: [v0.4 keyword interface](images/v04-keyword-demo.jpg).

Browser review found and fixed two concrete integration issues: first-time login discarded MCP consent state, and an observation form used `randomUUID()` in an HTTP-only development preview. The validated internal consent return now survives login, and retry keys use `getRandomValues()`.

## Hosted database migration

The additive migration was applied to Supabase project `zqmngsghinrxnqcwkdkt` in the private `smis_marketing` schema:

- Core schema **4**; provider extension **2**; keyword schema **1**; additive intelligence extension **3**.
- The legacy intelligence marker remains **1** so the previous release can continue during rollout or rollback.
- All **57** private-schema tables are owned by `smis_marketing_app`.
- `anon` and `authenticated` have no usage permission on this schema.
- Supabase's security advisor returned no findings after migration.
- Hash comparisons of all existing users, posts, media records and documents matched before/after the upgrade. Existing counts remain 4 user records (2 active), 2 posts, 3 committed media records and 1 document, including the retained inactive QA data described in the prior validation report.
- All 5 existing source watches and 110 collected notice records remain.
- The existing live health endpoint remained HTTP 200 on persistent PostgreSQL after the migration, before the new code deployment.

The migration did not copy synthetic local exam, competitor, keyword or career records into production. It enabled no provider connection or YouTube subscription. Current media storage remained 5 physical objects / 235,472 bytes; database size after schema creation was approximately 14.2 MB.

## Deployment acceptance

The release was deployed and checked on **5 November 2026, approximately 03:49 UTC**:

- Application commit: [`0b59233fd07b0e4ce905be48a1b3602b5c043009`](https://github.com/saga0003/Sales-and-Marketing-St-Mary-s-/commit/0b59233fd07b0e4ce905be48a1b3602b5c043009).
- Vercel deployment: `dpl_EzUjVciLJpTeYNzp2u3YcAU9moJ3`, **READY**, production target, with the canonical `stmarys-marketing-workspace.vercel.app` alias and the exact application commit above.
- [GitHub check, test and build run 41963657485](https://github.com/saga0003/Sales-and-Marketing-St-Mary-s-/actions/runs/41963657485) completed successfully.
- The canonical `/api/health` returned HTTP **200**, `release: "0.4.0"`, `demoMode: false`, and persistent PostgreSQL. The browser loaded the normal work-email/password sign-in screen.
- Both MCP discovery endpoints returned HTTP **200** with the canonical issuer/resource, PKCE S256 and the three documented scopes.
- Anonymous MCP transport returned **401** with the protected-resource metadata challenge. Workspace bootstrap, MCP settings and storage information also returned **401** without a session.
- Unsigned reporting and intelligence cron calls returned **401**. A malformed YouTube subscription challenge returned **422** without accepting a subscription.
- OAuth registration rejected an off-domain callback with **400**; authorization rejected an unknown client with **400**. No usable client or grant was created by those negative checks.
- Vercel returned no error/fatal entries for this deployment in the filtered 15-minute window after these checks. That is a release snapshot, not a guarantee of future uptime.

This documentation update follows the application release; it does not change the deployed application code.

Real Google/Meta/LinkedIn consent, an actual Search Console import, a real YouTube hub subscription/delivery and the user's ChatGPT plugin installation still require their corresponding account access or explicit opt-in. No paid API service, OpenAI call, MFA or external social post is part of this validation.
