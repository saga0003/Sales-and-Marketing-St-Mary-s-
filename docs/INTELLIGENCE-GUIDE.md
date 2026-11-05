# Research, competitor monitoring, SEO and answer visibility

This guide covers the automated research features in St. Mary’s Marketing Workspace. Your saved sources, notices, briefs, audit reports and observations use the workspace’s persistent PostgreSQL database. Source pages and PDFs remain with their original publisher; the collector stores links, short feed metadata, detection times and change history.

## 1. Start with official education sources

Open **Intelligence → Monitoring**. The source catalog provides starting points for NTA, CBSE, CISCE, NMC, MCC, UPSC and Karnataka Examinations Authority. **Add watch** saves the source and enables its monitor. You can also save a source in the source library and create a watch for its public RSS/Atom feed or HTML notice page.

For each watch, choose:

| Setting              | How to use it                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Source or competitor | Connect the watch to the saved source/profile so the team can identify its publisher.                                                           |
| Mode                 | Use **RSS** for a public RSS/Atom feed; **HTML** for a page containing notice links; **YouTube** for a channel’s public video feed.             |
| URL                  | Enter the notice-page/feed URL. An HTML monitor does not open every page on the website.                                                        |
| Keywords             | Optional words or phrases matched against titles and feed excerpts. An item matching any keyword is retained. Leave empty for broader coverage. |
| Interval             | Choose between 6 and 168 hours. The default is 12 hours.                                                                                        |
| Active               | Pause a watch when it is no longer needed. Pausing keeps existing results.                                                                      |

Choose **Check now** for the first scan. Its results are marked **Baseline**: they were already on the source when monitoring began. They must not be presented as announcements published today. Publisher dates and detection dates are separate; an HTML link often has no reliable machine-readable publication date.

After the baseline, the worker discovers new links and title/feed-metadata changes. Repeated scans of the same item do not create duplicate notices. Corrections update the existing notice and retain its earlier metadata in history. A linked brief’s verification is cleared if its source metadata changes, so the team can check the correction before using the claim again.

The scheduler checks for due watches every 15 minutes and processes up to two in each run. A watch is fetched only when its own interval is due. This is periodic monitoring, not an instant breaking-news service. Work queued behind other due watches can run later. Each scan retains up to 80 matching items, and the workspace supports up to 50 watches.

### What a source check does and does not establish

The HTML collector reads notice titles and links. The RSS/Atom collector also retains a short excerpt and a supplied publication date. It does not read every PDF, total the seats in a medical-college spreadsheet, or verify a claim merely because a page was reachable. A PDF replaced at the same URL without changed page/feed metadata may not be detected.

Sites can change layout, require JavaScript, block automatic readers or disallow a path in `robots.txt`. The watch displays the error and preserves earlier results. It backs off failed automatic checks. Login walls, access challenges and crawling restrictions are not bypassed. Keep such sources in the manual review list or use a publisher-provided allowed feed. Wait at least one minute between manual retries.

The catalog is a useful starting set, not coverage of every competitive examination or every state board. Add the exact official pages relevant to your audience and periodically review which ones still work.

## 2. Turn an update into useful marketing content

1. Open an item in the notice inbox and follow its **original source**.
2. Check the examination/course, academic year, effective date, issuing authority, affected candidates and any later correction.
3. Choose **Create brief** and record the audience, the practical content angle and priority. The brief starts **unverified**.
4. A manager checks the evidence and verifies the brief. The brief keeps the original link and distinguishes a supplied publication date from its first detection time.
5. Turn the brief into a draft, add the school’s explanation or advice, and use the normal submission and manager-approval process.

For a medical-seat item, distinguish an application for a new college, permission for a course/intake, recognition status, and seats available in a particular counselling round. These are different claims. Read the NMC/MCC order and its applicable year before using a number in a post. The software does not certify admission eligibility or offer medical advice.

For example, a new seat-matrix link could become a useful explainer about where students can check the official matrix and what changed for the relevant round. The team supplies and verifies the actual comparison; the collector does not invent an increase or an advantage.

No detected item becomes a public post automatically. Brief creation is idempotent: clicking it twice returns the same brief. Existing drafts and approved content are not silently rewritten when a source later changes.

## 3. How competitor monitoring works

Save each competitor’s name, platform, profile URL, category and any notes in the competitor list. You can track several profiles for the same competitor.

| Competitor source                                  | Automated behavior in this version                                                                                                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YouTube channel                                    | Polls its public upload feed and records video titles, links, publication dates and available short descriptions. Title/description metadata corrections update the recorded item. |
| Public website or blog                             | Monitors its allowed public RSS/Atom feed or an HTML notice page.                                                                                                                  |
| Instagram, Facebook, LinkedIn, X or TikTok profile | Saved for manual review. Arbitrary competitor-profile scraping is not implemented. Connecting your own social account does not grant access to a competitor’s private analytics.   |

For YouTube, enter the exact channel ID beginning with **UC** followed by 22 characters, or a URL such as `https://www.youtube.com/channel/UC…`. A channel handle such as `@schoolname` alone is insufficient for this feed connector. YouTube provides channel IDs in account/channel information and channel links. The feed offers a limited recent upload window; it is not a complete historical archive.

A practical team routine is to review new competitor items, label the topic or format, save a brief about the opportunity, and create an original response relevant to your school. For example, a competitor’s admissions Q&A might reveal an unanswered parent question that your team can explain. The app records the source; it does not copy a competitor’s video or automatically claim that a topic caused more admissions.

This release does not provide competitors’ private reach, ad spending, enquiries, audience demographics or conversion data. Public feed activity and your own account analytics answer different questions.

## 4. Audit your website’s SEO foundations

Open the SEO section in **Performance** and register an HTTPS website URL. Audits require proof that your team controls the exact origin—for example, `https://school.example.org` is separate from `https://www.school.example.org`.

Choose one verification method:

- Publish the exact displayed token as the text content of `/.well-known/stmarys-marketing-verification.txt` on that website.
- Add the displayed `stmarys-marketing-verification` meta tag to the homepage HTML head.

Your website administrator can make this small change. Click **Verify** after it is publicly available. A public verification token is not a password or a Google/Meta credential. Ownership is renewed every 30 days; keep the file or tag in place and verify again when requested. If the site redirects to another origin, register and verify the final origin.

Enter a page URL on the verified origin and run an audit. The report checks the returned HTML for:

- HTTP response, title, description and canonical declaration.
- Headings, language and viewport metadata.
- Missing image alt attributes and visible HTML link counts.
- JSON-LD parsing/types, robots directives and basic social-preview metadata.

Each result contains the checked URL and time. Findings explain what was observed and what to review; there is no invented ranking score. Empty alt text can be appropriate for a decorative image. Multiple H1 headings are a review item, not proof of a Google penalty. A found canonical or structured-data type is not a guarantee of valid search eligibility.

This is a one-page HTML audit, not a browser-rendered crawl. It does not execute JavaScript, test every linked destination, measure Core Web Vitals or prove whether Google has indexed a page. Use the separately connected Search Console reports for actual search performance. Wait at least one minute between audits of the same registered site.

## 5. Measure AEO/GEO with reproducible evidence

The answer-visibility section is a **manual observation log** in this release. It helps you measure a repeatable sample without pretending that every AI answer has a universal rank. It does not silently run ChatGPT, Gemini or another provider, and a ChatGPT subscription is not used as an API key.

Create a test prompt with its intent, school, language, location and target website. Keep wording and context consistent when comparing observations. Run the prompt yourself in the chosen provider, then record:

| Field                      | What to record                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| Provider and model         | The service and the model shown, or explicitly “not disclosed” if unavailable.             |
| Checked at                 | The actual observation date and time.                                                      |
| Answer excerpt             | Enough of the answer to explain the observation; avoid unnecessary personal information.   |
| Mentioned                  | Whether the school was mentioned in that answer.                                           |
| Cited                      | Whether the answer cited the school’s target website. Include the actual citation URL.     |
| Citation URLs and evidence | The cited pages and an optional accessible share/capture link.                             |
| Notes                      | Account/context differences, location assumptions and anything that affects repeatability. |

The server checks that a “cited” observation includes a URL on the target website. A citation to another institution is not counted as a citation to your school. Earlier observations retain a snapshot of their prompt and context when you later edit the prompt.

Compare like-for-like prompts and show the sample size alongside any mention/citation rate. A change across a few manually recorded answers is an observation, not proof that your school’s overall AI visibility increased. Google’s documentation says normal SEO foundations still apply to its AI search features; there is no special AI schema or separate technical requirement that guarantees inclusion.

## 6. A safe evaluation sequence

1. Use your manager account to add one official source from the catalog and run its baseline.
2. Check that the original URL, baseline label, detection time and any publisher date are clear.
3. Create a brief from one notice. Verify that it stays unverified until a manager checks it, then create a draft through the existing workflow.
4. Add a YouTube competitor using its exact channel ID and review the returned video links.
5. Pause a watch and confirm that it keeps its earlier notices while no longer participating in scheduled scans.
6. Register a website you control, publish its challenge token, verify it and audit one page.
7. Record two answer observations using the same prompt and context. Check that their evidence links and dates are understandable to another team member.

For a source blocked by robots, authentication or JavaScript, confirm that the UI shows the problem and lets the team continue with manual review. Do not treat an empty or failed import as evidence that a board or competitor has published nothing.

## Official references used for this implementation

Checked on **5 November 2026**. These pages establish the source locations and platform behavior; they do not make any particular detected announcement verified.

- [NTA notice archive](https://nta.ac.in/NoticeBoardArchive)
- [CBSE examination circulars](https://www.cbse.gov.in/cbsenew/Examination_Circular.html)
- [CISCE official homepage and latest updates](https://cisce.org/)
- [NMC public news/notices](https://nmc.org.in/whats-new?type=news)
- [MCC current undergraduate counselling events](https://mcc.nic.in/current-events-ug/)
- [MCC undergraduate news and events](https://mcc.nic.in/news-events-ug-medical/)
- [UPSC latest notices](https://www.upsc.gov.in/whats-new)
- [Karnataka Examinations Authority](https://cetonline.karnataka.gov.in/kea/indexnew)
- [YouTube’s documented public channel-feed notification model](https://developers.google.com/youtube/data/guides/push_notifications)
- [Google Search Essentials](https://developers.google.com/search/docs/essentials)
- [Google: AI features and your website](https://developers.google.com/search/docs/appearance/ai-features)

The implementation uses the existing Node.js/Express/PostgreSQL stack. It does not import an entire social-management repository or introduce an additional paid automation service.
