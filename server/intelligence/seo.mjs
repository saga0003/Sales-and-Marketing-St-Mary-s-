import { attributes, plainText, publicLink, scanTags, elements, stripSections } from './parse.mjs';

function collectTypes(value, types, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 15) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 100)) collectTypes(item, types, depth + 1);
    return;
  }
  const ownTypes = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
  for (const type of ownTypes) if (typeof type === 'string' && type.length <= 120) types.add(type);
  for (const child of Object.values(value).slice(0, 100)) collectTypes(child, types, depth + 1);
}

export function inspectPage(result, { id, siteId, url, checkedAt }) {
  const html = result.text;
  const tags = [...scanTags(html)].filter((tag) => !tag.closing);
  const meta = new Map();
  for (const tag of tags.filter((item) => item.tag === 'meta')) {
    const value = attributes(html.slice(tag.start, tag.end));
    const key = (value.name || value.property || '').toLowerCase();
    if (key && !meta.has(key)) meta.set(key, value.content || '');
  }
  const titles = elements(html, ['title'], 10);
  const title = plainText(
    titles.length ? html.slice(titles[0].payload, titles[0].contentEnd) : '',
    500,
  );
  const description = plainText(meta.get('description') || '', 1000);
  let canonical = null;
  let canonicalCount = 0;
  let invalidCanonical = false;
  for (const tag of tags.filter((item) => item.tag === 'link')) {
    const value = attributes(html.slice(tag.start, tag.end));
    if ((value.rel || '').toLowerCase().split(/\s+/).includes('canonical')) {
      canonicalCount += 1;
      const link = publicLink(value.href || '', result.url);
      if (!value.href || !link) invalidCanonical = true;
      if (!canonical) canonical = link;
    }
  }
  const visible = stripSections(html, ['script', 'style', 'noscript', 'svg', 'template']);
  const visibleTags = [...scanTags(visible)].filter((tag) => !tag.closing);
  const headings = elements(visible, ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'], 100).map((heading) => ({
    level: Number(heading.tag[1]),
    text: plainText(visible.slice(heading.payload, heading.contentEnd), 300),
  }));
  const images = visibleTags
    .filter((tag) => tag.tag === 'img')
    .map((tag) => attributes(visible.slice(tag.start, tag.end)));
  const imagesWithoutAlt = images.filter((image) => !Object.hasOwn(image, 'alt')).length;
  const types = new Set();
  let invalidStructuredData = 0;
  let jsonLdCount = 0;
  for (const block of elements(html, ['script'], 100)) {
    if (jsonLdCount >= 20) break;
    const attrs = attributes(html.slice(block.start, block.payload));
    if ((attrs.type || '').toLowerCase() !== 'application/ld+json') continue;
    jsonLdCount += 1;
    try {
      if (block.contentEnd - block.payload > 100000) throw new Error();
      collectTypes(JSON.parse(html.slice(block.payload, block.contentEnd)), types);
    } catch {
      invalidStructuredData += 1;
    }
  }
  const links = new Set();
  let internalLinkCount = 0;
  let externalLinkCount = 0;
  for (const tag of visibleTags.filter((item) => item.tag === 'a')) {
    const attrs = attributes(visible.slice(tag.start, tag.end));
    const link = attrs.href ? publicLink(attrs.href, result.url) : null;
    if (!link || links.has(link)) continue;
    links.add(link);
    if (new URL(link).origin === new URL(result.url).origin) internalLinkCount += 1;
    else externalLinkCount += 1;
  }
  const robots = [meta.get('robots'), meta.get('googlebot'), result.headers?.['x-robots-tag']]
    .filter(Boolean)
    .join('; ')
    .slice(0, 2000);
  const findings = [];
  const add = (id, severity, title, detail) => findings.push({ id, severity, title, detail });
  if (result.status === 200)
    add(
      'http-status',
      'pass',
      'Page returns HTTP 200',
      'The HTML page was reachable during this check.',
    );
  else
    add(
      'http-status',
      'issue',
      `Page returns HTTP ${result.status}`,
      'Review this response before expecting the page to be indexed.',
    );
  if (!title)
    add(
      'title',
      'issue',
      'Add a descriptive page title',
      'The fetched HTML did not contain a usable <title>. Describe the page and school clearly.',
    );
  else if (titles.length > 1)
    add(
      'title',
      'warning',
      'More than one title element',
      'Keep one clear <title> in the page head.',
    );
  else
    add(
      'title',
      'pass',
      'Page title found',
      `${title.length} characters. Review whether the wording matches the page; character count is not a ranking rule.`,
    );
  if (!description)
    add(
      'description',
      'warning',
      'Write a useful meta description',
      'No meta description was found. A concise, accurate description can help explain this page in search previews; Google may choose other text.',
    );
  else
    add(
      'description',
      'pass',
      'Meta description found',
      `${description.length} characters. Preview the wording and make sure it describes this page accurately.`,
    );
  if (invalidCanonical || canonicalCount > 1)
    add(
      'canonical',
      'issue',
      'Review the canonical declaration',
      'The page has an invalid canonical URL or multiple canonical declarations.',
    );
  else if (!canonical)
    add(
      'canonical',
      'warning',
      'No canonical declaration found',
      'Review duplicate URLs and decide whether this page needs an explicit preferred URL. Absence alone does not prove an indexing problem.',
    );
  else
    add(
      'canonical',
      new URL(canonical).origin === new URL(url).origin ? 'pass' : 'warning',
      'Canonical URL found',
      canonical,
    );
  const primary = headings.filter((item) => item.level === 1);
  if (!primary.length)
    add(
      'headings',
      'warning',
      'Clarify the main page heading',
      'No H1 was found in the returned HTML. Give readers a clear page heading and a meaningful heading order.',
    );
  else if (primary.length > 1)
    add(
      'headings',
      'info',
      'Review the heading structure',
      `${primary.length} H1 headings were found. Check the outline for clarity; multiple H1s alone do not prove a search penalty.`,
    );
  else
    add(
      'headings',
      'pass',
      'Main heading found',
      primary[0].text || 'The H1 is empty; review its visible text.',
    );
  if (imagesWithoutAlt)
    add(
      'image-alt',
      'warning',
      'Some images have no alt attribute',
      `${imagesWithoutAlt} of ${images.length} image elements omit alt. Describe meaningful images; decorative images can use an empty alt attribute.`,
    );
  else
    add(
      'image-alt',
      'pass',
      'Image alt attributes checked',
      images.length
        ? `All ${images.length} image elements have an alt attribute. Review its quality manually.`
        : 'No image elements were present in the returned HTML.',
    );
  if (/\b(?:noindex|none)\b/i.test(robots))
    add(
      'indexing',
      'warning',
      'The page requests no indexing',
      'A robots meta tag or X-Robots-Tag includes noindex/none. Keep it if intentional; remove it only when the page should appear in search.',
    );
  else
    add(
      'indexing',
      'pass',
      'No explicit noindex directive found',
      'This checks the returned HTML and response headers only. It does not prove that Google has indexed the page.',
    );
  if (invalidStructuredData)
    add(
      'structured-data',
      'issue',
      'Repair invalid JSON-LD',
      `${invalidStructuredData} structured-data script(s) could not be parsed. Validate them and make sure the facts match the visible page.`,
    );
  else if (types.size)
    add(
      'structured-data',
      'info',
      'Structured-data types found',
      [...types].join(', ') + '. Presence is not validation or eligibility for a rich result.',
    );
  else
    add(
      'structured-data',
      'info',
      'No JSON-LD types found',
      'Add relevant structured data only when it describes the visible content. There is no special schema required for AI Overviews or AI Mode.',
    );
  const htmlTag = tags.find((tag) => tag.tag === 'html');
  const htmlAttrs = attributes(htmlTag ? html.slice(htmlTag.start, htmlTag.end) : '<html>');
  add(
    'language',
    htmlAttrs.lang ? 'pass' : 'warning',
    htmlAttrs.lang ? 'Page language declared' : 'Declare the document language',
    htmlAttrs.lang ||
      'A lang attribute helps browsers and assistive technology interpret the page.',
  );
  add(
    'viewport',
    meta.has('viewport') ? 'pass' : 'warning',
    meta.has('viewport') ? 'Viewport declaration found' : 'Review mobile viewport setup',
    meta.get('viewport') ||
      'A viewport declaration helps pages scale appropriately on phones. This check does not measure mobile layout or Core Web Vitals.',
  );
  add(
    'robots',
    'info',
    'Automatic access policy checked',
    result.robotsState === 'not_found'
      ? 'The site returned no robots.txt file. Indexing and other access rules are separate checks.'
      : 'The requested path was allowed for this checker by the fetched robots.txt. Googlebot rules may differ.',
  );
  add(
    'links',
    'info',
    'Crawlable HTML links counted',
    `${internalLinkCount} distinct internal and ${externalLinkCount} external HTTP(S) links. Destinations were not crawled or tested for broken links.`,
  );
  if (!meta.get('og:title') || !meta.get('og:image'))
    add(
      'social-preview',
      'warning',
      'Review the social sharing preview',
      'Open Graph title or image metadata is missing from the returned HTML. Add the metadata needed for a useful shared-link preview.',
    );
  return {
    id,
    siteId,
    url,
    fetchedUrl: result.url,
    checkedAt,
    statusCode: result.status,
    title,
    description,
    canonical,
    headings,
    structuredDataTypes: [...types].sort(),
    imageCount: images.length,
    imagesWithoutAlt,
    internalLinkCount,
    externalLinkCount,
    robots,
    findings,
  };
}
