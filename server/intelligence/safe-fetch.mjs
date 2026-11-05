import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import { HttpError } from '../validation.mjs';

export const READER_AGENT = 'StMarysIntelligence/1.0';
export const MAX_DOCUMENT_BYTES = 1024 * 1024;
const rejectedNames = /(?:^|\.)(?:localhost|local|internal|test|invalid|example|home\.arpa)$/i;

export function publicHttpsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(422, 'Use a complete public HTTPS URL.', 'invalid_public_url');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    isIP(hostname.replace(/^\[|\]$/g, '')) ||
    !hostname.includes('.') ||
    rejectedNames.test(hostname) ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      hostname,
    ) ||
    url.href.length > 2048
  )
    throw new HttpError(
      422,
      'Use a public HTTPS hostname on its standard port, without credentials. Local and private network addresses cannot be monitored.',
      'invalid_public_url',
    );
  url.hostname = hostname;
  url.hash = '';
  return url;
}

// Conservative public-unicast allowlist. Reject mapped, transition, local,
// multicast, documentation, benchmark and other special-purpose ranges.
export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (family === 6) {
    const value = address.toLowerCase();
    const first = parseInt(value.split(':')[0], 16);
    const second = parseInt(value.split(':')[1] || '0', 16);
    return (
      first >= 0x2000 &&
      first <= 0x3fff &&
      !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8)) &&
      first !== 0x2002 &&
      first !== 0x3fff
    );
  }
  return false;
}

function bounded(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new HttpError(504, message, 'source_timeout')), milliseconds);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

export function createSafeReader({ lookup = dnsLookup, request = httpsRequest } = {}) {
  async function resolve(url) {
    let addresses;
    try {
      addresses = await bounded(
        lookup(url.hostname, { all: true, verbatim: true }),
        3000,
        'The source hostname did not respond in time.',
      );
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'The source hostname could not be resolved.', 'source_dns_failed');
    }
    if (
      !Array.isArray(addresses) ||
      !addresses.length ||
      addresses.some((item) => !isPublicAddress(item.address))
    )
      throw new HttpError(
        422,
        'The source resolves to a private or reserved network address and cannot be fetched.',
        'private_network_blocked',
      );
    return addresses.find((item) => item.family === 4) ?? addresses[0];
  }

  async function one(url, { maxBytes, timeoutMs }) {
    const address = await resolve(url);
    return new Promise((resolveResult, reject) => {
      let finished = false;
      let deadline;
      let req;
      let incoming;
      const controller = new AbortController();
      const finish = (error, value) => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        if (error) {
          // The same deadline covers receiving and decoding. Aborting the
          // pipeline also destroys its decoder, including on expansion limits.
          controller.abort();
          incoming?.destroy();
          req?.destroy();
        }
        error ? reject(error) : resolveResult(value);
      };
      try {
        req = request(
          url,
          {
            method: 'GET',
            agent: false,
            family: address.family,
            autoSelectFamily: false,
            servername: url.hostname,
            rejectUnauthorized: true,
            maxHeaderSize: 16384,
            headers: {
              'User-Agent': READER_AGENT,
              Accept:
                'text/html, application/atom+xml, application/rss+xml, application/xml, text/xml, text/plain;q=0.8',
              'Accept-Encoding': 'gzip, deflate, br',
              Connection: 'close',
            },
            // Pin the checked address to the socket. A later DNS answer cannot
            // redirect this request to an internal host (DNS rebinding).
            lookup: (_name, opts, callback) => {
              if (typeof opts === 'function') callback = opts;
              if (opts?.all) callback(null, [address]);
              else callback(null, address.address, address.family);
            },
          },
          (response) => {
            incoming = response;
            if (finished) {
              response.destroy();
              return;
            }
            const headers = Object.fromEntries(
              Object.entries(response.headers).map(([name, value]) => [
                name.toLowerCase(),
                Array.isArray(value) ? value.join(', ') : String(value ?? ''),
              ]),
            );
            const status = response.statusCode ?? 0;
            if ([301, 302, 303, 307, 308].includes(status)) {
              finish(null, { status, headers, text: '', url: url.href });
              response.destroy();
              return;
            }
            if (Number(headers['content-length']) > maxBytes) {
              finish(
                new HttpError(
                  422,
                  'The source document exceeds the 1 MiB reading limit.',
                  'source_too_large',
                ),
              );
              response.destroy();
              return;
            }
            const encoding = (headers['content-encoding'] || 'identity').trim().toLowerCase();
            const decoders = {
              gzip: createGunzip,
              deflate: createInflate,
              br: createBrotliDecompress,
            };
            // Stacked or unknown encodings are not guessed. Each supported
            // document is decoded once, through independently bounded streams.
            if (encoding !== 'identity' && !Object.hasOwn(decoders, encoding)) {
              finish(
                new HttpError(
                  422,
                  'The source uses an unsupported document encoding. Use its public feed or check it manually.',
                  'unsupported_encoding',
                ),
              );
              response.destroy();
              return;
            }
            let encodedLength = 0;
            let decodedLength = 0;
            const chunks = [];
            const tooLarge = () =>
              new HttpError(
                422,
                'The source document exceeds the reading limit (at most 1 MiB before or after decompression).',
                'source_too_large',
              );
            const encodedLimit = new Transform({
              transform(chunk, _encoding, callback) {
                encodedLength += chunk.length;
                if (encodedLength > maxBytes) callback(tooLarge());
                else callback(null, chunk);
              },
            });
            const collected = new Writable({
              write(chunk, _encoding, callback) {
                decodedLength += chunk.length;
                if (decodedLength > maxBytes) callback(tooLarge());
                else {
                  chunks.push(chunk);
                  callback();
                }
              },
            });
            const decoder = encoding === 'identity' ? null : decoders[encoding]();
            let decoderFailure;
            decoder?.on('error', (error) => {
              decoderFailure = error;
            });
            pipeline(response, encodedLimit, ...(decoder ? [decoder] : []), collected, {
              signal: controller.signal,
            }).then(
              () =>
                finish(null, {
                  status,
                  headers,
                  text: Buffer.concat(chunks, decodedLength).toString('utf8'),
                  url: url.href,
                }),
              (error) =>
                finish(
                  error instanceof HttpError
                    ? error
                    : new HttpError(
                        502,
                        decoderFailure === error
                          ? 'The source returned an invalid or incomplete compressed document.'
                          : 'The source closed the connection before its document was complete.',
                        decoderFailure === error ? 'source_decode_failed' : 'source_read_failed',
                      ),
                ),
            );
          },
        );
        req.on('error', () =>
          finish(
            new HttpError(
              502,
              'The source could not be read securely. Check the URL or try again later.',
              'source_fetch_failed',
            ),
          ),
        );
        deadline = setTimeout(() => {
          finish(
            new HttpError(
              504,
              'The source did not respond in time. Try again later.',
              'source_timeout',
            ),
          );
          req.destroy();
        }, timeoutMs);
        deadline.unref?.();
        req.end();
      } catch {
        finish(new HttpError(502, 'The source could not be read securely.', 'source_fetch_failed'));
        req?.destroy();
      }
    });
  }

  return async function read(value, options = {}) {
    const maxBytes = Math.min(options.maxBytes ?? MAX_DOCUMENT_BYTES, MAX_DOCUMENT_BYTES);
    const startedAt = Date.now();
    let current = publicHttpsUrl(value);
    const initialOrigin = current.origin;
    for (let hop = 0; hop <= 3; hop += 1) {
      const remaining = (options.totalTimeoutMs ?? 16000) - (Date.now() - startedAt);
      if (remaining <= 0)
        throw new HttpError(504, 'The source did not respond in time.', 'source_timeout');
      if (options.sameOrigin && current.origin !== initialOrigin)
        throw new HttpError(
          422,
          'This check cannot redirect to a different website origin.',
          'cross_origin_redirect',
        );
      await options.beforeRequest?.(current);
      const result = await one(current, { maxBytes, timeoutMs: Math.min(8000, remaining) });
      if (![301, 302, 303, 307, 308].includes(result.status)) return result;
      if (!result.headers.location)
        throw new HttpError(
          502,
          'The source returned an incomplete redirect.',
          'invalid_source_redirect',
        );
      current = publicHttpsUrl(new URL(result.headers.location, current).href);
    }
    throw new HttpError(502, 'The source redirected too many times.', 'too_many_redirects');
  };
}

function ruleMatches(path, pattern) {
  if (!pattern) return false;
  const end = pattern.endsWith('$');
  const raw = end ? pattern.slice(0, -1) : pattern;
  // Ordered literal segments avoid building a potentially exponential regex
  // from an untrusted robots file containing many wildcard characters.
  const parts = raw.split('*');
  if (!path.startsWith(parts[0])) return false;
  let cursor = parts[0].length;
  for (let index = 1; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) continue;
    if (end && index === parts.length - 1) {
      const start = path.length - part.length;
      return start >= cursor && path.endsWith(part);
    }
    const next = path.indexOf(part, cursor);
    if (next < 0) return false;
    cursor = next + part.length;
  }
  return !end || raw.endsWith('*') || cursor === path.length;
}

export function robotsAllows(document, url) {
  const groups = [];
  let current = null;
  let seenRule = false;
  for (const raw of document.split(/\r?\n/).slice(0, 10000)) {
    const line = raw.split('#')[0].trim();
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === 'user-agent') {
      if (!current || seenRule) {
        current = { agents: [], rules: [] };
        groups.push(current);
        seenRule = false;
      }
      current.agents.push(value.toLowerCase());
    } else if (current && ['allow', 'disallow'].includes(key)) {
      current.rules.push({ allow: key === 'allow', value });
      seenRule = true;
    }
  }
  const specificityOf = (group) =>
    Math.max(
      0,
      ...group.agents.map((agent) =>
        agent !== '*' && 'stmarysintelligence'.startsWith(agent) ? agent.length : 0,
      ),
    );
  const specificity = Math.max(0, ...groups.map(specificityOf));
  const specific = specificity
    ? groups.filter((group) => specificityOf(group) === specificity)
    : [];
  const chosen = specific.length ? specific : groups.filter((group) => group.agents.includes('*'));
  const target = new URL(url);
  const rawPath = `${target.pathname}${target.search}`;
  let decodedPath = rawPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    /* Keep malformed escapes literal. */
  }
  return [rawPath, decodedPath].every((path) => {
    let best = { specificity: -1, allow: true };
    for (const rule of chosen.flatMap((group) => group.rules)) {
      if (ruleMatches(path, rule.value)) {
        const specificity = rule.value.replace(/[\*$]/g, '').length;
        if (specificity > best.specificity || (specificity === best.specificity && rule.allow))
          best = { specificity, allow: rule.allow };
      }
    }
    return best.allow;
  });
}

export function createRobotsReader(read) {
  // Each worker/run has a small in-memory cache, never an unbounded global map.
  const cache = new Map();
  async function check(url) {
    let robots = cache.get(url.origin);
    if (!robots) {
      const result = await read(`${url.origin}/robots.txt`, {
        maxBytes: 128 * 1024,
        totalTimeoutMs: 8000,
      });
      if (result.status === 404 || result.status === 410) robots = { text: '', state: 'not_found' };
      else if (result.status >= 200 && result.status < 300)
        robots = { text: result.text, state: 'checked' };
      else
        throw new HttpError(
          409,
          'The source’s robots.txt could not be checked. The automatic check has been deferred; use the original source manually.',
          'robots_unavailable',
        );
      if (cache.size >= 8) cache.clear();
      cache.set(url.origin, robots);
    }
    if (!robotsAllows(robots.text, url.href))
      throw new HttpError(
        409,
        'This source does not allow automated access to that page in robots.txt. Keep it as a manual source or use an allowed public feed.',
        'robots_blocked',
      );
    return robots.state;
  }
  return async (url, options = {}) => {
    let robotsState = 'checked';
    // The real reader rechecks every redirect before requesting it. The initial
    // check also makes this behavior explicit for deterministic injected readers.
    robotsState = await check(publicHttpsUrl(url));
    const result = await read(url, {
      ...options,
      beforeRequest: async (next) => {
        robotsState = await check(next);
        await options.beforeRequest?.(next);
      },
    });
    return { ...result, robotsState };
  };
}
