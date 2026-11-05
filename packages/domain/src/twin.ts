/* Store Twin — anonymous footfall simulator + derived metrics. Pure TS: the sim script writes the output to RTDB, the UI only reads it. */

export type Activity = 'walk' | 'browse' | 'try' | 'photo' | 'queue' | 'pay' | 'chat' | 'idle';
export const ACTIVITY_EMOJI: Record<Activity, string> = { walk: '🚶', browse: '👀', try: '🛍️', photo: '📸', queue: '⏳', pay: '💳', chat: '💬', idle: '🧍' };

export interface TwinZone { id: string; floorId: string; name: string; polygon: { x: number; y: number }[] }
/** Wire shape under /twin/{store}/{floor}/people/{id}: anonymous coordinates only. */
export interface TwinPerson { id: string; k: 'c' | 's'; x: number; y: number; z: string; a: Activity }
export interface TwinMeta { date: string; entriesToday: number; billsToday: number; updatedAt: number }

export const CASH_WRAP = 'Cash Wrap';
const ENTRANCE = 'Entrance';
export const SERVICE_SECONDS = 9;
const SPEED = 30;
const PAY_SECONDS = 3;

export const isCashWrap = (z: Pick<TwinZone, 'name'>) => z.name === CASH_WRAP;
export function centroid(z: TwinZone) {
  const xs = z.polygon.map((p) => p.x), ys = z.polygon.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/** Relative footfall by IST hour (mall hours 10–22): lunch bump, big evening peak. */
const HOURLY = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.25, 0.4, 0.6, 0.7, 0.55, 0.45, 0.5, 0.7, 0.9, 1, 0.85, 0.6, 0.3, 0.1];
export const hourlyFactor = (hour: number) => HOURLY[((Math.floor(hour) % 24) + 24) % 24]!;
/** Total people on the floor plate (customers + staff): always 15–60. */
export const targetPopulation = (hour: number) => Math.round(15 + 45 * hourlyFactor(hour));
export const staffTarget = (hour: number) => 4 + Math.round(hourlyFactor(hour) * 2);

interface Wp { floor: string; zone: string; x: number; y: number; warp?: boolean }
export interface SimPerson {
  id: string; k: 'c' | 's'; floor: string; x: number; y: number; zone: string; act: Activity;
  route: Wp[]; dwell: number; buys: boolean; leaving: boolean; pay: number;
}
export interface SimState { people: SimPerson[]; nextId: number; entries: number; bills: number; serve: number }
export const newSim = (entries = 0, bills = 0): SimState => ({ people: [], nextId: 1, entries, bills, serve: SERVICE_SECONDS });

export interface SimCtx { zones: TwinZone[]; floors: string[]; hour: number; rand: () => number; dt: number }

const pick = <T,>(a: T[], rand: () => number) => a[Math.floor(rand() * a.length)]!;
function find(zones: TwinZone[], floor: string, name: string) { return zones.find((z) => z.floorId === floor && z.name === name); }
const wpOf = (z: TwinZone, warp = false): Wp => ({ floor: z.floorId, zone: z.id, ...centroid(z), warp });

/** Path = zone-to-zone via the floor's Entrance/stairs when the floor changes. */
function buildRoute(c: SimCtx, from: string, stops: TwinZone[]): Wp[] {
  const out: Wp[] = [];
  let floor = from;
  for (const z of stops) {
    if (z.floorId !== floor) {
      const out1 = find(c.zones, floor, ENTRANCE);
      const in1 = find(c.zones, z.floorId, ENTRANCE);
      if (out1) out.push(wpOf(out1));
      if (in1) out.push(wpOf(in1, true));
      floor = z.floorId;
    }
    out.push(wpOf(z));
  }
  return out;
}

const browseZones = (zones: TwinZone[]) => zones.filter((z) => z.name !== ENTRANCE && !isCashWrap(z));
function actFor(zone: TwinZone | undefined, rand: () => number): Activity {
  if (zone?.name === 'Photobooth') return 'photo';
  return rand() < 0.3 ? 'try' : 'browse';
}

function spawnCustomer(s: SimState, c: SimCtx) {
  const home = c.floors[0]!;
  const ent = find(c.zones, home, ENTRANCE);
  if (!ent) return;
  const pool = browseZones(c.zones);
  const n = 2 + Math.floor(c.rand() * 3);
  const stops: TwinZone[] = [];
  for (let i = 0; i < n; i++) stops.push(pick(pool, c.rand));
  const buys = c.rand() < 0.42;
  const till = find(c.zones, home, CASH_WRAP);
  if (buys && till) stops.push(till);
  const p = centroid(ent);
  s.people.push({ id: `c${s.nextId++}`, k: 'c', floor: home, x: p.x, y: p.y, zone: ent.id, act: 'walk', route: buildRoute(c, home, stops), dwell: 0, buys, leaving: false, pay: 0 });
  s.entries++;
}

function seedStaff(s: SimState, c: SimCtx, floor: string, till: boolean) {
  const pool = browseZones(c.zones).filter((z) => z.floorId === floor);
  const z = till ? find(c.zones, floor, CASH_WRAP) : pick(pool, c.rand);
  if (!z) return;
  const p = centroid(z);
  s.people.push({ id: `s${s.nextId++}`, k: 's', floor, x: p.x, y: p.y, zone: z.id, act: till ? 'idle' : 'chat', route: [], dwell: 3 + c.rand() * 10, buys: false, leaving: false, pay: 0 });
}

const queueOf = (s: SimState) => s.people.filter((p) => p.act === 'queue').sort((a, b) => a.pay - b.pay);

/** Advance the world by `dt` seconds. Mutates `s`. */
export function stepSim(s: SimState, c: SimCtx) {
  const home = c.floors[0]!;
  // Staff: keep a till cashier on the home floor plus floaters per floor.
  const staff = s.people.filter((p) => p.k === 's');
  if (!staff.some((p) => p.act === 'idle')) seedStaff(s, c, home, true);
  const floaters = staff.filter((p) => p.act !== 'idle').length;
  const want = Math.max(0, staffTarget(c.hour) - 1);
  if (floaters < want) seedStaff(s, c, c.floors[floaters % c.floors.length]!, false);
  else if (floaters > want) s.people.splice(s.people.findIndex((p) => p.k === 's' && p.act !== 'idle'), 1);

  // Customers: arrival rate chases the hourly target population.
  const customers = s.people.filter((p) => p.k === 'c' && !p.leaving).length;
  const gap = targetPopulation(c.hour) - s.people.filter((p) => p.k === 's').length - customers;
  if (gap > 0) { const n = Math.min(gap, Math.ceil(gap / 4)); for (let i = 0; i < n; i++) spawnCustomer(s, c); }

  // Till: serve queue head every SERVICE_SECONDS.
  const q = queueOf(s);
  const paying = s.people.some((p) => p.act === 'pay' && p.k === 'c');
  s.serve -= c.dt;
  if (q.length && !paying && s.serve <= 0) { q[0]!.act = 'pay'; q[0]!.pay = PAY_SECONDS; s.serve = SERVICE_SECONDS; }

  const tillZone = find(c.zones, home, CASH_WRAP);
  const tillAt = tillZone ? centroid(tillZone) : { x: 330, y: 225 };
  const exit = find(c.zones, home, ENTRANCE);

  for (const p of s.people) {
    if (p.k === 'c' && p.act === 'pay') {
      p.pay -= c.dt;
      if (p.pay <= 0) { s.bills++; p.leaving = true; p.act = 'walk'; p.route = exit ? buildRoute(c, p.floor, [exit]) : []; }
      continue;
    }
    if (p.act === 'queue') {
      const i = queueOf(s).indexOf(p);
      p.x = tillAt.x - 14 - (i % 6) * 13; p.y = tillAt.y + 12 - Math.floor(i / 6) * 14;
      continue;
    }
    if (p.dwell > 0) { p.dwell -= c.dt; if (p.dwell > 0) continue; p.act = 'walk'; }
    const next = p.route[0];
    if (!next) {
      if (p.leaving) { p.floor = ''; continue; }
      if (p.k === 's') {
        const z = pick(browseZones(c.zones).filter((zz) => zz.floorId === p.floor), c.rand);
        p.route = [wpOf(z)];
      } else { p.leaving = true; p.route = exit ? buildRoute(c, p.floor, [exit]) : []; if (!exit) p.floor = ''; }
      continue;
    }
    if (next.warp) { p.floor = next.floor; p.x = next.x; p.y = next.y; p.route.shift(); continue; }
    const dx = next.x - p.x, dy = next.y - p.y, d = Math.hypot(dx, dy), step = SPEED * c.dt;
    if (d > step) { p.x += (dx / d) * step; p.y += (dy / d) * step; p.act = 'walk'; continue; }
    p.x = next.x; p.y = next.y; p.zone = next.zone; p.route.shift();
    const z = c.zones.find((zz) => zz.id === next.zone);
    if (p.k === 'c' && z && isCashWrap(z)) { p.act = 'queue'; p.pay = s.nextId++; continue; }
    if (p.leaving) continue;
    p.act = p.k === 's' ? 'chat' : actFor(z, c.rand);
    p.dwell = p.k === 's' ? 6 + c.rand() * 14 : 6 + c.rand() * 20;
  }
  s.people = s.people.filter((p) => p.floor !== '' && !(p.leaving && p.route.length === 0 && p.act === 'walk' && p.dwell <= 0 && nearExit(p, exit)));
}
function nearExit(p: SimPerson, exit?: TwinZone) { if (!exit) return true; const e = centroid(exit); return p.floor === exit.floorId && Math.hypot(p.x - e.x, p.y - e.y) < 2; }

export function snapshot(s: SimState, floor: string): TwinPerson[] {
  return s.people.filter((p) => p.floor === floor).map((p) => ({ id: p.id, k: p.k, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, z: p.zone, a: p.act }));
}

/** Expected cumulative visitors/bills from opening to `hour`, so a script started mid-day isn't at zero. */
export function warmStart(hour: number): { entries: number; bills: number } {
  let entries = 0;
  for (let h = 10; h < Math.floor(hour); h++) entries += Math.round(hourlyFactor(h) * 130);
  entries += Math.round(hourlyFactor(hour) * 130 * (hour - Math.floor(hour)));
  return { entries, bills: Math.round(entries * 0.18) };
}

/* ───────── Derived metrics (UI) */
export function queueStats(people: TwinPerson[]) {
  const len = people.filter((p) => p.a === 'queue').length;
  const paying = people.some((p) => p.a === 'pay');
  return { length: len, waitSec: len * SERVICE_SECONDS + (paying ? PAY_SECONDS : 0) };
}
export function zoneCounts(people: TwinPerson[]) {
  const out: Record<string, { customers: number; staff: number }> = {};
  for (const p of people) { const e = (out[p.z] ??= { customers: 0, staff: 0 }); if (p.k === 's') e.staff++; else e.customers++; }
  return out;
}
/** Exponentially-decayed person-seconds per zone; call once per frame/second. */
export function accumulateDwell(heat: Record<string, number>, people: TwinPerson[], decay = 0.995): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(heat)) out[k] = v * decay;
  for (const p of people) if (p.k === 'c' && p.a !== 'walk' && p.a !== 'queue') out[p.z] = (out[p.z] ?? 0) + 1;
  return out;
}
export const heatLevel = (heat: Record<string, number>, zone: string) => { const max = Math.max(1, ...Object.values(heat)); return (heat[zone] ?? 0) / max; };

export function conversionPct(m: Pick<TwinMeta, 'entriesToday' | 'billsToday'> | null) {
  return m && m.entriesToday > 0 ? (m.billsToday / m.entriesToday) * 100 : 0;
}

export interface Suggestion { tone: 'cherry' | 'butter' | 'mint'; text: string }
/** One rule-based nudge, first matching rule wins. */
export function staffSuggestion(people: TwinPerson[], zones: TwinZone[], meta: Pick<TwinMeta, 'entriesToday' | 'billsToday'> | null): Suggestion {
  const q = queueStats(people);
  if (q.length >= 4) return { tone: 'cherry', text: `Queue at Cash Wrap is ${q.length} deep (~${Math.round(q.waitSec / 60 * 10) / 10} min wait). Pull a floor associate to open the second till.` };
  const counts = zoneCounts(people);
  const crowded = zones.filter((z) => !isCashWrap(z) && z.name !== ENTRANCE).map((z) => ({ z, ...(counts[z.id] ?? { customers: 0, staff: 0 }) }))
    .filter((r) => r.customers >= 5 && r.staff === 0).sort((a, b) => b.customers - a.customers)[0];
  if (crowded) return { tone: 'butter', text: `${crowded.customers} shoppers in ${crowded.z.name} (floor ${crowded.z.floorId}) with no associate nearby. Send someone over to help.` };
  const conv = conversionPct(meta);
  if (meta && meta.entriesToday >= 60 && conv < 14) return { tone: 'butter', text: `Conversion is ${conv.toFixed(1)}% today. Greet at the entrance and offer a try-on or gift suggestion.` };
  return { tone: 'mint', text: 'Floor is balanced: short queue and every busy zone is covered. Keep the current staffing.' };
}
