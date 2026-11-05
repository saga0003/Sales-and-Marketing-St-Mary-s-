import { readFile } from 'node:fs/promises';
import { transaction } from '../database.mjs';
import { createSafeReader } from './safe-fetch.mjs';
import { SOURCE_CATALOG, INTELLIGENCE_LIMITS } from './catalog.mjs';
import { createWatchService, registerWatchRoutes } from './watches.mjs';
import { createSiteService, registerSiteRoutes } from './sites.mjs';
import { createAnswerService, registerAnswerRoutes } from './answers.mjs';
import { createEducationService, registerEducationRoutes } from './education.mjs';
import { createMonitoringService, registerMonitoringRoutes } from './monitoring.mjs';
import { createYoutubePushService, registerYoutubePushRoutes } from './youtube-push.mjs';

export async function registerIntelligence(app, context) {
  const { db, config, now, requireAuth, options = {} } = context;
  const version = '3';
  // The additive release marker is separate from v0.3's legacy marker so a
  // hosted migration can keep earlier cold starts and rollback code compatible.
  const marker = async () =>
    (await db
      .prepare("SELECT value FROM workspace_metadata WHERE key = 'intelligence_extensions_version'")
      .get()) ??
    (await db
      .prepare("SELECT value FROM workspace_metadata WHERE key = 'intelligence_schema_version'")
      .get());
  if (config.migrate !== false) {
    await transaction(db, async () => {
      if (db.kind === 'postgres')
        await db
          .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
          .get(`smis:${db.schema}:migrations`);
      const current = (await marker())?.value;
      if (current && !['1', '2', version].includes(current))
        throw new Error('This intelligence schema is newer than the running application.');
      if (!current) await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
      if (!current || current === '1')
        await db.exec(await readFile(new URL('./migration-v2.sql', import.meta.url), 'utf8'));
      if (current !== version)
        await db.exec(await readFile(new URL('./migration-v3.sql', import.meta.url), 'utf8'));
      await db
        .prepare(
          "INSERT INTO workspace_metadata(key,value) VALUES('intelligence_extensions_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(version);
    });
  } else if ((await marker())?.value !== version) {
    throw new Error(
      'Intelligence database migration required. Apply the base schema when absent and server/intelligence/migration-v2.sql then migration-v3.sql before deploying this release.',
    );
  }
  const read = options.reader ?? createSafeReader();
  const automationEnabled =
    options.automationEnabled ?? process.env.INTELLIGENCE_AUTOMATION_ENABLED !== 'false';
  const services = { db, now, read, automationEnabled, notify: options.notify };
  const watches = createWatchService(services);
  const sites = createSiteService(services);
  const answers = createAnswerService(services);
  const education = createEducationService(services);
  const monitoring = createMonitoringService({ ...services, watches, education });
  const youtubePush = createYoutubePushService({
    ...services,
    watches,
    publicOrigin: options.appOrigin ?? config.publicOrigin,
    encryptionKey: options.encryptionKey ?? process.env.CREDENTIAL_ENCRYPTION_KEY,
    fetch: options.pushFetch,
  });
  registerWatchRoutes(app, context, watches);
  registerSiteRoutes(app, context, sites);
  registerAnswerRoutes(app, context, answers);
  registerEducationRoutes(app, context, education);
  registerMonitoringRoutes(app, context, monitoring);
  registerYoutubePushRoutes(app, context, youtubePush);
  async function data() {
    // When called from the shared bootstrap this joins its existing transaction.
    // The ordinary endpoint uses one snapshot for consistent totals and records.
    return transaction(db, async () => ({
      watches: await watches.list(),
      notices: await watches.notices(),
      sourceCatalog: SOURCE_CATALOG,
      siteVerifications: await sites.list(),
      seoAudits: await sites.reports(),
      answerPrompts: await answers.prompts(),
      answerObservations: await answers.observations(),
      automation: {
        enabled: automationEnabled,
        minimumIntervalHours: INTELLIGENCE_LIMITS.minimumIntervalHours,
        maxWatchesPerRun: INTELLIGENCE_LIMITS.maxWatchesPerRun,
      },
    }));
  }
  app.get('/api/intelligence', requireAuth, async (_request, response) =>
    response.json(await data()),
  );
  return {
    bootstrap: async () => ({ intelligence: await data() }),
    runDue: async (options) => {
      const feeds = await watches.runDue(options);
      const pages = await monitoring.runDue({ limit: 1, actor: options?.actor ?? null });
      const push = await youtubePush.runDue();
      return { ...feeds, pageMonitoring: pages, youtubePush: push };
    },
    services: { watches, sites, answers, education, monitoring, youtubePush },
  };
}
