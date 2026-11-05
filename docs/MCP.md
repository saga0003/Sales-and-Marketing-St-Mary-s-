# ChatGPT MCP connection — v0.4

The application exposes an authenticated **Streamable HTTP MCP server** at:

```text
https://stmarys-marketing-workspace.vercel.app/api/mcp
```

It uses the official, pinned `@modelcontextprotocol/sdk` package. It does not call the OpenAI API, purchase research credits, or run a consumer ChatGPT session in the background. The user's ChatGPT plan and custom-plugin availability still apply.

## Connect as a manager

1. Open the workspace's **Settings → ChatGPT & MCP** and copy the endpoint.
2. In ChatGPT, open **Plugins → plus → Add custom MCP server**. Enter a name and the endpoint, then choose OAuth. Client registration is automatic; optional client-ID/secret fields can remain empty.
3. Follow ChatGPT's creation/installation flow. Sign in to this workspace when prompted. The app returns to the pending consent screen after a first-time login.
4. Reading is required. Select draft preparation and/or research writes only if desired, then allow the chosen access. Declining returns an OAuth denial without creating a grant.
5. Start a conversation and select the plugin using `@`. Ask it to list pending research requests, inspect the actual source links and save cited findings for review.
6. Revoke a connection in **Settings → ChatGPT & MCP** whenever needed. Authorization expires after 30 days and requires a new consent flow.

Current official instructions: [connect a custom MCP server](https://developers.openai.com/plugins/deploy/connect-chatgpt), [OAuth authentication](https://developers.openai.com/plugins/build/auth). Some older ChatGPT interfaces use Apps or Connectors terminology. Account/workspace policy can restrict installation.

This release has not signed in to the user's ChatGPT account or installed the custom plugin on their behalf. Protocol tests establish server behavior; actual installation and consent require that user's account.

## Permissions and tools

| Scope                | Tools and effects                                                                                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace:read`     | Identify the current account; read work counts; search saved posts/documents/tasks/competitors/sources; read a post and comments; list source updates and research requests; read competitor history; list/get exams, pathways and keywords; list selected provider accounts; read an individual imported account report. |
| `workspace:drafts`   | Create a content draft. It is always unapproved, unscheduled and has no publishing destination or attached media.                                                                                                                                                                                                         |
| `workspace:research` | Queue research; save cited findings/competitor observations; create/update unverified exam and career drafts; add a keyword; record manual/MCP search or answer evidence separately from direct provider measurements.                                                                                                    |

Tools are registered only for scopes actually granted. No tool approves or publishes a post, verifies an exam/pathway, changes an advertising campaign/budget, returns a provider secret, creates a user, or changes application administration.

The existing workspace authorization model applies: managers can read the shared school workspace. The school selector organizes records; it is not a new independent tenant boundary. Individual account reports retain their exact connection, provider and school identity.

All research claims must retain inspected references and observation times. Tool descriptions explicitly treat source text as untrusted evidence, never as instructions. A source update is not automatically a verified seat count, deadline or eligibility rule.

### Retry behavior

Every write tool requires an `idempotencyKey` of 8–120 characters using letters, numbers, underscore, period, colon or hyphen. Use a stable key for a retry of exactly the same intended change. A different payload with the same key returns `idempotency_conflict` instead of silently duplicating or replacing a record.

The grant row is locked before writes; authorization is rechecked and the operation/receipt commit together. Exam and pathway updates additionally need their current expected revision. Keyword evidence cannot write the direct Search Console sample table. ChatGPT draft/results events notify the requesting manager as well as eligible other managers; manual self-edits do not create redundant self-alerts.

## Authentication design

- Public discovery at `/.well-known/oauth-protected-resource/api/mcp` and `/.well-known/oauth-authorization-server`. Vercel routes both to the API, not the single-page HTML shell.
- Authorization-code OAuth with mandatory S256 PKCE, exact registered redirect and resource binding. Tokens for another origin/resource cannot be reused here.
- Dynamic client registration permits only the documented `https://chatgpt.com` callback paths. It supports public clients (`none`) and `client_secret_post`; confidential client secrets are encrypted with the existing credential vault.
- Anonymous unapproved registrations expire after 30 minutes. Consent extends a client registration to 90 days from registration, while its individual manager grant lasts 30 days. Abandoned registration/request records are reclaimed.
- The browser consent request lasts 10 minutes and binds to an authenticated active manager **and that browser session**. Normal application CSRF protection applies to consent and revocation.
- Authorization codes last two minutes and work once. Access tokens last at most one hour. Refresh tokens rotate, remain bounded by the 30-day grant and revoke the grant if an already consumed refresh token is replayed.
- Access, refresh and authorization-code values are stored only as hashes. Every MCP request checks that the manager is still active and the grant is current. Deactivation/revocation invalidates existing access immediately.
- Bearer credentials apply only to the MCP endpoint. They do not authorize ordinary browser administration endpoints.
- Durable per-IP OAuth and per-grant MCP rate limits apply across serverless instances. The initial MCP limit is 600 requests/hour/grant.
- CORS is limited to ChatGPT on the MCP resource, with no credentialed ambient-browser access. OAuth SDK handlers expose their required discovery/token interfaces.

The server transport is stateless and returns JSON. Each HTTP request gets a fresh SDK server/transport and closes it when complete. GET/DELETE on the MCP transport return 405 after authentication; no long-lived event-stream session or in-memory token store is required.

## Configuration and deployment

The existing production `APP_ORIGIN` and `CREDENTIAL_ENCRYPTION_KEY` are sufficient for this server's own OAuth registration. No OpenAI API key is required. Do not confuse this with Google/Meta/LinkedIn application registration: those providers still require their own applications and user consent.

Core migration `004_owner_mcp.sql` adds the owner marker and MCP authorization/receipt/rate tables. The Supabase release migration also adds research, education, YouTube push and keyword tables within the private `smis_marketing` schema under `smis_marketing_app`. Hosted automatic migration remains disabled.

The production migration retains `intelligence_schema_version=1` for the old build during deployment/rollback and sets `intelligence_extensions_version=3` for the new build. It preserves the existing account, post, media, source and notice records.

## Verification and operational limits

The MCP test suite uses real HTTP requests to an isolated application database: discovery, allowed registration callbacks, encrypted client secrets, session-bound consent, CSRF, scope restrictions, PKCE, code reuse, exact resource/client/redirect, SDK initialization/tools, draft idempotency, no publication side effect, unverified research, per-account report isolation, refresh replay, revocation and deactivation. The sign-in return helper has a targeted regression for retaining consent without accepting an external redirect.

An active MCP connection does not inspect a webpage by itself. A ChatGPT session needs to perform the research using its available browsing tools and call the appropriate record tool. The workspace retains the result for review. Local automated tests and public hosted discovery checks do not prove that an individual user's ChatGPT plugin has been connected.

No MFA or email delivery was added. Persistent inbox alerts, optional sound and browser notifications continue to use the existing open-workspace delivery mechanism.
