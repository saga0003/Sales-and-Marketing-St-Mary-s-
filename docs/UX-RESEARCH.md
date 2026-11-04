# School marketing workspace: UX decisions

## Goal and audience

The product gives a small school marketing team a shared place to discover useful information, prepare content, request approval and keep work organized. Contributors need to understand their next action without learning the integration architecture. A manager needs to see the content and its supporting evidence before approving publication.

The design uses a soft off-white canvas, navy text, restrained violet accents, rounded panels and generous separation between sections. Green, amber and red are secondary status cues. Every meaningful status also has a text label; color is never the sole explanation.

The application should feel like one workspace. Separate services may supply publishing, monitoring or reporting later, but users should not have to understand those services to add a task or review a draft.

## Reference translated into the product

The supplied interface reference informed the light canvas, rounded cards, compact navy navigation, violet selection and paired list/detail review area. These choices were adapted to school marketing tasks. Dashboard figures, review counts and source status have distinct labels, and sample figures remain visibly separated from saved workflow records. No artwork or product branding from the reference was copied.

## Information architecture

The top-level navigation groups work by the team's intent:

| Area         | User question                                 | Main action                          |
| ------------ | --------------------------------------------- | ------------------------------------ |
| Overview     | What needs my attention?                      | Open work that needs review          |
| Content      | What are we going to publish?                 | Draft, review and approve content    |
| Intelligence | What should we pay attention to?              | Review an insight and create a draft |
| Performance  | What is working?                              | Compare available results            |
| Workspace    | Who is doing what, and where is our guidance? | Maintain tasks and shared documents  |
| Settings     | What is connected and who has access?         | Inspect configuration                |

Within Intelligence, **Discover**, **Competitors** and **Sources** separate the research inbox from the reference collections that will supply it. Within Workspace, **Tasks** and **Knowledge** separate work to complete from information to retain. These are visible, labelled switches, rather than hidden navigation inside overflow menus.

## Research inbox and source evidence

An insight is a starting point for a human decision. Its card includes a category, date, source, summary and verification state. The full detail view adds the source type, audience, original-source link and a suggested content angle. Managers can mark a source as verified or return it to review. Contributors can see that state and prepare a draft.

The filters have distinct meanings:

- **All updates** shows the active research inbox and excludes dismissed entries.
- **Saved** collects bookmarked ideas.
- **Needs review** highlights updates without team verification.
- **Drafted** makes it clear that a content draft already exists.
- **Dismissed** allows an update to be restored rather than permanently losing it.

Bookmarks are reversible. Draft creation is explicit, and the interface explains that a draft still requires editing and manager approval. Creating a draft is not a publication action. The source-detail panel has a dedicated reminder for medical-seat information: proposed additions, approved intake and counselling-round availability are different facts.

Public URLs are checked for HTTP/HTTPS protocols before the application renders an external link. Source pages open in a separate tab so that the review context is preserved. The interface shows the original publisher rather than implying that a generated summary is authoritative.

## Competitor and source collections

Teams can enter a research brief with a publisher, source URL, their own summary, intended audience and content angle. The source type is a human classification; saving it never marks evidence as verified. A manager reviews the brief separately.

The collections support add, edit, search and confirmed deletion. Competitor entries also show the platform, category and review notes. Official sources use a more compact row layout because comparing names, domains and categories is their primary task.

The status is **Manual review** until a real monitoring worker is connected. The prototype does not describe saved URLs as running monitors or claim that a profile was recently checked. A paused entry is labelled **Paused**. A review timestamp is shown only when supplied by stored data.

Adding a profile does not grant access to its private metrics or guarantee automated collection. The UI stays focused on the reference the team has saved. Future integrations must expose real connection and job health separately from the existence of a URL.

## Tasks and knowledge

Tasks open in a three-column board: **To do**, **In progress** and **Completed**. Explicit actions move a task forward, and the edit form exposes owner, due date, priority and status together. A list view provides a compact comparison of the same fields and supports direct status changes. Dragging is not required for any action.

Search and owner/priority filters sit beside the board/list switch. Empty columns have an explanation and a direct add action. Overdue tasks have an **Overdue** text label as well as a different color. The progress indicator counts stored tasks; it does not imply an external productivity measure.

Knowledge documents have categories, full-text search, a reading view and a simple text editor with a preview. This first version intentionally identifies the format as plain text. It does not imply support for Notion blocks, real-time co-editing, document history or rich text that has not been implemented. The editor permits a blank body but requires a usable title. Deleting a document requires explicit confirmation.

## Table and toolbar guidance

IBM Carbon's [data-table guidelines](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines) informed the task list's separation of search/filter controls, column headers, row data and row actions. The implementation uses a real HTML table with a caption and scoped column headers. Repeated edit/delete controls have record-specific accessible names.

The toolbar contains controls that affect the visible collection. Each row contains actions for that row. The primary create action remains near the page heading. This reduces ambiguity about whether an action affects one item or the whole workspace.

There is no decorative row selection because the first version does not offer a batch operation. The table can scroll horizontally on narrow screens while preserving the document's normal page layout.

## Accessibility decisions

The implementation is informed by the W3C explanations for [WCAG 2.2 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) and [Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html). These are implementation references, not a claim that the entire application has completed a conformance audit.

- Core actions use native buttons. Fields use labels, and icon-only actions identify both the action and affected record.
- Repeated compact action targets have minimum dimensions of at least 24 CSS pixels. Most toolbar and form controls are larger.
- Intelligence and Workspace view/filter switches expose their state with `aria-pressed` and use ordinary buttons. Other page tabs remain reachable by keyboard; a complete screen-reader audit is still outstanding.
- Task movement is available through buttons and select controls, so it does not require pointer dragging.
- Native focus behavior is retained. Search controls use a visible focus-within treatment. Shared modals provide focus trapping, Escape handling and focus restoration.
- The post composer keeps its actions visible in a footer while its content scrolls. Intelligence and Workspace avoid sticky overlays inside their page content. Dialog content must scroll within the available viewport, and focus must remain visible when validation or the on-screen keyboard changes the visible area.
- Status, priority and verification use text in addition to color. Task progress exposes a labelled progressbar value.
- User-provided document content is rendered as text, not injected HTML.
- Layouts adapt to one column on small screens. Decorative transitions respect reduced-motion preferences.
- Errors appear as text, and form validation errors are announced with `role="alert"`. The application toast system provides feedback for server mutations.

Keyboard traversal, actual color contrast, zoom/reflow, screen-reader announcements and modal focus behavior should be checked in the running application before making a formal accessibility claim.

## Preview versus future live functionality

| Implemented interaction               | Boundary that remains visible                              |
| ------------------------------------- | ---------------------------------------------------------- |
| Saved competitor and source records   | Manual review; no background watching is implied           |
| Research cards and saved ideas        | Example records retain their example labels                |
| Team verification of source evidence  | Human review status, not an automated fact-check guarantee |
| Creating a content draft              | No approval or publication is implied                      |
| Task and document CRUD                | Shared persistence provided by the application's API       |
| Board/list and search/filter controls | Operate on stored workspace records                        |

Future live monitoring needs scheduled workers, source parsers, error handling, review timestamps, change evidence and correction handling. Publishing needs real connected accounts and a server-side check that the exact approved revision is the revision being sent. Analytics needs real account data and a clear date window. These future capabilities must replace preview labels only when their actual dependencies are connected and verified.

## Security and product contracts

The frontend hides manager verification from contributors, but the API must enforce the same rule. Button visibility is not authorization. Mutations use the shared workspace client, which refreshes state after success and returns API errors to the page. The UI does not optimistically claim that a mutation succeeded before the server accepts it.

Opportunity approval and content publication are separate actions. The server remains responsible for preventing stale approvals, duplicate publication and unauthorized account operations. The interface reinforces that boundary by making **Create content draft** a distinct action and by leaving the approval flow in Content.
