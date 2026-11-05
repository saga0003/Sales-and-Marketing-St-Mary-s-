# St. Mary’s Marketing Workspace — user guide

> **For v0.4, use the [current user guide](V04-USER-GUIDE.md).** It covers the revised connection flow, multiple accounts, competitor research, exams and careers, keyword charts, ChatGPT MCP, storage and the 15-minute test. This document preserves the earlier v0.3 workflow; the v0.4 guide takes precedence where behavior differs.

Version 0.3 · 5 November 2026

**Open the app:** [stmarys-marketing-workspace.vercel.app](https://stmarys-marketing-workspace.vercel.app/)

Use the **question-mark button** in the app for the built-in guide. This document explains everyday use, how to test with a second email, where data lives, and what is required to connect real accounts.

## 1. What the activation link means

A personal setup or password-recovery link works once and expires after 24 hours. That limit applies to the link. It does **not** give the app, your Vercel deployment, your account, or your saved work a 24-hour lifetime.

After choosing your password, use the normal app URL and your email/password. If a setup link expires before it is used, a manager can generate a replacement in **Settings → Team & access**. A replacement invalidates earlier unused links. Changing a password ends previous sessions; normal sessions also expire and require signing in again.

Vercel hosting protection is separate from the app’s login. The production address now lets team members reach the app login without a Vercel account. Preview and generated deployment URLs retain Vercel protection. Always give colleagues the short production URL above, rather than a long generated deployment URL or temporary Vercel share link.

## 2. Where images, videos, and logins are stored

| Item                                                                  | Storage and behavior                                                                                                                                                                         |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App interface and API                                                 | Vercel hosts the interface and server routes.                                                                                                                                                |
| Images and videos                                                     | The private Supabase Storage bucket `stmarys-marketing-private` in the school marketing project. They are not committed to GitHub or saved permanently on a Vercel function’s disk.          |
| Drafts, comments, approvals, tasks, documents, reports, notifications | Supabase PostgreSQL, in the private application schema `smis_marketing`.                                                                                                                     |
| App accounts and sessions                                             | The app’s own authentication implementation, backed by that PostgreSQL database. This version does **not** use Supabase Auth. Passwords are salted and hashed; session cookies are HttpOnly. |
| Provider credentials and account tokens                               | Encrypted server-side in the database. The browser is not given the application’s encryption key or a Supabase secret key.                                                                   |

Authorized users can preview media. Temporary signed URLs allow approved delivery to a publishing provider. A signed media URL can expire while the stored file remains available. Account setup links, session lifetimes, and signed media links are three different things.

Images accept JPEG, PNG, or WebP inputs up to **3 MiB**. The server decodes them, removes metadata, and creates an immutable JPEG; transparency becomes white. Videos accept **MP4 with H.264 video and optional AAC audio**, up to **40 MiB and 10 minutes**, with dimensions up to 4096 px per side. Video validation inspects file structure and track declarations; it does not transcode the video or decode every frame. A destination may impose stricter limits. Use its validation message to correct the export.

The app reserves capacity for uploads and limits the shared library to **200 items / 512 MiB**. Those are application limits, not a guarantee of zero hosting charges. Abandoned upload reservations are cleaned up after their upload links expire. Backups and a tested restore procedure are still an operational responsibility.

## 3. Where to find things

| Section      | Use it for                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------- |
| Overview     | Current work and priorities.                                                                      |
| Content      | Drafts, media, review decisions, history, calendar, and publishing jobs.                          |
| Intelligence | Official-source watches, competitor uploads, a notice inbox, and research briefs.                 |
| Performance  | GA4, connected platform/search/ad reports, owned-site checks, and answer visibility observations. |
| Workspace    | Tasks and shared documents with structured blocks and saved history.                              |
| Settings     | Connections, team membership, notification preferences, and workspace controls.                   |

Choose the school in the header before preparing or connecting school-specific work. Dates and times in the interface use India Standard Time.

The typography uses a 16px-equivalent body and input size, 14px concise secondary labels, and larger headings. The scale uses relative units and respects browser text preferences. Compact mode changes spacing. It does not shrink the reading size. The [typography notes](TYPE-AND-UX.md) explain the research and targeted accessibility checks.

## 4. Test the complete workflow with a second email

Use an email address you control, or an alias that your email provider supports. The address is a login identifier in this application. **No invitation email is sent automatically and no email verification service is configured.** Access is established with the private link created by a manager.

Keep your manager account open in your regular browser. Use a different browser profile or private/incognito window for the test contributor, so the two sessions do not replace one another.

1. Open **Settings → Team & access → Add member** as manager.
2. Enter a recognizable name such as “Marketing test contributor,” the second email, and the **Contributor** role.
3. Copy the member’s setup link. Open it in the separate browser and choose a password of at least 12 characters.
4. In both sessions, open the bell and enable sound if desired. Enabling sound plays a short confirmation tone. Browser audio may need a fresh click after a new browser session. Desktop notifications are optional and require browser permission.
5. As contributor, create a draft, enter a working title and caption, upload an image, and save. Leave **publishing destinations empty** for this internal test. Selecting a planning channel alone is not a publishing destination.
6. Close the editor, reopen the saved draft, and check that the caption and image survived.
7. Submit it for review. Keep the manager tab visible. Within about 20 seconds, the manager should see an unread inbox item. A previously loaded backlog does not play a burst of sounds on login.
8. As manager, open the notification. A post still awaiting review opens in **Content → Approvals** with that post selected and its review controls available. Expand **Comments & revision history** to add a comment, then choose **Request changes** with a useful note. If another manager has already decided, the notification opens the current post details instead.
9. In the contributor session, check the inbox and open the changes-requested notification. Your own draft opens in the editor so you can make the requested change and resubmit. Notifications for posts you cannot currently edit open the post details and history instead.
10. Approve the revised post as manager. The contributor receives the decision. Check the approved revision and the saved history.
11. Change approved content as manager. Confirm that approval is cleared and a fresh review is required.
12. Reload both sessions. Saved posts and notification read/unread states should remain. Deactivate the test member when finished; their saved work and review history are retained.

**Expected result:** both people know when their next action is required. The test does not publish publicly because no destination was attached.

### If no sound or popup appears

Notifications are stored even if sound is off. Check the bell first. New actions create inbox entries; reviews completed before this release remain in post history and are not backfilled into the new inbox. The actor does not receive a duplicate notification for their own action, so use the two-account test above. Sound must be enabled in the browser, and operating-system/browser settings can mute it. Checks run about every 20 seconds while the workspace is visible and refresh when you return. Hidden or minimized tabs do not keep polling. A focused workspace uses in-app alerts; desktop popups are attempted only when permission is granted and the workspace is not focused. Desktop notifications also depend on browser support. This release does not provide closed-browser web push or notification emails.

## 5. Draft, review, and publish

Prepare the caption, institution, format, ordered media, source evidence, and optional planned time. A **saved draft** is shared workspace data. A browser recovery copy is unsent, local work; restore it and save explicitly.

The author submits. A manager approves, rejects, or requests changes. Review comments belong to a revision. Any change to the caption, selected media, media order, destination, or publishing declarations requires a new approval.

With a connected publishing destination, **Approve & queue** identifies the exact account and intended time. The worker checks due jobs every five minutes and processes one at a time. A schedule marks the earliest eligible time; provider processing and backlog can add delay.

| Destination                      | Formats implemented in this release                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Instagram professional account   | One image, an ordered image carousel, or a Reel using a validated MP4.                                                               |
| Facebook Page                    | Text or one image.                                                                                                                   |
| Google Business Profile location | A text or image business update, where that location supports local posts.                                                           |
| LinkedIn Page / personal profile | Text or one image, subject to the authorized product and scopes.                                                                     |
| YouTube channel                  | One MP4 video. Privacy, made-for-children status, and altered/synthetic-media declarations must be explicitly selected and approved. |

Do not treat every format/channel combination in the planning calendar as supported automatic delivery. The composer and server validate the actual connected destinations.

**Queued** means waiting. **Publishing** means processing. A confirmed provider result includes its remote ID/link. A YouTube upload can still be processing or restricted by YouTube; review the reported visibility and provider status. An ambiguous delivery goes to **Confirmation needed**. Inspect the destination and reconcile it where supported before creating another post; blindly retrying could duplicate the publication.

Once any destination has published, the delivered content is protected against editing into a second send. Duplicate it as a new unapproved draft when you need a new post.

## 6. Can connections work like Metricool?

**Yes, for day-to-day account connection after the application has been configured.** The flow is:

1. Choose a service and school in **Settings → Connections**.
2. Click **Connect** and sign in on the provider’s own consent screen.
3. Review and grant the requested permissions.
4. Return to the workspace and select the exact Page, channel, location, ad account, or property.
5. **Test access**, then import a report or prepare a reviewed publication.

The app cannot grant itself permission or skip provider approval. Metricool operates its own registered provider applications. A separately hosted school workspace needs its own application registration and, where applicable, verification or API access approval. This is initial administrator work; colleagues should not have to paste new API credentials for every account.

This version groups credentials into **Google, Meta, and LinkedIn** applications. Each service still requests its relevant permissions. Adding new scopes can require reconnecting an existing authorization.

| Service                               | One-time work outside this app                                                                                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GA4                                   | Create a Google Cloud OAuth web app; enable Analytics Admin and Data APIs; add callback URLs; ensure GA4 is installed on the school website and the account has property access.               |
| Search Console                        | Enable its API, verify the website property, and grant the signing-in Google account access.                                                                                                   |
| YouTube                               | Enable Data and Analytics APIs; use the correct channel/Brand Account identity; meet Google’s verification and quota requirements.                                                             |
| Google Business Profile, formerly GMB | Obtain Business Profile API access for the Google Cloud project and manage an eligible verified school location.                                                                               |
| Google Ads                            | Enable/approve Google Ads API access for the Google Cloud project and grant customer-account access. A manager customer ID may be needed. Follow current access rules in the connection guide. |
| Instagram                             | Configure Meta Facebook Login and permissions; use an eligible professional Instagram account linked to a Facebook Page you manage.                                                            |
| Facebook Pages                        | Configure the Page permissions and authorize a person with sufficient Page access. Personal Facebook profiles are not supported destinations.                                                  |
| Meta Ads                              | Configure Marketing API access and `ads_read`; authorize access to the ad account.                                                                                                             |
| LinkedIn Page                         | Verify the developer app’s associated Page and obtain Community Management API access/scopes.                                                                                                  |
| LinkedIn personal profile             | Enable the appropriate sign-in and Share on LinkedIn products and have the profile owner authorize. Self-serve sharing does not include personal analytics.                                    |

The [account connection guide](CONNECTING-ACCOUNTS.md) contains provider-specific steps, callback URLs, scopes, account selection, and official references. Store secrets in Settings or the server environment, never in a post, document, screenshot, or repository.

### GA4: installation and reporting are different

Connecting an existing GA4 property reads its reports. It does not install tracking on your website. If GA4 is not set up, create its property and web stream, install the Google tag or Google Tag Manager configuration on the actual school website, verify incoming events, and configure meaningful key events. Website consent and measurement settings belong to the site setup.

After authorization, open **Performance → Website analytics**, choose the property and date range, and import. Read the report period and import timestamp. Key events are whatever the property defines; they are not automatically confirmed admissions.

### Instagram: a sensible first live test

Use a school-managed test account or an explicitly agreed test post. Complete Meta app setup, account authorization, account selection, and **Test access**. Attach an uploaded image to a Post draft, select the exact destination, submit, and review the account name before approving. Check the remote post link after the worker runs. Only move to carousel/Reel tests after the basic connection and delivery are confirmed.

### Reporting boundaries

Managers can import a chosen period manually or enable **Automatic imports** for an eligible connected reporting account. Automatic imports are off initially, default to every 24 hours when enabled, and allow intervals from 6 to 168 hours. A separate scheduled sweep runs every 15 minutes and processes at most one due account per invocation. Each automatic import covers 28 days ending two UTC dates before the run, allowing for reporting lag and time-zone differences; the exact dates remain visible. A backlog or provider outage can delay refreshes. Permission failures require reconnection; temporary provider errors can retry on a later interval.

Reports retain dates, currency where applicable, and import timestamps. Reach and unique users are not added across unrelated sources. Ad conversions depend on each provider’s attribution rules; a website key event, an ad conversion, an enquiry, and a confirmed admission are different measures. Ads connectors are read-only and cannot change budgets or launch campaigns.

## 7. How official-source and competitor monitoring works

In **Intelligence**, add a recommended official source or configure a saved source’s feed/notice page. Active watches are persistent. A scheduled sweep runs every 15 minutes, processes a bounded number of due watches, and respects each watch’s own interval (at least six hours). You can also run a check manually, subject to its cooldown.

The live workspace already has watches for **CBSE, CISCE, NMC, MCC undergraduate current events, and NTA**, each with a 12-hour interval. The initial verified collections contain 80 CBSE links, 12 CISCE links, six NMC links, and 12 MCC links: **110 baseline items**. NTA's homepage is reachable, but its current scan extracts no usable notice items. Keep checking NTA manually until a suitable feed or notice adapter is verified. A successful check with zero items does not prove that no new announcement exists.

The first successful scan is labelled a **baseline**: the system found these items, but does not claim they were just announced. Later scans detect new links/items and meaningful changes. Errors and blocked sources remain visible; they do not erase earlier notices. Supported readers use public RSS/Atom feeds and notice-link HTML. They do not solve CAPTCHAs, sign in to scrape a website, or parse every linked PDF.

For medical seats and new colleges, a notice is evidence to investigate. Verify the academic year, course, state, institution, sanctioned intake versus approval/proposal status, and official effective date before making a promotional claim. The system does not invent a national seat total from a headline.

### Competitor workflow

1. Add the competitor’s name, platform, exact profile/channel URL, category, and notes.
2. For YouTube, configure the exact `UC…` channel ID or `/channel/UC…` URL. An `@handle` alone is not an RSS channel ID.
3. Activate its YouTube watch. The notice inbox receives supported public upload-feed items on later checks. A public website/feed can also be watched where allowed.
4. Open interesting items, compare themes and timing, and create a research brief explaining the opportunity for your own audience.
5. Verify evidence, create an original draft, and use the normal review process.

Instagram, Facebook, and LinkedIn competitor profiles are currently **manual watchlist entries** where the platform does not provide authorized public access to this app. A public profile URL does not grant private analytics, ad spend, demographic data, or an unrestricted competitor API. The current YouTube feed watcher records upload items; it is not a historical follower/view-count benchmarking service.

See the [intelligence guide](INTELLIGENCE-GUIDE.md) for source setup, corrections, failure states, and examples of useful marketing briefs.

## 8. SEO, AEO/GEO, and documents

**Owned-site checks:** add the school’s HTTPS website origin, install its displayed verification file or meta tag, verify ownership, and audit a page. The report inspects returned HTML for title, description, canonical URL, headings, image alt attributes, links, robots directives, and structured-data types. It is a bounded page audit, not a JavaScript-rendering crawler or a guarantee of search rankings. Search Console provides separate search-performance evidence.

**Answer visibility:** create repeatable prompts with institution, language, locale, intent, and target page. Record an actual answer, provider/model, date, mentions, citations, and evidence. These are reproducible observations. This release does not run paid ChatGPT/Gemini searches in the background or manufacture a universal GEO ranking score. A ChatGPT subscription does not automatically configure API access for this application. [ChatGPT and API billing are separate](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform); any eligible credits still need to be linked and configured for the API organization.

**Documents:** create paragraphs, headings, bullet items, checklist items, and quotations; reorder them and save. History shows earlier saved versions. Restoring an older version creates a new saved version. If someone else saves while you are editing, compare versions and decide what to keep; the app does not silently overwrite their changes. This is shared block editing with conflict protection, not simultaneous character-by-character collaboration.

## 9. Production acceptance and next decisions

Before regular live publishing, complete one real authorized account pilot per provider, verify callback/account permissions, confirm returned post links and visibility, review connection renewal, and test database/media restoration. Provider API versions, quotas, credentials, and access reviews require ongoing ownership.

Current remaining boundaries include closed-browser push/email delivery, unrestricted social competitor monitoring, broad JavaScript crawling, automated paid-model AEO testing, Facebook/LinkedIn video delivery, advertisement creation/spending, CRM admissions attribution, and simultaneous live document co-editing.

For feedback, give the screen, device/browser, expected result, actual result, and whether the issue occurred with an internal test or a real authorized account. Keep account setup links and credentials out of screenshots.
