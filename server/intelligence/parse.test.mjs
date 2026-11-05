import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, parseNoticePage, youtubeFeed, publicLink } from './parse.mjs';
import { inspectPage } from './seo.mjs';

test('RSS extraction preserves publisher dates, strips markup, filters keywords and keeps correction identity', () => {
  const source = `<rss><channel><item><guid>notice-1</guid><title>NEET seats &amp; counselling</title>
    <link>https://board.example.org/notice.pdf?utm_source=test</link>
    <description><![CDATA[<p>Check the <b>official</b> document.</p><script>bad()</script>]]></description>
    <pubDate>Thu, 05 Nov 2026 08:00:00 +0530</pubDate></item>
    <item><title>Unrelated recruitment</title><link>https://board.example.org/jobs</link></item></channel></rss>`;
  const [entry] = parseFeed(source, 'https://board.example.org/feed', { keywords: ['NEET'] });
  assert.equal(entry.title, 'NEET seats & counselling');
  assert.equal(entry.url, 'https://board.example.org/notice.pdf');
  assert.equal(entry.publishedAt, '2026-11-05T02:30:00.000Z');
  assert.equal(entry.excerpt, 'Check the official document.');
  const [corrected] = parseFeed(
    source.replace('NEET seats &amp; counselling', 'NEET revised seats'),
    'https://board.example.org/feed',
    { keywords: ['NEET'] },
  );
  assert.equal(corrected.key, entry.key);
  assert.notEqual(corrected.hash, entry.hash);
});

test('Atom channel feed and HTML table notices produce source links without fabricated publication dates', () => {
  const feed = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>yt:video:abcdefghijk</id>
    <yt:videoId>abcdefghijk</yt:videoId><title>School admissions Q&amp;A</title>
    <link rel="alternate" href="http://www.youtube.com/watch?v=abcdefghijk"/>
    <published>2026-11-04T10:00:00Z</published></entry></feed>`;
  assert.equal(
    parseFeed(feed, 'https://www.youtube.com/feeds/videos.xml')[0].url,
    'https://www.youtube.com/watch?v=abcdefghijk',
  );
  const html = `<nav><a href="/exam-menu">Examination menu</a></nav><table><tr><td>05/11/2026</td>
    <td>Board examination timetable correction</td><td><a href="/documents/revised.pdf">ENGLISH</a></td></tr></table>
    <a href="javascript:alert(1)">Another important examination notice</a>`;
  const notices = parseNoticePage(html, 'https://board.example.org/notices');
  assert.equal(notices.length, 1);
  assert.match(notices[0].title, /Board examination timetable correction/);
  assert.equal(
    notices[0].publishedAt,
    null,
    'A row date is not automatically claimed as the publication date.',
  );
});

test('external XML entities and deceptive YouTube channel URLs are rejected', () => {
  assert.throws(
    () =>
      parseFeed(
        '<!DOCTYPE rss [<!ENTITY a SYSTEM "file:///etc/passwd">]><rss/>',
        'https://example.org/feed',
      ),
    { code: 'unsafe_xml' },
  );
  const channel = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
  assert.equal(
    youtubeFeed(channel),
    `https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`,
  );
  assert.equal(
    youtubeFeed(`https://www.youtube.com/channel/${channel}/videos`),
    youtubeFeed(channel),
  );
  for (const invalid of [
    'https://www.youtube.com/@handle',
    `https://youtube.com.evil.example.org/channel/${channel}`,
    'https://127.0.0.1/',
  ])
    assert.throws(() => youtubeFeed(invalid), { code: 'youtube_channel_id_required' });
  assert.equal(publicLink('javascript:alert(1)', 'https://example.org/'), null);
  assert.equal(publicLink('https://user:secret@example.org/', 'https://example.org/'), null);
});

test('malformed or excessive markup is bounded and script/comment links are never treated as notices', () => {
  assert.deepEqual(
    parseFeed(`<rss>${'<item>'.repeat(5000)}</rss>`, 'https://example.org/feed'),
    [],
  );
  assert.throws(
    () => parseFeed(`<rss>${'<item>'.repeat(30001)}</rss>`, 'https://example.org/feed'),
    { code: 'source_markup_limit' },
  );
  assert.deepEqual(
    parseNoticePage(
      '<script>const fake = "<a href=\"https://example.org/exam.pdf\">Fake examination notice</a>";</script><!-- <a href="/exam.pdf">Another exam notice</a> -->',
      'https://example.org/',
    ),
    [],
  );
});

test('SEO report distinguishes HTML evidence from indexing/ranking claims and accepts decorative empty alt', () => {
  const report = inspectPage(
    {
      status: 200,
      url: 'https://school.example.org/admissions',
      robotsState: 'checked',
      headers: { 'x-robots-tag': 'noindex' },
      text: `<html lang="en"><head><title>Admissions at the school</title>
      <meta name="description" content="Admissions information"><meta name="viewport" content="width=device-width">
      <link rel="canonical" href="/admissions"><script type="application/ld+json">{"@context":"https://schema.org","@type":"School","name":"Example"}</script>
      </head><body><h1>Admissions</h1><h2>How to apply</h2><img src="a.jpg" alt=""><img src="b.jpg">
      <a href="/contact">Contact us</a><a href="https://board.example.org/">Board</a></body></html>`,
    },
    {
      id: 'audit',
      siteId: 'site',
      url: 'https://school.example.org/admissions',
      checkedAt: '2026-11-05T00:00:00Z',
    },
  );
  assert.equal(report.imagesWithoutAlt, 1);
  assert.equal(report.canonical, 'https://school.example.org/admissions');
  assert.deepEqual(report.structuredDataTypes, ['School']);
  assert.equal(report.internalLinkCount, 1);
  assert.equal(report.externalLinkCount, 1);
  assert.equal(report.findings.find((item) => item.id === 'indexing').severity, 'warning');
  assert.equal(Object.hasOwn(report, 'score'), false);
});
