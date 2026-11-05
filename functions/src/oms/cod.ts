import type { z } from 'zod';
import type { ImportCodRemittanceInput, SimulateCodRemittanceInput } from '@texafashions/types';
import { journalBalanced, reconcileCod, type JournalLine } from '@texafashions/domain';
import { FieldValue, Timestamp, col, db, type Caller } from '../admin';
import { audit, fail, requireRoles, ymd } from '../engine';
import type { Doc } from './orders';

const stamp = () => FieldValue.serverTimestamp();
export const MAX_REMITTANCE_LINES = 200;
const CODE_RE = /[^A-Za-z0-9_-]/g;

/**
 * Courier COD remittance advice → reconciled against delivered, unremitted COD parcels by AWB.
 * Journal: Dr Bank (remitted − fees) · Dr courier fees · Cr COD receivable (what was applied to known parcels) · Cr Suspense (unknown / duplicate / excess).
 * A short payment keeps the shortfall in COD receivable and marks the parcel `short_paid` (dispute).
 */
export async function importCodRemittance(c: Caller, i: z.output<typeof ImportCodRemittanceInput>) {
  requireRoles(c, 'cfo');
  if (i.lines.length > MAX_REMITTANCE_LINES) fail(`Split the file into batches of at most ${MAX_REMITTANCE_LINES} AWBs`);
  const id = `${i.courier}-${i.utr}`.replace(CODE_RE, '-'); const ref = col('codRemittances').doc(id);
  const open = await col('shipments').where('codStatus', '==', 'with_courier').get();
  const mine = open.docs.filter((d) => d.get('courier') === i.courier);
  const recon = reconcileCod(mine.map((d) => ({ awb: d.get('awb') as string, amountPaise: d.get('codAmountPaise') as number })), i.lines);
  const byAwb = new Map(mine.map((d) => [d.get('awb') as string, d.ref]));
  const applied = recon.rows.filter((r) => r.status === 'matched' || r.status === 'short' || r.status === 'excess').reduce((a, r) => a + Math.min(r.remittedPaise, r.expectedPaise), 0);
  const suspense = recon.remittedPaise - applied;
  const journal: JournalLine[] = [
    { ledgerId: 'L-BANK-HDFC', drPaise: recon.remittedPaise - i.feesPaise, crPaise: 0, narration: `COD remittance ${i.courier} ${i.utr}` },
    ...(i.feesPaise ? [{ ledgerId: 'L-FREIGHT-OUT', drPaise: i.feesPaise, crPaise: 0, narration: 'Courier COD fee' }] : []),
    ...(applied ? [{ ledgerId: 'L-COD-CLR', drPaise: 0, crPaise: applied }] : []),
    ...(suspense ? [{ ledgerId: 'L-SUSPENSE', drPaise: 0, crPaise: suspense, narration: 'Unmatched / excess courier receipts' }] : []),
  ];
  if (i.feesPaise > recon.remittedPaise) fail('Fees exceed the remitted amount');
  if (!journalBalanced(journal)) fail('Internal error: remittance journal does not balance');
  return db.runTransaction(async (tx) => {
    const dup = await tx.get(ref);
    if (dup.exists) fail(`Remittance ${i.utr} from ${i.courier} was already imported`);
    const live = await tx.getAll(...recon.rows.filter((r) => byAwb.has(r.awb)).map((r) => byAwb.get(r.awb)!));
    const still = new Set(live.filter((s) => s.get('codStatus') === 'with_courier').map((s) => s.get('awb') as string));
    for (const r of recon.rows) {
      if (!still.has(r.awb)) continue;
      tx.update(byAwb.get(r.awb)!, { codStatus: r.status === 'short' ? 'short_paid' : 'remitted', codRemittedPaise: r.remittedPaise, codShortPaise: r.status === 'short' ? -r.diffPaise : 0, remittanceId: id, remittedAt: stamp() });
    }
    const jRef = col('journals').doc();
    tx.set(jRef, { event: 'cod_remittance', refType: 'codRemittance', refId: id, storeId: 'ONL', day: ymd(), lines: journal, balanced: true, at: stamp() });
    tx.create(ref, {
      courier: i.courier, utr: i.utr, remittedOn: i.remittedOn, rows: recon.rows, remittedPaise: recon.remittedPaise, feesPaise: i.feesPaise, netBankPaise: recon.remittedPaise - i.feesPaise, matchedPaise: recon.matchedPaise, shortPaise: recon.shortPaise,
      excessPaise: recon.excessPaise, suspensePaise: suspense, pendingAwbs: recon.pendingAwbs, issues: recon.rows.filter((r) => r.status !== 'matched').length, journalId: jRef.id,
      status: recon.rows.every((r) => r.status === 'matched') ? 'reconciled' : 'needs_review', importedBy: c.uid, importedByName: c.name, createdAt: stamp(),
    });
    audit(tx, c, { action: 'cod_remittance_imported', entity: 'codRemittances', entityId: id, before: null, after: { courier: i.courier, utr: i.utr, remittedPaise: recon.remittedPaise, short: recon.shortPaise, suspense } });
    return { id, status: recon.rows.every((r) => r.status === 'matched') ? 'reconciled' : 'needs_review', remittedPaise: recon.remittedPaise, matchedPaise: recon.matchedPaise, shortPaise: recon.shortPaise, suspensePaise: suspense, issues: recon.rows.filter((r) => r.status !== 'matched').length, pending: recon.pendingAwbs.length };
  });
}

/** Demo: fabricates the courier's remittance file for the courier holding the most cash — with a short payment and one unknown AWB so the reconciliation has something to catch. */
export async function simulateCodRemittance(c: Caller, i: z.output<typeof SimulateCodRemittanceInput>) {
  requireRoles(c, 'cfo');
  const open = await col('shipments').where('codStatus', '==', 'with_courier').get();
  if (!open.size) fail('No delivered COD parcels are waiting for remittance — simulate a COD order and mark it delivered first');
  const by = new Map<string, Doc[]>(); for (const d of open.docs) { const k = d.get('courier') as string; by.set(k, [...(by.get(k) ?? []), d.data() as Doc]); }
  const [courierName, ships] = [...by].sort((a, b) => b[1].length - a[1].length)[0]!;
  const batch = ships.slice(0, MAX_REMITTANCE_LINES - 1); const short = Math.min(i.shortLines ?? 1, batch.length);
  const lines = batch.map((s, k) => ({ awb: s.awb as string, amountPaise: k < short ? Math.round((s.codAmountPaise as number) * 0.9) : (s.codAmountPaise as number) }));
  lines.push({ awb: `ZZ${String(Date.now()).slice(-9)}`, amountPaise: 49900 });
  const fees = batch.reduce((a, s) => a + (s.codFeePaise as number), 0);
  return importCodRemittance(c, { courier: courierName, utr: `SIM${Date.now()}`, remittedOn: new Date().toISOString().slice(0, 10), lines, feesPaise: fees });
}
export { Timestamp };
