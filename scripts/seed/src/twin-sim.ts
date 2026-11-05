/* Store Twin simulator: writes anonymous people positions to RTDB /twin/{store}/{floor}/people at 1 Hz.
   Usage: pnpm twin:sim [storeId ...]   (default PUN-PMC). Zones/floors come from the stores master. */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';
import { ORG_ID } from '@texafashions/types';
import { newSim, snapshot, stepSim, warmStart, type SimState, type TwinMeta, type TwinZone } from '@texafashions/domain';

const projectId = process.env.GCLOUD_PROJECT ??= process.env.FIREBASE_PROJECT_ID ?? 'texafashions-demo';
if (!getApps().length) initializeApp({ projectId, databaseURL: process.env.FIREBASE_DATABASE_URL ?? `https://${projectId}-default-rtdb.firebaseio.com` });
const fs = getFirestore();
const rtdb = getDatabase();

// Demo controls → "busy hour": while settings/demo.busyUntil is in the future, play the 7 pm peak.
let busyUntil = 0;
fs.doc(`orgs/${ORG_ID}/settings/demo`).onSnapshot((d) => { busyUntil = Number(d.get('busyUntil') ?? 0); if (busyUntil > Date.now()) console.log('[twin-sim] busy hour ON'); }, () => undefined);
const simHour = () => (busyUntil > Date.now() ? 19.5 : istNow().hour);

const stores = process.argv.slice(2).length ? process.argv.slice(2) : ['PUN-PMC'];
const istNow = () => { const d = new Date(Date.now() + 5.5 * 3600_000); return { hour: d.getUTCHours() + d.getUTCMinutes() / 60, date: d.toISOString().slice(0, 10) }; };

interface Runner { id: string; floors: string[]; zones: TwinZone[]; sim: SimState; date: string }
const runners: Runner[] = [];
for (const id of stores) {
  const doc = (await fs.doc(`orgs/${ORG_ID}/stores/${id}`).get()).data() as { floors?: { id: string }[]; zones?: TwinZone[] } | undefined;
  if (!doc?.zones?.length) { console.warn(`[twin-sim] ${id}: no zones in the stores master — run pnpm seed first`); continue; }
  const { hour, date } = istNow();
  const prev = (await rtdb.ref(`twin/${id}/meta`).get()).val() as TwinMeta | null;
  const warm = prev?.date === date ? { entries: prev.entriesToday, bills: prev.billsToday } : warmStart(hour);
  runners.push({ id, floors: (doc.floors ?? [{ id: 'F1' }]).map((f) => f.id), zones: doc.zones, sim: newSim(warm.entries, warm.bills), date });
  console.log(`[twin-sim] ${id}: floors ${runners.at(-1)!.floors.join(',')} · ${doc.zones.length} zones`);
}
if (!runners.length) process.exit(1);

// Pre-roll 90 simulated seconds so the floor is already populated on the first frame.
for (const r of runners) for (let i = 0; i < 90; i++) stepSim(r.sim, { zones: r.zones, floors: r.floors, hour: simHour(), rand: Math.random, dt: 1 });

let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    const hour = simHour();
    const at = Date.now();
    const updates: Record<string, unknown> = {};
    for (const r of runners) {
      stepSim(r.sim, { zones: r.zones, floors: r.floors, hour, rand: Math.random, dt: 1 });
      for (const f of r.floors) updates[`${r.id}/${f}`] = { at, people: Object.fromEntries(snapshot(r.sim, f).map(({ id, ...p }) => [id, p])) };
      const meta: TwinMeta = { date: r.date, entriesToday: r.sim.entries, billsToday: r.sim.bills, updatedAt: at };
      updates[`${r.id}/meta`] = meta;
    }
    await rtdb.ref('twin').update(updates);
  } catch (e) { console.error('[twin-sim]', (e as Error).message); } finally { busy = false; }
}, 1000);
console.log('[twin-sim] running at 1 Hz — Ctrl+C to stop');
