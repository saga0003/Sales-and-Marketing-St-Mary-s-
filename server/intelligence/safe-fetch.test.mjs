import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
import {
  MAX_DOCUMENT_BYTES,
  publicHttpsUrl,
  isPublicAddress,
  createSafeReader,
  robotsAllows,
  createRobotsReader,
} from './safe-fetch.mjs';

function transport(responses, calls) {
  return (url, options, callback) => {
    const call = { url: url.href, options };
    calls.push(call);
    const request = new EventEmitter();
    let response;
    request.end = () =>
      queueMicrotask(() => {
        const value = responses.shift();
        if (value instanceof Error) return request.emit('error', value);
        response =
          value.stream ??
          Readable.from(value.chunks ?? [value.bytes ?? Buffer.from(value.text || '')]);
        call.response = response;
        response.statusCode = value.status ?? 200;
        response.headers = value.headers ?? { 'content-type': 'text/html' };
        callback(response);
      });
    request.destroy = () => {
      call.destroyed = true;
      response?.destroy();
    };
    return request;
  };
}

test('public reader rejects credentials, private literals, ports and non-HTTPS before network access', () => {
  for (const value of [
    'http://example.org/',
    'https://user:password@example.org/',
    'https://example.org:444/',
    'https://localhost/',
    'https://127.0.0.1/',
    'https://2130706433/',
    'https://0x7f000001/',
    'https://[::1]/',
    'https://metadata.google.internal/',
    'https://printer.local/',
    'file:///etc/passwd',
    'https://example.org@127.0.0.1/',
  ])
    assert.throws(() => publicHttpsUrl(value), { code: 'invalid_public_url' });
  assert.equal(publicHttpsUrl('https://EXAMPLE.org./news#top').href, 'https://example.org/news');
});

test('public address filter rejects IPv4/IPv6 local, mapped, transition and reserved networks', () => {
  for (const address of [
    '127.0.0.1',
    '10.1.1.1',
    '169.254.169.254',
    '100.64.1.1',
    '172.31.1.1',
    '192.168.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '198.18.0.2',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '::1',
    '::',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
    '2001:db8::1',
    '2001::1234',
    '2001:0000:abcd::1',
    '2002:7f00:1::1',
    '3fff::1',
  ])
    assert.equal(isPublicAddress(address), false, address);
  for (const address of [
    '93.184.216.34',
    '8.8.8.8',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
  ])
    assert.equal(isPublicAddress(address), true, address);
});

test('a checked public DNS address is pinned to the socket and TLS hostname checks remain enabled', async () => {
  const calls = [];
  let lookupCalls = 0;
  const read = createSafeReader({
    lookup: async () => {
      lookupCalls += 1;
      return [{ address: '93.184.216.34', family: 4 }];
    },
    request: transport([{ text: '<html>Public document</html>' }], calls),
  });
  const result = await read('https://public.example.org/news');
  assert.match(result.text, /Public document/);
  assert.equal(lookupCalls, 1);
  assert.equal(calls[0].options.rejectUnauthorized, true);
  assert.equal(calls[0].options.servername, 'public.example.org');
  assert.equal(calls[0].options.agent, false);
  calls[0].options.lookup('public.example.org', {}, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, '93.184.216.34');
    assert.equal(family, 4);
  });
  assert.equal(lookupCalls, 1, 'Socket connection must not resolve a second DNS answer.');
});

test('mixed public/private DNS answers and redirects to internal hosts are blocked', async () => {
  let contacted = false;
  const mixed = createSafeReader({
    lookup: async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.2', family: 4 },
    ],
    request: () => {
      contacted = true;
    },
  });
  await assert.rejects(() => mixed('https://public.example.org/'), {
    code: 'private_network_blocked',
  });
  assert.equal(contacted, false);
  const calls = [];
  const redirect = createSafeReader({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: transport(
      [{ status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data/' } }],
      calls,
    ),
  });
  await assert.rejects(() => redirect('https://public.example.org/'), {
    code: 'invalid_public_url',
  });
  assert.equal(calls.length, 1);
});

test('reader bounds received bytes, refuses unknown/stacked encoding, and sanitizes transport errors', async () => {
  const make = (response) =>
    createSafeReader({
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      request: transport([response], []),
    });
  await assert.rejects(
    () => make({ text: 'a'.repeat(300) })('https://example.org/', { maxBytes: 200 }),
    { code: 'source_too_large' },
  );
  await assert.rejects(
    () => make({ headers: { 'content-length': '2000000' } })('https://example.org/'),
    { code: 'source_too_large' },
  );
  await assert.rejects(
    () =>
      make({ headers: { 'content-encoding': 'compress' }, text: 'data' })('https://example.org/'),
    { code: 'unsupported_encoding' },
  );
  await assert.rejects(
    () =>
      make({ headers: { 'content-encoding': 'gzip, br' }, text: 'data' })('https://example.org/'),
    { code: 'unsupported_encoding' },
  );
  await assert.rejects(
    () => make(new Error('secret-token-in-a-network-error'))('https://example.org/'),
    (error) => error.code === 'source_fetch_failed' && !error.message.includes('secret-token'),
  );
});

const compressions = [
  ['gzip', gzipSync],
  ['deflate', deflateSync],
  ['br', brotliCompressSync],
];

test('reader decodes chunked gzip, deflate and Brotli public documents within both byte limits', async () => {
  const expected = '<html><a href="/notice.pdf">Official examination notice — ಕನ್ನಡ</a></html>';
  for (const [encoding, compress] of compressions) {
    const bytes = compress(Buffer.from(expected));
    const calls = [];
    const read = createSafeReader({
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      request: transport(
        [
          {
            headers: {
              'content-encoding': ` ${encoding.toUpperCase()} `,
              'content-length': String(bytes.length),
            },
            chunks: [bytes.subarray(0, 4), bytes.subarray(4, 19), bytes.subarray(19)],
          },
        ],
        calls,
      ),
    });
    const result = await read('https://official.example.org/notices');
    assert.equal(result.text, expected, encoding);
    assert.equal(result.status, 200);
    assert.equal(result.url, 'https://official.example.org/notices');
    assert.equal(calls[0].options.headers['Accept-Encoding'], 'gzip, deflate, br');
    assert.equal(calls[0].options.rejectUnauthorized, true);
  }
});

test('each compression decoder rejects expansion past 1 MiB and destroys the request', async () => {
  const expanded = Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 'a');
  for (const [encoding, compress] of compressions) {
    const bytes = compress(expanded);
    assert.ok(bytes.length < MAX_DOCUMENT_BYTES, 'Fixture must be small on the wire.');
    const calls = [];
    const read = createSafeReader({
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      request: transport([{ headers: { 'content-encoding': encoding }, bytes }], calls),
    });
    await assert.rejects(() => read('https://official.example.org/notices'), {
      code: 'source_too_large',
    });
    assert.equal(calls[0].destroyed, true, encoding);
    assert.equal(calls[0].response.destroyed, true, encoding);
  }
});

test('compressed wire bytes are limited independently of decoded size and declared length', async () => {
  // Concatenated valid empty gzip members expand to zero bytes but still consume
  // the encoded budget. The deliberately false header must not bypass counting.
  const bytes = Buffer.concat(Array.from({ length: 4 }, () => gzipSync(Buffer.alloc(0))));
  const calls = [];
  const read = createSafeReader({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: transport(
      [
        {
          headers: { 'content-encoding': 'gzip', 'content-length': '1' },
          chunks: [bytes.subarray(0, 40), bytes.subarray(40)],
        },
      ],
      calls,
    ),
  });
  await assert.rejects(() => read('https://official.example.org/notices', { maxBytes: 64 }), {
    code: 'source_too_large',
  });
  assert.equal(calls[0].destroyed, true);
});

test('a decoded document exactly at its limit succeeds; truncated compression fails safely', async () => {
  const expected = Buffer.alloc(1024, 'a');
  for (const [encoding, compress] of compressions) {
    const bytes = compress(expected);
    const read = createSafeReader({
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      request: transport(
        [
          { headers: { 'content-encoding': encoding }, bytes },
          {
            headers: { 'content-encoding': encoding },
            bytes: bytes.subarray(0, Math.floor(bytes.length / 2)),
          },
        ],
        [],
      ),
    });
    assert.equal(
      (await read('https://official.example.org/notices', { maxBytes: 1024 })).text,
      expected.toString(),
    );
    await assert.rejects(
      () => read('https://official.example.org/notices'),
      (error) => {
        assert.equal(error.code, 'source_decode_failed');
        assert.doesNotMatch(error.message, /Z_BUF_ERROR|Z_DATA_ERROR|BROTLI|stack/i);
        return true;
      },
    );
  }
});

test('the source deadline aborts a compressed stream that never finishes', async () => {
  let sent = false;
  const stream = new Readable({
    read() {
      if (!sent) {
        sent = true;
        this.push(gzipSync(Buffer.from('notice')));
      }
    },
  });
  const calls = [];
  const read = createSafeReader({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: transport([{ headers: { 'content-encoding': 'gzip' }, stream }], calls),
  });
  // The real socket keeps the process alive; this fixture has no socket handle.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(
      () => read('https://official.example.org/notices', { totalTimeoutMs: 20 }),
      { code: 'source_timeout' },
    );
    assert.equal(calls[0].destroyed, true);
    assert.equal(stream.destroyed, true);
  } finally {
    clearInterval(keepAlive);
  }
});

test('compressed robots rules still prevent requesting a disallowed source', async () => {
  const calls = [];
  const read = createSafeReader({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: transport(
      [
        {
          headers: { 'content-encoding': 'br' },
          bytes: brotliCompressSync(Buffer.from('User-agent: *\nDisallow: /blocked')),
        },
      ],
      calls,
    ),
  });
  await assert.rejects(() => createRobotsReader(read)('https://official.example.org/blocked'), {
    code: 'robots_blocked',
  });
  assert.deepEqual(
    calls.map((call) => call.url),
    ['https://official.example.org/robots.txt'],
  );
});

test('robots rules honor most specific agent, longest paths, allow ties, wildcards and encoded paths', () => {
  const rules = 'User-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow: /*.pdf$\n';
  assert.equal(robotsAllows(rules, 'https://example.org/public'), true);
  assert.equal(robotsAllows(rules, 'https://example.org/private/page'), false);
  assert.equal(robotsAllows(rules, 'https://example.org/%70rivate/page'), false);
  assert.equal(robotsAllows(rules, 'https://example.org/private/open/page'), true);
  assert.equal(robotsAllows(rules, 'https://example.org/notice.pdf'), false);
  assert.equal(robotsAllows(rules, 'https://example.org/notice.pdf?download=1'), true);
  assert.equal(
    robotsAllows('User-agent: *\nDisallow: /\nAllow: /\n', 'https://example.org/'),
    true,
  );
  assert.equal(
    robotsAllows(
      'User-agent: *\nDisallow: /\nUser-agent: StMarys\nDisallow: /\nUser-agent: StMarysIntelligence\nAllow: /\n',
      'https://example.org/',
    ),
    true,
  );
});

test('robots fetch errors defer source access and disallowed pages are never requested', async () => {
  const calls = [];
  const read = async (url) => {
    calls.push(url);
    return { status: 200, text: 'User-agent: *\nDisallow: /blocked', headers: {}, url };
  };
  await assert.rejects(() => createRobotsReader(read)('https://example.org/blocked'), {
    code: 'robots_blocked',
  });
  assert.deepEqual(calls, ['https://example.org/robots.txt']);
  await assert.rejects(
    () =>
      createRobotsReader(async (url) => ({ status: 503, text: '', headers: {}, url }))(
        'https://example.org/feed',
      ),
    { code: 'robots_unavailable' },
  );
});
