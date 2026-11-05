import { createHash, createHmac } from 'node:crypto';

import { PROVIDERS, providerGroup } from './provider-definitions.mjs';
import { createAdditionalProviders } from './additional-providers.mjs';
export { PROVIDERS } from './provider-definitions.mjs';

export class ProviderError extends Error {
  constructor(message, code = 'provider_error', options = {}) {
    super(message);
    this.code = code;
    this.httpStatus = options.httpStatus ?? 502;
    this.ambiguous = options.ambiguous ?? false;
    this.reauthenticate = options.reauthenticate ?? false;
  }
}

const token = (value) => {
  if (typeof value !== 'string' || !value || value.length > 16384)
    throw new ProviderError(
      'The provider did not return a usable access token.',
      'invalid_token_response',
    );
  return value;
};
const numericId = (value) => {
  if (!/^\d{1,40}$/.test(String(value)))
    throw new ProviderError(
      'The provider returned an invalid account identifier.',
      'invalid_account',
    );
  return String(value);
};

export function createProviderClient({
  fetch: fetchImpl = globalThis.fetch,
  now = () => new Date(),
  metaVersion = 'v25.0',
  timeoutMs = 20000,
  googleAdsVersion = 'v26',
  linkedinVersion = '202610',
} = {}) {
  if (!/^v\d{2}\.\d$/.test(metaVersion))
    throw new Error('META_API_VERSION must be a version such as v25.0.');
  const graph = `https://graph.facebook.com/${metaVersion}`;
  async function request(url, options = {}) {
    const { responseKind, timeout: requestTimeout, ...fetchOptions } = options;
    let response;
    try {
      response = await fetchImpl(url, {
        ...fetchOptions,
        redirect: 'error',
        signal: AbortSignal.timeout(requestTimeout ?? timeoutMs),
      });
    } catch {
      throw new ProviderError(
        'The provider could not be reached. Check the connection and try again.',
        'provider_unreachable',
        { ambiguous: true },
      );
    }
    let data;
    try {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 2 * 1024 * 1024) throw new Error();
      const text = Buffer.from(buffer).toString('utf8');
      data = text ? (response.ok && responseKind === 'empty' ? {} : JSON.parse(text)) : {};
      if (!text && responseKind !== 'empty' && response.status !== 204) throw new Error();
    } catch {
      throw new ProviderError(
        'The provider returned an unreadable response.',
        'invalid_provider_response',
        { ambiguous: response.ok || response.status >= 500 },
      );
    }
    if (!response.ok || data.error) {
      const code = data.error?.code;
      const reauthenticate =
        response.status === 401 || code === 190 || data.error === 'invalid_grant';
      const missingPermission = response.status === 403 || [10, 200].includes(code);
      const limited = response.status === 429 || [4, 17, 32, 613].includes(code);
      const cloudAccessRequired = JSON.stringify(data.error?.details ?? []).includes(
        'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION',
      );
      const message = cloudAccessRequired
        ? 'The Google Cloud project is not approved for production Ads accounts. Apply for the appropriate access level in Google Cloud Console.'
        : reauthenticate
          ? 'Authorization expired or was revoked. Reconnect this account.'
          : missingPermission
            ? 'The provider denied permission. Check account access, enabled APIs and app review.'
            : limited
              ? 'The provider rate limit was reached. Wait before retrying.'
              : 'The provider rejected the request. Check the account setup and supported media requirements.';
      throw new ProviderError(
        message,
        reauthenticate
          ? 'reauthorization_required'
          : missingPermission
            ? 'permission_denied'
            : limited
              ? 'provider_rate_limited'
              : 'provider_rejected',
        { httpStatus: response.status, ambiguous: response.status >= 500, reauthenticate },
      );
    }
    return { data, headers: response.headers, status: response.status };
  }
  const json = async (url, options) => (await request(url, options)).data;
  const bearer = (accessToken) => ({ Authorization: `Bearer ${token(accessToken)}` });
  const googleForm = (body) =>
    json('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
  const expiry = (seconds) =>
    seconds !== undefined && seconds !== null && Number.isFinite(Number(seconds))
      ? now().getTime() + Number(seconds) * 1000
      : null;
  function metaUrl(path, accessToken, secret, query = {}) {
    const url = new URL(`${graph}/${path}`);
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) url.searchParams.set(key, String(value));
    if (secret && accessToken)
      url.searchParams.set(
        'appsecret_proof',
        createHmac('sha256', secret).update(accessToken).digest('hex'),
      );
    return url;
  }
  const client = {
    authorize(provider, credentials, redirectUri, state, verifier) {
      if (providerGroup(provider) === 'google') {
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.search = new URLSearchParams({
          client_id: credentials.clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: PROVIDERS[provider].scopes.join(' '),
          include_granted_scopes: 'true',
          state,
          access_type: 'offline',
          prompt: 'consent',
          code_challenge_method: 'S256',
          code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        }).toString();
        return url.toString();
      }
      const url = new URL(`https://www.facebook.com/${metaVersion}/dialog/oauth`);
      url.search = new URLSearchParams({
        client_id: credentials.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: PROVIDERS[provider].scopes.join(','),
        state,
        auth_type: 'rerequest',
      }).toString();
      return url.toString();
    },
    async exchange(provider, credentials, redirectUri, code, verifier) {
      if (providerGroup(provider) === 'google') {
        const data = await googleForm({
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          redirect_uri: redirectUri,
          code,
          code_verifier: verifier,
          grant_type: 'authorization_code',
        });
        if (
          data.scope &&
          !PROVIDERS[provider].scopes.every((scope) => data.scope.split(' ').includes(scope))
        )
          throw new ProviderError(
            'A required permission was not granted. Reconnect and allow the permissions listed for this service.',
            'permission_denied',
          );
        return {
          accessToken: token(data.access_token),
          refreshToken: data.refresh_token ? token(data.refresh_token) : null,
          expiresAt: expiry(data.expires_in),
          scopes: data.scope ? data.scope.split(' ') : PROVIDERS[provider].scopes,
        };
      }
      const url = new URL(`${graph}/oauth/access_token`);
      url.search = new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        redirect_uri: redirectUri,
        code,
      }).toString();
      const initial = await json(url);
      const longLivedUrl = new URL(`${graph}/oauth/access_token`);
      longLivedUrl.search = new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        fb_exchange_token: token(initial.access_token),
      }).toString();
      const extended = await json(longLivedUrl);
      const accessToken = token(extended.access_token);
      const permissionData = await json(
        metaUrl('me/permissions', accessToken, credentials.clientSecret),
        { headers: bearer(accessToken) },
      );
      const granted = (permissionData.data ?? [])
        .filter((item) => item.status === 'granted')
        .map((item) => item.permission);
      if (!PROVIDERS[provider].scopes.every((scope) => granted.includes(scope)))
        throw new ProviderError(
          'Required permissions were declined. Reconnect and allow the listed permissions.',
          'permission_denied',
        );
      return { accessToken, expiresAt: expiry(extended.expires_in), scopes: granted };
    },
    async refresh(credentials, current) {
      if (!current.refreshToken)
        throw new ProviderError(
          'Google did not issue offline access. Reconnect this account.',
          'reauthorization_required',
          { reauthenticate: true },
        );
      const data = await googleForm({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: token(current.refreshToken),
        grant_type: 'refresh_token',
      });
      return {
        ...current,
        accessToken: token(data.access_token),
        refreshToken: data.refresh_token ? token(data.refresh_token) : current.refreshToken,
        expiresAt: expiry(data.expires_in),
      };
    },
    async discover(provider, current, credentials) {
      const accounts = [];
      let pageToken;
      for (let page = 0; page < 20; page += 1) {
        if (provider === 'google') {
          const url = new URL('https://analyticsadmin.googleapis.com/v1beta/accountSummaries');
          url.searchParams.set('pageSize', '200');
          if (pageToken) url.searchParams.set('pageToken', pageToken);
          const data = await json(url, { headers: bearer(current.accessToken) });
          for (const account of data.accountSummaries ?? [])
            for (const property of account.propertySummaries ?? []) {
              if (!/^properties\/\d+$/.test(property.property ?? '')) continue;
              accounts.push({
                id: property.property,
                name: String(property.displayName ?? property.property),
                kind: 'ga4',
              });
            }
          pageToken = data.nextPageToken;
        } else {
          const url = metaUrl('me/accounts', current.accessToken, credentials.clientSecret, {
            fields: 'id,name,access_token,instagram_business_account{id,username}',
            limit: 100,
            after: pageToken,
          });
          const data = await json(url, { headers: bearer(current.accessToken) });
          for (const page of data.data ?? [])
            if (page.instagram_business_account?.id && page.access_token) {
              accounts.push({
                id: numericId(page.instagram_business_account.id),
                name: page.instagram_business_account.username
                  ? `@${page.instagram_business_account.username}`
                  : String(page.name),
                kind: 'instagram',
                platform: 'instagram',
                pageId: numericId(page.id),
                pageAccessToken: token(page.access_token),
              });
            }
          // Do not follow a provider-controlled paging URL carrying credentials.
          pageToken = data.paging?.next ? data.paging?.cursors?.after : null;
        }
        if (!pageToken) return accounts;
      }
      throw new ProviderError(
        'This account has too many resources to list safely. Use a Google/Meta identity with access limited to the school accounts.',
        'discovery_limit',
      );
    },
    async test(provider, accountId, current, credentials) {
      if (provider === 'google') {
        if (!/^properties\/\d+$/.test(accountId))
          throw new ProviderError('Select a GA4 property first.', 'account_required');
        await json(`https://analyticsadmin.googleapis.com/v1beta/${accountId}`, {
          headers: bearer(current.accessToken),
        });
      } else {
        await json(
          metaUrl(numericId(accountId), current.pageAccessToken, credentials.clientSecret, {
            fields: 'id,username',
          }),
          { headers: bearer(current.pageAccessToken) },
        );
      }
      return true;
    },
    async report(accountId, current, startDate, endDate) {
      if (!/^properties\/\d+$/.test(accountId))
        throw new ProviderError('Select a GA4 property first.', 'account_required');
      async function run(dimensions, metrics, limit = '100', orderBys) {
        return json(`https://analyticsdata.googleapis.com/v1beta/${accountId}:runReport`, {
          method: 'POST',
          headers: { ...bearer(current.accessToken), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dateRanges: [{ startDate, endDate }],
            dimensions: dimensions.map((name) => ({ name })),
            metrics: metrics.map((name) => ({ name })),
            limit,
            ...(orderBys ? { orderBys } : {}),
          }),
        });
      }
      const four = ['totalUsers', 'sessions', 'screenPageViews', 'keyEvents'];
      const results = await Promise.allSettled([
        run([], four, '1'),
        run(['date'], four, '100', [{ dimension: { dimensionName: 'date' } }]),
        run(['pagePath'], ['sessions', 'screenPageViews', 'keyEvents'], '20', [
          { metric: { metricName: 'screenPageViews' }, desc: true },
        ]),
        run(['sessionSourceMedium'], ['sessions', 'keyEvents'], '20', [
          { metric: { metricName: 'sessions' }, desc: true },
        ]),
      ]);
      for (const result of results) if (result.status === 'rejected') throw result.reason;
      const [totals, daily, pages, sources] = results.map((result) => result.value);
      const number = (row, index) => {
        const value = Number(row?.metricValues?.[index]?.value ?? 0);
        if (!Number.isFinite(value) || value < 0)
          throw new ProviderError('Analytics returned an invalid metric.', 'invalid_metric');
        return value;
      };
      return {
        totals: {
          users: number(totals.rows?.[0], 0),
          sessions: number(totals.rows?.[0], 1),
          views: number(totals.rows?.[0], 2),
          keyEvents: number(totals.rows?.[0], 3),
        },
        daily: (daily.rows ?? []).map((row) => ({
          date: String(row.dimensionValues?.[0]?.value ?? '').replace(
            /^(\d{4})(\d{2})(\d{2})$/,
            '$1-$2-$3',
          ),
          users: number(row, 0),
          sessions: number(row, 1),
          views: number(row, 2),
          keyEvents: number(row, 3),
        })),
        pages: (pages.rows ?? []).map((row) => ({
          path: String(row.dimensionValues?.[0]?.value ?? ''),
          sessions: number(row, 0),
          views: number(row, 1),
          keyEvents: number(row, 2),
        })),
        sources: (sources.rows ?? []).map((row) => ({
          source: String(row.dimensionValues?.[0]?.value ?? ''),
          sessions: number(row, 0),
          keyEvents: number(row, 1),
        })),
      };
    },
    async createContainer(accountId, current, credentials, caption, imageUrl, options = {}) {
      const data = await json(
        metaUrl(`${numericId(accountId)}/media`, current.pageAccessToken, credentials.clientSecret),
        {
          method: 'POST',
          headers: {
            ...bearer(current.pageAccessToken),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            ...(imageUrl ? { image_url: imageUrl } : {}),
            ...(caption ? { caption } : {}),
            ...options,
          }).toString(),
        },
      );
      return numericId(data.id);
    },
    async containerStatus(containerId, current, credentials) {
      const data = await json(
        metaUrl(numericId(containerId), current.pageAccessToken, credentials.clientSecret, {
          fields: 'status_code',
        }),
        { headers: bearer(current.pageAccessToken) },
      );
      return data.status_code;
    },
    async publish(accountId, containerId, current, credentials) {
      const data = await json(
        metaUrl(
          `${numericId(accountId)}/media_publish`,
          current.pageAccessToken,
          credentials.clientSecret,
        ),
        {
          method: 'POST',
          headers: {
            ...bearer(current.pageAccessToken),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ creation_id: numericId(containerId) }).toString(),
        },
      );
      if (!/^\d{1,40}$/.test(String(data.id ?? '')))
        throw new ProviderError(
          'The provider did not confirm a publication identifier. Reconcile before trying again.',
          'publication_unconfirmed',
          { ambiguous: true },
        );
      return String(data.id);
    },
    async media(accountId, mediaId, current, credentials) {
      // Membership is verified from the connected account's media edge, rather
      // than accepting an arbitrary ID a manager pastes into reconciliation.
      let after;
      for (let page = 0; page < 5; page += 1) {
        const data = await json(
          metaUrl(
            `${numericId(accountId)}/media`,
            current.pageAccessToken,
            credentials.clientSecret,
            { fields: 'id,permalink,caption,timestamp', limit: 100, after },
          ),
          { headers: bearer(current.pageAccessToken) },
        );
        const media = (data.data ?? []).find((item) => String(item.id) === numericId(mediaId));
        if (media) return media;
        after = data.paging?.next ? data.paging?.cursors?.after : null;
        if (!after) break;
      }
      throw new ProviderError(
        'That publication was not found on the selected Instagram account.',
        'publication_not_found',
      );
    },
  };
  return createAdditionalProviders({
    base: client,
    json,
    request,
    bearer,
    googleForm,
    expiry,
    metaUrl,
    token,
    numericId,
    ProviderError,
    now,
    fetch: fetchImpl,
    timeoutMs,
    googleAdsVersion,
    linkedinVersion,
  });
}
