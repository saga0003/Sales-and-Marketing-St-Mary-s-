import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

// Development is an explicitly isolated sample workspace. Production never opts
// into demo mode automatically; use npm start with a configured environment.
if (existsSync('.env')) loadEnvFile('.env');
const demoMode = process.env.DEMO_MODE ?? 'true';
const databasePath =
  process.env.DATABASE_PATH ??
  resolve(
    'data',
    ['true', '1'].includes(demoMode.toLowerCase()) ? 'demo.sqlite' : 'production.sqlite',
  );
const children = [];
const server = spawn(process.execPath, ['server/index.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: '3001', DEMO_MODE: demoMode, DATABASE_PATH: databasePath },
});
children.push(server);
const vite = spawn(
  process.execPath,
  [resolve('node_modules/vite/bin/vite.js'), '--host', '0.0.0.0', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: process.env,
  },
);
children.push(vite);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 150).unref();
}
for (const child of children)
  child.on('exit', (code) => {
    if (!stopping) stop(code || 0);
  });
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
