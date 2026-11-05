import { createPageMonitoringService, PAGE_MONITOR_LIMITS } from './page-monitoring.mjs';
import { createResearchService } from './research.mjs';

export function createMonitoringService(context) {
  const pages = createPageMonitoringService(context);
  return { ...pages, ...createResearchService({ ...context, pages }) };
}

export function registerMonitoringRoutes(app, { requireAuth, requireManager }, service) {
  const manager = [requireAuth, requireManager];
  app.get('/api/intelligence/monitoring', requireAuth, async (_request, response) =>
    response.json({
      pageMonitors: await service.listPageMonitors(),
      researchRequests: await service.researchRequests(),
      limits: PAGE_MONITOR_LIMITS,
    }),
  );
  app.post('/api/intelligence/page-monitors', ...manager, async (request, response) =>
    response
      .status(201)
      .json({ monitor: await service.createPageMonitor(request.body, request.auth.user) }),
  );
  app.patch('/api/intelligence/page-monitors/:id', ...manager, async (request, response) =>
    response.json({
      monitor: await service.updatePageMonitor(request.params.id, request.body, request.auth.user),
    }),
  );
  app.delete('/api/intelligence/page-monitors/:id', ...manager, async (request, response) =>
    response.json(await service.removePageMonitor(request.params.id, request.auth.user)),
  );
  app.get('/api/intelligence/page-monitors/:id/snapshots', requireAuth, async (request, response) =>
    response.json({ snapshots: await service.pageSnapshots(request.params.id) }),
  );
  app.post('/api/intelligence/page-monitors/:id/run', ...manager, async (request, response) =>
    response.json(await service.checkPage(request.params.id, { actor: request.auth.user })),
  );
  app.get('/api/intelligence/research-requests', requireAuth, async (request, response) =>
    response.json({ requests: await service.researchRequests({ status: request.query.status }) }),
  );
  app.post('/api/intelligence/research-requests', requireAuth, async (request, response) =>
    response.status(201).json(await service.requestResearch(request.body, request.auth.user)),
  );
  app.get('/api/intelligence/research-requests/:id', requireAuth, async (request, response) =>
    response.json(await service.researchContext(request.params.id)),
  );
  app.post(
    '/api/intelligence/research-requests/:id/result',
    requireAuth,
    async (request, response) =>
      response.json({
        request: await service.recordResearchResult(
          request.params.id,
          request.body,
          request.auth.user,
        ),
      }),
  );
  app.post(
    '/api/intelligence/research-requests/:id/cancel',
    requireAuth,
    async (request, response) =>
      response.json({
        request: await service.cancelResearch(request.params.id, request.auth.user),
      }),
  );
  app.post('/api/intelligence/competitors/:id/research', requireAuth, async (request, response) =>
    response.json(
      await service.researchCompetitor(request.params.id, request.body, request.auth.user),
    ),
  );
  app.get(
    '/api/intelligence/competitors/:id/observations',
    requireAuth,
    async (request, response) =>
      response.json({ observations: await service.observations(request.params.id) }),
  );
  app.post(
    '/api/intelligence/competitors/:id/observations',
    requireAuth,
    async (request, response) =>
      response
        .status(201)
        .json(await service.recordObservation(request.params.id, request.body, request.auth.user)),
  );
}
