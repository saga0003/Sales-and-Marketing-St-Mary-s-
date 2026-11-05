# Connecting school accounts

This guide covers the account connections and publishing adapters in the current release. Start in **Settings → Connections**. The app can discover authorized accounts, import reports, and send supported posts after a manager approves the exact revision. A service remains **Setup required** until its developer application is configured; an **App ready** badge means its credentials have been saved, not that the provider has approved the application or granted access to a school account.

The implemented adapters have automated tests using provider responses. A live account pilot is still required for each school's credentials, permissions and eligible resources. No school account is connected merely by deploying this code.

## Can connecting work like Metricool?

Yes: after the school's administrator finishes the provider setup, the everyday process is **Connect account → sign in with the provider → allow the requested permissions → choose the school property, Page, channel or ad account**. The app handles the authorization callback, encrypted token storage, supported token refresh and resource discovery.

There are three developer applications to configure: one Google application, one Meta application and one LinkedIn application. Services in the same group reuse those application credentials but ask for their own permissions. Connecting GA4 does not silently authorize Google Ads; connecting Instagram does not silently authorize Meta Ads.

The account owner still has to consent. The app cannot approve its own permissions, obtain a role the person does not have, verify a website on the school's behalf, or bypass Google, Meta or LinkedIn application review. Creating a social account is only the first part of this setup.

## What this release can connect

| Service                   | Resource you select                            | Implemented reporting                                                                        | Implemented approved publishing                                  |
| ------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Google Analytics 4        | GA4 property                                   | Users, sessions, views, key events, pages and acquisition sources                            | None                                                             |
| Search Console            | Verified website property                      | Search clicks, impressions, CTR, position, queries and pages                                 | None                                                             |
| YouTube                   | Owned channel                                  | Channel views, watch time, average view duration and subscribers gained/lost                 | One MP4 video, with explicit visibility and audience settings    |
| Google Business Profile   | School business location                       | Available daily profile interactions and impressions                                         | Text update or one-image update, subject to location eligibility |
| Google Ads                | Accessible advertiser account                  | Campaign spend, impressions, clicks and configured conversions                               | None; ad budgets and campaigns cannot be changed                 |
| Instagram                 | Professional account linked to a Facebook Page | Available account views, reach, interactions and current account counts                      | Single image, image carousel or Reel                             |
| Facebook Pages            | Managed Page                                   | Posts created in the selected period, current engagement snapshots and available Page counts | Text or one-image Page post                                      |
| Meta Ads                  | Accessible ad account                          | Account and campaign spend, reach, impressions, clicks and reported action types             | None; ad budgets and campaigns cannot be changed                 |
| LinkedIn Pages            | Eligible administered organization             | Available organic organization statistics for an eligible admin                              | Text or one-image organization post                              |
| LinkedIn personal profile | Profile of the authorizing member              | Not included in the self-serve permissions used here                                         | Text or one-image member post                                    |

Resource-level capabilities control the available actions. For example, a person who can see a Facebook Page may lack its content-creation task. That Page can appear without a publishing capability. LinkedIn organization reporting can require a stronger administrator role than posting.

## Before the administrator begins

Use the stable production app URL as the OAuth origin. Open each service's app-settings panel and copy its **Authorized redirect URI** exactly. Register only the callbacks for services you intend to enable. Changing domains later requires updating the application origin and the registered callbacks.

The callback pattern is:

```text
https://YOUR-APP-DOMAIN/api/connections/oauth/SERVICE-ID/callback
```

| Developer application | Service IDs / callback segments                                        |
| --------------------- | ---------------------------------------------------------------------- |
| Google                | `google`, `search_console`, `youtube`, `google_business`, `google_ads` |
| Meta                  | `instagram`, `facebook`, `meta_ads`                                    |
| LinkedIn              | `linkedin`, `linkedin_member`                                          |

Use accounts and developer projects owned by the school. Keep a second authorized administrator for continuity. Provider client secrets are entered in app settings and encrypted on the server; they are never returned to the screen. Once a group has been configured, leave existing secret fields blank to keep them while updating another setting. A new client ID changes the developer application and requires reconnecting existing accounts.

The production site needs to be reachable by intended team members and usable by provider reviewers. Vercel's deployment-protection sign-in is separate from this app's login; the hosting administrator must configure it consistently with those intended users.

## Google: one application, five services

### Common setup

1. Create or choose the school's Google Cloud project.
2. Configure the OAuth consent screen, audience, application information and required verification. If the application is in a testing mode, add the intended test users according to Google's current rules.
3. Create an OAuth client of type **Web application**. Register the exact callback for every Google service being enabled.
4. Enable the APIs listed below. Service-specific API access approval can be required in addition to OAuth consent.
5. In the workspace, save the client ID and client secret once under a Google service. Other Google service cards use the same application.
6. Select **Connect account** on the desired service, choose the correct institution, authorize an account with access, and select a discovered resource. Repeat for each service/resource you want to use.

Google authorization uses an authorization-code flow with PKCE and requests offline access. The app renews access when Google issues a usable refresh token. Revocation, missing offline access or a provider restriction can still require **Authorize again**. See Google's [web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server) and [sensitive-scope verification guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).

### GA4

Enable **Google Analytics Admin API** and **Google Analytics Data API**. The person connecting needs access to the intended GA4 property. This service requests `analytics.readonly`.

**Connecting GA4 does not install tracking on the school website.** Create the GA4 property and web data stream, install the Google tag or Google Tag Manager configuration on that website, check Realtime/DebugView, and configure useful key events. Examples might be an enquiry form submitted, an application started or a prospectus downloaded. Decide which events matter before comparing marketing channels; the app imports the definitions already configured in GA4. Follow Google's [GA4 setup guide](https://support.google.com/analytics/answer/9304153) and [reporting API documentation](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport).

### Search Console

Enable **Google Search Console API**, add and verify the school's website in Search Console, then authorize an account with access to it. Domain verification may require a DNS record; a URL-prefix property can use one of Google's supported verification methods. The app lists verified properties the authorized account can access and requests `webmasters.readonly`.

Reports show Google's search-performance data. The query/page tables may be limited or privacy-filtered; their rows need not add up to the separate overall totals. Dates follow Search Console's reporting conventions. See [Search Analytics query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query).

### YouTube

Enable **YouTube Data API v3** and **YouTube Analytics API**. Authorize the identity associated with the intended channel or Brand Account. The app requests `youtube.readonly`, `yt-analytics.readonly` and `youtube.upload`. It rechecks the upload identity before sending a video so an approved destination cannot silently become another channel.

For the first pilot, create a small test MP4 and choose **Private** in the composer. Also explicitly select the made-for-kids audience setting and altered/synthetic-content declaration. A school video is not automatically made for kids merely because the school has children; the publisher must decide the appropriate designation from the actual content and YouTube's requirements.

The worker uploads the video and records the ID, returned visibility and provider processing status. **Upload confirmed does not mean the video is already public or finished processing.** Check YouTube Studio and the returned link. This adapter sets subscriber notifications off for its uploads. Current upload behavior and available fields are documented in [videos.insert](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert); current docs no longer impose a blanket private-only rule on unverified API projects, although account settings, verification, quota and other restrictions still apply. [Channel Analytics reports](https://developers.google.com/youtube/analytics/channel_reports) require ownership access.

### Google Business Profile / GMB

Use the school's verified Business Profile and request **Business Profile API access** for the Google Cloud project. A configured OAuth application alone does not grant this API access. Enable the Account Management, Business Information, Business Profile Performance and Google My Business APIs required by these adapters. The application requests `business.manage`, which is broader than reporting because approved local-post creation uses it.

Connect as an owner or manager and select the precise school location. Publishing is offered for a location whose returned metadata indicates control; the provider still makes the final decision about verification, business-category eligibility and allowed local posts. A local-post ID can exist while provider moderation is pending. Use [basic setup](https://developers.google.com/my-business/content/basic-setup), [OAuth setup](https://developers.google.com/my-business/content/implement-oauth) and [local-post creation](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts/create).

### Google Ads

Enable **Google Ads API** in the project that owns the OAuth client. Obtain the API access level needed for production advertiser accounts in **Google Cloud Console**. Google changed this onboarding on September 9, 2026: developer tokens were sunset; an existing token header is optional and ignored in the current migration flow. Do not follow older instructions that tell a new integration to apply for a developer token in the Ads manager API Center. Google's [developer-token migration guide](https://developers.google.com/google-ads/api/docs/api-policy/developer-token) is the current authority for this change.

If the school uses a manager account, enter its 10-digit **Manager customer ID**, without hyphens, in the Google Ads application settings. The adapter discovers accessible advertisers and records the applicable manager context. The OAuth scope is `adwords`; although that permission is broad, this application contains only read-only Ads queries. It has no campaign creation, budget changes or spend-changing operations.

The reports retain account currency, account time zone and the provider's configured conversion semantics. A conversion can represent an enquiry, a page event or another configured action; it is not automatically a school admission. Compare figures with the same date range and conversion definitions in Google Ads.

## Meta: Instagram, Facebook Pages and Meta Ads

1. Create a school-owned Meta developer app with the Facebook Login / business use cases needed for these services.
2. Register the three exact callbacks you intend to use. Configure the application's required business information, privacy policy, data-deletion handling and other items required by Meta's current dashboard.
3. Request the permissions and access level needed for the target accounts. Eligible app-role/test accounts may be usable during development; production users outside those roles may require review, advanced access and business verification.
4. Save the app ID and app secret once in the workspace's Meta group.
5. Connect each service separately, allow its listed permissions, and select the specific school account.

| Service        | Permissions requested by this release                                                                                   | Account preparation                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Instagram      | `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights` | Professional Instagram account linked to a Facebook Page; the authorizing person must have appropriate Page/account access |
| Facebook Pages | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `read_insights`                                       | Facebook Page; sufficient tasks/access for posting                                                                         |
| Meta Ads       | `ads_read`                                                                                                              | Person with access to the intended ad account; Marketing API setup/access                                                  |

This Instagram adapter uses **Instagram API with Facebook Login**. It does not use the separate Instagram Login path, so the linked Facebook Page is required here. Personal Instagram accounts and personal Facebook profiles are not publishing destinations. If an older authorization was created before the new scopes were added, select **Authorize again** to request the expanded access.

The app exchanges the Meta authorization for a supported longer-lived token and selects the corresponding Page/account token where needed. It does not promise permanent authorization: expiration, permission changes, account-role changes or revoked access can require reconnection.

Use Meta's [official Instagram API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), [Instagram publishing documentation](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/), [Pages posting guide](https://developers.facebook.com/docs/pages-api/posts/) and [Marketing API Insights guide](https://developers.facebook.com/docs/marketing-api/insights/). Meta's main documentation was intermittently unavailable to the research browser; its maintained Postman collection supplied the account-discovery and permission examples used for implementation.

## LinkedIn: Page and member connections are separate

For a **LinkedIn Page**, create a developer app associated with the school's organization, complete its verification and request the appropriate **Community Management API** access. Register the `linkedin` callback. This service requests `rw_organization_admin`, `r_organization_social` and `w_organization_social`. LinkedIn decides which access level and scopes it approves; a workspace connection cannot substitute for that approval. Authorize an eligible Page administrator and choose the organization. See [increasing API access](https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access), [organization roles](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role) and the [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api).

For a **personal LinkedIn profile**, enable **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn**, register the `linkedin_member` callback, and connect as that member. This route requests `openid`, `profile` and `w_member_social`. It can publish an approved text/image post but does not provide personal-profile analytics or automatic post read-back. Those capabilities are outside the self-serve permissions used here. See [Share on LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin).

The app refreshes LinkedIn access only if the approved product/application actually receives a refresh token and it remains valid. Otherwise it requests reconnection when authorization expires.

## Publishing formats and media limits

These are this application's current supported formats and conservative limits, not a claim to support every format the platforms themselves offer.

| Destination             | Composer format and assets                                  | Text / additional requirements                                                                                                         |
| ----------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Instagram               | `Post`: one image; `Carousel`: 2–10 images; `Reel`: one MP4 | Caption ≤2,200 characters. Images ≥320 px wide, ratio 4:5–1.91:1; carousel ratios must match. Reels: 9:16, ≥320 px wide, 3–600 seconds |
| Facebook Page           | `Post`: text, or text plus one image                        | Caption ≤5,000 characters                                                                                                              |
| LinkedIn Page/profile   | `Post`: text, or text plus one image                        | Caption ≤3,000 characters                                                                                                              |
| Google Business Profile | `Post`: text, or text plus one image                        | Caption ≤1,500 characters; provider must allow local posting                                                                           |
| YouTube                 | `Video`: one MP4                                            | Title ≤100 characters without angle brackets; description ≤5,000; explicit privacy, audience and synthetic-content settings            |

Image uploads accept JPEG, PNG and WebP up to 3 MiB and 24 megapixels. The server decodes them, removes metadata, flattens transparency onto white and stores the normalized JPEG before review. The team approves that final version. Video uploads accept validated MP4 with H.264 video and optional AAC audio, up to 40 MiB and 10 minutes; this release does not transcode other codecs.

Media is private. In this deployment, the configured Supabase storage broker stores the assets in the private application bucket; the application database stores their metadata, owner, dimensions and integrity hash. Authorized team previews use the app or an expiring signed URL. The worker validates the stored bytes again before delivery and grants providers only the temporary access needed to fetch the approved asset. Uploads and unfinished reservations share a 200-item / 512 MiB workspace allowance. An unfinished video reserves its maximum permitted size until completion or expired-upload cleanup.

Stories, mixed-media carousels, Facebook/LinkedIn video, arbitrary YouTube scheduling options and ad creation are not implemented in this release.

## Test a connection and one publication

1. Use **Settings → Connections → Connect account** as a manager. Select the intended institution, authorize, and choose a discovered account. Read its account name and capabilities before continuing.
2. Select **Test access**. This checks current access; it does not publish a post.
3. For a reporting account, choose **Import first report** or open its report panel. Select a completed date range and import. Check the account, institution, dates, import time and notes. Compare one or two figures with the provider's own dashboard using the same settings.
4. Create a clearly labelled pilot draft in **Content**, choose a supported format and actual media, and select only the intended test destination. YouTube should begin with private visibility. Facebook, Instagram, LinkedIn and Business Profile posts can be publicly visible on the chosen account, so use an account and caption appropriate for that pilot.
5. Submit the draft, ask a manager to request changes with a note, revise and resubmit. Confirm that the manager sees the exact final media, caption, destination and platform options before approving.
6. Approval with a destination creates the publication job. A worker must be enabled and running for actual delivery. Open **Content → Publishing queue**, select the job’s post, and inspect its **Publishing** section for the job state, returned provider ID, processing status and link. The queue appears once publication jobs exist. Approval without destinations remains a workspace review action.
7. Inspect the actual provider result. Verify formatting, asset order, account identity and visibility. Record this pilot result before using that account for an ongoing schedule.

Editing an approved draft invalidates its approval and pending jobs. A published destination is preserved even if another destination fails. Duplicate delivered content to make a new post instead of rewriting its history.

### When delivery is uncertain

A timeout after a send may mean the platform accepted the post but its response was lost. Such a job shows **Confirmation needed** in the post’s Publishing section and **Check confirmation** in the queue. It is not automatically resent. Inspect the provider first. For supported read-back services, supply the published post/video identifier in the recovery action; the server checks account ownership, approved text and a plausible publication time before recording success. YouTube also checks the approved title.

LinkedIn personal-profile read-back is unavailable under the self-serve permissions used here. Its uncertain sends require manual inspection and operator investigation; the app deliberately does not offer a blind retry that could produce duplicates. Confirmed delivery, provider moderation and public visibility are separate facts.

## Reading reports accurately

- Every saved report identifies its account, school, date range and import time. Selecting different dates does not refresh the stored report until **Import report** completes. **Export CSV** downloads the persisted report with its notes and currency.
- Imports can run on demand or on an optional schedule. In a connected reporting account, a manager can enable automatic imports (daily by default; intervals from 6 hours to 7 days). The schedule imports a 28-day window ending two UTC calendar dates ago, allowing a reporting lag across account time zones. A bounded worker processes one due account at a time, so the displayed next-run time is eligibility for processing rather than a minute-perfect guarantee. Manual imports can use a different date range. Provider quotas and processing delays still apply.
- Most imports allow up to 90 days per request; Instagram account-insights imports use up to 30 days. Provider availability and retention may further limit results.
- GA4 unique-user totals and YouTube average view duration use separate aggregate reports. They are not calculated by adding daily unique counts or daily averages.
- Meta Ads account reach is taken from the account report, not the sum of campaign reach. Action types remain separate because several actions can describe overlapping user activity.
- Facebook post engagement is a current/lifetime snapshot for posts created in the chosen window. It is not a claim that every displayed reaction happened during that window. Follower counts are current snapshots where provided.
- LinkedIn organization statistics cover organic activity. Net likes can be negative after unlikes, and unique impressions are not summed across dates.
- Google Business Profile device/surface impressions do not equal unique people. Unavailable metrics remain unavailable; the app does not invent totals.
- These adapters report account data the owner authorized. They do not grant access to competitors' private insights, audiences, ad-account reports or unpublished posts.

## Troubleshooting

| What you see                                 | What to check                                                                                                                                                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup required                               | Save the shared developer-app credentials and confirm the production origin is configured                                                                                                                                   |
| Redirect URI mismatch                        | Register the exact callback shown for that service, including its service ID and HTTPS domain                                                                                                                               |
| Authorization cancelled / missing permission | Connect again and explicitly grant the required scopes; check the application's approved products and access level                                                                                                          |
| No accounts found                            | Confirm the authorizing identity has the required role, the resource is eligible, and the provider API is enabled/approved                                                                                                  |
| Google Ads production access error           | Review the owning Cloud project's Google Ads API access level in Cloud Console                                                                                                                                              |
| Business Profile quota/access error          | Complete Business Profile API approval and confirm the required APIs are enabled                                                                                                                                            |
| LinkedIn organization unavailable            | Check Community Management approval, organization scopes and the person's Page role                                                                                                                                         |
| Needs attention / expired authorization      | Test access or authorize again; reselect the same account to renew its existing connection. Automatic imports pause for denied or expired permissions. Temporary service/rate-limit errors retry at the configured interval |
| No report data                               | Verify the property was collecting data during the date range, allow for provider processing/privacy limits, and compare the provider dashboard                                                                             |
| Approved but not sent                        | Check the destination, schedule, publishing enablement, worker schedule and job error                                                                                                                                       |
| Confirmation needed / Check confirmation     | Inspect the provider result before attempting another publication                                                                                                                                                           |

Disconnecting removes that connection's saved local tokens, cancels its pending jobs and removes its saved imported report. It does not revoke the developer application's whole provider-side grant, which may also support other school connections. Full revocation is available from the provider's account-permissions settings.

Implementation references were checked on **5 November 2026**. Provider approval rules, permissions, API versions and metric availability can change; review the linked official documentation when setting up the school's production applications.
