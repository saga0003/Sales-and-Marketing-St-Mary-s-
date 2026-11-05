# St. Mary’s Marketing Workspace — v0.4 user guide

5 November 2026 · For the workspace owner, managers, and contributors

**Workspace address:** [stmarys-marketing-workspace.vercel.app](https://stmarys-marketing-workspace.vercel.app/)

Version **0.4.0 is deployed** at the workspace address above. Deployment and validation evidence are recorded in [VALIDATION.md](VALIDATION.md). Social-provider authorization and the user's ChatGPT installation remain separate account-dependent steps; deployment does not mean those accounts have been connected.

## 1. Start here: what is ready, and what still needs setup

v0.4 adds separate owner application administration, multiple-account selection, competitor research requests and webpage comparisons, an exam registry, career pathways, keyword trend charts, a ChatGPT MCP connection, and a storage/account information screen. The existing draft → review → approval workflow remains central.

**The configuration inspection for this version found zero configured Google, Meta, or LinkedIn applications.** That is the specific remaining blocker to their real sign-in, account discovery, analytics imports, and publishing. The owner needs to register/configure those three applications before staff can connect school accounts. An improved interface cannot create a provider application identity or approve its permissions on the provider’s behalf.

You can still use drafts, uploads, internal reviews, notifications, tasks, documents, supported public-source monitoring, exam/career drafts, and saved research without those social credentials. Keywords can be saved before connecting Search Console; their direct Google history begins only after an authorized import.

The budget rule for this version is **$0 in new paid services**. The application makes no OpenAI API calls and purchases no SERP, competitor-scraping, or connection-broker service. Existing Vercel, Supabase, and ChatGPT plans and usage limits remain separate. Storage and hosting are not unlimited. MFA remains deferred as requested.

## 2. Where to find everything

| Navigation                                                                          | Purpose                                                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Overview**                                                                        | Current work, review priorities, and reporting summaries.                                   |
| **Content**                                                                         | Drafts, media, feedback, revision history, approvals, calendar, and publishing status.      |
| **Intelligence → Monitoring**                                                       | Supported official-source and YouTube watches, detected notices, and their status.          |
| **Intelligence → Competitors**                                                      | Add multiple public competitor profiles/channels and start the appropriate research action. |
| **Intelligence → Research queue**                                                   | Research requests, **Webpage changes**, and dated **Profile evidence**.                     |
| **Intelligence → Exams & careers**                                                  | **Exam registry** and **Career pathways**, with sources and manager review.                 |
| **Intelligence → Research briefs / Sources**                                        | Turn source evidence into useful internal briefs and manage saved research sources.         |
| **Performance → Website analytics / Social & local / Ads reports / Search Console** | Individually attributed reports from connected properties and accounts.                     |
| **Performance → Keyword trends**                                                    | Per-keyword charts for direct Google data, recorded search checks, and AEO/GEO evidence.    |
| **Performance → Website checks / AI answer visibility**                             | Owned-site checks and the existing answer-observation workflow.                             |
| **Workspace**                                                                       | Tasks and structured shared documents.                                                      |
| **Settings → Connections**                                                          | Everyday **Accounts & Pages** and the separate owner **Application administration** area.   |
| **Settings → Team & access**                                                        | Create members and private setup/recovery links; manage access.                             |
| **Settings → ChatGPT & MCP**                                                        | Workspace endpoint, requested permissions, active grants, and revocation.                   |
| **Settings → Storage & access**                                                     | Saved/reserved media, available capacity, project identity, and login explanation.          |
| **Settings → Preferences**                                                          | Readable layout preferences and **Your notifications**.                                     |

Use the school selector in the header to focus the workspace. When adding a new connection, also check **School for new connections**; it determines the school that owns the selected resources. Connected-account filters and the analytics account selector help you inspect one Page/property at a time. Most interface timestamps use IST; Search Console chart dates retain Google’s reporting calendar and are labelled accordingly.

The body and input text use a 16px-equivalent base, secondary labels use 14px, and headings are larger. Compact mode reduces spacing without reducing the reading size. See [Typography and UX](TYPE-AND-UX.md).

## 3. A practical 15-minute test with a test email

Use a second email address you already control, or a supported alias. Keep the manager in the normal browser and use a separate browser profile or private window for the contributor. The app creates a login record; it does not create an email inbox or send an invitation.

For this walkthrough, leave **publishing destinations empty**. A planning channel such as Instagram is not itself a connected publishing destination.

| Approximate time  | Action                                                                                                                                                                                                                                                             | What to check                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **0–3 minutes**   | As manager, open **Settings → Team & access → Add member**. Create “Marketing test contributor” with your second email and the **Contributor** role. Copy the private setup link and open it in the separate browser. Choose a password of at least 12 characters. | The contributor can sign in with that email/password. No invitation email is expected.                                           |
| **3–5 minutes**   | In both sessions, open the bell and choose **Enable sound**, or use **Settings → Preferences → Your notifications**. As contributor, create a caption draft, upload one small image, and save it.                                                                  | A short sound confirms audio activation. The file stays attached after leaving Content and reopening the draft.                  |
| **5–9 minutes**   | Submit the draft. As manager, open the new inbox item, inspect the draft, and choose **Request changes** with a note. As contributor, open the feedback, revise, save, and resubmit.                                                                               | Both people receive the relevant next-action notification. Feedback and revision numbers stay attached to the record.            |
| **9–11 minutes**  | Approve the revised post as manager. Reopen the history and reload both sessions.                                                                                                                                                                                  | The approved revision and notification read/unread state persist. No external post is sent because destinations were left empty. |
| **11–13 minutes** | Open **Performance → Keyword trends → Add keyword**. Choose the school and save a real keyword using **Choose later — save the keyword first** if Search Console is unavailable.                                                                                   | The saved track persists and honestly says it needs a property/data. An empty chart is expected; the app does not invent ranks.  |
| **13–15 minutes** | Open **Settings → Storage & access** and check the uploaded file’s usage. Then visit **Intelligence → Exams & careers → Add exam** and save a clearly labelled internal test draft with an actual official reference link.                                         | Usage and limits are visible. The exam remains a draft needing source review, without invented dates or eligibility.             |

After the quick test, use the sections below to check competitor research, career pathways, MCP, and real provider connections. A live authorization/approval review may take longer than this interface walkthrough.

Deactivate the test member when finished if it is no longer needed. Saved work and review history remain. Generate a replacement setup link if the original expires; do not create repeated duplicate members just to retry onboarding.

### Notification behavior

The bell contains the persistent notification window. Sound can be enabled from its footer or from **Settings → Preferences**. **Desktop alerts → Enable alerts** additionally asks the browser for notification permission.

Keep the workspace open. New updates are normally checked about every 20 seconds while the tab is visible, and when you return to it. A hidden/minimized tab does not continuously poll. Desktop popups depend on browser permission and focus; the in-app inbox remains available when sound or popups are off. Closed-browser push and notification emails are not implemented.

Test with two people because the actor does not receive a duplicate alert for their own action. The browser may require another click to unlock audio in a new session. If no sound appears, check the bell, browser/OS muting, and the **Enable sound** state before assuming the review failed.

## 4. Your Supabase project, storage, and login

### The project identified during this inspection

| Item                             | Observed configuration                                    |
| -------------------------------- | --------------------------------------------------------- |
| Connected Supabase account label | **Hema Sagar 333**                                        |
| Organization                     | **InfinitSaga**                                           |
| Project                          | **St Marys Marketing Workspace**                          |
| Project reference                | `zqmngsghinrxnqcwkdkt`                                    |
| Media bucket                     | `stmarys-marketing-private` — private                     |
| Media observed                   | **5 objects, 235,472 bytes**, approximately **0.225 MiB** |
| Database observed                | Approximately **14.2 MB after the v0.4 schema update**    |

These are a dated inspection snapshot, not permanent usage figures. **Settings → Storage & access** shows current application media usage and reservations. The [Supabase project dashboard](https://supabase.com/dashboard/project/zqmngsghinrxnqcwkdkt) shows provider-level usage and billing. Access that dashboard with a Supabase account that has organization/project membership; a workspace test email does not grant Supabase administration access.

### Where each item lives

Vercel runs the interface and API. Supabase PostgreSQL stores drafts, reviews, documents, account records, reports, research, notifications, and media references in the application schema. Uploaded images and videos live in the private bucket. They are not committed to GitHub or stored permanently on a Vercel function’s temporary disk.

Authorized workspace users can preview files. Temporary delivery links allow an approved publishing provider to retrieve the required media. A link can expire while the file remains stored. Supabase documents private buckets and time-limited signed access in its [storage guide](https://supabase.com/docs/guides/storage/buckets/fundamentals).

### Is there enough room?

There is ample headroom for the observed small media collection, but the library has explicit limits:

| Application limit     | Value                                                                   |
| --------------------- | ----------------------------------------------------------------------- |
| Total media allowance | **512 MiB** across saved files and upload reservations                  |
| Item allowance        | **200** saved/reserved items                                            |
| Image input           | **3 MiB** per JPEG, PNG, or WebP                                        |
| Video input           | **40 MiB**, **10 minutes**, MP4 with H.264 video and optional AAC audio |

Images are normalized into immutable JPEGs; transparency becomes white. Video validation does not transcode an incompatible export. A publishing platform can impose stricter format limits. Pending videos reserve their maximum size until completed or cleaned up.

For scale, twelve maximum-size videos occupy about 480 MiB; a thirteenth would exceed the 512 MiB allowance before considering images. Smaller exports and reuse of existing assets stretch the library substantially. Keep camera originals/raw footage outside the publishing library and upload final exports. Check both available bytes and item count before a bulk upload.

Application limits are separate from Supabase storage, database, and download allowances. [Supabase’s published plans](https://supabase.com/pricing) have quotas; do not interpret the app’s remaining allowance as a guarantee of unlimited free hosting.

### Are logins using Supabase Auth? Is there an “application email” inbox?

**Logins are app-managed email/password accounts backed by PostgreSQL. Supabase Auth is not used.** Passwords are hashed and normal browser sessions are managed by this app. Provider account tokens are a separate encrypted credential store.

Your “application email” is simply the address used to identify your workspace login. Use an email address you already own. This software does not supply an inbox, mail hosting, unlimited email accounts, or an SMTP service. Setup and recovery links are shown to the manager for private sharing; no invitation email is sent automatically.

**The 24-hour limit applies only to the single-use setup/recovery link.** Your workspace, Vercel site, account, and saved content do not acquire a 24-hour lifetime. After setting your password, return to the ordinary workspace URL and sign in normally. A manager can issue a fresh link from **Team & access** when needed. Sessions can expire independently and require another sign-in.

## 5. Connecting accounts with the consent flow you requested

### What the owner does once

Open **Settings → Connections → Application administration**. Only the workspace owner can edit this area. There are three application cards: **Google**, **Meta**, and **LinkedIn**.

The app generates one common return address:

```text
https://stmarys-marketing-workspace.vercel.app/api/connections/oauth/callback
```

Register that exact generated address in each provider application you enable, and save its client ID and secret once. The workspace generates the per-service authorization request, permissions, return routing, token exchange, and resource chooser. Staff do not type callbacks or paste secrets for individual Pages/accounts.

The provider still requires a registered application and any applicable API/product approval. Google’s [web-server OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server) and LinkedIn’s [authorization guide](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow) describe these prerequisites. A **Credentials saved / Ready to authorize** label means the local configuration is available; it does not claim every provider permission has already been approved.

The inspection found **zero configured provider applications**, so this owner setup is still needed. Do not expect a real Facebook or Google consent screen while its card says **Administrator setup required**. The blocker is visible instead of opening a secret form from the ordinary Connect action.

### What managers do for each school account

1. Open **Settings → Connections → Accounts & Pages**.
2. Choose **School for new connections**, then the service.
3. Click **Connect**. Sign in on the provider’s own page and grant the requested permissions.
4. Back in the workspace, select the exact accessible properties, Pages, channels, locations, or ad accounts. Multiple choices are supported, up to 25 per save.
5. Save the selection. Each resource appears separately with its own school, identity, status, and report.
6. Use **Test access** and import a report for one selected account. Compare it with the same account and date range in the provider before enabling automatic imports.

Use **Choose more accounts** to discover additional resources available through an existing authorization. Start another Connect flow to sign in as a different identity. Google explicitly offers account selection. Separate service scopes can require another consent grant even when the application is shared.

Selecting an existing resource for the same school renews its existing connection instead of creating duplicate history. A resource already assigned to another school is unavailable; the server rejects a conflicting batch without partially saving it. Unselected existing accounts remain connected.

Filter saved accounts by school, provider family, or name/ID. In Performance, choose the intended connection before reading a report. Different Pages, currencies, reporting periods, and attribution rules are not silently blended.

### Platform prerequisites

| Service                       | Work needed before useful live access                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GA4                           | Enable Analytics Admin/Data APIs and authorize access to the intended property. Tracking must already be installed on the actual website.                                                                                                                                                                                                      |
| Search Console                | Verify the website property, grant the signing-in Google account access, and enable the API.                                                                                                                                                                                                                                                   |
| YouTube                       | Enable Data/Analytics APIs and choose the correct channel or Brand Account identity; Google verification/quota restrictions still apply.                                                                                                                                                                                                       |
| Google Business Profile / GMB | Obtain API project access and manage an eligible location. Google documents this in [Business Profile setup](https://developers.google.com/my-business/content/basic-setup).                                                                                                                                                                   |
| Google Ads                    | Enable the API in the OAuth application's Google Cloud project and obtain the access level needed for production accounts, then authorize the customer account. A manager customer ID may be needed for a hierarchy. See [Google's current access instructions](https://developers.google.com/google-ads/api/docs/api-policy/developer-token). |
| Instagram                     | The implemented Facebook Login route needs a professional Instagram account linked to a Facebook Page you manage, plus the required Meta permissions. See [Meta’s API collection](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api).                                                                                    |
| Facebook Pages                | Authorize a person with sufficient Page access and the Page permissions. Personal Facebook profiles are not publishing destinations.                                                                                                                                                                                                           |
| Meta Ads                      | Marketing API access and permission to read the selected ad account.                                                                                                                                                                                                                                                                           |
| LinkedIn                      | Organization reporting/publishing needs the appropriate Community Management access and Page role. Personal publishing needs the member’s authorization and supported products.                                                                                                                                                                |

Connecting GA4 reads reports; it does not install the Google tag. Create a property/web stream, install the tag or Tag Manager configuration on the school website, verify events, and define meaningful key events separately. The official [GA4 setup guide](https://support.google.com/analytics/answer/9304153) covers that website work.

For detailed owner administration and backward-compatible callbacks, see [Connections v0.4](CONNECTIONS-V04.md).

## 6. Competitors: automatic checks and assisted research

Start in **Intelligence → Competitors → Add competitor**. Save one record per public channel/profile you want to watch, with its correct platform and URL. Multiple profiles can belong to the same competing institution.

| Target                                                               | How this version handles it                                                                                     |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Public website                                                       | Bounded readable-page snapshots, scheduled comparisons, and change alerts when a monitor is configured.         |
| Public RSS/Atom or supported notice page                             | Scheduled item/link detection, baseline, deduplication, and later change notices.                               |
| YouTube channel                                                      | Public upload-feed checks. Optional push subscriptions can supplement checks after activation and verification. |
| Competitor Instagram, Facebook, LinkedIn, or Google Business profile | An explicit research request, followed by an actual team/ChatGPT inspection and source-linked observations.     |

### Website changes

Open **Intelligence → Research queue → Webpage changes → Monitor webpage**. Choose the saved website, target URL, and interval, then **Save monitor**. Use **Check now** to establish a baseline and **Compare changes** after a later successful check.

The first snapshot records what was already present. Subsequent differences produce evidence you can inspect. The monitor retains up to 30 snapshots, defaults to a 24-hour interval, and allows no less than six hours. Scheduled operation depends on the configured worker; outages, backlog, robots restrictions, or a blocked/dynamic page can delay or prevent a useful comparison. This is not a full-site crawler.

### Social profiles and GMB reviews

On a competitor, choose **Research now**, or **Research GMB** for a Google Business profile. A supported website/YouTube target can be checked directly. For the other profiles, the result is a pending request in **Research queue**.

Open the request and choose **Open research in ChatGPT**, or inspect the public profile yourself. Record the actual observation time, source links, summary, accessible follower/review/rating counts, and recent item links using **Record profile evidence / Record evidence**. **Profile evidence** and **Evidence & history** let you compare dated observations. The first observation is a baseline.

If a later inspection finds 4.5 stars and 128 reviews where the previous observation recorded 4.4 and 124, the app can preserve that change and the supporting sources. It cannot infer which unseen reviews appeared, prove a missing sampled post was deleted, or obtain a competitor’s private account analytics. A saved request is not a completed inspection.

There is no guarantee that every competitor post or Google review will be detected immediately. ChatGPT research requires an actual session with access to the relevant public sources; an inaccessible page remains an access limitation. Connecting your own GMB account does not grant private access to competitors’ locations.

### Optional YouTube push

YouTube supports server notifications for uploads and title/description updates through its [push-notification mechanism](https://developers.google.com/youtube/data/guides/push_notifications). In **Intelligence → Monitoring**, a manager can use **YouTube push → Enable push** on an eligible channel watch. The app constructs its callback automatically; there is no callback URL to copy for this subscription.

The control is opt-in. **Awaiting YouTube** means the subscription is pending verification; only **Active** confirms the hub has verified it. A saved opt-in alone is not evidence of active delivery. Use **Turn off push** to disable it while retaining scheduled feed checks.

This guide does not claim a production subscription is enabled or that a real push has been received. Check the displayed subscription state and last delivery, then retain feed checks as a fallback. Push does not supply arbitrary channel analytics or promise delivery of every possible change.

## 7. Exam updates and career pathways

### Official-source notices

Use **Intelligence → Monitoring** to configure watches for official boards, exam authorities, counselling bodies, and medical-college notices. Choose official references such as NTA, CBSE, CISCE, NMC, or MCC appropriate to the topic. A watch collects supported source metadata and notice links; opening a linked PDF and confirming its contents remains part of research.

A new link is not automatically a verified eligibility rule or seat total. Before using medical-college information in marketing, confirm the academic year, course, institution, state, sanctioned intake, approval/proposal status, and effective date in the original notice. The workflow keeps the source evidence with the proposed claim.

### Add an exam

Open **Intelligence → Exams & careers → Exam registry → Add exam**. Enter the name, category, stream, description, academic year, eligibility notes, and official reference links. Add dated milestones only when supported by the source. Link existing source watches if you want related collected notices attached to the exam context, then **Save exam guide**.

Use **Request research** to queue a specific question. The request can be completed with inspected evidence and **Save research for review**. A manager uses **Review**, confirms the sources, and chooses **Mark this revision reviewed**. Editing facts or receiving relevant new source notices clears the applicable review status, so an old approval does not silently cover changed guidance.

Adding an exam does not automatically discover every announcement across the internet. Links, a supported watch, or an explicit research request supply the collection path. The registry can be expanded across competitive exams and boards gradually.

### Build a career route

In **Career pathways → Add pathway**, select the stream and field, then describe the route, academic-year context, and researched eligibility. Use **Add entry route** for alternatives, link saved exams, and record education/training stages, outcomes, and reference links. Save, then request manager review.

For example, Science can organize medicine, allied health, engineering, research, or other fields; Commerce can organize accounting, management, economics, law, or other routes. These are planning categories, not automatically verified admissions advice. An actual route needs the relevant institution/exam rules and year. The baseline does not claim to be a complete national careers database.

See [Intelligence v0.4](INTELLIGENCE-V04.md) for the detailed research and education workflow.

## 8. Daily SEO charts, and AEO/GEO evidence

Open **Performance → Keyword trends → Add keyword**. Enter the exact term, school, Search Console property when available, country code such as `IND`, device, search type, and optional specific page. These identify the track; a different term/property/filter combination has a separate history.

### Google search

Choose an authorized Search Console property for the same school, then enable **daily Search Console checks**. The application requests finalized daily data with a **three-day reporting offset**. Each enabled track becomes due every 24 hours; the scheduled sweep processes a bounded batch of up to three due tracks. This is historical search performance with reporting delay, not a live search-result scrape.

The small chart shows average position by date. Lower is better: a move from 12 to 8 is improvement. Two real reported dates are needed to establish movement. Missing dates remain gaps and **No reported query rows** does not mean rank zero, no visibility, or a proven loss. Google documents both the API’s reporting calendar and incomplete/omitted rows in its [Search Analytics reference](https://developers.google.com/webmaster-tools/v1/searchanalytics/query).

If credentials are still absent, save the track with **Choose later — save the keyword first**. An empty chart is the correct state until data exists. A changed property should not be treated as the continuation of an unrelated site’s ranking.

### Recorded search checks

This tab stores actual team/MCP observations with dates, sources, and location/device context. They remain separate from direct Search Console API imports. Use this when research was actually performed; do not enter an invented rank merely to make a graph appear.

### AEO / GEO evidence

Set the exact answer-test prompt, target school website, location context, and language. Record the real answer provider/model, observation time, response evidence, mentions, and citations. If the model version is not disclosed, say so rather than guessing.

Each chart keeps the same prompt/provider/model/location/language context together. Mention and target-citation rates describe the recorded checks in that context. They are not a universal AI ranking and are not merged into Google’s average position. **Research prompt** copies a task you can use in an actual ChatGPT session. There is no paid daily model or rank-checking service running behind it.

## 9. Connect ChatGPT through MCP

MCP lets an authorized ChatGPT conversation read workspace records and, with additional permission, save research or create drafts. **A workspace manager must create and authorize this connection**; contributors cannot grant MCP access. It does not provide social-platform credentials or start an unattended ChatGPT conversation.

### Add the connection

Use the [current OpenAI instructions](https://developers.openai.com/plugins/deploy/connect-chatgpt); account/workspace policy can affect availability.

1. In this workspace, open **Settings → ChatGPT & MCP** and check the endpoint/readiness.
2. In ChatGPT, open **Plugins**, use **+**, and choose **Add custom MCP server**.
3. Give it a recognizable name, such as “St Mary’s Marketing,” and use this public endpoint:

   ```text
   https://stmarys-marketing-workspace.vercel.app/api/mcp
   ```

4. Choose **OAuth**. This server supports automatic client registration; leave optional client-ID/secret fields empty.
5. Review ChatGPT’s notice and create it as a plugin. Sign in to the school workspace when prompted.
6. On the workspace consent screen, choose permissions and allow the selected access. Return to ChatGPT, review the discovered tools, and install/select the plugin as required by its UI.
7. In a conversation, type `@` and choose the plugin. Start with a read request to confirm the connection.

OpenAI’s [authentication documentation](https://developers.openai.com/plugins/build/auth) explains the OAuth connection model. This MCP registration is separate from registering the school’s Google/Meta/LinkedIn applications.

### Permissions and useful first prompts

| Permission                     | Effect                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **Read the workspace**         | Read saved posts, documents, research, exams, career pathways, and keyword history. Required for this connection. |
| **Prepare content drafts**     | Create unscheduled drafts for review, with no publishing destination attached.                                    |
| **Save research and evidence** | Create research requests and save sourced observations, exam/career drafts, and keyword evidence.                 |

Try these prompts after selecting the plugin:

> Show my pending research requests. Tell me which ones have not actually been researched yet.

> Open the pending GMB competitor request, inspect the public sources available to you, compare them with the saved baseline, and save dated evidence. Describe any unavailable data explicitly.

> Research the official references for this exam’s stated academic year. Save sourced findings for manager review, then prepare a parent-friendly caption draft with no publishing destination.

> Show my tracked keyword history. Keep Search Console measurements, manual search observations, and AI-answer evidence separate. Suggest one content draft supported by the evidence.

A request to inspect sources still requires ChatGPT to have and use suitable research tools in that session. The MCP server provides workspace tools; it does not itself grant web browsing or competitor-platform access.

The server exposes no approval, publication, advertising-spend, provider-secret, or team-administration tool. Research submitted through MCP remains subject to verification. The manager performs review and publication decisions in the app.

Grants expire after **30 days** and can be revoked at **Settings → ChatGPT & MCP → Your ChatGPT connections**. Reconnect when needed. That lifespan is separate from the 24-hour member setup link. The server makes **no OpenAI API calls**; your ChatGPT subscription and limits continue to apply.

## 10. Publishing and reporting after connections work

For each newly connected service, validate account selection and a small report import first. Only then prepare an explicitly intended test publication on an account you control.

| Destination                       | Implemented publishing formats                                   |
| --------------------------------- | ---------------------------------------------------------------- |
| Instagram professional account    | Image, ordered image carousel, or validated MP4 Reel             |
| Facebook Page                     | Text or one image                                                |
| Google Business Profile           | Text/image business update where eligible                        |
| LinkedIn Page or personal profile | Text or one image with the required product access               |
| YouTube channel                   | Validated MP4, with approved privacy/audience/media declarations |

A manager approves the exact caption, media order, destination, and publishing choices. Editing them invalidates approval. A future time is the earliest eligible send time, not a guarantee that a platform finishes processing then. Check the actual returned provider link/ID. An uncertain send is held for reconciliation so a retry does not blindly create a duplicate.

Google Ads and Meta Ads are reporting connections; they do not create campaigns, change budgets, or spend money. Metrics retain their account, period, currency, and provider attribution. A reported ad conversion, GA4 key event, enquiry, and confirmed admission are different measures.

## 11. Troubleshooting and the next operational priorities

| What you see                                             | What to do                                                                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Administrator setup required**                         | The owner completes the shared application/server prerequisite in Application administration. There are no provider credentials to reuse until that setup is done. |
| Provider consent succeeds but a Page/property is missing | Check the signing-in identity’s role, provider permissions, account type, and product eligibility. Choose another identity or renew consent if access changed.     |
| Resource is assigned to another school                   | Confirm its intended school. Do not attach another school’s account just to complete a test.                                                                       |
| GMB/social research stays pending                        | Open the request and perform actual source inspection, either with the team or a connected ChatGPT session. Saving the request does not run an AI job.             |
| Keyword has no line                                      | Connect an eligible property and import, or save actual evidence. Check date/filter context and reporting lag; do not substitute zero.                             |
| YouTube push says **Awaiting YouTube**                   | Wait for verified subscription state and inspect any error. Do not treat opt-in as successful live delivery.                                                       |
| No review sound                                          | Use two accounts, keep the workspace visible, enable sound with a click, and inspect the bell/browser permission settings.                                         |
| Setup link expired                                       | Generate a new private link in Team & access. The app itself has not expired.                                                                                      |
| Upload rejected                                          | Check type, size, duration, remaining bytes, and reserved/item allowance; export a smaller compatible file.                                                        |
| ChatGPT connection fails                                 | Confirm the deployment includes v0.4, the MCP screen is ready, the URL ends in `/api/mcp`, OAuth is selected, and your ChatGPT workspace permits custom servers.   |

The next practical sequence is: finish the three owner provider applications; connect and verify one intended account at a time; compare imported reports; validate publishing deliberately; enable appropriate schedules; and expand source/exam/career coverage from verified evidence. Check backup/restore and media retention as usage grows. Email delivery, MFA, broader ad management, full-site crawling, universal social scraping, and real-time Notion-style co-editing remain later work.

Frequent scheduled workers depend on the existing hosting plan. [Vercel’s current cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) permit daily execution on Hobby and more frequent schedules on eligible paid plans. This guide does not authorize a plan upgrade or claim that all existing hosting is free. Preserve the $0-new-services rule when deciding which schedules to operate.

## Further guides

- [Connection administration and multiple-account details](CONNECTIONS-V04.md)
- [Intelligence, exams, and career pathways](INTELLIGENCE-V04.md)
- [Keyword measurement and evidence details](KEYWORD-TRACKING.md)
- [Typography and accessibility decisions](TYPE-AND-UX.md)
- [Earlier complete workflow guide](USER-GUIDE.md) — v0.3 details; use this guide where v0.4 changes the workflow
- [Repository setup and developer operations](../README.md)
