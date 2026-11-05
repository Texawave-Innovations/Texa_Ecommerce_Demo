#!/usr/bin/env node
// pnpm demo:local — FREE-PLAN demo: Firebase emulators + seed + web (:3100) + pos (:3101). No Blaze plan needed.
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { existsSync } from 'node:fs';

const PROJECT = 'demo-texafashions';
const env = { ...process.env, GCLOUD_PROJECT: PROJECT, FIREBASE_PROJECT_ID: PROJECT,
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_DATABASE_EMULATOR_HOST: '127.0.0.1:9001',
  NEXT_PUBLIC_USE_EMULATORS: 'true', NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT, NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-key',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${PROJECT}.firebaseapp.com`, NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${PROJECT}.appspot.com`, NEXT_PUBLIC_FIREBASE_APP_ID: '1:1:web:demo' };
if (spawnSync('java', ['-version'], { env }).status !== 0) {
  for (const p of ['/opt/homebrew/opt/openjdk@21/bin', '/opt/homebrew/opt/openjdk/bin', '/usr/local/opt/openjdk@21/bin']) {
    if (existsSync(`${p}/java`)) { env.PATH = `${p}:${env.PATH}`; break; }
  }
}
if (spawnSync('java', ['-version'], { env }).status !== 0) { console.error('✗ Java 21+ required: brew install openjdk@21'); process.exit(1); }

const children = []; let down = false;
const run = (name, cmd, args) => { const c = spawn(cmd, args, { env, stdio: 'inherit' }); c.on('exit', (code) => { if (code && !down) { console.error(`✗ ${name} exited with ${code}`); stop(1); } }); children.push(c); };
function stop(code = 0) { down = true; children.forEach((c) => c.kill('SIGINT')); setTimeout(() => process.exit(code), 1500); }
process.on('SIGINT', () => stop(0)); process.on('SIGTERM', () => stop(0));
const waitPort = (port) => new Promise((res, rej) => { const t0 = Date.now(); (function t() { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(); }); s.on('error', () => { s.destroy(); Date.now() - t0 > 120000 ? rej(new Error(`port ${port}`)) : setTimeout(t, 700); }); })(); });

console.log('▸ Building functions…');
if (spawnSync('pnpm', ['--filter', '@texafashions/functions', 'build'], { env, stdio: 'inherit' }).status !== 0) process.exit(1);
console.log('▸ Starting emulators…');
run('emulators', 'pnpm', ['exec', 'firebase', 'emulators:start', '--project', PROJECT, '--config', 'firebase.emulators.json']);
await waitPort(8080); await waitPort(9099); await waitPort(5001); await waitPort(9001);
console.log('▸ Seeding…');
if (spawnSync('pnpm', ['--filter', '@texafashions/seed', 'seed'], { env, stdio: 'inherit' }).status !== 0) stop(1);
children.push(spawn('pnpm', ['--filter', '@texafashions/seed', 'twin', 'PUN-PMC', 'MUM-PMC'], { env, stdio: 'inherit' }));
console.log('\n▸ web http://localhost:3100 · pos http://localhost:3101 · emulator UI http://localhost:4000\n');
run('web', 'pnpm', ['--filter', '@texafashions/web', 'dev']);
run('pos', 'pnpm', ['--filter', '@texafashions/pos', 'dev']);
