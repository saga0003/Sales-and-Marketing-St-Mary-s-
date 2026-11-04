import { createApp } from '../server/app.mjs';

// Fluid Compute may deliver concurrent requests to one function instance.
// Cache initialization, not user/session state; those records live in PostgreSQL.
let application;

export default async function handler(request, response) {
  try {
    application ??= createApp({
      serveStatic: false,
      onError(error) {
        // Do not log request bodies, credentials, connection strings or tokens.
        console.error('[workspace] API request failed:', error?.code ?? error?.name ?? 'Error');
      },
    }).catch((error) => {
      // A later invocation may retry a transient connection error. Initialization
      // never drops, re-seeds or resets an existing production workspace.
      application = undefined;
      throw error;
    });
    const app = await application;
    return app(request, response);
  } catch (error) {
    console.error('[workspace] API initialization failed:', error?.code ?? error?.name ?? 'Error');
    if (!response.headersSent) {
      response.statusCode = 503;
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Retry-After', '30');
      response.end(
        JSON.stringify({
          error: 'The workspace is temporarily unavailable. Please try again shortly.',
          code: 'workspace_unavailable',
        }),
      );
    }
  }
}
