/** Reconciliation Centre callables — one generic matching engine (`@texafashions/domain#match`), 9 config-driven
 * recon types. `reconFeeds` holds both sides of every type (seeded from CSVs in scripts/seed/recon/, `side: 'source'|'target'`)
 * so the loader is identical for all 9 — only the config differs. */
import type { z } from 'zod';
import { match, reconTypeConfig, type ReconRow } from '@texafashions/domain';
import type { DecideReconMatchInput, ReconAiSuggestInput, RunReconInput } from '@texafashions/types';
import { CLAUDE_MODEL, getClaude } from '../claude';
import { col, db, FieldValue, type Caller } from '../admin';
import { requireRoles } from '../engine';

type Doc = Record<string, any>;
const HQ_FIN = ['cfo', 'super_admin', 'auditor'] as const;

async function loadFeed(type: string, side: 'source' | 'target'): Promise<ReconRow[]> {
  const snap = await col('reconFeeds').where('type', '==', type).where('side', '==', side).get();
  return snap.docs.map((d) => { const r = d.data() as Doc; return { id: d.id, refNo: r.refNo ?? null, amountPaise: r.amountPaise, date: r.date, description: r.description ?? '' }; });
}

/** Runs the generic engine for one recon type, persists the run + every item, returns the summary for immediate UI render. */
export async function runRecon(c: Caller, i: z.output<typeof RunReconInput>) {
  requireRoles(c, ...HQ_FIN);
  const config = reconTypeConfig(i.type);
  const [source, target] = await Promise.all([loadFeed(i.type, 'source'), loadFeed(i.type, 'target')]);
  const byId = new Map([...source, ...target].map((r) => [r.id, r]));
  const result = match(source, target, config.rules);

  // Clear this type's previous items so re-running replaces rather than accumulates (demo depth: no run history diffing).
  const prev = await col('reconItems').where('type', '==', i.type).get();
  const delBatch = db.batch();
  prev.docs.forEach((d) => delBatch.delete(d.ref));
  await delBatch.commit();

  const runRef = col('reconRuns').doc();
  const batch = db.batch();
  result.matches.forEach((m) => {
    batch.set(col('reconItems').doc(), {
      runId: runRef.id, type: i.type, status: 'matched', rule: m.rule, confidence: m.confidence, amountPaise: m.amountPaise,
      sourceIds: m.sourceIds, targetIds: m.targetIds,
      sourceRows: m.sourceIds.map((id) => byId.get(id) ?? null), targetRows: m.targetIds.map((id) => byId.get(id) ?? null),
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  result.unmatchedSource.forEach((r) => batch.set(col('reconItems').doc(), { runId: runRef.id, type: i.type, status: 'unmatched_source', amountPaise: r.amountPaise, sourceIds: [r.id], targetIds: [], sourceRows: [r], targetRows: [], createdAt: FieldValue.serverTimestamp() }));
  result.unmatchedTarget.forEach((r) => batch.set(col('reconItems').doc(), { runId: runRef.id, type: i.type, status: 'unmatched_target', amountPaise: r.amountPaise, sourceIds: [], targetIds: [r.id], sourceRows: [], targetRows: [r], createdAt: FieldValue.serverTimestamp() }));
  batch.set(runRef, {
    type: i.type, matchRatePct: result.matchRatePct, matchedCount: result.matches.length,
    unmatchedSourceCount: result.unmatchedSource.length, unmatchedTargetCount: result.unmatchedTarget.length,
    sourceCount: source.length, targetCount: target.length, runBy: c.name, runAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  return { runId: runRef.id, matchRatePct: result.matchRatePct, matchedCount: result.matches.length, unmatchedSourceCount: result.unmatchedSource.length, unmatchedTargetCount: result.unmatchedTarget.length };
}

/** Accept/reject an AI-suggested (or auto-matched) pair — maker-checker is skipped in this demo; any HQ finance role can decide. */
export async function decideReconMatch(c: Caller, i: z.output<typeof DecideReconMatchInput>) {
  requireRoles(c, ...HQ_FIN);
  const ref = col('reconItems').doc(i.itemId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Recon item not found');
  await ref.set({ status: i.decision === 'accept' ? 'matched' : 'rejected', decidedBy: c.name, decidedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { itemId: i.itemId, status: i.decision === 'accept' ? 'matched' : 'rejected' };
}

/** Sends only the current unmatched rows (capped at 50) to Claude and asks it to propose likely pairs with confidence.
 * Suggestions are written as `ai_suggested` items for the user to accept/reject — never auto-applied. Falls back to a
 * deterministic closest-amount pairing when no API key is configured. */
export async function reconAiSuggest(c: Caller, i: z.output<typeof ReconAiSuggestInput>) {
  requireRoles(c, ...HQ_FIN);
  const items = await col('reconItems').where('type', '==', i.type).where('status', 'in', ['unmatched_source', 'unmatched_target']).get();
  const sourceItems = items.docs.filter((d) => d.get('status') === 'unmatched_source').slice(0, 50);
  const targetItems = items.docs.filter((d) => d.get('status') === 'unmatched_target').slice(0, 50);
  if (!sourceItems.length || !targetItems.length) return { suggested: 0, usedClaude: false };

  const source = sourceItems.map((d) => ({ itemId: d.id, ...(d.get('sourceRows')?.[0] ?? {}) }));
  const target = targetItems.map((d) => ({ itemId: d.id, ...(d.get('targetRows')?.[0] ?? {}) }));

  const claude = getClaude();
  let pairs: { sourceItemId: string; targetItemId: string; confidence: number; reason?: string }[] = [];
  let usedClaude = false;
  if (claude) {
    try {
      const res = await claude.messages.create({
        model: CLAUDE_MODEL, max_tokens: 1500,
        system: 'You reconcile two lists of financial transactions (source = external statement, target = our books) that a simple amount/date matcher could not pair automatically. Propose only pairs you are reasonably confident about (e.g. amounts close but not exact due to fees/rounding, or dates further apart than a simple window). Reply with ONLY JSON: {"pairs":[{"sourceItemId":string,"targetItemId":string,"confidence":number (0-1),"reason":string}]}. Never pair the same id twice.',
        messages: [{ role: 'user', content: `source (unmatched statement rows): ${JSON.stringify(source)}\n\ntarget (unmatched book rows): ${JSON.stringify(target)}` }],
      });
      const txt = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
      pairs = (JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)).pairs ?? []) as typeof pairs;
      usedClaude = true;
    } catch (e) { console.warn('Claude recon suggest failed, falling back to closest-amount pairing', e); }
  }
  if (!usedClaude) {
    const usedTargets = new Set<string>();
    for (const s of source) {
      let best: (typeof target)[number] | undefined; let bestDiff = Infinity;
      for (const t of target) { if (usedTargets.has(t.itemId)) continue; const diff = Math.abs((t.amountPaise ?? 0) - (s.amountPaise ?? 0)); if (diff < bestDiff) { bestDiff = diff; best = t; } }
      if (best && bestDiff <= Math.max(500, (s.amountPaise ?? 0) * 0.05)) { usedTargets.add(best.itemId); pairs.push({ sourceItemId: s.itemId, targetItemId: best.itemId, confidence: 0.6, reason: 'Closest amount (mock — no Claude key configured)' }); }
    }
  }

  const sourceIds = new Set(source.map((s) => s.itemId));
  const targetIds = new Set(target.map((t) => t.itemId));
  const seen = new Set<string>();
  const batch = db.batch();
  let suggested = 0;
  for (const p of pairs) {
    if (!sourceIds.has(p.sourceItemId) || !targetIds.has(p.targetItemId) || seen.has(p.sourceItemId) || seen.has(p.targetItemId)) continue;
    seen.add(p.sourceItemId); seen.add(p.targetItemId);
    const sRow = source.find((s) => s.itemId === p.sourceItemId)!;
    const tRow = target.find((t) => t.itemId === p.targetItemId)!;
    batch.set(col('reconItems').doc(), {
      runId: null, type: i.type, status: 'ai_suggested', rule: 'ai_suggest', confidence: Math.max(0, Math.min(1, p.confidence ?? 0.5)), reason: p.reason ?? null,
      amountPaise: sRow.amountPaise ?? tRow.amountPaise, sourceIds: [sRow.id], targetIds: [tRow.id], sourceRows: [sRow], targetRows: [tRow], createdAt: FieldValue.serverTimestamp(),
    });
    batch.delete(col('reconItems').doc(p.sourceItemId));
    batch.delete(col('reconItems').doc(p.targetItemId));
    suggested++;
  }
  await batch.commit();
  return { suggested, usedClaude };
}
