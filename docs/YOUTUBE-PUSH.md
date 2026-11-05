# YouTube push updates

YouTube channel watches now support an optional push subscription in addition to scheduled public-feed checks. A manager can enable it from the channel's watch card. The app generates its callback URL and shared signing secret; team members do not copy callback addresses, create a Google API project, or paste a YouTube API key for this feature.

Google documents push events for video uploads and changes to a video's title or description. Delivery can be near real time when the hub sends an event. This does not cover every kind of YouTube activity, and it is not a promise that every update arrives instantly. Community posts, comments, competitor analytics and other platforms are outside this subscription.

## Use it

1. Save the competitor's YouTube channel, using its exact `UC…` channel ID or `/channel/…` URL when adding the watch. A handle alone does not establish the feed identity.
2. Enable the channel watch and run its first check. This records older videos as a baseline instead of presenting them as newly published.
3. In that watch's **YouTube push** section, choose **Enable push**. It starts **Awaiting YouTube** until the hub verifies the generated public callback.
4. Choose **Refresh status** to recheck. Pending cards also refresh their status while the screen is visible. **Active** includes the lease expiry and latest accepted delivery time.
5. New or corrected items appear in the same notice inbox used by scheduled monitoring. Existing video IDs remain the same records. A changed source clears verification on any linked research brief so the team can review the correction before publishing.
6. Choose **Turn off push** to stop local ingestion immediately. The app also asks the hub to unsubscribe. Scheduled feed checks remain controlled by the watch's ordinary settings. Pausing a watch stops its push ingestion and automatic renewals as well.

If the service is unavailable, the card gives the reason. A missing baseline, paused watch or missing server configuration must be resolved before opt-in. Public-provider subscriptions are not activated automatically when this release is installed.

## What must be configured once by the workspace owner

- A stable public HTTPS app origin (`APP_ORIGIN` / the application's configured public origin). Localhost and a preview behind a sign-in wall cannot receive Google's callbacks.
- The existing `CREDENTIAL_ENCRYPTION_KEY`, used to encrypt each watch's signing secret with authenticated encryption. The UI never receives this secret.
- The authenticated intelligence cron worker. It renews at most **one due subscription per sweep**, alongside existing feed and page work.

No separate YouTube OAuth client, paid monitoring tool or model API is required for public-channel push. Existing server hosting and database limits still apply. If deployment protection blocks public callback requests, the subscription remains pending rather than claiming that delivery works.

The app requests a five-day lease. The hub chooses the actual lease duration, which the app records. Renewal is scheduled before that expiry; failed requests use increasing delays, capped at 24 hours. If the app or scheduled worker is unavailable long enough for the lease to expire, push is shown as needing attention. Existing feed history remains available.

## Evidence and delivery behavior

Each delivery must have a valid HMAC signature over its exact raw body. The callback checks the pending verification intent, exact subscribed topic, per-entry channel identity and valid update timestamps. Raw bodies are limited to 256 KiB and at most 40 video entries. XML document types and custom entities are rejected. The verification challenge is returned using a non-executable media type with `nosniff`.

Delivery receipts and provider update timestamps prevent duplicate retries or older packets from repeatedly creating alerts or overwriting a newer revision. The app retains up to 200 receipt hashes and 1,000 recent per-video revision timestamps for each watch. Existing notice and research retention follows the ordinary monitoring module.

A signed push can report a description change without including the new description itself. In that case the app retains the prior excerpt, marks the source as updated, and asks the reviewer to open the source. It does not invent a new description. The signed signal may therefore create a review event even when the visible title and retained excerpt are unchanged. The scheduled feed check remains in place to reconcile available metadata.

Some events can be missed during outages, delayed, rejected for an invalid signature, or omitted by the provider. A successful subscription confirms delivery setup; it does not prove complete historical coverage. The latest received timestamp is the last accepted push, not proof that the channel had no later activity.

## Maintainer reference

The additive `server/intelligence/migration-v3.sql` migration introduces subscriptions, bounded delivery receipts and per-video revision timestamps. The existing notice table remains authoritative. `createYoutubePushService()` accepts an injected clock, fetch adapter and watch service, so tests make no external subscription calls.

| Endpoint                                           | Access                                  | Purpose                                                 |
| -------------------------------------------------- | --------------------------------------- | ------------------------------------------------------- |
| `GET /api/intelligence/youtube-push`               | Signed-in user                          | Read availability and per-watch status, without secrets |
| `POST /api/intelligence/watches/:id/youtube-push`  | Manager + normal CSRF                   | `{ "enabled": true }` to opt in; `false` to stop        |
| `GET /api/intelligence/youtube-push/callback/:id`  | Pending intent with matching topic/mode | Hub verification challenge                              |
| `POST /api/intelligence/youtube-push/callback/:id` | Valid signature + active subscription   | Bounded raw Atom delivery                               |

Only the callback path is exempt from browser origin/session checks. Manager controls keep their ordinary session and CSRF requirements. The public callback does not accept commands to publish content, change credentials, or approve research.

The callback completes bounded ingestion inside the request. It does not launch an unawaited task that might disappear when a serverless function finishes. An in-progress source check can return a retryable response; the hub can retry the delivery. Subscription request tokens and database locks fence overlapping renewal attempts.

## Validation

The tests cover opt-in, role checks, baseline requirements, encrypted secrets, topic and mode verification, safe challenges, signed delivery, correction identity, linked-brief invalidation, omitted description text, duplicate/out-of-order messages, stale polling, payload limits, pausing, unsubscribe, persisted renewal and backoff. All provider traffic in these tests is injected fixture data. A real hub subscription must still be checked after a manager opts in on the deployed public origin.

Primary references:

- [YouTube push-notification guide](https://developers.google.com/youtube/data/guides/push_notifications): supported channel events, Google hub and Atom payload identities.
- [W3C WebSub specification](https://www.w3.org/TR/websub/): subscription intent, finite leases, authenticated delivery and callback response safety.
