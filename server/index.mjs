import { createApp } from './app.mjs';

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be a number from 1 to 65535.');

const app = createApp({
  onError: (error) =>
    console.error(
      '[workspace] Request failed:',
      error instanceof Error ? error.name : 'Unknown error',
    ),
});
const server = app.listen(port, process.env.BIND_ADDRESS ?? '0.0.0.0', () => {
  console.log(
    `School marketing workspace is listening on port ${port}. ${app.locals.demoMode ? 'DEMO: illustrative data only.' : 'Production workspace.'} External publishing is disabled.`,
  );
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => {
    app.locals.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
server.on('error', (error) => {
  console.error('[workspace] Server failed:', error.code ?? error.name);
  app.locals.close();
  process.exitCode = 1;
});
