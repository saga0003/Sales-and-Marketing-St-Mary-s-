# Release validation

Validation date: **4 November 2026**. Scope: the first self-hosted school marketing workspace, with local persistence and approval workflows. This document records checks performed on the implementation; it is not a platform certification or a claim of live provider connectivity.

## Automated checks

- `npm run check`: TypeScript compilation with strict settings.
- `npm run build`: production frontend bundle.
- `npm test`: **13 integration tests**, using actual HTTP requests against isolated SQLite databases.
- `npm run format:check`: source and documentation formatting.

The API suite covers the following risks:

| Area                      | Verified behavior                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Production initialization | No default credentials or demonstration records; bootstrap accounts use the same validation as later logins                                            |
| Authentication            | Password hashes rather than plaintext; separate sessions; sign-in failure limits without penalizing successful school-team logins                      |
| Request protection        | CSRF tokens and Origin checks; cross-site mutation rejection                                                                                           |
| Team permissions          | Contributors cannot approve, schedule, create managers, or edit another contributor’s drafts                                                           |
| Content revisions         | Stale writes are rejected; editing approved or planned content clears its approval and local planned state                                             |
| Planning                  | Future-date validation and exact approved revision checks; reaching the date does not pretend an external post was sent                                |
| Research                  | Manual production entry starts unverified; client verification/state injection and unsafe URLs are rejected; source provenance survives draft creation |
| Duplicate requests        | Repeating research-to-draft conversion returns the existing draft                                                                                      |
| Workspace records         | CRUD validation, partial updates, safe URLs, valid dates, and honest manual monitoring states                                                          |
| Persistence               | Sessions, changes and audit entries survive reopening the SQLite database without reseeding                                                            |
| Environment isolation     | A demo database cannot be opened as a production workspace, or vice versa                                                                              |

## Browser checks

The running app was exercised in Chromium through the managed development preview. The desktop screenshot is 1363 × 936 pixels. The development harness also rendered the actual app inside 390 × 844 and 768 × 844 pixel iframe viewports; these exercise responsive CSS rather than scaling a desktop screenshot. Scrollbars reduce the corresponding content widths to 375 and 753 pixels.

| Workflow                              | Observed result                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Create a draft and send it for review | The saved record appeared in the manager’s queue with revision 1                                                 |
| Manager approval                      | The interface displayed Approved, the revision, the reviewer and approval time                                   |
| Contributor preview                   | Approval and editing actions were absent for submitted content, including the contributor’s own submitted draft  |
| Content navigation and filtering      | The overview opened Approvals; an unmatched search showed an empty state and cleared the selected detail panel   |
| Mobile calendar                       | The month displayed an agenda and date jump control instead of a compressed desktop grid                         |
| Mobile composer                       | The dialog fit the viewport, fields scrolled, the title received focus and save/review controls remained visible |
| Mobile tasks                          | A task was created with the “In 7 days” shortcut, moved into progress and completed; stored totals updated       |
| Manual research entry                 | A source-linked brief saved successfully and opened with Needs source review and the entered classification      |
| Research to draft                     | The new draft appeared in Content with the source link and an explicit pending-verification note                 |
| Responsive research and analytics     | The inspected layouts remained within their page width; tables retained their own horizontal scrolling           |

The optional source date was left blank in the manual-entry test, verifying that the UI identifies the resulting date as a source/reference date rather than asserting an official publication date.

## Visual decisions checked

- Light surfaces, navy navigation and violet emphasis adapt the supplied reference to school marketing work.
- Review context stays next to the selected content on a wide screen; narrow screens use a modal detail view.
- Status labels supplement color, and controls retain visible keyboard focus.
- Sample analytics, manual monitoring and local planning remain explicit.
- Reported reach is labelled as a sum of daily figures rather than a deduplicated number of people. Channel snapshots are separate from the date-filtered trend.

The screenshots in `docs/images/` show illustrative demonstration data. Test records and SQLite files are not included in git.

## Limits of this verification

- No social, advertising, search, CRM or news account was connected. Provider permission reviews, live data accuracy, actual publication, billing changes and background monitoring were not exercised.
- Production authentication and mode separation were covered through the API tests. A public HTTPS deployment was not created in this session.
- Docker and Compose files were checked statically. Docker was unavailable in the environment, so no container build or container deployment is claimed.
- The browser checks used Chromium. Native date-picker selection on target devices, Safari/Firefox behavior, screen readers, zoom/reflow and a formal contrast/conformance audit remain pilot checks.
- A single SQLite-backed instance is the intended deployment. Load tests, distributed workers, horizontal scaling and disaster-recovery drills have not been performed.

For the next implementation milestones, see [ROADMAP.md](ROADMAP.md). For startup, persistent storage and account setup, see the [README](../README.md).
