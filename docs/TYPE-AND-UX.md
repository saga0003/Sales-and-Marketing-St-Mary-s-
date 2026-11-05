# Typography and interaction decisions

Researched 5 November 2026. This is the workspace's design scale, not a claim that WCAG requires a universal minimum pixel size.

## Research

- [USWDS typography](https://designsystem.digital.gov/components/typography/) recommends a comfortable effective size of at least 16px for most body text, reserving smaller sizes for concise companion text and specialized UI. It describes line height as a unitless multiplier and recommends considering line length alongside size.
- [GOV.UK paragraphs](https://design-system.service.gov.uk/styles/paragraphs/) currently uses a 19px paragraph default and 16px small body text sparingly. Its content-heavy public-service pages use a larger scale than this compact team dashboard.
- [WCAG 2.2: Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html) requires text to support enlargement to 200% without loss of content or functionality. It does not prescribe one minimum font size for every interface.
- [WCAG 2.2: Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) describes reflow at an equivalent width of 320 CSS pixels, with exceptions for content such as data tables that needs a two-dimensional layout.

## Applied scale

| Use                                             | Default size                                  | Treatment                                           |
| ----------------------------------------------- | --------------------------------------------- | --------------------------------------------------- |
| Body copy, text inputs, selects                 | 1rem / usually 16px                           | Unitless line height 1.5–1.7                        |
| Brief metadata, status labels, compact controls | 0.875rem / usually 14px                       | Readable contrast; never used for long instructions |
| Section headings                                | 1.25rem / usually 20px                        | Clear spacing and 1.4 line height                   |
| Dialog headings                                 | 1.375rem / usually 22px                       | Wrap rather than truncate                           |
| Page headings                                   | 2rem / usually 32px; 1.75rem on small screens | 1.2 line height                                     |

The root size is 100%, so the scale respects the browser's base font preference. Earlier 8–13px text has been replaced with the scale above. Inputs remain at least 1rem across screen sizes. The compact display preference adjusts spacing, not the font size. Page actions, forms, badges, and navigation can wrap. Mobile navigation uses a readable grid rather than shrinking its labels. Dense charts use a scrollable region and retain their exact data tables.

The reference's light surfaces, navy navigation, and violet emphasis are retained. Motion is reduced when the operating system requests reduced motion. A full accessibility conformance audit is separate from these targeted improvements; do not claim formal WCAG certification.

## Notifications

- Each user has a persistent inbox and unread count; viewing a page does not mark every item read.
- Lightweight polling checks for changes about every 20 seconds while the workspace is visible. Focus refreshes the inbox. This does not replace an open editor's unsaved state.
- Sound requires the user's explicit opt-in and a browser gesture. The preference can be muted. Audio may need a gesture again after a new browser session.
- Desktop alerts request browser permission only when the user enables them. They are optional, browser-dependent, and need an open workspace. Closed-browser web push and notification emails are not implemented.
- New alerts are deduplicated across tabs where Web Locks/localStorage are available. Historical unread items do not all chime on login.

## Shared documents

Structured blocks store plain text, not executable HTML. Paragraphs, headings, bullets, checklist items, and quotations can be inserted and reordered. Existing plain-text documents remain readable. Each save includes the expected version; conflicting changes preserve the unsaved editor and require explicit review. Saved history can be inspected and restored as a new version.
