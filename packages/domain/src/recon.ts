/** Generic reconciliation matching engine — one engine, N recon types (see RECON_TYPES). No Firebase; pure TS. */

export interface ReconRow {
  id: string;
  refNo?: string | null;
  amountPaise: number;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  description?: string;
}

export type MatchRuleType = 'exact_ref_amount' | 'amount_date_window' | 'many_to_one';
export interface MatchRule {
  type: MatchRuleType;
  /** amount_date_window / many_to_one: how many days apart source and target may be. Default 2. */
  dateWindowDays?: number;
  /** Allowed absolute paise difference. Default 0 (exact). */
  amountTolerancePaise?: number;
}

export interface ReconTypeConfig {
  key: string;
  label: string;
  sourceLabel: string;
  targetLabel: string;
  rules: MatchRule[];
}

export interface ReconMatch {
  sourceIds: string[];
  targetIds: string[];
  amountPaise: number;
  confidence: number;
  rule: MatchRuleType;
}

export interface ReconMatchResult {
  matches: ReconMatch[];
  unmatchedSource: ReconRow[];
  unmatchedTarget: ReconRow[];
  matchRatePct: number;
}

const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/** Brute-force subset of `rows` (capped at 6 candidates — demo depth) summing to `target` within `tolerance`. */
function findSubsetSum(rows: ReconRow[], target: number, tolerance: number): ReconRow[] | null {
  const n = Math.min(rows.length, 6);
  for (let mask = 1; mask < 1 << n; mask++) {
    let sum = 0;
    const subset: ReconRow[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) { sum += rows[i]!.amountPaise; subset.push(rows[i]!); }
    if (Math.abs(sum - target) <= tolerance) return subset;
  }
  return null;
}

/**
 * Matches `source` rows (e.g. a bank/UPI/gateway statement) against `target` rows (our books) by applying `rules`
 * in order — each rule only sees what the previous rule left unmatched. Supports exact ref+amount (1:1, confidence 1),
 * amount+date-window (1:1 fuzzy), and many-to-one (several source rows summing to one target row, or vice versa).
 */
export function match(source: ReconRow[], target: ReconRow[], rules: MatchRule[]): ReconMatchResult {
  let remSource = [...source];
  let remTarget = [...target];
  const matches: ReconMatch[] = [];

  for (const rule of rules) {
    const usedS = new Set<string>();
    const usedT = new Set<string>();

    if (rule.type === 'exact_ref_amount') {
      const byRef = new Map<string, ReconRow[]>();
      remTarget.forEach((t) => { if (t.refNo) { const a = byRef.get(t.refNo) ?? []; a.push(t); byRef.set(t.refNo, a); } });
      for (const s of remSource) {
        if (!s.refNo) continue;
        const cand = (byRef.get(s.refNo) ?? []).find((t) => !usedT.has(t.id) && t.amountPaise === s.amountPaise);
        if (cand) { usedS.add(s.id); usedT.add(cand.id); matches.push({ sourceIds: [s.id], targetIds: [cand.id], amountPaise: s.amountPaise, confidence: 1, rule: rule.type }); }
      }
    } else if (rule.type === 'amount_date_window') {
      const win = rule.dateWindowDays ?? 2;
      const tol = rule.amountTolerancePaise ?? 0;
      for (const s of remSource) {
        let best: ReconRow | undefined; let bestDiff = Infinity;
        for (const t of remTarget) {
          if (usedT.has(t.id)) continue;
          if (Math.abs(t.amountPaise - s.amountPaise) > tol) continue;
          const d = dayDiff(s.date, t.date);
          if (d > win) continue;
          if (d < bestDiff) { bestDiff = d; best = t; }
        }
        if (best) {
          usedS.add(s.id); usedT.add(best.id);
          matches.push({ sourceIds: [s.id], targetIds: [best.id], amountPaise: s.amountPaise, confidence: Math.round(Math.max(0.5, 1 - bestDiff / (win + 1)) * 100) / 100, rule: rule.type });
        }
      }
    } else {
      // many_to_one: group several rows on ONE side to sum to a single row on the other side, within a date window.
      // Tried in both directions — e.g. several cash drops -> one deposit slip, or one gateway payout -> several web orders.
      const win = rule.dateWindowDays ?? 1;
      const tol = rule.amountTolerancePaise ?? 0;
      for (const t of remTarget) {
        if (usedT.has(t.id)) continue;
        const cands = remSource.filter((s) => !usedS.has(s.id) && dayDiff(s.date, t.date) <= win);
        const subset = findSubsetSum(cands, t.amountPaise, tol);
        if (subset && subset.length > 1) {
          subset.forEach((s) => usedS.add(s.id));
          usedT.add(t.id);
          matches.push({ sourceIds: subset.map((s) => s.id), targetIds: [t.id], amountPaise: t.amountPaise, confidence: 0.8, rule: rule.type });
        }
      }
      for (const s of remSource) {
        if (usedS.has(s.id)) continue;
        const cands = remTarget.filter((t) => !usedT.has(t.id) && dayDiff(s.date, t.date) <= win);
        const subset = findSubsetSum(cands, s.amountPaise, tol);
        if (subset && subset.length > 1) {
          subset.forEach((t) => usedT.add(t.id));
          usedS.add(s.id);
          matches.push({ sourceIds: [s.id], targetIds: subset.map((t) => t.id), amountPaise: s.amountPaise, confidence: 0.8, rule: rule.type });
        }
      }
    }

    remSource = remSource.filter((s) => !usedS.has(s.id));
    remTarget = remTarget.filter((t) => !usedT.has(t.id));
  }

  const denom = Math.max(source.length, target.length) || 1;
  const matchedCount = matches.reduce((a, m) => a + Math.max(m.sourceIds.length, m.targetIds.length), 0);
  return { matches, unmatchedSource: remSource, unmatchedTarget: remTarget, matchRatePct: Math.round((matchedCount / denom) * 1000) / 10 };
}

/** The 9 recon types this demo covers, each driven by the one generic `match()` engine above. */
export const RECON_TYPES: ReconTypeConfig[] = [
  { key: 'bank', label: 'Bank statement', sourceLabel: 'Bank statement', targetLabel: 'GL bank ledger', rules: [{ type: 'exact_ref_amount' }, { type: 'amount_date_window', dateWindowDays: 2 }] },
  { key: 'upi', label: 'UPI settlement', sourceLabel: 'UPI settlement file', targetLabel: 'POS UPI sales', rules: [{ type: 'exact_ref_amount' }, { type: 'amount_date_window', dateWindowDays: 1 }] },
  { key: 'card', label: 'Card settlement', sourceLabel: 'Card settlement file', targetLabel: 'POS card sales', rules: [{ type: 'exact_ref_amount' }, { type: 'amount_date_window', dateWindowDays: 2 }] },
  { key: 'gateway', label: 'Payment gateway', sourceLabel: 'Gateway payout file', targetLabel: 'Web order payments', rules: [{ type: 'exact_ref_amount' }, { type: 'many_to_one', dateWindowDays: 1 }] },
  { key: 'cod', label: 'COD remittance', sourceLabel: 'Courier COD remittance', targetLabel: 'COD orders', rules: [{ type: 'exact_ref_amount' }, { type: 'many_to_one', dateWindowDays: 3 }] },
  { key: 'cash', label: 'Cash deposits', sourceLabel: 'Bank cash deposit slips', targetLabel: 'Store cash drops', rules: [{ type: 'amount_date_window', dateWindowDays: 2 }, { type: 'many_to_one', dateWindowDays: 2 }] },
  { key: 'inventory_gl', label: 'Inventory vs GL', sourceLabel: 'Stock valuation', targetLabel: 'GL inventory ledger', rules: [{ type: 'exact_ref_amount' }, { type: 'amount_date_window', dateWindowDays: 0 }] },
  { key: 'gst_2b', label: 'GST vs 2B', sourceLabel: 'Books purchase invoices', targetLabel: 'GSTR-2B feed', rules: [{ type: 'exact_ref_amount' }] },
  { key: 'erp_tally', label: 'ERP vs Tally', sourceLabel: 'ERP journals', targetLabel: 'Tally sync log', rules: [{ type: 'exact_ref_amount' }] },
];
export type ReconTypeKey = (typeof RECON_TYPES)[number]['key'];
export const reconTypeConfig = (key: string): ReconTypeConfig => RECON_TYPES.find((t) => t.key === key) ?? RECON_TYPES[0]!;
