import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProviderClient, PROVIDERS } from './providers.mjs';
import { migrateExtensions } from './migrate.mjs';
import { openDatabase } from '../database.mjs';

const credentials = { clientId: 'test-client', clientSecret: 'test-client-secret' };
const current = { accessToken: 'private-access-token', pageAccessToken: 'private-page-token' };
const channel = 'UCabcdefghijklmnopqrstuv';
const title = 'School open day';
const caption = 'Visit our school this Saturday.';
const now = () => new Date('2026-11-05T10:00:00Z');
const report = (adapter, service, id, account = current, settings = credentials) =>
  adapter.platformReport(service, id, account, settings, '2026-10-01', '2026-10-30');
const bodyOf = (options) => JSON.parse(options.body);

test('Google services reuse the app while each requests only its own scopes and PKCE', () => {
  const adapter = createProviderClient();
  for (const service of ['google', 'search_console', 'youtube', 'google_business', 'google_ads']) {
    const url = new URL(
      adapter.authorize(
        service,
        credentials,
        `https://school.example/${service}`,
        'state',
        'verifier',
      ),
    );
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.deepEqual(url.searchParams.get('scope').split(' '), PROVIDERS[service].scopes);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('include_granted_scopes'), 'true');
  }
  const member = new URL(
    adapter.authorize(
      'linkedin_member',
      credentials,
      'https://school.example/member',
      'state',
      'verifier',
    ),
  );
  assert.ok(member.searchParams.get('scope').includes('w_member_social'));
  assert.ok(!member.searchParams.get('scope').includes('w_organization_social'));
  assert.ok(PROVIDERS.meta_ads.scopes.includes('ads_read'));
  assert.ok(!PROVIDERS.meta_ads.scopes.includes('ads_management'));
});

test('Google and Meta exchanges reject partial permission grants without exposing provider errors', async () => {
  const google = createProviderClient({
    fetch: async () =>
      Response.json({
        access_token: 'private',
        scope: PROVIDERS.youtube.scopes[0],
        expires_in: 3600,
      }),
  });
  await assert.rejects(
    () =>
      google.exchange(
        'youtube',
        credentials,
        'https://school.example/callback',
        'code',
        'verifier',
      ),
    (error) => error.code === 'permission_denied',
  );
  let calls = 0;
  const meta = createProviderClient({
    fetch: async () =>
      Response.json(
        ++calls < 3
          ? { access_token: 'private', expires_in: 3600 }
          : { data: [{ permission: 'pages_show_list', status: 'granted' }] },
      ),
  });
  await assert.rejects(
    () =>
      meta.exchange('facebook', credentials, 'https://school.example/callback', 'code', 'verifier'),
    (error) => error.code === 'permission_denied',
  );
  assert.equal(calls, 3);
});

test('Search Console filters unverified properties and keeps property totals distinct from top rows', async () => {
  const adapter = createProviderClient({
    fetch: async (value, options) => {
      const url = new URL(value);
      if (url.pathname.endsWith('/sites'))
        return Response.json({
          siteEntry: [
            { siteUrl: 'sc-domain:school.example', permissionLevel: 'siteOwner' },
            { siteUrl: 'https://unverified.example/', permissionLevel: 'siteUnverifiedUser' },
          ],
        });
      assert.ok(url.pathname.includes('sc-domain%3Aschool.example'));
      const input = bodyOf(options);
      assert.equal(input.dataState, 'final');
      return Response.json({
        rows: [
          {
            ...(input.dimensions.length ? { keys: ['top'] } : {}),
            clicks: input.dimensions.length ? 3 : 8,
            impressions: 100,
            ctr: 0.08,
            position: 3.1,
          },
        ],
      });
    },
  });
  assert.deepEqual(
    (await adapter.discover('search_console', current, credentials)).map((entry) => entry.id),
    ['sc-domain:school.example'],
  );
  const result = await report(adapter, 'search_console', 'sc-domain:school.example');
  assert.equal(result.summary.find((entry) => entry.key === 'clicks').value, 8);
  assert.equal(result.summary.find((entry) => entry.key === 'ctr').value, 8);
  assert.equal(result.tables.find((entry) => entry.key === 'query').rows[0].clicks, 3);
  assert.match(result.notes.join(' '), /Privacy filtering/);
});

test('Google Ads reporting keeps account currency, micros conversion and manager headers without requiring a legacy token', async () => {
  const requests = [];
  const adapter = createProviderClient({
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      assert.equal(options.headers['login-customer-id'], '1234567890');
      assert.equal(options.headers['developer-token'], undefined);
      assert.match(bodyOf(options).query, /SELECT/);
      assert.doesNotMatch(String(url), /mutate/);
      return Response.json({
        results: [
          {
            customer: { currencyCode: 'INR', timeZone: 'Asia/Kolkata' },
            campaign: { id: '1', name: 'School visits', status: 'ENABLED' },
            segments: { date: '2026-10-01' },
            metrics: {
              impressions: '100',
              clicks: '20',
              costMicros: '123450000',
              conversions: 1.5,
              conversionsValue: 300,
            },
          },
        ],
      });
    },
  });
  const result = await report(adapter, 'google_ads', '9999999999', {
    ...current,
    loginCustomerId: '1234567890',
  });
  assert.equal(result.currency, 'INR');
  assert.equal(result.summary.find((entry) => entry.key === 'spend').value, 123.45);
  assert.equal(result.summary.find((entry) => entry.key === 'conversions').value, 1.5);
  assert.equal(requests.length, 3);
  assert.match(result.notes.join(' '), /not automatically verified admissions/);
});

test('Meta Ads uses account reach and separate action types rather than adding overlapping totals', async () => {
  const adapter = createProviderClient({
    fetch: async (value, options) => {
      const url = new URL(value);
      assert.equal(options.method, undefined);
      assert.equal(url.searchParams.get('use_account_attribution_setting'), 'true');
      assert.equal(url.searchParams.get('action_report_time'), 'impression');
      const account = url.searchParams.get('level') === 'account';
      return Response.json({
        data: [
          {
            account_currency: 'EUR',
            campaign_id: '1',
            campaign_name: 'First',
            impressions: '40',
            clicks: '5',
            spend: '7.25',
            reach: account ? '12' : '20',
            actions: [
              { action_type: 'lead', value: '2' },
              { action_type: 'onsite_conversion.lead_grouped', value: '2' },
            ],
          },
        ],
      });
    },
  });
  const result = await report(adapter, 'meta_ads', 'act_123');
  assert.equal(result.currency, 'EUR');
  assert.equal(result.summary.find((item) => item.key === 'reach').value, 12);
  assert.equal(result.tables.find((item) => item.key === 'actions').rows.length, 2);
  assert.ok(!result.summary.some((item) => /leads/i.test(item.label)));
});

test('Business Profile discovery gates publishing on the actual location capability', async () => {
  const adapter = createProviderClient({
    fetch: async (value) => {
      const url = new URL(value);
      if (url.hostname === 'mybusinessaccountmanagement.googleapis.com')
        return Response.json({ accounts: [{ name: 'accounts/123' }] });
      assert.equal(url.searchParams.get('readMask'), 'name,title,metadata');
      return Response.json({
        locations: [
          { name: 'locations/1', title: 'School one', metadata: { hasVoiceOfMerchant: true } },
          { name: 'locations/2', title: 'School two', metadata: { hasVoiceOfMerchant: false } },
        ],
      });
    },
  });
  const accounts = await adapter.discover('google_business', current, credentials);
  assert.ok(accounts[0].capabilities.includes('publish:text'));
  assert.ok(!accounts[1].capabilities.some((item) => item.startsWith('publish:')));
  assert.equal(accounts[0].credentials.businessAccountName, 'accounts/123');
});

test('LinkedIn Page discovery excludes revoked and unrelated roles and separates report access', async () => {
  const adapter = createProviderClient({
    fetch: async (value, options) => {
      const url = new URL(value);
      assert.equal(options.headers['Linkedin-Version'], '202610');
      if (url.pathname.endsWith('/organizationAcls'))
        return Response.json({
          elements: [
            { organization: 'urn:li:organization:1', role: 'ADMINISTRATOR', state: 'APPROVED' },
            {
              organization: 'urn:li:organization:2',
              role: 'CONTENT_ADMINISTRATOR',
              state: 'APPROVED',
            },
            { organization: 'urn:li:organization:3', role: 'ADMINISTRATOR', state: 'REVOKED' },
            { organization: 'urn:li:organization:4', role: 'ANALYST', state: 'APPROVED' },
          ],
        });
      return Response.json({
        localizedName: url.pathname.endsWith('/1') ? 'First Page' : 'Second Page',
      });
    },
  });
  const accounts = await adapter.discover('linkedin', current, credentials);
  assert.equal(accounts.length, 2);
  assert.ok(accounts[0].capabilities.includes('analytics:read'));
  assert.ok(!accounts[1].capabilities.includes('analytics:read'));
});

test('Facebook report distinguishes publication-date filtering from cumulative interaction snapshots', async () => {
  const adapter = createProviderClient({
    fetch: async (value) => {
      const url = new URL(value);
      if (!url.pathname.endsWith('/published_posts'))
        return Response.json({ id: '123', followers_count: 500, fan_count: 400 });
      assert.equal(url.searchParams.get('until'), '2026-10-31');
      return Response.json({
        data: [
          {
            id: '123_456',
            message: 'A school event',
            created_time: '2026-10-02T00:00:00Z',
            reactions: { summary: { total_count: 8 } },
            comments: { summary: { total_count: 2 } },
            shares: { count: 1 },
          },
        ],
      });
    },
  });
  const result = await report(adapter, 'facebook', '123');
  assert.equal(result.summary.find((item) => item.key === 'followers').value, 500);
  assert.equal(result.tables[0].rows[0].reactions, 8);
  assert.match(result.notes.join(' '), /cumulative snapshots/);
});

test('YouTube analytics keeps provider aggregate average duration rather than adding daily averages', async () => {
  const headers = [
    { name: 'views', dataType: 'INTEGER' },
    { name: 'averageViewDuration', dataType: 'INTEGER' },
  ];
  const adapter = createProviderClient({
    fetch: async (value) => {
      const url = new URL(value);
      assert.equal(url.searchParams.get('ids'), `channel==${channel}`);
      return Response.json(
        url.searchParams.has('dimensions')
          ? {
              columnHeaders: [{ name: 'day', dataType: 'STRING' }, ...headers],
              rows: [
                ['2026-10-01', 8, 40],
                ['2026-10-02', 2, 80],
              ],
            }
          : { columnHeaders: headers, rows: [[10, 48]] },
      );
    },
  });
  const result = await report(adapter, 'youtube', channel);
  assert.equal(result.summary.find((entry) => entry.key === 'averageViewDuration').value, 48);
  assert.equal(result.tables[0].rows.length, 2);
});

test('Instagram carousels preserve image order and Reels use the video container path', async () => {
  const bodies = [];
  const adapter = createProviderClient({
    fetch: async (_url, options) => {
      bodies.push(new URLSearchParams(options.body));
      return Response.json({ id: String(100 + bodies.length) });
    },
  });
  const media = [
    { url: 'https://media.example/one.jpg' },
    { url: 'https://media.example/two.jpg' },
  ];
  await adapter.preparePublication(
    'instagram',
    '123',
    current,
    credentials,
    { caption, format: 'Carousel' },
    media,
  );
  assert.equal(bodies[0].get('is_carousel_item'), 'true');
  assert.equal(bodies[0].get('image_url'), media[0].url);
  assert.equal(bodies[1].get('image_url'), media[1].url);
  assert.equal(bodies[2].get('children'), '101,102');
  assert.equal(bodies[2].get('media_type'), 'CAROUSEL');
  await adapter.preparePublication(
    'instagram',
    '123',
    current,
    credentials,
    { caption, format: 'Reel' },
    [{ url: 'https://media.example/reel.mp4' }],
  );
  assert.equal(bodies[3].get('media_type'), 'REELS');
  assert.equal(bodies[3].get('video_url'), 'https://media.example/reel.mp4');
  assert.equal(bodies[3].get('image_url'), null);
});

test('LinkedIn image preparation rejects off-provider upload URLs and reads the authoritative post ID header', async () => {
  let requests = 0;
  const unsafe = createProviderClient({
    fetch: async () => {
      requests++;
      return Response.json({
        value: { image: 'urn:li:image:one', uploadUrl: 'https://attacker.example/upload' },
      });
    },
  });
  await assert.rejects(
    () =>
      unsafe.preparePublication(
        'linkedin',
        'urn:li:organization:1',
        current,
        credentials,
        { title, caption },
        [{ bytes: Buffer.from('image') }],
      ),
    (error) => error.code === 'invalid_upload_url',
  );
  assert.equal(requests, 1);
  const adapter = createProviderClient({
    fetch: async (_url, options) => {
      const body = bodyOf(options);
      assert.equal(body.author, 'urn:li:organization:1');
      assert.equal(body.commentary, caption);
      return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:999' } });
    },
  });
  const result = await adapter.publishDirect(
    'linkedin',
    'urn:li:organization:1',
    current,
    credentials,
    { title, caption },
    [],
    null,
  );
  assert.equal(result.id, 'urn:li:share:999');
  assert.match(result.url, /linkedin\.com/);
});

test('YouTube upload uses approved visibility and audience declarations and verifies the exact channel', async () => {
  let requests = 0;
  const bytes = Buffer.from('validated MP4 bytes from private storage');
  const adapter = createProviderClient({
    fetch: async (value, options) => {
      requests++;
      const url = new URL(value);
      if (url.pathname.endsWith('/channels')) return Response.json({ items: [{ id: channel }] });
      if (options.method === 'POST') {
        const body = bodyOf(options);
        assert.equal(body.status.privacyStatus, 'unlisted');
        assert.equal(body.status.selfDeclaredMadeForKids, false);
        assert.equal(body.status.containsSyntheticMedia, true);
        assert.equal(body.snippet.title, title);
        assert.equal(url.searchParams.get('notifySubscribers'), 'false');
        return new Response(null, {
          status: 200,
          headers: {
            location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=test',
          },
        });
      }
      assert.equal(options.method, 'PUT');
      assert.deepEqual(options.body, bytes);
      return Response.json({
        id: 'abcdefghijk',
        snippet: { channelId: channel },
        status: { privacyStatus: 'unlisted', uploadStatus: 'uploaded' },
      });
    },
  });
  const result = await adapter.publishDirect(
    'youtube',
    channel,
    current,
    credentials,
    {
      title,
      caption,
      publicationOptions: {
        youtubePrivacy: 'unlisted',
        madeForKids: false,
        containsSyntheticMedia: true,
      },
    },
    [{ bytes }],
  );
  assert.equal(requests, 3);
  assert.equal(result.visibility, 'unlisted');
  assert.equal(result.id, 'abcdefghijk');
  const wrong = createProviderClient({
    fetch: async () => Response.json({ items: [{ id: 'UCzzzzzzzzzzzzzzzzzzzzzz' }] }),
  });
  await assert.rejects(
    () =>
      wrong.publishDirect('youtube', channel, current, credentials, { title, caption }, [
        { bytes },
      ]),
    (error) => error.code === 'channel_mismatch',
  );
});

test('Reconciliation refuses a foreign Facebook owner and unsupported LinkedIn member read-back', async () => {
  const adapter = createProviderClient({
    fetch: async () =>
      Response.json({
        id: '2_99',
        from: { id: '2' },
        message: caption,
        created_time: now().toISOString(),
      }),
  });
  await assert.rejects(
    () => adapter.publication('facebook', '1', '2_99', current, credentials),
    (error) => error.code === 'publication_not_found',
  );
  await assert.rejects(
    () =>
      adapter.publication(
        'linkedin_member',
        'urn:li:person:abc',
        'urn:li:share:1',
        current,
        credentials,
      ),
    (error) => error.code === 'reconciliation_unavailable',
  );
});

test('expired LinkedIn access refreshes only when the provider supplied a valid refresh token', async () => {
  const adapter = createProviderClient({
    now,
    fetch: async (_url, options) => {
      assert.equal(new URLSearchParams(options.body).get('grant_type'), 'refresh_token');
      return Response.json({ access_token: 'new-access', expires_in: 3600 });
    },
  });
  await assert.rejects(
    () => adapter.refresh(credentials, current, 'linkedin'),
    (error) => error.reauthenticate,
  );
  const updated = await adapter.refresh(
    credentials,
    { ...current, refreshToken: 'old-refresh', refreshExpiresAt: now().getTime() + 86400000 },
    'linkedin',
  );
  assert.equal(updated.accessToken, 'new-access');
  assert.equal(updated.refreshToken, 'old-refresh');
});

test('provider migration preserves legacy IDs and enforces new destination constraints', async (t) => {
  const db = await openDatabase(':memory:', { databaseUrl: '' });
  t.after(() => db.close());
  await db
    .prepare(
      "INSERT INTO users(id,name,email,role,password_hash,active,created_at,updated_at) VALUES ('test_manager','Manager','manager@example.invalid','manager','hash',1,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')",
    )
    .run();
  await db.exec(await readFile(new URL('./fixtures/schema-v1.sql', import.meta.url), 'utf8'));
  await db
    .prepare(
      "INSERT INTO service_connections(id,provider,account_id,account_name,institution,status,encrypted_credentials,connected_by,created_at) VALUES ('legacy','instagram','123','School','St. Mary’s ISC','connected','unchanged-ciphertext','test_manager','2026-11-01T00:00:00Z')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO website_reports(connection_id,report_json,imported_at) VALUES ('legacy','{}','2026-11-01T00:00:00Z')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO posts(id,title,caption,platforms,format,institution,status,language,owner_id,created_at,updated_at,revision,palette) VALUES ('old_post','Retained draft','Retained caption','[\"instagram\"]','Post','St. Mary’s ISC','draft','English','test_manager','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z',1,'violet')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO media_assets(id,name,mime_type,size,sha256,width,height,storage_kind,storage_path,owner_id,created_at) VALUES ('old_image','school.jpg','image/jpeg',3,'hash',400,500,'test','assets/old.jpg','test_manager','2026-11-01T00:00:00Z')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO publication_jobs(id,post_id,revision,connection_id,account_id,account_name,asset_id,approved_payload,payload_hash,status,scheduled_at,created_at,updated_at) VALUES ('old_job','old_post',1,'legacy','123','School','old_image','{}','old-hash','queued','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')",
    )
    .run();
  await migrateExtensions(db, { migrate: true });
  assert.equal(
    (
      await db
        .prepare("SELECT encrypted_credentials FROM service_connections WHERE id='legacy'")
        .get()
    ).encrypted_credentials,
    'unchanged-ciphertext',
  );
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM website_reports').get()).count, 1);
  assert.equal(
    (await db.prepare("SELECT payload_hash FROM publication_jobs WHERE id='old_job'").get())
      .payload_hash,
    'old-hash',
  );
  assert.equal(
    (await db.prepare("SELECT kind FROM media_assets WHERE id='old_image'").get()).kind,
    'image',
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT value FROM workspace_metadata WHERE key='provider_extensions_schema_version'",
        )
        .get()
    ).value,
    '2',
  );
  assert.deepEqual(await db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(
    (await db.prepare('PRAGMA table_info(publication_jobs)').all()).find(
      (column) => column.name === 'asset_id',
    ).notnull,
    0,
  );
  await db.prepare("UPDATE service_connections SET provider='youtube' WHERE id='legacy'").run();
  await assert.rejects(() =>
    db.prepare("UPDATE service_connections SET provider='invented' WHERE id='legacy'").run(),
  );
  await migrateExtensions(db, { migrate: true });
  await migrateExtensions(db, { migrate: false });
});
