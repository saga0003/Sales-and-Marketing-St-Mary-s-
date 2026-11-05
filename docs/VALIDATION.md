# Version 0.3 release validation

Validation date: **5 November 2026**. This release adds readable typography, durable review notifications, structured documents, official-source monitoring, owned-site checks, answer evidence, more account connectors and media formats, and optional scheduled report imports.

Hosted application: [St. Mary’s Marketing Workspace](https://stmarys-marketing-workspace.vercel.app/).

## Automated checks

- `npm test`: **100 passing tests**, no failures or skipped tests.
- `npm run build`: passed, including TypeScript compilation.
- Global Prettier formatting and `git diff --check`: completed.

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

At **320 CSS pixels**, the main navigation uses two columns and Performance tabs wrap. The tested inner viewport measured 305 pixels after its scrollbar, with equal client and scroll widths. The notification panel fits that narrow viewport. A 390-pixel layout was also reviewed.

An enlarged layout was reviewed with a 674-pixel iframe rendered at twice its size. This was an explicit layout simulation; it was **not** a successful native-browser 200% zoom test. A formal accessibility audit, screen-reader coverage and native mobile/Safari uploads remain acceptance work.

## Hosted release checks

The source release is prepared for the existing Vercel project. The remaining rollout checks are the reviewed PostgreSQL migration, production promotion, two-account review/inbox acceptance, private media reads, protected cron invocation, and at least one official-source scan from the hosted runtime. Record their actual outcomes here after deployment. Existing user records must be retained; temporary validation records must be removed.

## Provider acceptance still required

For each desired service, configure the school's developer application, grant eligible access and select the intended resource. Compare a small report period with the provider. Approve one deliberately chosen live test per publishing format, inspect its remote ID and actual result, and verify recovery behavior before depending on scheduled publishing.

Google Ads and Meta Ads are reporting only. Other social competitor profiles remain manual when no authorized API is implemented. AEO/GEO entries are observations entered by the team, not an automated universal rank. Notice-page detection does not parse every PDF or verify a medical-seat claim.

See [USER-GUIDE.md](USER-GUIDE.md), [CONNECTING-ACCOUNTS.md](CONNECTING-ACCOUNTS.md), [INTELLIGENCE-GUIDE.md](INTELLIGENCE-GUIDE.md), and [ROADMAP.md](ROADMAP.md).
