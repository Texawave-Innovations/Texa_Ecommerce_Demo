#!/usr/bin/env node
// pnpm dev — run web (:3100) + pos (:3101) against the hosted Firebase demo project.
// Config comes from apps/web/.env.local and apps/pos/.env.local (see .env.example).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

for (const app of ['web', 'pos']) {
  if (!existsSync(`apps/${app}/.env.local`)) {
    console.error(`✗ apps/${app}/.env.local is missing. Copy .env.example to apps/${app}/.env.local and fill in your Firebase web config.`);
    process.exit(1);
  }
}
console.log('▸ web http://localhost:3100 · pos http://localhost:3101');
const children = ['web', 'pos'].map((app) => spawn('pnpm', ['--filter', `@texafashions/${app}`, 'dev'], { stdio: 'inherit' }));
const stop = () => { children.forEach((c) => c.kill('SIGINT')); setTimeout(() => process.exit(0), 1000); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
children.forEach((c) => c.on('exit', (code) => { if (code) { console.error('✗ an app exited with', code); stop(); } }));
