import { createHash } from 'node:crypto';
import { HttpError } from '../validation.mjs';
import { publicHttpsUrl } from './safe-fetch.mjs';

const entities = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  bull: '•',
  copy: '©',
  reg: '®',
  ensp: ' ',
  emsp: ' ',
});

// Metadata extraction does not need an executable DOM. A bounded tag scanner
// prevents malformed unclosed elements from causing repeated quadratic scans.
export function* scanTags(source) {
  let cursor = 0;
  let count = 0;
  let lowerSource;
  while (cursor < source.length) {
    const start = source.indexOf('<', cursor);
    if (start < 0) return;
    if (++count > 30000)
      throw new HttpError(
        422,
        'This source contains too much markup for a bounded metadata scan. Use a focused notice page or public feed.',
        'source_markup_limit',
      );
    if (source.startsWith('<!--', start)) {
      const close = source.indexOf('-->', start + 4);
      const end = close < 0 ? source.length : close + 3;
      yield { tag: '#comment', start, end, closing: false, selfClosing: true };
      cursor = end;
      continue;
    }
    if (source.startsWith('<![CDATA[', start)) {
      const close = source.indexOf(']]>', start + 9);
      cursor = close < 0 ? source.length : close + 3;
      continue;
    }
    const matched = source
      .slice(start, start + 100)
      .match(/^<(\/?)([A-Za-z][\w:-]*|!doctype)(?=[\s/>])/i);
    if (!matched) {
      cursor = start + 1;
      continue;
    }
    let index = start + matched[0].length;
    let quote = '';
    for (; index < source.length; index += 1) {
      if (index - start > 16384)
        throw new HttpError(
          422,
          'A source markup tag exceeds the reading limit.',
          'source_markup_limit',
        );
      const char = source[index];
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (index >= source.length) return;
    const tag = matched[2].toLowerCase();
    const end = index + 1;
    yield { tag, start, end, closing: Boolean(matched[1]), selfClosing: source[index - 1] === '/' };
    cursor = end;
    if (!matched[1] && ['script', 'style', 'textarea'].includes(tag)) {
      lowerSource ??= source.toLowerCase();
      const close = lowerSource.indexOf(`</${tag}`, cursor);
      if (close < 0) return;
      cursor = close;
    }
  }
}

export function elements(source, names, limit = 500, includeUnclosed = false) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const result = [];
  let active = null;
  for (const token of scanTags(source)) {
    if (!active) {
      if (!token.closing && !token.selfClosing && wanted.has(token.tag))
        active = { ...token, payload: token.end, level: 1 };
    } else if (token.tag === active.tag) {
      if (!token.closing && !token.selfClosing) active.level += 1;
      else if (token.closing && --active.level === 0) {
        result.push({ ...active, contentEnd: token.start, end: token.end });
        active = null;
        if (result.length >= limit) break;
      }
    }
  }
  if (active && includeUnclosed)
    result.push({ ...active, contentEnd: source.length, end: source.length });
  return result;
}

export function stripSections(source, names) {
  const pieces = [];
  let previous = 0;
  for (const block of elements(source, names, 1000, true)) {
    pieces.push(source.slice(previous, block.start), ' ');
    previous = block.end;
  }
  pieces.push(source.slice(previous));
  return pieces.join('');
}

export function decodeText(value) {
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity.startsWith('#')) {
      const number =
        entity[1].toLowerCase() === 'x'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
        ? String.fromCodePoint(number)
        : '';
    }
    return entities[entity.toLowerCase()] ?? match;
  });
}

export function plainText(value, limit = 2000) {
  const source = stripSections(
    String(value ?? '')
      .replaceAll('<![CDATA[', '')
      .replaceAll(']]>', ''),
    ['script', 'style', 'noscript', 'svg', 'template'],
  );
  const pieces = [];
  let previous = 0;
  for (const token of scanTags(source)) {
    pieces.push(source.slice(previous, token.start), ' ');
    previous = token.end;
  }
  pieces.push(source.slice(previous));
  return decodeText(pieces.join(''))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

export function attributes(tag) {
  const result = {};
  const source = tag.replace(/^<\/?[\w:-]+/, '').replace(/\/?\s*>$/, '');
  const pattern = /([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    const key = match[1].toLowerCase();
    if (key.length <= 100 && !Object.hasOwn(result, key))
      result[key] = decodeText(match[2] ?? match[3] ?? match[4] ?? '').slice(0, 4096);
  }
  return result;
}

export function publicLink(value, base) {
  try {
    const url = new URL(decodeText(value).trim(), base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const checked = new URL(url);
    checked.protocol = 'https:';
    publicHttpsUrl(checked.href);
    url.hash = '';
    for (const key of [...url.searchParams.keys()])
      if (/^utm_/i.test(key) || ['fbclid', 'gclid'].includes(key.toLowerCase()))
        url.searchParams.delete(key);
    return url.href.length <= 2048 ? url.href : null;
  } catch {
    return null;
  }
}

function dateOrNull(value) {
  const text = plainText(value, 100);
  if (!text) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function element(source, names) {
  const found = elements(source, names, 30);
  for (const name of names) {
    const block = found.find((item) => item.tag === name.toLowerCase());
    if (block) return source.slice(block.payload, block.contentEnd);
  }
  return '';
}

function normalizeEntry(entry, keywords = []) {
  const title = plainText(entry.title, 240);
  const excerpt = plainText(entry.excerpt, 320);
  if (!title || !entry.url) return null;
  if (
    keywords.length &&
    !keywords.some((word) =>
      `${title} ${excerpt}`.toLocaleLowerCase().includes(word.toLocaleLowerCase()),
    )
  )
    return null;
  const value = { title, url: entry.url, excerpt, publishedAt: entry.publishedAt ?? null };
  return {
    ...value,
    // A title/description correction updates the same item, rather than
    // appearing as a second announcement. Provider GUIDs are never executed.
    key: createHash('sha256')
      .update(entry.stableId || value.url)
      .digest('hex'),
    hash: createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  };
}

export function parseFeed(document, url, { keywords = [], limit = 80 } = {}) {
  if (/<!DOCTYPE|<!ENTITY/i.test(document))
    throw new HttpError(
      422,
      'XML feeds containing document types or custom entities are not supported.',
      'unsafe_xml',
    );
  if (!/<(?:rss|feed|rdf:RDF)\b/i.test(document))
    throw new HttpError(
      422,
      'This URL did not return a public RSS or Atom feed. Choose HTML notice-page mode or enter the feed URL.',
      'not_a_feed',
    );
  const result = [];
  const seen = new Set();
  for (const block of elements(document, ['item', 'entry'], 500)) {
    const source = document.slice(block.payload, block.contentEnd);
    let link = element(source, ['link']);
    if (!link || /<|>/.test(link)) link = '';
    if (!link) {
      for (const tag of scanTags(source)) {
        if (tag.tag !== 'link' || tag.closing) continue;
        const values = attributes(source.slice(tag.start, tag.end));
        if ((!values.rel || values.rel === 'alternate') && values.href) {
          link = values.href;
          break;
        }
      }
    }
    const videoId = plainText(element(source, ['yt:videoId']), 100);
    if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) link = `https://www.youtube.com/watch?v=${videoId}`;
    const entry = normalizeEntry(
      {
        title: element(source, ['title']),
        url: publicLink(link, url),
        excerpt: element(source, ['description', 'summary', 'media:description', 'content']),
        publishedAt: dateOrNull(element(source, ['published', 'pubDate', 'dc:date'])),
        stableId: videoId || plainText(element(source, ['guid', 'id']), 500),
      },
      keywords,
    );
    if (entry && !seen.has(entry.key)) {
      result.push(entry);
      seen.add(entry.key);
    }
    if (result.length >= limit) break;
  }
  return result;
}

const genericLink =
  /^(?:read\s*more|view(?:\s*\/\s*download)?|download|english|hindi|pdf|click\s*here|accessible\s*version\s*:?\s*view|open|details|more|\d+)\s*(?:\([^)]*\))?$/i;
const boringLink =
  /^(?:home|about(?:\s+us)?|contact(?:\s+us)?|privacy(?:\s+policy)?|terms(?:\s+and\s+conditions)?|login|sign\s*in|logout|skip\s+to|search|menu|sitemap|facebook|instagram|youtube|twitter|linkedin|previous|next|back)\b/i;

export function parseNoticePage(document, url, { keywords = [], limit = 80 } = {}) {
  const source = stripSections(document, [
    'script',
    'style',
    'noscript',
    'svg',
    'template',
    'nav',
    'header',
    'footer',
  ]);
  const candidates = new Map();
  function collect(fragment, context = '') {
    for (const anchor of elements(fragment, ['a'], 1500)) {
      const opening = fragment.slice(anchor.start, anchor.payload);
      const attrs = attributes(opening);
      if (!attrs.href || attrs.href.trim().startsWith('#')) continue;
      const link = publicLink(attrs.href, url);
      if (!link || link === publicLink(url, url)) continue;
      let title =
        plainText(fragment.slice(anchor.payload, anchor.contentEnd), 500) ||
        plainText(attrs.title || attrs['aria-label'], 500);
      if ((!title || genericLink.test(title)) && context) title = context;
      if (!title || genericLink.test(title) || boringLink.test(title)) continue;
      title = title
        .replace(/\b(?:Accessible Version\s*:?|Read More|Click here|File size|New_img)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const likelyNotice =
        /\.pdf(?:[?#]|$)/i.test(link) ||
        /notice|circular|notification|news|update|press|result|exam|seat|admission|counsell|syllabus|question|corrigend|admit|intake|timetable|calendar|ಪ್ರಕಟ|ಪರೀಕ್ಷ|ಪ್ರವೇಶ|ಸೂಚನ/i.test(
          `${title} ${new URL(link).pathname}`,
        );
      if (!likelyNotice || title.length < 8) continue;
      const entry = normalizeEntry({ title, url: link, excerpt: '', publishedAt: null }, keywords);
      if (!entry) continue;
      const previous = candidates.get(entry.key);
      if (
        !previous ||
        (genericLink.test(previous.title) && !genericLink.test(entry.title)) ||
        (previous.title.length < 15 && entry.title.length >= 15)
      )
        candidates.set(entry.key, entry);
      if (candidates.size >= limit * 3) break;
    }
  }
  // Many official boards put the title in a table cell and use only "English"
  // or "View" for the actual document link. Preserve the row's context.
  for (const block of elements(source, ['tr', 'article', 'li'], 500)) {
    const fragment = source.slice(block.payload, block.contentEnd);
    const context = plainText(fragment, 500)
      .replace(/(?:\s*\|\s*)+/g, ' ')
      .trim();
    collect(fragment, context);
    if (candidates.size >= limit * 3) break;
  }
  collect(source);
  return [...candidates.values()].slice(0, limit);
}

export function youtubeFeed(value) {
  let channel = String(value ?? '').trim();
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(channel)) {
    try {
      const url = publicHttpsUrl(channel);
      if (!['youtube.com', 'www.youtube.com'].includes(url.hostname)) throw new Error();
      channel =
        url.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})(?:\/|$)/)?.[1] ||
        (['/feeds/videos.xml', '/xml/feeds/videos.xml'].includes(url.pathname)
          ? url.searchParams.get('channel_id')
          : '') ||
        '';
    } catch {
      channel = '';
    }
  }
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(channel))
    throw new HttpError(
      422,
      'Use the exact YouTube channel ID (UC followed by 22 characters) or its /channel/ URL. A handle alone is not enough for feed monitoring.',
      'youtube_channel_id_required',
    );
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`;
}

export function parseSource(document, url, mode, options) {
  const found =
    mode === 'html' ? parseNoticePage(document, url, options) : parseFeed(document, url, options);
  if (
    mode === 'html' &&
    !found.length &&
    /captcha|cloudflare|access\s+denied|verify\s+(?:you\s+are|that\s+you)|enable\s+javascript/i.test(
      document,
    )
  )
    throw new HttpError(
      409,
      'This source is protected or requires JavaScript. Keep it as a manual source or use a public feed; access challenges are not bypassed.',
      'source_requires_manual_review',
    );
  return found;
}
