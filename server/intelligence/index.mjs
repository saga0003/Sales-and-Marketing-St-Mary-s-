import { readFile } from 'node:fs/promises';
import { transaction } from '../database.mjs';
import { createSafeReader } from './safe-fetch.mjs';
import { SOURCE_CATALOG, INTELLIGENCE_LIMITS } from './catalog.mjs';
import { createWatchService, registerWatchRoutes } from './watches.mjs';
import { createSiteService, registerSiteRoutes } from './sites.mjs';
import { createAnswerService, registerAnswerRoutes } from './answers.mjs';

export async function registerIntelligence(app, context) {
  const { db, config, now, requireAuth, options = {} } = context;
  const version = '1';
  const marker = () =>
    db
      .prepare("SELECT value FROM workspace_metadata WHERE key = 'intelligence_schema_version'")
      .get();
  if (config.migrate !== false) {
    await transaction(db, async () => {
      if (db.kind === 'postgres')
        await db
          .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
          .get(`smis:${db.schema}:migrations`);
      if ((await marker())?.value !== version)
        await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    });
  } else if ((await marker())?.value !== version) {
    throw new Error(
      'Intelligence database migration required. Apply server/intelligence/schema.sql before deploying this release.',
    );
  }
  const read = options.reader ?? createSafeReader();
  const automationEnabled =
    options.automationEnabled ?? process.env.INTELLIGENCE_AUTOMATION_ENABLED !== 'false';
  const services = { db, now, read, automationEnabled, notify: options.notify };
  const watches = createWatchService(services);
  const sites = createSiteService(services);
  const answers = createAnswerService(services);
  registerWatchRoutes(app, context, watches);
  registerSiteRoutes(app, context, sites);
  registerAnswerRoutes(app, context, answers);
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
    runDue: (options) => watches.runDue(options),
    services: { watches, sites, answers },
  };
}
