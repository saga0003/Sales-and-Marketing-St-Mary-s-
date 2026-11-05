# Connections in v0.4

The normal workflow is **choose a school → Connect → provider sign-in and consent → choose accounts → view or import that account’s report**. Managers no longer encounter a developer application form when they click Connect. The workspace owner configures three shared applications in a separate administration area.

This guide describes the implementation and its tests. A saved application is not proof of provider approval, and local adapter tests are not proof that a real school account has been authorized.

## What changed

| Area                     | v0.4 behavior                                                                                                                                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Everyday navigation      | Settings → Connections → Accounts & Pages. Choose the school before connecting. Filter saved accounts by school, provider family, or account name/ID.                                                                              |
| Connect                  | Goes directly to the provider’s authorization page when the application is configured. It uses a full-page redirect and returns to the account chooser.                                                                            |
| Missing application      | The card says **Administrator setup required**, explains the missing server/application requirement, and disables authorization. It never opens a secret-entry form as a substitute for consent.                                   |
| Developer administration | A separate, owner-only **Application administration** area groups Google, Meta, and LinkedIn. Other managers can connect accounts using configured applications, but cannot read the administration catalog or change credentials. |
| Callback                 | The server generates one common callback for all ten service adapters. The owner registers that exact value once in each enabled provider application.                                                                             |
| Resource selection       | Check multiple returned Pages, properties, locations, channels, or ad accounts. Up to 25 resources can be selected in a single save. Use **Choose more accounts** to add more from an existing authorization.                      |
| Separate analytics       | Each selected resource has its own connection ID, school, account ID, report, sync state, and publishing capabilities. The existing analytics account selector reads the selected connection’s report.                             |
| Reauthorization          | Selecting an already-connected resource for the same school renews its existing connection instead of creating a duplicate. Its report and publishing-destination identity remain stable.                                          |
| Different schools        | An existing resource assigned to another school is marked unavailable. The server independently rejects such a selection and rolls back the entire batch.                                                                          |

## Why a callback still exists

The consent experience shown in Metricool is OAuth. A provider still needs an application identity, registered return address, and permission configuration behind that screen. This workspace now generates the authorization request, scopes, state, return address, token exchange, and account chooser. Those details stay out of the everyday account-connection screen.

Google requires registered application credentials and a matching redirect URI; LinkedIn also requires a developer application and registered callback. Application registration and provider access review cannot be granted by this workspace itself. See the [Google OAuth web-server documentation](https://developers.google.com/identity/protocols/oauth2/web-server) and [LinkedIn authorization-code flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow).

The owner handles application registration once per provider family. Staff handle their own provider sign-in and consent. Credentials are never requested per Page, school, or report.

## Owner setup

1. Sign in as the workspace owner and open **Settings → Connections → Application administration**.
2. Copy **Authorized callback / redirect URI**. Its format is `https://<workspace-host>/api/connections/oauth/callback`. Use the exact generated value; do not type a different callback into the workspace.
3. Register or open your own application with the required provider. Register the generated URI in that provider’s developer console.
4. Enable the required APIs/products and request the access appropriate to your school accounts. The expandable service requirements in each application card list the current adapter requirements.
5. Save the application’s client ID and secret once in the owner form, or configure them in the secure deployment environment. Secrets saved through this form are encrypted on the server. Neither saved secrets nor account access tokens are returned to the browser.
6. Return to **Accounts & Pages**, choose the school, and connect one service to validate consent and resource discovery.

| Shared application | Services using it                                                 | Prerequisites beyond the common callback                                                                                                                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google             | GA4, Search Console, YouTube, Google Business Profile, Google Ads | Enable the service APIs in the same Google project. The authorizing Google identity must have access to the intended resource. Applicable Google verification, API access, and quotas still apply.                                                                                           |
| Meta               | Instagram, Facebook Pages, Meta Ads                               | The implemented Instagram adapter uses Facebook Login and requires a professional Instagram account linked to a Facebook Page. Choose the Meta products and permissions needed by the enabled service. Eligible app-role testing or the required provider access approval must be completed. |
| LinkedIn           | Organization Pages, personal profile publishing                   | Configure the required products and scopes. Organization features require eligible Page administration and Community Management access; member publishing uses its own requested permissions.                                                                                                |

Meta’s own [Instagram API collection](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api) documents the application prerequisite. Its [Page-token request](https://www.postman.com/meta/instagram/request/0vuw3vk/get-access-tokens-of-pages-you-manage) documents discovering managed Pages and their distinct Page access tokens. The implementation preserves that resource separation.

The application card shows **Credentials saved** only when the server can load the application credentials and has a valid public origin. The service card then says **Ready to authorize**. Neither label claims that the provider has approved every product or scope. The consent/discovery response determines actual access.

Each service requests its own defined permissions. Sharing a Google or Meta application does not give every connected service universal access. A new service may ask for an additional consent grant. Google’s connection screen requests account selection, so a manager can choose a different Google identity when needed.

### Server configuration

The deployment must retain its original `CREDENTIAL_ENCRYPTION_KEY` and set its stable HTTPS `APP_ORIGIN`. An encryption-key change without migrating existing ciphertext makes saved credentials unreadable. The server reports this rather than displaying a ready connection.

Environment-based shared credentials remain supported:

- Google: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- Meta: `META_APP_ID` and `META_APP_SECRET`.
- LinkedIn: `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`.

An encrypted workspace setting takes precedence over its environment counterpart. Optional Google Ads manager hierarchy configuration remains part of the shared Google application.

No paid connection broker or additional MFA step was introduced.

## Connecting several accounts

1. In **Accounts & Pages**, select the school for the new connections.
2. Click **Connect** on the intended service.
3. Sign in on that provider’s own domain and grant the requested permissions.
4. The workspace lists only resources returned by that authorization. Search by name or ID and check the resources you intend to use.
5. Review the school shown in the chooser, then save the selection.
6. Each chosen resource appears separately. Use **Test access** and import a report for that specific connection.
7. To add resources reachable from the same authorization later, use **Choose more accounts**. To sign in as another person or Google identity, start another Connect flow.

The selection limit is 25 per save, not a total workspace account limit. Provider discovery itself has bounded pagination and may request a more limited account identity if the provider returns too many resources. A provider may return fewer resources than the user expects because of account roles, product eligibility, permissions, or its own API behavior. The workspace cannot manufacture access to a missing resource.

Selecting an existing same-school resource renews its credentials and preserves its connection ID. Unselected existing connections remain connected. A selected connection cannot be repointed to a different resource through the old single-account endpoint; this prevents an approved publishing destination from silently changing identity.

New resources always receive separate connection IDs and separately sealed credentials. A Facebook Page token from one Page is never copied into another Page’s selected connection. Reports keep their own connection attribution. Disconnecting one connection does not disconnect its sibling resources or replace their reports.

## Review and publishing

Connecting an account or importing a report does not publish anything. The existing content review and durable publishing queue remain in place. Selecting a different destination still requires the content revision and approval checks already used by the workspace.

An account cannot be changed while a publication is actively processing. Renewing the same account can restore access needed to reconcile an ambiguous send, but it does not authorize a duplicate send. Changing the shared application ID marks affected connections as needing attention and cancels eligible queued/failed jobs; the manager must reauthorize before publishing can resume.

Google Ads and Meta Ads adapters remain reporting adapters. Connection administration does not introduce campaign creation, budget edits, or ad spending.

## Practical acceptance test

Use an isolated test workspace and provider accounts you control. Keep publishing destinations empty when testing only the content interface.

| Test                                                         | Expected result                                                                                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Open Connections with no application credentials             | Clear administrator blocker; Connect is disabled. No secret modal opens.                                                |
| Sign in as an ordinary manager                               | Accounts & Pages works; owner application administration is unavailable. Direct administration API requests return 403. |
| Sign in as the workspace owner                               | Exactly three shared application groups and one generated callback are visible. Existing secrets are never shown.       |
| Configure one family, then connect a service in that family  | Connect navigates to provider consent. A successful return opens the resource chooser.                                  |
| Cancel provider consent                                      | The workspace reports that authorization was not granted. It creates no selected connection.                            |
| Select two authorized Pages for one school                   | Two independent connections appear. Importing each report preserves its account ID/name and school.                     |
| Repeat consent and select those same two Pages               | The existing IDs remain; there are no duplicate connections or overwritten sibling reports.                             |
| Try to select a resource already belonging to another school | The chooser marks it unavailable, and the server rejects a forged request atomically.                                   |
| Remove provider access after listing resources, then save    | Selection is re-discovered and rejected if the resource is no longer available. No fabricated connection is created.    |
| Disconnect one of two connected resources                    | Its sibling remains available with its own report.                                                                      |
| Authorize in one browser session and return in another       | Authorization is rejected because state is session-bound.                                                               |

Automated regression coverage uses local fake provider responses. Real consent, product approval, actual school access, and provider quotas must also be checked with the real registered applications before calling that integration production-verified.

## API and migration contract

All routes below use the existing session and CSRF protections. Owner administration additionally requires the manager role and the authoritative `workspace_owner_id` marker. The marker is initialized by core v0.4 migration/bootstrap; an inactive owner is not replaced automatically. The extension retains the earliest-active-manager fallback only for legacy installations with no owner marker.

| Route                                           | Purpose and response                                                                                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/connections`                          | Existing public catalog plus `applicationAdministration: { isOwner }`. Providers return `canConfigure: false` for other users.                                                                    |
| `GET /api/connections/applications`             | Owner-only `{ applications, redirectUri, encryptionConfigured, originConfigured }`. Three groups, service requirements, readiness, and credential source; no saved client secret or access token. |
| `PUT /api/connections/applications/:group`      | Owner-only partial save; group is `google`, `meta`, or `linkedin`. Returns `{ application }`. Initial save requires client ID and secret.                                                         |
| `PUT /api/connections/providers/:provider`      | Legacy settings endpoint retained, now subject to the same owner check.                                                                                                                           |
| `POST /api/connections/authorize`               | Existing `{ provider, institution }`; returns the real provider authorization URL using the shared callback. Manager-only.                                                                        |
| `GET /api/connections/oauth/callback`           | New common return handler. Provider, school, user, session, expiry, verifier, and exact callback are resolved from server-held authorization state.                                               |
| `GET /api/connections/oauth/:provider/callback` | Legacy return handler retained for previously issued authorization states.                                                                                                                        |
| `GET /api/connections/:id/accounts`             | Re-discovers accessible resources. Public choices may include `connectedConnectionId` and `connectedInstitution`; no tokens are returned.                                                         |
| `POST /api/connections/:id/select-many`         | Manager-only `{ accountIds: string[] }`, 1–25 unique IDs. Returns `{ connections }`. Re-discovers, checks stale authorization/configuration, and saves all selected resources transactionally.    |
| `POST /api/connections/:id/select`              | Existing single-selection shape retained. It cannot change a selected connection to a different resource.                                                                                         |

No new connection tables or columns are required. Existing encrypted provider settings retain their storage keys, including the legacy `instagram` key for the Meta family. Existing selected connection IDs and reports are preserved. New authorization state adds the exact `redirectUri` inside the existing encrypted verifier payload. In-flight older states that lack this field use their service-specific callback.

Register the common callback in each enabled provider app **before starting new authorizations with v0.4**. Keep old callback registrations until any in-flight older authorizations have expired. Existing selected account tokens do not need migration merely because the callback path changed.

The extension also exposes the server-only helper:

```js
await extensions.withSearchConsole(
  connectionId,
  { accountId: expectedProperty, institution: expectedSchool },
  async (connection, currentCredentials, applicationCredentials) => {
    // Call the fixed-host Search Console API within the server.
  },
);
```

The helper requires the Search Console provider, an exact selected property and school, `connected` status, and `analytics:read`; it reuses the existing refresh path. It is never a client endpoint. Calling modules must still fence their own database persistence against stale jobs or changed tracking records.

## Verification performed

The connection extension suite contains 38 passing tests at this change, including the existing publishing/reporting protections and six additional regression cases covering owner privilege, common/legacy callbacks, multi-Page credential and report isolation, cross-school rollback, stale authorization, and the Search Console helper. The TypeScript check also passed. These are local implementation checks; they do not claim a live provider has granted access.
