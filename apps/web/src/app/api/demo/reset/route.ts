import { spawn } from 'node:child_process';
import path from 'node:path';

export const dynamic = 'force-dynamic';

/** Demo reset = re-run the seed (it clears operational data and rebuilds masters + history). Emulator/dev only. */
export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return Response.json({ message: 'Reset runs the seed script, so run `pnpm seed` from your machine (service account required).' }, { status: 409 });
  }
  const root = path.resolve(process.cwd(), '../..');
  const code = await new Promise<number>((resolve) => {
    const c = spawn('pnpm', ['--filter', '@texafashions/seed', 'seed'], { cwd: root, env: process.env, stdio: 'ignore' });
    c.on('error', () => resolve(1));
    c.on('exit', (n) => resolve(n ?? 1));
  });
  return code === 0 ? Response.json({ message: 'Demo data reset to the seeded baseline' }) : Response.json({ message: `Seed exited with code ${code}` }, { status: 500 });
}
