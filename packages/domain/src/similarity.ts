export interface Named { id: string; name: string; extra?: string; /** Deliberate variant key (colour|size|character). Items with different variants are never duplicates. */ variant?: string }
export interface DupPair { a: string; b: string; score: number; reason: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ㄱ-힝 ]+/g, ' ').replace(/\s+/g, ' ').trim();

function trigrams(s: string): Set<string> {
  const p = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
  return out;
}

/** Dice coefficient over character trigrams, 0..1. */
export function similarity(a: string, b: string): number {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const A = trigrams(x), B = trigrams(y);
  let inter = 0;
  A.forEach((g) => { if (B.has(g)) inter++; });
  return (2 * inter) / (A.size + B.size);
}

/** Deterministic duplicate candidate finder (also used as the no-API-key fallback). */
export function findDuplicateCandidates(items: Named[], threshold = 0.78, limit = 50): DupPair[] {
  const out: DupPair[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!, b = items[j]!;
      if (a.variant !== undefined && b.variant !== undefined && a.variant !== b.variant) continue;
      const s = similarity(`${a.name} ${a.extra ?? ''}`, `${b.name} ${b.extra ?? ''}`);
      if (s >= threshold) out.push({ a: a.id, b: b.id, score: Math.round(s * 100) / 100, reason: 'Very similar name' });
    }
  }
  return out.sort((p, q) => q.score - p.score).slice(0, limit);
}
