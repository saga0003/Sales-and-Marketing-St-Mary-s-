import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js';
import { clientRegistrationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/register.js';
import { revocationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js';
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidRequestError,
  InvalidScopeError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { createVault, hash, opaqueId } from './extensions/crypto.mjs';
import { audit, toUser } from './database.mjs';
import { HttpError, parse } from './validation.mjs';

export const MCP_SCOPES = ['workspace:read', 'workspace:drafts', 'workspace:research'];
const HOUR = 3600000;
const DAY = 24 * HOUR;
const rawToken = () => randomBytes(32).toString('base64url');
const parseJson = (value) => JSON.parse(value);
const supportedClientMethods = new Set(['none', 'client_secret_post']);

function trustedRedirect(value, allowedRedirects) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash || url.search) return false;
  if (allowedRedirects.includes(url.href)) return true;
  if (url.protocol !== 'https:' || url.port || url.hostname !== 'chatgpt.com') return false;
  return (
    url.pathname === '/connector_platform_oauth_redirect' ||
    /^\/connector\/oauth\/[A-Za-z0-9_-]{1,200}$/.test(url.pathname)
  );
}

export function createMcpAuthorization({ db, config, now, options = {} }) {
  const origin = config.publicOrigin;
  const resource = origin ? origin + '/api/mcp' : null;
  const metadataUrl = origin ? origin + '/.well-known/oauth-protected-resource/api/mcp' : null;
  const vault = createVault(options.encryptionKey ?? process.env.CREDENTIAL_ENCRYPTION_KEY);
  const ready = Boolean(origin && vault);
  const allowedRedirects = options.allowedRedirects ?? [];
  const stamp = () => now().getTime();
  const metadata = ready
    ? {
        issuer: origin,
        authorization_endpoint: origin + '/api/mcp/oauth/authorize',
        token_endpoint: origin + '/api/mcp/oauth/token',
        registration_endpoint: origin + '/api/mcp/oauth/register',
        revocation_endpoint: origin + '/api/mcp/oauth/revoke',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
        revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
        authorization_response_iss_parameter_supported: true,
        scopes_supported: MCP_SCOPES,
      }
    : null;
  const protectedMetadata = ready
    ? {
        resource,
        authorization_servers: [origin],
        scopes_supported: MCP_SCOPES,
        bearer_methods_supported: ['header'],
        resource_name: 'St. Mary’s Marketing Workspace',
      }
    : null;
  const requireReady = () => {
    if (!ready)
      throw new HttpError(
        503,
        'The MCP server needs the application origin and encryption key configured.',
        'mcp_unconfigured',
      );
  };
  const checkResource = (requested) => {
    if (!requested || requested.href !== resource)
      throw new InvalidRequestError('The resource must be this workspace MCP endpoint.');
  };
  const checkScopes = (values) => {
    const scopes = [...new Set(values?.length ? values : MCP_SCOPES)];
    if (!scopes.includes('workspace:read') || scopes.some((scope) => !MCP_SCOPES.includes(scope)))
      throw new InvalidScopeError(
        'Choose the supported workspace scopes, including workspace:read.',
      );
    return scopes;
  };
  async function rateLimit(key, maximum, period) {
    return db.transaction(async () => {
      if (db.kind === 'postgres')
        await db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('mcp-rate:' + key);
      const row = await db
        .prepare('SELECT * FROM mcp_rate_limits WHERE key=?' + db.lockSuffix)
        .get(key);
      const start = Math.floor(stamp() / period) * period;
      if (row && Number(row.window_start) === start && Number(row.count) >= maximum)
        throw new HttpError(
          429,
          'The workspace connection limit was reached. Try again later.',
          'mcp_rate_limit',
        );
      await db
        .prepare(
          'INSERT INTO mcp_rate_limits(key,window_start,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,count=?',
        )
        .run(key, start, row && Number(row.window_start) === start ? Number(row.count) + 1 : 1);
    });
  }
  async function grantFor(id, { lock = false } = {}) {
    const grant = await db
      .prepare('SELECT * FROM mcp_grants WHERE id=?' + (lock ? db.lockSuffix : ''))
      .get(id);
    if (!grant || grant.revoked_at != null || Number(grant.expires_at) <= stamp())
      throw new InvalidGrantError(
        'This authorization expired or was revoked. Reconnect the workspace.',
      );
    const user = await db
      .prepare("SELECT * FROM users WHERE id=? AND active=1 AND role='manager'")
      .get(grant.user_id);
    if (!user) throw new InvalidGrantError('This manager no longer has access.');
    return { grant, user: toUser(user) };
  }
  async function issueTokens(grant) {
    const access = rawToken(),
      refresh = rawToken();
    const accessExpires = Math.min(stamp() + HOUR, Number(grant.expires_at));
    await db
      .prepare("INSERT INTO mcp_tokens(token_hash,grant_id,kind,expires_at) VALUES(?,?,'access',?)")
      .run(hash(access), grant.id, accessExpires);
    await db
      .prepare(
        "INSERT INTO mcp_tokens(token_hash,grant_id,kind,expires_at) VALUES(?,?,'refresh',?)",
      )
      .run(hash(refresh), grant.id, Number(grant.expires_at));
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: Math.max(0, Math.floor((accessExpires - stamp()) / 1000)),
      scope: parseJson(grant.scopes).join(' '),
    };
  }
  const clientsStore = {
    async getClient(id) {
      if (typeof id !== 'string' || id.length > 200) return undefined;
      const row = await db.prepare('SELECT * FROM mcp_clients WHERE id=?').get(id);
      if (!row || Number(row.expires_at) <= stamp()) return undefined;
      const client = parseJson(row.metadata_json);
      if (row.encrypted_secret && vault)
        client.client_secret = vault.open(row.encrypted_secret, 'mcp-client:' + id).secret;
      return client;
    },
    async registerClient(input) {
      requireReady();
      const method = input.token_endpoint_auth_method ?? 'client_secret_post';
      if (!supportedClientMethods.has(method))
        throw new InvalidClientMetadataError('Use none with PKCE, or client_secret_post.');
      if (
        !input.redirect_uris?.length ||
        input.redirect_uris.length > 5 ||
        input.redirect_uris.some((uri) => !trustedRedirect(uri, allowedRedirects))
      )
        throw new InvalidClientMetadataError(
          'Only the documented ChatGPT callback is allowed for automatic registration.',
        );
      if (
        input.grant_types?.some(
          (grant) => !['authorization_code', 'refresh_token'].includes(grant),
        ) ||
        input.response_types?.some((type) => type !== 'code')
      )
        throw new InvalidClientMetadataError(
          'Only authorization-code and refresh-token flows are supported.',
        );
      const client = {
        client_id: input.client_id ?? opaqueId('mcpclient'),
        client_id_issued_at: Math.floor(stamp() / 1000),
        client_name: String(input.client_name || 'ChatGPT workspace connection').slice(0, 120),
        redirect_uris: [...new Set(input.redirect_uris)],
        token_endpoint_auth_method: method,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: MCP_SCOPES.join(' '),
      };
      let secret = null;
      if (method === 'client_secret_post') {
        client.client_secret = input.client_secret ?? rawToken();
        client.client_secret_expires_at = Math.floor((stamp() + 90 * DAY) / 1000);
        secret = vault.seal({ secret: client.client_secret }, 'mcp-client:' + client.client_id);
      }
      const publicClient = { ...client };
      delete publicClient.client_secret;
      await db.transaction(async () => {
        if (db.kind === 'postgres')
          await db
            .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
            .get('mcp-client-registration');
        // Unapproved anonymous registrations expire quickly. Keep authorized
        // grants/audit history, while reclaiming abandoned setup requests.
        await db.prepare('DELETE FROM mcp_authorization_requests WHERE expires_at<?').run(stamp());
        await db
          .prepare('DELETE FROM mcp_authorization_codes WHERE expires_at<?')
          .run(stamp() - DAY);
        await db.prepare('DELETE FROM mcp_tokens WHERE expires_at<?').run(stamp() - DAY);
        await db.prepare('DELETE FROM mcp_rate_limits WHERE window_start<?').run(stamp() - DAY);
        await db
          .prepare(
            'DELETE FROM mcp_clients WHERE expires_at<? AND NOT EXISTS (SELECT 1 FROM mcp_grants WHERE mcp_grants.client_id=mcp_clients.id)',
          )
          .run(stamp());
        const total = await db
          .prepare('SELECT COUNT(*) AS count FROM mcp_clients WHERE expires_at>?')
          .get(stamp());
        if (Number(total.count) >= 100)
          throw new InvalidClientMetadataError(
            'The workspace client limit is reached. Contact the owner.',
          );
        await db
          .prepare(
            'INSERT INTO mcp_clients(id,metadata_json,encrypted_secret,created_at,expires_at) VALUES(?,?,?,?,?)',
          )
          .run(
            client.client_id,
            JSON.stringify(publicClient),
            secret,
            stamp(),
            stamp() + 30 * 60000,
          );
      });
      return client;
    },
  };
  const provider = {
    clientsStore,
    async authorize(client, params, response) {
      requireReady();
      checkResource(params.resource);
      const scopes = checkScopes(params.scopes);
      if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge))
        throw new InvalidRequestError('A valid S256 PKCE challenge is required.');
      if ((params.state?.length ?? 0) > 2048)
        throw new InvalidRequestError('The authorization state is too long.');
      const request = rawToken();
      await db.transaction(async () => {
        if (db.kind === 'postgres')
          await db
            .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
            .get('mcp-pending-authorization');
        const total = await db
          .prepare(
            'SELECT COUNT(*) AS count FROM mcp_authorization_requests WHERE expires_at>? AND consumed_at IS NULL',
          )
          .get(stamp());
        if (Number(total.count) >= 100)
          throw new InvalidRequestError('Too many pending connections. Try again in ten minutes.');
        await db
          .prepare(
            'INSERT INTO mcp_authorization_requests(request_hash,client_id,redirect_uri,state,code_challenge,scopes,resource,expires_at) VALUES(?,?,?,?,?,?,?,?)',
          )
          .run(
            hash(request),
            client.client_id,
            params.redirectUri,
            params.state ?? '',
            params.codeChallenge,
            JSON.stringify(scopes),
            resource,
            stamp() + 10 * 60000,
          );
      });
      response.redirect(
        302,
        origin + '/#settings?tab=mcp&authorize=' + encodeURIComponent(request),
      );
    },
    async challengeForAuthorizationCode(client, code) {
      if (typeof code !== 'string' || code.length > 200)
        throw new InvalidGrantError('Invalid authorization code.');
      const row = await db
        .prepare(
          'SELECT c.*,g.client_id FROM mcp_authorization_codes c JOIN mcp_grants g ON g.id=c.grant_id WHERE c.code_hash=?',
        )
        .get(hash(code));
      if (
        !row ||
        row.client_id !== client.client_id ||
        row.consumed_at != null ||
        Number(row.expires_at) <= stamp()
      )
        throw new InvalidGrantError('This authorization code expired or was already used.');
      return row.code_challenge;
    },
    async exchangeAuthorizationCode(client, code, _verifier, redirectUri, requested) {
      checkResource(requested);
      return db.transaction(async () => {
        const row = await db
          .prepare('SELECT * FROM mcp_authorization_codes WHERE code_hash=?' + db.lockSuffix)
          .get(hash(code));
        if (
          !row ||
          row.consumed_at != null ||
          Number(row.expires_at) <= stamp() ||
          row.redirect_uri !== redirectUri
        )
          throw new InvalidGrantError('Invalid, expired or already used authorization code.');
        const { grant } = await grantFor(row.grant_id, { lock: true });
        if (grant.client_id !== client.client_id || grant.resource !== resource)
          throw new InvalidGrantError('The authorization does not belong to this client.');
        await db
          .prepare('UPDATE mcp_authorization_codes SET consumed_at=? WHERE code_hash=?')
          .run(stamp(), hash(code));
        return issueTokens(grant);
      });
    },
    async exchangeRefreshToken(client, token, requestedScopes, requested) {
      checkResource(requested);
      // A consumed refresh token revokes its family; keep that revocation even
      // when returning an invalid-grant error to a replaying client.
      const result = await db.transaction(async () => {
        const row = await db
          .prepare("SELECT * FROM mcp_tokens WHERE token_hash=? AND kind='refresh'" + db.lockSuffix)
          .get(hash(token));
        if (!row || Number(row.expires_at) <= stamp()) return null;
        const { grant } = await grantFor(row.grant_id, { lock: true });
        if (grant.client_id !== client.client_id || grant.resource !== resource) return null;
        if (row.consumed_at != null) {
          await db.prepare('UPDATE mcp_grants SET revoked_at=? WHERE id=?').run(stamp(), grant.id);
          return null;
        }
        const granted = parseJson(grant.scopes);
        if (requestedScopes?.some((scope) => !granted.includes(scope)))
          throw new InvalidScopeError('Reconnect to grant additional scopes.');
        // This profile does not silently narrow a long-lived authorization.
        if (
          requestedScopes?.length &&
          (requestedScopes.length !== granted.length ||
            granted.some((scope) => !requestedScopes.includes(scope)))
        )
          throw new InvalidScopeError(
            'Refresh with the original scopes or reconnect for a different permission set.',
          );
        await db
          .prepare('UPDATE mcp_tokens SET consumed_at=? WHERE token_hash=?')
          .run(stamp(), hash(token));
        return issueTokens(grant);
      });
      if (!result)
        throw new InvalidGrantError('The refresh token expired or was replayed. Reconnect.');
      return result;
    },
    async verifyAccessToken(token) {
      if (!ready || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))
        throw new InvalidTokenError('A valid workspace access token is required.');
      const row = await db
        .prepare("SELECT * FROM mcp_tokens WHERE token_hash=? AND kind='access'")
        .get(hash(token));
      if (!row || Number(row.expires_at) <= stamp() || row.consumed_at != null)
        throw new InvalidTokenError('The access token expired.');
      let current;
      try {
        current = await grantFor(row.grant_id);
      } catch {
        throw new InvalidTokenError('The workspace authorization is no longer active.');
      }
      const { grant, user } = current;
      if (grant.resource !== resource)
        throw new InvalidTokenError('This token belongs to a different resource.');
      if (grant.last_used_at == null || Number(grant.last_used_at) < stamp() - HOUR)
        await db.prepare('UPDATE mcp_grants SET last_used_at=? WHERE id=?').run(stamp(), grant.id);
      return {
        token,
        clientId: grant.client_id,
        scopes: parseJson(grant.scopes),
        expiresAt: Number(row.expires_at) / 1000,
        resource: new URL(resource),
        extra: { user, grantId: grant.id },
      };
    },
    async revokeToken(client, input) {
      const row = await db
        .prepare(
          'SELECT g.* FROM mcp_tokens t JOIN mcp_grants g ON g.id=t.grant_id WHERE t.token_hash=? AND g.client_id=?',
        )
        .get(hash(input.token), client.client_id);
      if (row)
        await db.prepare('UPDATE mcp_grants SET revoked_at=? WHERE id=?').run(stamp(), row.id);
    },
  };
  async function pendingRequest(id, auth, bind = false) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(id))
      throw new HttpError(404, 'This connection request was not found.', 'not_found');
    const row = await db
      .prepare('SELECT * FROM mcp_authorization_requests WHERE request_hash=?' + db.lockSuffix)
      .get(hash(id));
    if (!row || row.consumed_at != null || Number(row.expires_at) <= stamp())
      throw new HttpError(
        410,
        'This connection request expired. Start connecting again from ChatGPT.',
        'request_expired',
      );
    if (row.user_id && (row.user_id !== auth.user.id || row.session_hash !== auth.tokenHash))
      throw new HttpError(
        403,
        'Continue this connection in the browser session where it was opened.',
        'session_mismatch',
      );
    if (bind && !row.user_id) {
      await db
        .prepare(
          'UPDATE mcp_authorization_requests SET user_id=?,session_hash=? WHERE request_hash=?',
        )
        .run(auth.user.id, auth.tokenHash, hash(id));
      row.user_id = auth.user.id;
      row.session_hash = auth.tokenHash;
    }
    return row;
  }
  function install(app, { requireAuth, requireManager }) {
    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/api/mcp',
    ])
      app.get(path, (_req, res) => {
        requireReady();
        res.set('Access-Control-Allow-Origin', '*').json(protectedMetadata);
      });
    app.get('/.well-known/oauth-authorization-server', (_req, res) => {
      requireReady();
      res.set('Access-Control-Allow-Origin', '*').json(metadata);
    });
    app.use('/api/mcp/oauth', async (req, res, next) => {
      requireReady();
      res.set('Cache-Control', 'no-store');
      if (req.method !== 'OPTIONS')
        await rateLimit(
          'oauth:' + hash(req.ip || 'unknown') + ':' + req.path,
          req.path === '/register' ? 20 : 100,
          req.path === '/register' ? HOUR : 15 * 60000,
        );
      next();
    });
    app.use(
      '/api/mcp/oauth/authorize',
      (req, res, next) => {
        // SDK redirects only after validating a registered redirect. Add issuer
        // identification on both success/error callbacks for RFC 9207 clients.
        const redirect = res.redirect.bind(res);
        res.redirect = (status, location) => {
          const target = typeof status === 'string' ? status : location;
          const code = typeof status === 'number' ? status : 302;
          const parsed = new URL(target, origin);
          if (parsed.origin !== origin) parsed.searchParams.set('iss', origin);
          return redirect(code, parsed.href);
        };
        next();
      },
      authorizationHandler({ provider, rateLimit: false }),
    );
    app.use('/api/mcp/oauth/token', tokenHandler({ provider, rateLimit: false }));
    app.use(
      '/api/mcp/oauth/register',
      clientRegistrationHandler({ clientsStore, rateLimit: false }),
    );
    app.use('/api/mcp/oauth/revoke', revocationHandler({ provider, rateLimit: false }));
    app.get('/api/mcp/settings', requireAuth, requireManager, async (req, res) => {
      const rows = await db
        .prepare(
          'SELECT g.*,c.metadata_json FROM mcp_grants g JOIN mcp_clients c ON c.id=g.client_id WHERE g.user_id=? ORDER BY g.created_at DESC LIMIT 30',
        )
        .all(req.auth.user.id);
      res.json({
        ready,
        endpoint: resource,
        scopes: MCP_SCOPES,
        additionalApiSpendUsd: 0,
        grants: rows.map((row) => ({
          id: row.id,
          clientName: parseJson(row.metadata_json).client_name,
          scopes: parseJson(row.scopes),
          createdAt: new Date(Number(row.created_at)).toISOString(),
          expiresAt: new Date(Number(row.expires_at)).toISOString(),
          lastUsedAt: row.last_used_at ? new Date(Number(row.last_used_at)).toISOString() : null,
          revoked: row.revoked_at != null,
        })),
      });
    });
    app.get('/api/mcp/consent/:id', requireAuth, requireManager, async (req, res) => {
      const result = await db.transaction(async () => {
        const row = await pendingRequest(req.params.id, req.auth, true);
        const client = await clientsStore.getClient(row.client_id);
        if (!client)
          throw new HttpError(410, 'This client registration expired.', 'request_expired');
        return {
          clientName: client.client_name,
          redirectOrigin: new URL(row.redirect_uri).origin,
          scopes: parseJson(row.scopes),
          expiresAt: new Date(Number(row.expires_at)).toISOString(),
        };
      });
      res.json(result);
    });
    app.post('/api/mcp/consent/:id', requireAuth, requireManager, async (req, res) => {
      const input = parse(
        z.object({ allow: z.boolean(), scopes: z.array(z.enum(MCP_SCOPES)).max(3) }).strict(),
        req.body,
      );
      const redirectUrl = await db.transaction(async () => {
        const row = await pendingRequest(req.params.id, req.auth, false);
        if (row.user_id !== req.auth.user.id || row.session_hash !== req.auth.tokenHash)
          throw new HttpError(403, 'Open the consent screen before approving.', 'session_mismatch');
        const requested = parseJson(row.scopes);
        if (
          input.allow &&
          (!input.scopes.includes('workspace:read') ||
            input.scopes.some((scope) => !requested.includes(scope)))
        )
          throw new HttpError(
            400,
            'Choose only the requested permissions, including reading.',
            'invalid_scope',
          );
        const target = new URL(row.redirect_uri);
        target.searchParams.set('iss', origin);
        if (row.state) target.searchParams.set('state', row.state);
        await db
          .prepare('UPDATE mcp_authorization_requests SET consumed_at=? WHERE request_hash=?')
          .run(stamp(), hash(req.params.id));
        if (!input.allow) {
          target.searchParams.set('error', 'access_denied');
          target.searchParams.set('error_description', 'The manager declined this connection.');
          return target.href;
        }
        const grantId = opaqueId('mcpgrant');
        const code = rawToken();
        await db
          .prepare('UPDATE mcp_clients SET expires_at=created_at+? WHERE id=?')
          .run(90 * DAY, row.client_id);
        await db
          .prepare(
            'INSERT INTO mcp_grants(id,client_id,user_id,scopes,resource,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',
          )
          .run(
            grantId,
            row.client_id,
            req.auth.user.id,
            JSON.stringify([...new Set(input.scopes)]),
            resource,
            stamp(),
            stamp() + 30 * DAY,
          );
        await db
          .prepare(
            'INSERT INTO mcp_authorization_codes(code_hash,grant_id,code_challenge,redirect_uri,expires_at) VALUES(?,?,?,?,?)',
          )
          .run(hash(code), grantId, row.code_challenge, row.redirect_uri, stamp() + 2 * 60000);
        await audit(
          db,
          req.auth.user,
          'MCP connection authorized',
          grantId,
          'Granted ' +
            input.scopes.join(', ') +
            '. Publishing and approval are not exposed to MCP.',
          now().toISOString(),
        );
        target.searchParams.set('code', code);
        return target.href;
      });
      res.json({ redirectUrl });
    });
    app.post('/api/mcp/grants/:id/revoke', requireAuth, requireManager, async (req, res) => {
      parse(z.object({}).strict(), req.body ?? {});
      const found = await db
        .prepare('SELECT id FROM mcp_grants WHERE id=? AND user_id=?')
        .get(req.params.id, req.auth.user.id);
      if (!found) throw new HttpError(404, 'This connection was not found.', 'not_found');
      await db.transaction(async () => {
        await db.prepare('UPDATE mcp_grants SET revoked_at=? WHERE id=?').run(stamp(), found.id);
        await audit(
          db,
          req.auth.user,
          'MCP connection revoked',
          found.id,
          'All access and refresh tokens for this connection are invalid.',
          now().toISOString(),
        );
      });
      res.json({ revoked: true });
    });
  }
  return { ready, resource, metadataUrl, provider, install, rateLimit };
}
