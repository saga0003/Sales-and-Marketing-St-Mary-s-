import { PROVIDERS, providerGroup } from './provider-definitions.mjs';

const column = (key, label, type = 'number') => ({ key, label, type });
const metric = (key, label, value, unit = 'count') => ({ key, label, value, unit });
const dayAfter = (value) =>
  new Date(Date.parse(`${value}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const dateParts = (value) => value.split('-').map(Number);
const safeText = (value, limit = 4000) => String(value ?? '').slice(0, limit);

export function createAdditionalProviders(context) {
  const { base, json, request, bearer, expiry, metaUrl, token, numericId, ProviderError, now } =
    context;
  const { googleAdsVersion, linkedinVersion } = context;
  if (!/^v\d{2}$/.test(googleAdsVersion))
    throw new Error('GOOGLE_ADS_API_VERSION must be a version such as v26.');
  if (!/^20\d{2}(0[1-9]|1[0-2])$/.test(linkedinVersion))
    throw new Error('LINKEDIN_API_VERSION must be YYYYMM.');
  const adsRoot = `https://googleads.googleapis.com/${googleAdsVersion}`;
  const liRoot = 'https://api.linkedin.com/rest';
  const liHeaders = (current) => ({
    ...bearer(current.accessToken),
    'Linkedin-Version': linkedinVersion,
    'X-Restli-Protocol-Version': '2.0.0',
  });
  const fail = (message, code = 'invalid_account') => {
    throw new ProviderError(message, code);
  };
  const number = (value, fallback = 0) => {
    if (value === null || value === undefined || value === '') return fallback;
    const result = Number(value);
    if (!Number.isFinite(result))
      fail('The provider returned an invalid metric.', 'invalid_metric');
    return result;
  };
  const googleAccount = (id, prefix) => {
    if (!new RegExp(`^${prefix}/[0-9]+$`).test(id))
      fail('Choose a valid account returned by the authorization.');
    return id;
  };
  const channelId = (id) => {
    if (!/^UC[A-Za-z0-9_-]{22}$/.test(id))
      fail('Select a YouTube channel returned by this authorization.');
    return id;
  };
  const liOwner = (id, member = false) => {
    if (!(member ? /^urn:li:person:[A-Za-z0-9_-]+$/ : /^urn:li:organization:\d+$/).test(id))
      fail('Select the LinkedIn profile or Page returned by this authorization.');
    return id;
  };
  const limitError = () =>
    fail(
      'This identity has too many resources to list in one request. Limit its access to the intended school accounts.',
      'discovery_limit',
    );
  const adsHeaders = (current, credentials, managerId = credentials.loginCustomerId) => ({
    ...bearer(current.accessToken),
    'Content-Type': 'application/json',
    ...(credentials.developerToken ? { 'developer-token': credentials.developerToken } : {}),
    ...(managerId ? { 'login-customer-id': numericId(managerId) } : {}),
  });
  async function adsSearch(customerId, query, current, credentials, managerId) {
    const id = numericId(customerId.replace(/^customers\//, ''));
    const rows = [];
    let pageToken;
    for (let page = 0; page < 10; page += 1) {
      const data = await json(`${adsRoot}/customers/${id}/googleAds:search`, {
        method: 'POST',
        headers: adsHeaders(current, credentials, managerId),
        body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
      });
      rows.push(...(data.results ?? []));
      if (rows.length > 5000)
        fail(
          'This report exceeds the 5,000-row import limit. Select a shorter date range.',
          'report_limit',
        );
      pageToken = data.nextPageToken;
      if (!pageToken) return rows;
    }
    fail(
      'The provider report exceeded the import page limit. Select a shorter date range.',
      'report_limit',
    );
  }
  async function metaPages(current, credentials, query = {}) {
    const rows = [];
    let after;
    for (let page = 0; page < 20; page += 1) {
      const data = await json(
        metaUrl('me/accounts', current.accessToken, credentials.clientSecret, {
          fields: 'id,name,access_token,tasks',
          limit: 100,
          ...query,
          after,
        }),
        { headers: bearer(current.accessToken) },
      );
      rows.push(...(data.data ?? []));
      after = data.paging?.next ? data.paging?.cursors?.after : null;
      if (!after) return rows;
    }
    return limitError();
  }
  async function discover(service, current, credentials) {
    if (service === 'google' || service === 'instagram')
      return base.discover(service, current, credentials);
    if (service === 'search_console') {
      const data = await json('https://www.googleapis.com/webmasters/v3/sites', {
        headers: bearer(current.accessToken),
      });
      return (data.siteEntry ?? [])
        .filter((entry) => entry.permissionLevel !== 'siteUnverifiedUser')
        .map((entry) => ({
          id: safeText(entry.siteUrl, 2048),
          name: safeText(entry.siteUrl, 2048),
          kind: service,
          capabilities: ['analytics:read'],
        }));
    }
    if (service === 'youtube') {
      const url = new URL('https://www.googleapis.com/youtube/v3/channels');
      url.search = new URLSearchParams({
        part: 'snippet,contentDetails',
        mine: 'true',
        maxResults: '50',
      }).toString();
      const data = await json(url, { headers: bearer(current.accessToken) });
      if (data.nextPageToken) return limitError();
      return (data.items ?? []).map((entry) => ({
        id: channelId(entry.id),
        name: safeText(entry.snippet?.title || entry.id),
        kind: service,
        platform: 'youtube',
        capabilities: PROVIDERS.youtube.capabilities,
      }));
    }
    if (service === 'google_business') {
      const accounts = [];
      let pageToken;
      let requests = 0;
      for (let page = 0; page < 5; page += 1) {
        const url = new URL('https://mybusinessaccountmanagement.googleapis.com/v1/accounts');
        url.searchParams.set('pageSize', '20');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const data = await json(url, { headers: bearer(current.accessToken) });
        for (const account of data.accounts ?? []) {
          googleAccount(account.name, 'accounts');
          let locationToken;
          for (let locationPage = 0; locationPage < 10; locationPage += 1) {
            if (++requests > 30) return limitError();
            const locationUrl = new URL(
              `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations`,
            );
            locationUrl.search = new URLSearchParams({
              readMask: 'name,title,metadata',
              pageSize: '100',
              ...(locationToken ? { pageToken: locationToken } : {}),
            }).toString();
            const result = await json(locationUrl, { headers: bearer(current.accessToken) });
            for (const location of result.locations ?? []) {
              const id = googleAccount(location.name, 'locations');
              if (accounts.some((entry) => entry.id === id)) continue;
              // canOperateLocalPost is deprecated and no longer populated. A location
              // with Voice of Merchant may queue a post; the create API still
              // enforces the location/category's publishing eligibility.
              const canPost =
                location.metadata?.hasVoiceOfMerchant === true ||
                location.metadata?.canOperateLocalPost === true;
              accounts.push({
                id,
                name: safeText(location.title || id),
                kind: service,
                platform: service,
                capabilities: canPost
                  ? PROVIDERS.google_business.capabilities
                  : ['analytics:read', 'account:read'],
                credentials: { businessAccountName: account.name, hasVoiceOfMerchant: canPost },
              });
            }
            locationToken = result.nextPageToken;
            if (!locationToken) break;
            if (locationPage === 9) return limitError();
          }
        }
        pageToken = data.nextPageToken;
        if (!pageToken) return accounts;
      }
      return limitError();
    }
    if (service === 'google_ads') {
      const data = await json(`${adsRoot}/customers:listAccessibleCustomers`, {
        headers: adsHeaders(current, credentials),
      });
      const roots = (data.resourceNames ?? []).slice(0, 25);
      if ((data.resourceNames ?? []).length > 25) return limitError();
      if (
        credentials.loginCustomerId &&
        !roots.includes(`customers/${credentials.loginCustomerId}`)
      )
        roots.unshift(`customers/${credentials.loginCustomerId}`);
      const accounts = new Map();
      for (const resourceName of roots) {
        const id = googleAccount(resourceName, 'customers').split('/')[1];
        const rows = await adsSearch(
          id,
          'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1',
          current,
          credentials,
        );
        const customer = rows[0]?.customer;
        if (!customer) continue;
        if (!customer.manager) {
          accounts.set(String(customer.id), {
            id: String(customer.id),
            name: safeText(customer.descriptiveName || `Google Ads ${customer.id}`),
            kind: service,
            timezone: customer.timeZone,
            capabilities: ['analytics:read'],
            credentials: {
              currency: customer.currencyCode,
              timezone: customer.timeZone,
              loginCustomerId: credentials.loginCustomerId || null,
            },
          });
        } else {
          const children = await adsSearch(
            id,
            'SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager FROM customer_client WHERE customer_client.manager = FALSE LIMIT 1000',
            current,
            credentials,
            credentials.loginCustomerId || id,
          );
          for (const row of children) {
            const child = row.customerClient;
            if (!child?.id) continue;
            accounts.set(String(child.id), {
              id: String(child.id),
              name: safeText(child.descriptiveName || `Google Ads ${child.id}`),
              kind: service,
              timezone: child.timeZone,
              capabilities: ['analytics:read'],
              credentials: {
                currency: child.currencyCode,
                timezone: child.timeZone,
                loginCustomerId: credentials.loginCustomerId || id,
              },
            });
          }
        }
      }
      return [...accounts.values()];
    }
    if (service === 'facebook') {
      return (await metaPages(current, credentials))
        .filter((entry) => entry.access_token)
        .map((entry) => ({
          id: numericId(entry.id),
          name: safeText(entry.name),
          kind: service,
          platform: service,
          capabilities:
            Array.isArray(entry.tasks) &&
            entry.tasks.some((task) =>
              ['CREATE_CONTENT', 'MANAGE', 'PROFILE_PLUS_CREATE_CONTENT'].includes(task),
            )
              ? PROVIDERS.facebook.capabilities
              : ['analytics:read', 'account:read'],
          pageId: numericId(entry.id),
          pageAccessToken: token(entry.access_token),
        }));
    }
    if (service === 'meta_ads') {
      const accounts = [];
      let after;
      for (let page = 0; page < 20; page += 1) {
        const data = await json(
          metaUrl('me/adaccounts', current.accessToken, credentials.clientSecret, {
            fields: 'id,account_id,name,currency,timezone_name,account_status',
            limit: 100,
            after,
          }),
          { headers: bearer(current.accessToken) },
        );
        for (const entry of data.data ?? []) {
          const id = `act_${numericId(entry.account_id || String(entry.id).replace(/^act_/, ''))}`;
          accounts.push({
            id,
            name: safeText(entry.name || id),
            kind: service,
            timezone: entry.timezone_name,
            capabilities: ['analytics:read'],
            credentials: { currency: entry.currency, timezone: entry.timezone_name },
          });
        }
        after = data.paging?.next ? data.paging?.cursors?.after : null;
        if (!after) return accounts;
      }
      return limitError();
    }
    if (service === 'linkedin_member') {
      const data = await json('https://api.linkedin.com/v2/userinfo', {
        headers: bearer(current.accessToken),
      });
      return [
        {
          id: liOwner(`urn:li:person:${data.sub}`, true),
          name: safeText(data.name || 'LinkedIn member'),
          kind: service,
          platform: 'linkedin',
          capabilities: PROVIDERS.linkedin_member.capabilities,
        },
      ];
    }
    if (service === 'linkedin') {
      const accounts = [];
      for (let page = 0; page < 10; page += 1) {
        const url = new URL(`${liRoot}/organizationAcls`);
        url.search = new URLSearchParams({
          q: 'roleAssignee',
          state: 'APPROVED',
          start: String(page * 100),
          count: '100',
        }).toString();
        const data = await json(url, { headers: liHeaders(current) });
        for (const entry of data.elements ?? []) {
          if (
            entry.state !== 'APPROVED' ||
            !['ADMINISTRATOR', 'CONTENT_ADMINISTRATOR', 'CONTENT_ADMIN'].includes(entry.role)
          )
            continue;
          const id = liOwner(entry.organization);
          if (accounts.some((item) => item.id === id)) continue;
          const organization = await json(`${liRoot}/organizations/${id.split(':').pop()}`, {
            headers: liHeaders(current),
          });
          accounts.push({
            id,
            name: safeText(
              organization.localizedName ||
                Object.values(organization.name?.localized ?? {})[0] ||
                id,
            ),
            kind: service,
            platform: 'linkedin',
            capabilities:
              entry.role === 'ADMINISTRATOR'
                ? PROVIDERS.linkedin.capabilities
                : ['publish:text', 'publish:image', 'account:read'],
          });
        }
        if (
          !(data.paging?.links ?? []).some((link) => link.rel === 'next') &&
          (data.elements?.length ?? 0) < 100
        )
          return accounts;
      }
      return limitError();
    }
    fail('This provider is not supported.', 'provider_not_supported');
  }

  async function platformReport(service, accountId, current, credentials, startDate, endDate) {
    const report = { summary: [], tables: [], notes: [] };
    if (service === 'search_console') {
      if (!(accountId.startsWith('sc-domain:') || /^https?:\/\//.test(accountId)))
        fail('Select a Search Console property first.');
      const run = (dimensions, rowLimit = 100) =>
        json(
          `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(accountId)}/searchAnalytics/query`,
          {
            method: 'POST',
            headers: { ...bearer(current.accessToken), 'Content-Type': 'application/json' },
            body: JSON.stringify({
              startDate,
              endDate,
              dimensions,
              rowLimit,
              type: 'web',
              dataState: 'final',
            }),
          },
        );
      const [total, daily, queries, pages] = await all([
        run([], 1),
        run(['date']),
        run(['query']),
        run(['page']),
      ]);
      const values = total.rows?.[0] ?? {};
      report.summary = [
        metric('clicks', 'Search clicks', number(values.clicks)),
        metric('impressions', 'Search impressions', number(values.impressions)),
        metric('ctr', 'Click-through rate', number(values.ctr) * 100, 'percent'),
        metric('position', 'Average position', number(values.position)),
      ];
      for (const [key, label, data] of [
        ['date', 'Daily search performance', daily],
        ['query', 'Top search queries', queries],
        ['page', 'Top search pages', pages],
      ]) {
        report.tables.push({
          key,
          label,
          columns: [
            column(
              key,
              key === 'date' ? 'Date' : key === 'query' ? 'Query' : 'Page',
              key === 'page' ? 'url' : 'text',
            ),
            column('clicks', 'Clicks'),
            column('impressions', 'Impressions'),
            column('ctr', 'CTR', 'percent'),
            column('position', 'Average position'),
          ],
          rows: (data.rows ?? []).map((row) => ({
            [key]: safeText(row.keys?.[0]),
            clicks: number(row.clicks),
            impressions: number(row.impressions),
            ctr: number(row.ctr) * 100,
            position: number(row.position),
          })),
          truncated: key !== 'date' && (data.rows?.length ?? 0) >= 100,
        });
      }
      report.notes = [
        'Finalized web-search data; dates follow Search Console’s Pacific Time reporting boundary.',
        'Query/page tables contain top rows. Privacy filtering and provider limits mean their sums can differ from property totals.',
      ];
    } else if (service === 'youtube') {
      channelId(accountId);
      const metrics =
        'views,estimatedMinutesWatched,averageViewDuration,likes,comments,subscribersGained,subscribersLost';
      const run = (dimensions) => {
        const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
        url.search = new URLSearchParams({
          ids: `channel==${accountId}`,
          startDate,
          endDate,
          metrics,
          ...(dimensions ? { dimensions, sort: dimensions, maxResults: '100' } : {}),
        }).toString();
        return json(url, { headers: bearer(current.accessToken) });
      };
      const [totals, daily] = await all([run(), run('day')]);
      const asRows = (data) =>
        (data.rows ?? []).map((row) =>
          Object.fromEntries(
            (data.columnHeaders ?? []).map((header, index) => [
              header.name,
              header.dataType === 'STRING' ? safeText(row[index]) : number(row[index]),
            ]),
          ),
        );
      const total = asRows(totals)[0] ?? {};
      const fields = [
        ['views', 'Views', 'count'],
        ['estimatedMinutesWatched', 'Watch time', 'minutes'],
        ['averageViewDuration', 'Average view duration', 'seconds'],
        ['likes', 'Likes', 'count'],
        ['comments', 'Comments', 'count'],
        ['subscribersGained', 'Subscribers gained', 'count'],
        ['subscribersLost', 'Subscribers lost', 'count'],
      ];
      report.summary = fields.map(([key, label, unit]) =>
        metric(key, label, number(total[key]), unit),
      );
      report.tables = [
        {
          key: 'daily',
          label: 'Daily channel performance',
          columns: [
            column('day', 'Date', 'text'),
            ...fields.map(([key, label]) => column(key, label)),
          ],
          rows: asRows(daily),
        },
      ];
      report.notes = [
        'Reports require channel ownership and may lag behind YouTube Studio. Average view duration is an aggregate from the provider, not a sum of daily averages.',
        'This report does not request YouTube revenue permissions.',
      ];
    } else if (service === 'google_business') {
      googleAccount(accountId, 'locations');
      const fields = [
        ['WEBSITE_CLICKS', 'Website clicks'],
        ['CALL_CLICKS', 'Call clicks'],
        ['BUSINESS_DIRECTION_REQUESTS', 'Direction requests'],
        ['BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'Desktop Maps impressions'],
        ['BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'Desktop Search impressions'],
        ['BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'Mobile Maps impressions'],
        ['BUSINESS_IMPRESSIONS_MOBILE_SEARCH', 'Mobile Search impressions'],
      ];
      const url = new URL(
        `https://businessprofileperformance.googleapis.com/v1/${accountId}:fetchMultiDailyMetricsTimeSeries`,
      );
      fields.forEach(([key]) => url.searchParams.append('dailyMetrics', key));
      for (const [boundary, date] of [
        ['startDate', startDate],
        ['endDate', endDate],
      ])
        dateParts(date).forEach((part, index) =>
          url.searchParams.set(
            `dailyRange.${boundary}.${['year', 'month', 'day'][index]}`,
            String(part),
          ),
        );
      const data = await json(url, { headers: bearer(current.accessToken) });
      const days = new Map();
      const observed = new Set();
      for (const group of data.multiDailyMetricTimeSeries ?? [])
        for (const series of group.dailyMetricTimeSeries ?? []) {
          if (series.dailySubEntityType) continue;
          observed.add(series.dailyMetric);
          for (const point of series.timeSeries?.datedValues ?? []) {
            const date = `${point.date?.year}-${String(point.date?.month).padStart(2, '0')}-${String(point.date?.day).padStart(2, '0')}`;
            const row = days.get(date) ?? { date };
            row[series.dailyMetric] = number(point.value);
            days.set(date, row);
          }
        }
      report.tables = [
        {
          key: 'daily',
          label: 'Daily location performance',
          columns: [
            column('date', 'Date', 'text'),
            ...fields.map(([key, label]) => column(key, label)),
          ],
          rows: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
        },
      ];
      report.summary = fields
        .filter(([key]) => observed.has(key))
        .map(([key, label]) =>
          metric(
            key,
            label,
            [...days.values()].reduce((sum, row) => sum + number(row[key]), 0),
          ),
        );
      report.notes = [
        'Counts follow Business Profile’s metric definitions. Missing metrics are unavailable, not measured zeroes.',
        'Calls, directions and website clicks are interactions, not confirmed admissions. Impression counts are reported by device/surface and are not cross-platform unique people.',
      ];
    } else if (service === 'google_ads') {
      const id = numericId(accountId);
      const fields =
        'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value';
      const range = `segments.date BETWEEN '${startDate}' AND '${endDate}'`;
      const managerId = current.loginCustomerId || credentials.loginCustomerId;
      const [totals, campaigns, daily] = await all([
        adsSearch(
          id,
          `SELECT customer.currency_code, customer.time_zone, ${fields} FROM customer WHERE ${range}`,
          current,
          credentials,
          managerId,
        ),
        adsSearch(
          id,
          `SELECT campaign.id, campaign.name, campaign.status, ${fields} FROM campaign WHERE ${range} ORDER BY metrics.cost_micros DESC LIMIT 1000`,
          current,
          credentials,
          managerId,
        ),
        adsSearch(
          id,
          `SELECT segments.date, ${fields} FROM customer WHERE ${range} ORDER BY segments.date`,
          current,
          credentials,
          managerId,
        ),
      ]);
      const values = (row) => ({
        impressions: number(row.metrics?.impressions),
        clicks: number(row.metrics?.clicks),
        spend: number(row.metrics?.costMicros) / 1000000,
        conversions: number(row.metrics?.conversions),
        conversionValue: number(row.metrics?.conversionsValue),
      });
      const total = values(totals[0] ?? {});
      report.currency =
        safeText(totals[0]?.customer?.currencyCode || current.currency, 8) || undefined;
      report.summary = [
        metric('spend', 'Spend', total.spend, 'currency'),
        metric('impressions', 'Impressions', total.impressions),
        metric('clicks', 'Clicks', total.clicks),
        metric('conversions', 'Configured conversions', total.conversions),
        metric('conversionValue', 'Conversion value', total.conversionValue, 'currency'),
      ];
      const columns = [
        column('impressions', 'Impressions'),
        column('clicks', 'Clicks'),
        column('spend', 'Spend', 'currency'),
        column('conversions', 'Configured conversions'),
        column('conversionValue', 'Conversion value', 'currency'),
      ];
      report.tables = [
        {
          key: 'campaigns',
          label: 'Campaign performance',
          columns: [
            column('name', 'Campaign', 'text'),
            column('status', 'Status', 'text'),
            ...columns,
          ],
          rows: campaigns.map((row) => ({
            id: safeText(row.campaign?.id),
            name: safeText(row.campaign?.name),
            status: safeText(row.campaign?.status),
            ...values(row),
          })),
          truncated: campaigns.length >= 1000,
        },
        {
          key: 'daily',
          label: 'Daily ad-account performance',
          columns: [column('date', 'Date', 'text'), ...columns],
          rows: daily.map((row) => ({ date: safeText(row.segments?.date), ...values(row) })),
        },
      ];
      report.notes = [
        `Amounts are in the ad account’s currency${report.currency ? ` (${report.currency})` : ''}; dates follow ${totals[0]?.customer?.timeZone || current.timezone || 'the account time zone'}.`,
        'Conversions and value follow your Google Ads conversion actions and attribution settings. They are not automatically verified admissions.',
        'This adapter executes reporting queries only and cannot alter a campaign or budget.',
      ];
    } else if (service === 'meta_ads') {
      if (!/^act_\d+$/.test(accountId)) fail('Select a Meta ad account first.');
      const query = {
        fields: 'account_currency,campaign_id,campaign_name,impressions,clicks,spend,reach,actions',
        time_range: JSON.stringify({ since: startDate, until: endDate }),
        use_account_attribution_setting: 'true',
        action_report_time: 'impression',
        limit: 100,
      };
      const read = async (level) => {
        const rows = [];
        let after;
        for (let page = 0; page < 10; page += 1) {
          const data = await json(
            metaUrl(`${accountId}/insights`, current.accessToken, credentials.clientSecret, {
              ...query,
              level,
              after,
            }),
            { headers: bearer(current.accessToken) },
          );
          rows.push(...(data.data ?? []));
          after = data.paging?.next ? data.paging?.cursors?.after : null;
          if (!after) return { rows, truncated: false };
        }
        return { rows, truncated: true };
      };
      const [account, campaigns] = await all([read('account'), read('campaign')]);
      const total = account.rows[0] ?? {};
      report.currency = safeText(total.account_currency || current.currency, 8) || undefined;
      report.summary = [
        metric('spend', 'Spend', number(total.spend), 'currency'),
        metric('impressions', 'Impressions', number(total.impressions)),
        metric('clicks', 'Clicks (all)', number(total.clicks)),
        metric('reach', 'Account reach', number(total.reach)),
      ];
      report.tables = [
        {
          key: 'campaigns',
          label: 'Campaign performance',
          columns: [
            column('name', 'Campaign', 'text'),
            column('spend', 'Spend', 'currency'),
            column('impressions', 'Impressions'),
            column('clicks', 'Clicks (all)'),
            column('reach', 'Reach'),
          ],
          rows: campaigns.rows.map((row) => ({
            id: safeText(row.campaign_id),
            name: safeText(row.campaign_name),
            spend: number(row.spend),
            impressions: number(row.impressions),
            clicks: number(row.clicks),
            reach: number(row.reach),
          })),
          truncated: campaigns.truncated,
        },
        {
          key: 'actions',
          label: 'Attributed actions, as reported by Meta',
          columns: [column('action', 'Action type', 'text'), column('value', 'Count')],
          rows: (total.actions ?? []).map((row) => ({
            action: safeText(row.action_type),
            value: number(row.value),
          })),
        },
      ];
      report.notes = [
        `Amounts use ${report.currency || 'the account currency'} and dates use ${current.timezone || 'the ad account time zone'}.`,
        'Reports use account attribution settings and impression-time action reporting. Action types may overlap; this app does not add them into a fabricated lead total.',
        'Account reach is returned by Meta and is not the sum of campaign reach. Ads remain read-only.',
      ];
    } else if (service === 'instagram') {
      if (Date.parse(endDate) - Date.parse(startDate) > 29 * 86400000)
        fail(
          'Instagram insight imports support a maximum 30-day date range. Choose a shorter period.',
          'invalid_date_range',
        );
      const access = current.pageAccessToken;
      const profile = await json(
        metaUrl(numericId(accountId), access, credentials.clientSecret, {
          fields: 'id,username,followers_count,media_count',
        }),
        { headers: bearer(access) },
      );
      const data = await json(
        metaUrl(`${numericId(accountId)}/insights`, access, credentials.clientSecret, {
          metric: 'views,reach,total_interactions',
          period: 'day',
          metric_type: 'total_value',
          since: startDate,
          until: dayAfter(endDate),
        }),
        { headers: bearer(access) },
      );
      const labels = {
        views: 'Views',
        reach: 'Accounts reached',
        total_interactions: 'Interactions',
      };
      report.summary = (data.data ?? [])
        .filter((row) => labels[row.name] && row.total_value?.value !== undefined)
        .map((row) => metric(row.name, labels[row.name], number(row.total_value.value)));
      report.tables = [
        {
          key: 'profile',
          label: 'Profile snapshot at import',
          columns: [
            column('username', 'Account', 'text'),
            column('followers', 'Current followers'),
            column('media', 'Current media count'),
          ],
          rows: [
            {
              username: safeText(profile.username),
              followers: number(profile.followers_count),
              media: number(profile.media_count),
            },
          ],
        },
      ];
      report.notes = [
        'The requested period applies to insights. The follower/media counts are current snapshots at import, not historical totals.',
        'Meta may withhold insights for small accounts, recent content or unavailable periods; omitted metrics remain unavailable.',
      ];
    } else if (service === 'facebook') {
      const access = current.pageAccessToken;
      const profile = await json(
        metaUrl(numericId(accountId), access, credentials.clientSecret, {
          fields: 'id,name,fan_count,followers_count',
        }),
        { headers: bearer(access) },
      );
      const posts = [];
      let after;
      let truncated = false;
      for (let page = 0; page < 5; page += 1) {
        const data = await json(
          metaUrl(`${numericId(accountId)}/published_posts`, access, credentials.clientSecret, {
            fields:
              'id,message,created_time,permalink_url,reactions.limit(0).summary(true),comments.limit(0).summary(true),shares',
            since: startDate,
            until: dayAfter(endDate),
            limit: 100,
            after,
          }),
          { headers: bearer(access) },
        );
        posts.push(...(data.data ?? []));
        after = data.paging?.next ? data.paging?.cursors?.after : null;
        if (!after) break;
        if (page === 4) truncated = true;
      }
      const rows = posts.map((post) => ({
        title: safeText(post.message, 160),
        publishedAt: safeText(post.created_time),
        url: safeText(post.permalink_url),
        reactions: number(post.reactions?.summary?.total_count),
        comments: number(post.comments?.summary?.total_count),
        shares: number(post.shares?.count),
      }));
      report.summary = [
        metric(
          'posts',
          truncated ? 'Posts imported (limited)' : 'Posts published in period',
          rows.length,
        ),
        metric('followers', 'Current followers', number(profile.followers_count)),
        metric('fans', 'Current Page likes', number(profile.fan_count)),
      ];
      report.tables = [
        {
          key: 'posts',
          label: 'Posts in period, interaction counts at import',
          columns: [
            column('title', 'Post', 'text'),
            column('publishedAt', 'Published', 'text'),
            column('reactions', 'Current reactions'),
            column('comments', 'Current comments'),
            column('shares', 'Current shares'),
            column('url', 'Open post', 'url'),
          ],
          rows,
          truncated,
        },
      ];
      report.notes = [
        'The date filter selects posts published in that period. Reaction/comment/share counts are cumulative snapshots at import, not interactions that occurred only within the period.',
        'Follower and Page-like counts are current snapshots. This report does not claim unique reach or paid performance.',
      ];
    } else if (service === 'linkedin') {
      liOwner(accountId);
      const url = new URL(`${liRoot}/organizationalEntityShareStatistics`);
      url.search = new URLSearchParams({
        q: 'organizationalEntity',
        organizationalEntity: accountId,
        timeIntervals: `(timeRange:(start:${Date.parse(`${startDate}T00:00:00Z`)},end:${Date.parse(`${dayAfter(endDate)}T00:00:00Z`)}),timeGranularityType:DAY)`,
      }).toString();
      const data = await json(url, { headers: liHeaders(current) });
      const fields = [
        ['impressionCount', 'Impressions'],
        ['clickCount', 'Clicks'],
        ['likeCount', 'Net likes'],
        ['commentCount', 'Comments'],
        ['shareCount', 'Shares'],
      ];
      const rows = (data.elements ?? []).map((entry) => ({
        date: new Date(number(entry.timeRange?.start)).toISOString().slice(0, 10),
        ...Object.fromEntries(
          fields.map(([key]) => [key, number(entry.totalShareStatistics?.[key])]),
        ),
      }));
      report.summary = fields.map(([key, label]) =>
        metric(
          key,
          label,
          rows.reduce((sum, row) => sum + row[key], 0),
        ),
      );
      report.tables = [
        {
          key: 'daily',
          label: 'Daily organization organic posts',
          columns: [
            column('date', 'Date', 'text'),
            ...fields.map(([key, label]) => column(key, label)),
          ],
          rows,
        },
      ];
      report.notes = [
        'Organic organization statistics only; sponsored activity is excluded. Net likes may be negative when people unlike posts.',
        'LinkedIn time-bound shares can differ from lifetime shares. Unique impressions are deliberately not summed across dates.',
      ];
    } else
      fail(
        'This connection does not expose a supported analytics report. LinkedIn personal-profile reporting requires restricted provider access.',
        'analytics_not_supported',
      );
    return report;
  }

  return {
    ...base,
    authorize(service, credentials, redirectUri, state, verifier) {
      if (providerGroup(service) !== 'linkedin')
        return base.authorize(service, credentials, redirectUri, state, verifier);
      const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: credentials.clientId,
        redirect_uri: redirectUri,
        state,
        scope: PROVIDERS[service].scopes.join(' '),
      }).toString();
      return url.toString();
    },
    async exchange(service, credentials, redirectUri, code, verifier) {
      if (providerGroup(service) !== 'linkedin')
        return base.exchange(service, credentials, redirectUri, code, verifier);
      const data = await json('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
        }).toString(),
      });
      const scopes =
        typeof data.scope === 'string' ? data.scope.split(/[ ,]+/) : PROVIDERS[service].scopes;
      if (!PROVIDERS[service].scopes.every((scope) => scopes.includes(scope)))
        fail(
          'LinkedIn did not grant all required permissions. Check the developer products and reconnect.',
          'permission_denied',
        );
      return {
        accessToken: token(data.access_token),
        refreshToken: data.refresh_token ? token(data.refresh_token) : null,
        expiresAt: expiry(data.expires_in),
        refreshExpiresAt: expiry(data.refresh_token_expires_in),
        scopes,
      };
    },
    async refresh(credentials, current, service = 'google') {
      if (providerGroup(service) === 'google') return base.refresh(credentials, current);
      if (
        providerGroup(service) !== 'linkedin' ||
        !current.refreshToken ||
        (current.refreshExpiresAt && current.refreshExpiresAt <= now().getTime())
      )
        throw new ProviderError(
          'Authorization expired. Reconnect this account.',
          'reauthorization_required',
          { reauthenticate: true },
        );
      const data = await json('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: token(current.refreshToken),
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
        }).toString(),
      });
      return {
        ...current,
        accessToken: token(data.access_token),
        refreshToken: data.refresh_token ? token(data.refresh_token) : current.refreshToken,
        expiresAt: expiry(data.expires_in),
      };
    },
    discover,
    async test(service, accountId, current, credentials) {
      if (service === 'google' || service === 'instagram')
        return base.test(service, accountId, current, credentials);
      // Discovery proves resource ownership/role instead of accepting a pasted ID.
      if (!(await discover(service, current, credentials)).some((entry) => entry.id === accountId))
        fail(
          'This authorization no longer has access to the selected account. Reconnect it.',
          'permission_denied',
        );
      return true;
    },
    platformReport,
    ...createPublicationAdapters({
      ...context,
      liHeaders,
      liOwner,
      channelId,
      googleAccount,
      number,
      fail,
    }),
  };
}

async function all(promises) {
  const results = await Promise.allSettled(promises);
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  return results.map((result) => result.value);
}

// Publication adapters are added below. All their calls happen after queue preflight.
function createPublicationAdapters(context) {
  const {
    base,
    json,
    request,
    bearer,
    metaUrl,
    numericId,
    ProviderError,
    liHeaders,
    liOwner,
    channelId,
    googleAccount,
    fail,
  } = context;
  const accepted = (
    id,
    pattern,
    message = 'The provider did not confirm a publication identifier. Inspect the destination before retrying.',
  ) => {
    if (typeof id !== 'string' || !pattern.test(id))
      throw new ProviderError(message, 'publication_unconfirmed', { ambiguous: true });
    return id;
  };
  const publicationMetadata = (data) => ({
    id: data.id,
    caption: data.caption,
    timestamp: data.timestamp,
    permalink: data.permalink,
    visibility: data.visibility ?? null,
    providerStatus: data.providerStatus ?? null,
  });
  function uploadUrl(value, hosts, prefix) {
    let url;
    try {
      url = new URL(value);
    } catch {
      fail('The provider returned an invalid upload address.', 'invalid_upload_url');
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !hosts.includes(url.hostname) ||
      !url.pathname.startsWith(prefix)
    )
      fail(
        'The provider returned an unexpected upload address. No media was sent.',
        'invalid_upload_url',
      );
    return url;
  }
  return {
    async preparePublication(service, accountId, current, credentials, post, media) {
      if (service === 'instagram') {
        if (post.format === 'Carousel') {
          const children = [];
          for (const item of media)
            children.push(
              await base.createContainer(accountId, current, credentials, '', item.url, {
                is_carousel_item: 'true',
              }),
            );
          return base.createContainer(accountId, current, credentials, post.caption, null, {
            media_type: 'CAROUSEL',
            children: children.join(','),
          });
        }
        if (post.format === 'Reel')
          return base.createContainer(accountId, current, credentials, post.caption, null, {
            media_type: 'REELS',
            video_url: media[0].url,
            share_to_feed: 'true',
          });
        return base.createContainer(accountId, current, credentials, post.caption, media[0].url);
      }
      if (['linkedin', 'linkedin_member'].includes(service) && media.length) {
        const owner = liOwner(accountId, service === 'linkedin_member');
        const data = await json('https://api.linkedin.com/rest/images?action=initializeUpload', {
          method: 'POST',
          headers: { ...liHeaders(current), 'Content-Type': 'application/json' },
          body: JSON.stringify({ initializeUploadRequest: { owner } }),
        });
        const image = accepted(data.value?.image, /^urn:li:image:[A-Za-z0-9_-]+$/);
        const url = uploadUrl(data.value?.uploadUrl, ['www.linkedin.com'], '/dms-uploads/');
        await request(url, {
          method: 'PUT',
          headers: { ...bearer(current.accessToken), 'Content-Type': 'image/jpeg' },
          body: media[0].bytes,
          responseKind: 'empty',
          timeout: 60000,
        });
        return image;
      }
      return null;
    },
    async preparedStatus(service, containerId, current, credentials) {
      if (service === 'instagram') return base.containerStatus(containerId, current, credentials);
      if (service === 'linkedin' && containerId) {
        const data = await json(
          `https://api.linkedin.com/rest/images/${encodeURIComponent(containerId)}`,
          { headers: liHeaders(current) },
        );
        if (data.status === 'AVAILABLE') return 'FINISHED';
        if (['WAITING_UPLOAD', 'PROCESSING'].includes(data.status)) return 'IN_PROGRESS';
        return 'ERROR';
      }
      return 'FINISHED';
    },
    async publishDirect(service, accountId, current, credentials, post, media, containerId) {
      if (service === 'instagram') {
        return { id: await base.publish(accountId, containerId, current, credentials), url: null };
      }
      if (service === 'facebook') {
        const id = numericId(accountId);
        const access = current.pageAccessToken;
        const data = await json(
          metaUrl(`${id}/${media.length ? 'photos' : 'feed'}`, access, credentials.clientSecret),
          {
            method: 'POST',
            headers: { ...bearer(access), 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(
              media.length
                ? { url: media[0].url, caption: post.caption, published: 'true' }
                : { message: post.caption },
            ).toString(),
          },
        );
        const remoteId = accepted(String(data.post_id || data.id || ''), /^\d+(?:_\d+)?$/);
        return { id: remoteId, url: `https://www.facebook.com/${remoteId}` };
      }
      if (service === 'google_business') {
        const parent = `${googleAccount(current.businessAccountName, 'accounts')}/${googleAccount(accountId, 'locations')}`;
        const data = await json(`https://mybusiness.googleapis.com/v4/${parent}/localPosts`, {
          method: 'POST',
          headers: { ...bearer(current.accessToken), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            languageCode: 'en',
            summary: post.caption,
            topicType: 'STANDARD',
            ...(media.length ? { media: [{ mediaFormat: 'PHOTO', sourceUrl: media[0].url }] } : {}),
          }),
        });
        const id = accepted(
          data.name,
          /^accounts\/\d+\/locations\/\d+\/localPosts\/[A-Za-z0-9_-]+$/,
        );
        if (!id.startsWith(`${parent}/localPosts/`))
          throw new ProviderError(
            'The provider confirmed a post on an unexpected location. Inspect before continuing.',
            'publication_unconfirmed',
            { ambiguous: true },
          );
        return {
          id,
          url: data.searchUrl || null,
          providerStatus: safeText(data.state || 'ACCEPTED', 80),
        };
      }
      if (['linkedin', 'linkedin_member'].includes(service)) {
        const author = liOwner(accountId, service === 'linkedin_member');
        const result = await request('https://api.linkedin.com/rest/posts', {
          method: 'POST',
          headers: { ...liHeaders(current), 'Content-Type': 'application/json' },
          responseKind: 'empty',
          body: JSON.stringify({
            author,
            commentary: post.caption,
            visibility: 'PUBLIC',
            distribution: {
              feedDistribution: 'MAIN_FEED',
              targetEntities: [],
              thirdPartyDistributionChannels: [],
            },
            lifecycleState: 'PUBLISHED',
            isReshareDisabledByAuthor: false,
            ...(containerId ? { content: { media: { id: containerId, title: post.title } } } : {}),
          }),
        });
        const id = accepted(result.headers.get('x-restli-id'), /^urn:li:(?:share|ugcPost):\d+$/);
        return { id, url: `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}/` };
      }
      if (service === 'youtube') {
        channelId(accountId);
        // A standard OAuth upload always targets the identity's channel. Recheck it
        // immediately before initializing the upload, not just when connecting.
        const check = await json(
          'https://www.googleapis.com/youtube/v3/channels?part=id&mine=true&maxResults=50',
          { headers: bearer(current.accessToken) },
        );
        if (check.items?.length !== 1 || check.items[0].id !== accountId)
          fail(
            'The authorized YouTube identity does not resolve to exactly the approved channel. Reconnect the intended channel.',
            'channel_mismatch',
          );
        const options = post.publicationOptions;
        const initialized = await request(
          'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status,processingDetails&notifySubscribers=false',
          {
            method: 'POST',
            headers: {
              ...bearer(current.accessToken),
              'Content-Type': 'application/json',
              'X-Upload-Content-Type': 'video/mp4',
              'X-Upload-Content-Length': String(media[0].bytes.length),
            },
            responseKind: 'empty',
            body: JSON.stringify({
              snippet: { title: post.title, description: post.caption, categoryId: '27' },
              status: {
                privacyStatus: options.youtubePrivacy,
                selfDeclaredMadeForKids: options.madeForKids,
                containsSyntheticMedia: options.containsSyntheticMedia,
              },
            }),
          },
        );
        const upload = uploadUrl(
          initialized.headers.get('location'),
          ['www.googleapis.com'],
          '/upload/youtube/v3/videos',
        );
        const data = await json(upload, {
          method: 'PUT',
          headers: {
            ...bearer(current.accessToken),
            'Content-Type': 'video/mp4',
            'Content-Length': String(media[0].bytes.length),
          },
          body: media[0].bytes,
          timeout: 120000,
        });
        const id = accepted(data.id, /^[A-Za-z0-9_-]{11}$/);
        if (data.snippet?.channelId && data.snippet.channelId !== accountId)
          throw new ProviderError(
            'YouTube returned a different channel after upload. Inspect the channel before continuing.',
            'publication_unconfirmed',
            { ambiguous: true },
          );
        return {
          id,
          url: `https://www.youtube.com/watch?v=${id}`,
          visibility: ['private', 'unlisted', 'public'].includes(data.status?.privacyStatus)
            ? data.status.privacyStatus
            : null,
          providerStatus: safeText(
            data.status?.uploadStatus || data.processingDetails?.processingStatus || 'UPLOADED',
            80,
          ),
        };
      }
      fail('Publishing is unavailable for this provider.', 'publishing_not_supported');
    },
    async publication(service, accountId, remoteId, current, credentials) {
      if (service === 'instagram') return base.media(accountId, remoteId, current, credentials);
      if (service === 'facebook') {
        if (!/^\d+(?:_\d+)?$/.test(remoteId))
          fail('Enter the Facebook post identifier.', 'invalid_publication_id');
        const data = await json(
          metaUrl(remoteId, current.pageAccessToken, credentials.clientSecret, {
            fields: 'id,message,created_time,permalink_url,from',
          }),
          { headers: bearer(current.pageAccessToken) },
        );
        if (String(data.from?.id) !== numericId(accountId))
          fail('That post belongs to a different Facebook Page.', 'publication_not_found');
        return publicationMetadata({
          id: String(data.id),
          caption: data.message || '',
          timestamp: data.created_time,
          permalink: data.permalink_url,
        });
      }
      if (service === 'google_business') {
        const parent = `${googleAccount(current.businessAccountName, 'accounts')}/${googleAccount(accountId, 'locations')}`;
        if (
          !/^accounts\/\d+\/locations\/\d+\/localPosts\/[A-Za-z0-9_-]+$/.test(remoteId) ||
          !remoteId.startsWith(`${parent}/localPosts/`)
        )
          fail(
            'That post does not belong to the selected business location.',
            'publication_not_found',
          );
        const data = await json(`https://mybusiness.googleapis.com/v4/${remoteId}`, {
          headers: bearer(current.accessToken),
        });
        return publicationMetadata({
          id: data.name,
          caption: data.summary || '',
          timestamp: data.createTime,
          permalink: data.searchUrl,
          providerStatus: safeText(data.state, 80),
        });
      }
      if (service === 'linkedin_member')
        fail(
          'LinkedIn self-serve member access cannot read posts back. Inspect the profile manually; this job will not be resent automatically.',
          'reconciliation_unavailable',
        );
      if (service === 'linkedin') {
        if (!/^urn:li:(?:share|ugcPost):\d+$/.test(remoteId))
          fail('Enter the LinkedIn post URN.', 'invalid_publication_id');
        const data = await json(
          `https://api.linkedin.com/rest/posts/${encodeURIComponent(remoteId)}`,
          { headers: liHeaders(current) },
        );
        if (data.author !== liOwner(accountId))
          fail('That post belongs to a different LinkedIn Page.', 'publication_not_found');
        return publicationMetadata({
          id: remoteId,
          caption: data.commentary || '',
          timestamp: new Date(data.publishedAt || data.createdAt).toISOString(),
          permalink: `https://www.linkedin.com/feed/update/${encodeURIComponent(remoteId)}/`,
        });
      }
      if (service === 'youtube') {
        if (!/^[A-Za-z0-9_-]{11}$/.test(remoteId))
          fail('Enter the 11-character YouTube video ID.', 'invalid_publication_id');
        const data = await json(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet,status,processingDetails&id=${encodeURIComponent(remoteId)}`,
          { headers: bearer(current.accessToken) },
        );
        const video = data.items?.[0];
        if (!video || video.snippet?.channelId !== channelId(accountId))
          fail(
            'That video does not belong to the selected YouTube channel.',
            'publication_not_found',
          );
        return {
          ...publicationMetadata({
            id: video.id,
            caption: video.snippet?.description || '',
            timestamp: video.snippet?.publishedAt,
            permalink: `https://www.youtube.com/watch?v=${remoteId}`,
            visibility: video.status?.privacyStatus,
            providerStatus: safeText(
              video.status?.uploadStatus || video.processingDetails?.processingStatus,
              80,
            ),
          }),
          title: video.snippet?.title,
        };
      }
      fail(
        'Publication verification is unavailable for this provider.',
        'reconciliation_unavailable',
      );
    },
  };
}
