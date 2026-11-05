# Open-source reuse decisions

Reviewed on 5 November 2026 for the St. Mary’s workspace. Permission to import a repository does not make merging several unrelated applications the fastest route to a coherent product.

## Decision for this release

Keep the existing React, Express and PostgreSQL application and extend its shared accounts, approval revisions, private media and audit events. These foundations already express the school's most important rule: a manager approves the exact content before an external publisher can send it.

This release does not fork or copy a separate product. It reuses the dependencies recorded in `package.json` and adds focused adapters. There are no new npm dependencies for version 0.3. This avoids adding a second login system, a separate queue and conflicting data ownership merely to display another application's interface inside this one.

## Repositories considered

| Project                                                      | Useful capabilities                             | Why it was not merged into this release                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Postiz](https://github.com/gitroomhq/postiz-app)            | Social scheduling and publishing                | A separate application and operational stack would need its own integration with exact-revision approval and private media. Its [AGPL license](https://github.com/gitroomhq/postiz-app/blob/main/LICENSE) also needs to be respected when modifying and operating it.                          |
| [Mixpost](https://github.com/inovector/mixpost)              | Social publishing and account management        | PHP/Laravel architecture would introduce another runtime and account/data model. Its available edition and actual connector coverage must be checked against the chosen integration.                                                                                                           |
| [Activepieces](https://github.com/activepieces/activepieces) | Recurring workflows and connector orchestration | Potentially useful later for operator-managed automations. Its [license](https://github.com/activepieces/activepieces/blob/main/LICENSE) distinguishes the MIT core from commercially licensed enterprise paths. A workflow still needs to call the school's approval-safe API, not bypass it. |
| [AFFiNE](https://github.com/toeverything/AFFiNE)             | Richer document and knowledge work              | A full separate collaborative document service is more infrastructure than the initial school editor requires. Reconsider when real-time editing, richer databases or a canvas becomes an actual need.                                                                                         |

## Reconsider when there is a concrete gap

Adopt a maintained project when its verified feature coverage and operations cost beat building that particular component. Check the exact release, license, security history, provider terms, deployment requirements, export path and how authorization/audit events cross the boundary. A fork does not remove Google, Meta or LinkedIn app registration, account consent, API quotas or provider review.

The next likely reuse opportunity is an operator-only automation service for broader approved workflows. It should receive narrow workspace API permissions and preserve the existing review process. Do not add it solely to claim that more repositories have been integrated.
