import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { transaction, makeId, audit } from '../database.mjs';
import { HttpError, parse } from '../validation.mjs';
import { INTELLIGENCE_LIMITS } from './catalog.mjs';
import { publicHttpsUrl, createRobotsReader } from './safe-fetch.mjs';
import { attributes, scanTags, elements } from './parse.mjs';
import { inspectPage } from './seo.mjs';

const VERIFIED_FOR_MS = 30 * 24 * 3600000;
const challengePath = '/.well-known/stmarys-marketing-verification.txt';
function equal(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

function isVerified(row, now) {
  return row.verified_at && now.getTime() - new Date(row.verified_at).getTime() <= VERIFIED_FOR_MS;
}

function publicSite(row, at) {
  return {
    id: row.id,
    origin: row.origin,
    status: isVerified(row, at) ? 'verified' : 'pending',
    verificationUrl: `${row.origin}${challengePath}`,
    verificationToken: row.verification_token,
    metaTag: `<meta name="stmarys-marketing-verification" content="${row.verification_token}">`,
    verifiedAt: row.verified_at,
    lastAuditAt: row.last_audit_at,
  };
}

export function createSiteService({ db, now, read }) {
  const stamp = () => now().toISOString();
  async function get(id) {
    const row = await db
      .prepare(
        `SELECT * FROM intelligence_sites WHERE id = ?${db.inTransaction() ? db.lockSuffix : ''}`,
      )
      .get(id);
    if (!row)
      throw new HttpError(404, 'This website registration could not be found.', 'site_not_found');
    return row;
  }
  async function list() {
    return (
      await db.prepare('SELECT * FROM intelligence_sites ORDER BY created_at DESC').all()
    ).map((row) => publicSite(row, now()));
  }
  async function reports() {
    return (
      await db
        .prepare(
          'SELECT report FROM intelligence_seo_audits ORDER BY created_at DESC, id DESC LIMIT 30',
        )
        .all()
    ).map((row) => JSON.parse(row.report));
  }
  async function create(value, actor) {
    const origin = publicHttpsUrl(value).origin;
    return transaction(db, async () => {
      if (db.kind === 'postgres')
        await db
          .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
          .get(`smis:${db.schema}:intelligence-sites`);
      const existing = await db
        .prepare('SELECT * FROM intelligence_sites WHERE origin = ?')
        .get(origin);
      if (existing) return publicSite(existing, now());
      const count = await db.prepare('SELECT count(*) AS count FROM intelligence_sites').get();
      if (Number(count.count) >= INTELLIGENCE_LIMITS.maxSites)
        throw new HttpError(
          409,
          `Register up to ${INTELLIGENCE_LIMITS.maxSites} website origins. Remove unused registrations first.`,
          'site_limit',
        );
      const id = makeId('site');
      await db
        .prepare(
          'INSERT INTO intelligence_sites(id, origin, verification_token, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(id, origin, randomBytes(32).toString('base64url'), actor.id, stamp());
      await audit(
        db,
        actor,
        'SEO website registered',
        id,
        `Ownership verification is required for ${origin}.`,
        stamp(),
      );
      return publicSite(await get(id), now());
    });
  }
  async function claim(id, kind) {
    return transaction(db, async () => {
      const row = await get(id);
      if (row.run_token && row.lease_until > stamp())
        throw new HttpError(
          409,
          'A website check is already running. Wait for it to finish.',
          'site_busy',
        );
      if (kind === 'audit' && !isVerified(row, now()))
        throw new HttpError(
          409,
          'Verify ownership of this website before running an audit. Verification is renewed every 30 days.',
          'site_verification_required',
        );
      const lastAttempt = kind === 'audit' ? row.last_audit_attempt_at : row.last_verify_attempt_at;
      if (lastAttempt && now().getTime() - new Date(lastAttempt).getTime() < 60000)
        throw new HttpError(
          429,
          'Wait at least one minute between website checks of the same kind.',
          'site_rate_limited',
        );
      const token = randomBytes(24).toString('base64url');
      const column = kind === 'audit' ? 'last_audit_attempt_at' : 'last_verify_attempt_at';
      await db
        .prepare(
          `UPDATE intelligence_sites SET run_token = ?, lease_until = ?, ${column} = ? WHERE id = ?`,
        )
        .run(
          token,
          new Date(now().getTime() + INTELLIGENCE_LIMITS.leaseMs).toISOString(),
          stamp(),
          id,
        );
      return { ...row, run_token: token };
    });
  }
  async function release(row) {
    await db
      .prepare(
        'UPDATE intelligence_sites SET run_token = NULL, lease_until = NULL WHERE id = ? AND run_token = ?',
      )
      .run(row.id, row.run_token);
  }
  async function verify(id, actor) {
    const row = await claim(id, 'verify');
    try {
      let verified = false;
      try {
        const file = await read(`${row.origin}${challengePath}`, {
          maxBytes: 16384,
          sameOrigin: true,
          totalTimeoutMs: 8000,
        });
        verified = file.status === 200 && equal(file.text.trim(), row.verification_token);
      } catch (error) {
        if (error?.code === 'private_network_blocked' || error?.code === 'invalid_public_url')
          throw error;
      }
      if (!verified) {
        const page = await read(`${row.origin}/`, { sameOrigin: true, totalTimeoutMs: 10000 });
        if (page.status === 200) {
          const head = elements(page.text, ['head'], 1)[0];
          const headHtml = head ? page.text.slice(head.payload, head.contentEnd) : '';
          verified = [...scanTags(headHtml)]
            .filter((tag) => tag.tag === 'meta' && !tag.closing)
            .some((tag) => {
              const attrs = attributes(headHtml.slice(tag.start, tag.end));
              return (
                attrs.name?.toLowerCase() === 'stmarys-marketing-verification' &&
                equal(attrs.content, row.verification_token)
              );
            });
        }
      }
      if (!verified)
        throw new HttpError(
          409,
          'The verification token was not found. Publish the exact token in the challenge file or add the supplied meta tag to the homepage, then try again.',
          'site_not_verified',
        );
      await transaction(db, async () => {
        const changed = await db
          .prepare(
            'UPDATE intelligence_sites SET verified_at = ?, run_token = NULL, lease_until = NULL WHERE id = ? AND run_token = ?',
          )
          .run(stamp(), id, row.run_token);
        if (changed.changes !== 1)
          throw new HttpError(
            409,
            'The check expired. Verify the website again.',
            'stale_site_check',
          );
        await audit(
          db,
          actor,
          'SEO website verified',
          id,
          `${row.origin} passed its public ownership challenge.`,
          stamp(),
        );
      });
      return publicSite(await get(id), now());
    } finally {
      await release(row);
    }
  }
  async function inspect(id, input, actor) {
    const site = await get(id);
    const url = publicHttpsUrl(input.url || site.origin).href;
    if (new URL(url).origin !== site.origin)
      throw new HttpError(
        422,
        'Audit a URL on this exact verified website origin. Register another origin separately.',
        'site_origin_mismatch',
      );
    const row = await claim(id, 'audit');
    try {
      const result = await createRobotsReader(read)(url, { sameOrigin: true });
      if (result.status === 401 || result.status === 403)
        throw new HttpError(
          409,
          'The website denied the automatic reader access. Check its public access settings; access restrictions are not bypassed.',
          'site_access_denied',
        );
      const contentType = result.headers?.['content-type'] || '';
      if (
        !/text\/html|application\/xhtml\+xml/i.test(contentType) &&
        !/<(?:!doctype\s+html|html)\b/i.test(result.text)
      )
        throw new HttpError(
          422,
          'SEO checks need an HTML web page. PDFs and API responses are not page audits.',
          'site_not_html',
        );
      const timestamp = stamp();
      const report = inspectPage(result, {
        id: makeId('seo_audit'),
        siteId: row.id,
        url,
        checkedAt: timestamp,
      });
      await transaction(db, async () => {
        const current = await get(id);
        if (current.run_token !== row.run_token)
          throw new HttpError(409, 'This audit expired. Run it again.', 'stale_site_check');
        await db
          .prepare(
            'INSERT INTO intelligence_seo_audits(id, site_id, report, created_at) VALUES (?, ?, ?, ?)',
          )
          .run(report.id, id, JSON.stringify(report), timestamp);
        await db
          .prepare(
            'UPDATE intelligence_sites SET last_audit_at = ?, run_token = NULL, lease_until = NULL WHERE id = ? AND run_token = ?',
          )
          .run(timestamp, id, row.run_token);
        await audit(
          db,
          actor,
          'SEO audit completed',
          id,
          `${url}: ${report.findings.filter((item) => item.severity === 'issue').length} issues and ${report.findings.filter((item) => item.severity === 'warning').length} review items. HTML snapshot checks do not establish rankings or indexing.`,
          timestamp,
        );
      });
      return report;
    } finally {
      await release(row);
    }
  }
  async function remove(id, actor) {
    await transaction(db, async () => {
      const row = await get(id);
      if (row.run_token && row.lease_until > stamp())
        throw new HttpError(
          409,
          'Wait for the running website check to finish before removing it.',
          'site_busy',
        );
      await db.prepare('DELETE FROM intelligence_sites WHERE id = ?').run(id);
      await audit(
        db,
        actor,
        'SEO website removed',
        id,
        'The verification challenge and stored page audit reports were removed from the workspace.',
        stamp(),
      );
    });
  }
  return { list, reports, create, verify, inspect, remove };
}

export function registerSiteRoutes(app, { requireAuth, requireManager }, service) {
  const manager = [requireAuth, requireManager];
  app.get('/api/intelligence/sites', requireAuth, async (_request, response) =>
    response.json({ sites: await service.list(), audits: await service.reports() }),
  );
  app.post('/api/intelligence/sites', ...manager, async (request, response) => {
    const { url } = parse(
      z.object({ url: z.string().trim().min(1).max(2048) }).strict(),
      request.body,
    );
    response.status(201).json({ site: await service.create(url, request.auth.user) });
  });
  app.post('/api/intelligence/sites/:id/verify', ...manager, async (request, response) =>
    response.json({ site: await service.verify(request.params.id, request.auth.user) }),
  );
  app.post('/api/intelligence/sites/:id/audit', ...manager, async (request, response) => {
    const input = parse(
      z.object({ url: z.string().trim().min(1).max(2048).optional() }).strict(),
      request.body || {},
    );
    response
      .status(201)
      .json({ audit: await service.inspect(request.params.id, input, request.auth.user) });
  });
  app.delete('/api/intelligence/sites/:id', ...manager, async (request, response) => {
    await service.remove(request.params.id, request.auth.user);
    response.json({ removed: true });
  });
}
