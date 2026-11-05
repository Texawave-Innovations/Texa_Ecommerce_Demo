import type { z } from 'zod';
import type { ProcessReturnInput, VoidSaleInput } from '@texafashions/types';
import { apportion, buildReturnJournal, financialYear, journalBalanced, refundForQty, reverseJournal, type JournalLine } from '@texafashions/domain';
import { FieldValue, col, db, type Caller } from '../admin';
import { StockEngine, audit, fail, getMasterDocs, must, requireLocation, requireRoles, reserveNumber, ymd } from '../engine';
import { requireManagerPin } from './pin';
import { sanitiseId } from './util';

type Doc = Record<string, any>;
const BIG_REFUND_PAISE = 500_000, MAX_AGE_MS = 7 * 86_400_000;

interface Req { kind: 'return' | 'void'; saleId: string; storeId: string; tillId: string; shiftId: string; lines?: { lineId: string; qty: number; reasonCode: string }[]; refundMode: 'CASH' | 'CN' | 'ORIGINAL'; reasonCode?: string; managerPin?: string | null; note?: string | null }

export const processReturn = (c: Caller, i: z.output<typeof ProcessReturnInput>) => reverseSale(c, { kind: 'return', ...i });
export const voidSale = (c: Caller, i: z.output<typeof VoidSaleInput>) => reverseSale(c, { kind: 'void', ...i, refundMode: 'ORIGINAL' });

async function reverseSale(c: Caller, r: Req) {
  requireRoles(c, 'cashier', 'store_manager'); requireLocation(c, r.storeId);
  const saleRef = col('sales').doc(r.saleId);
  const reasonIds = r.kind === 'void' ? [r.reasonCode!] : r.lines!.map((l) => l.reasonCode);
  const reasons = await getMasterDocs<Doc>('reasonCodes', reasonIds);
  for (const id of reasonIds) if (!reasons.has(id)) fail(`Unknown reason code ${id}`);

  return db.runTransaction(async (tx) => {
    const sSnap = await tx.get(saleRef);
    const sale = must(sSnap.data() as Doc | undefined, 'Sale not found');
    if (sale.storeId !== r.storeId) fail('Sale belongs to another store');
    if (sale.status === 'voided' || sale.status === 'returned') fail(`Sale is already ${sale.status}`);
    const refs = {
      shift: col('shifts').doc(r.shiftId),
      cust: sale.customer?.id ? col('customers').doc(sale.customer.id) : null,
      journal: r.kind === 'void' && sale.journalId ? col('journals').doc(sale.journalId) : null,
      voucher: r.kind === 'void' && sale.voucherCode ? col('vouchers').doc(sale.voucherCode) : null,
      instr: r.refundMode === 'ORIGINAL' ? (sale.payments as Doc[]).filter((p) => (p.mode === 'GC' || p.mode === 'CN') && p.ref).map((p) => ({ p, ref: col(p.mode === 'GC' ? 'giftCards' : 'creditNotes').doc(p.ref) })) : [],
    };
    const snaps = await tx.getAll(refs.shift, ...(refs.cust ? [refs.cust] : []), ...(refs.journal ? [refs.journal] : []), ...(refs.voucher ? [refs.voucher] : []), ...refs.instr.map((x) => x.ref));
    let k = 0; const shift = snaps[k++]!.data() as Doc | undefined; const cust = refs.cust ? snaps[k++]!.data() as Doc | undefined : undefined;
    const jSnap = refs.journal ? snaps[k++]! : null; const vSnap = refs.voucher ? snaps[k++]! : null; const instrSnaps = refs.instr.map(() => snaps[k++]!);
    if (!shift || shift.status !== 'open' || shift.storeId !== r.storeId || shift.tillId !== r.tillId) fail('Shift is not open on this till');

    // ── what is being returned
    const reqLines = r.kind === 'void' ? (sale.lines as Doc[]).map((l) => ({ lineId: l.lineId, qty: l.qty - l.returnedQty, reasonCode: r.reasonCode! })).filter((l) => l.qty > 0) : r.lines!;
    if (r.kind === 'void') {
      if (sale.shiftId !== r.shiftId) fail('A bill can only be voided in the shift it was created');
      if (ymd(sale.createdAt.toDate()) !== ymd()) fail('A bill can only be voided on the day it was created — use a return instead');
      if (sale.status !== 'completed') fail('Bills with returns cannot be voided');
    }
    const lines = (sale.lines as Doc[]).map((l) => ({ ...l }));
    const out: { lineId: string; skuId: string; name: string; qty: number; refundPaise: number; reasonCode: string; gstRate: number; unitCostPaise: number; isService: boolean }[] = [];
    for (const rl of reqLines) {
      const l = lines.find((x) => x.lineId === rl.lineId); if (!l) fail(`Line ${rl.lineId} is not on this bill`);
      if (rl.qty > l.qty - l.returnedQty) fail(`Only ${l.qty - l.returnedQty} unit(s) of "${l.name}" can still be returned`);
      const refundPaise = refundForQty({ lineNetPaise: l.netPaise, soldQty: l.qty, returnedQty: l.returnedQty, refundedPaise: l.refundedPaise, qty: rl.qty });
      out.push({ lineId: l.lineId, skuId: l.skuId, name: l.name, qty: rl.qty, refundPaise, reasonCode: rl.reasonCode, gstRate: l.gstRate, unitCostPaise: l.unitCostPaise ?? 0, isService: !!l.isService });
      l.returnedQty += rl.qty; l.refundedPaise += refundPaise;
    }
    if (!out.length) fail('Nothing to return');
    const refund = r.kind === 'void' ? sale.payablePaise : out.reduce((a, x) => a + x.refundPaise, 0);

    // ── manager approval
    const needs = r.kind === 'void' || out.some((x) => reasons.get(x.reasonCode)?.needsApproval) || refund > BIG_REFUND_PAISE || Date.now() - sale.createdAt.toMillis() > MAX_AGE_MS;
    const mgr = needs ? await requireManagerPin(r.storeId, r.managerPin) : undefined;

    // ── refund tenders
    let parts: { mode: string; amountPaise: number; ref?: string }[];
    if (r.refundMode === 'ORIGINAL') {
      const pays: Doc[] = (sale.payments as Doc[]).map((p) => ({ ...p, applied: p.mode === 'CASH' ? p.amountPaise - (sale.changeGivenPaise ?? 0) : p.amountPaise })).filter((p) => p.applied > 0);
      const split = refund > 0 && pays.length ? apportion(refund, pays.map((p) => p.applied)) : [];
      parts = pays.map((p, i) => ({ mode: p.mode, amountPaise: split[i]!, ref: p.ref })).filter((p) => p.amountPaise > 0);
    } else parts = refund > 0 ? [{ mode: r.refundMode, amountPaise: refund }] : [];
    const cashRefund = parts.filter((p) => p.mode === 'CASH').reduce((a, p) => a + p.amountPaise, 0);

    // ── numbering, stock
    const retNum = await reserveNumber(tx, 'RET', r.storeId);
    const cnNum = r.refundMode === 'CN' && refund > 0 ? await reserveNumber(tx, 'CN', r.storeId) : null;
    const eng = await StockEngine.load(tx, out.filter((x) => !x.isService).map((x) => [r.storeId, x.skuId] as [string, string]), { ignoreLock: true });
    const retRef = col('returns').doc();
    for (const x of out) {
      if (x.isService) continue;
      const damaged = r.kind === 'return' && x.reasonCode === 'RC-RET-DEF';
      eng.move({ locationId: r.storeId, skuId: x.skuId, bucket: damaged ? 'damaged' : 'onHand', qty: x.qty, kind: 'receipt', refType: r.kind === 'void' ? 'void' : 'return', refId: retRef.id, unitCostPaise: x.unitCostPaise, reason: `${r.kind} ${sale.invoiceNo} — ${x.reasonCode}` });
    }

    // ── journal
    let jl: JournalLine[];
    if (r.kind === 'void' && jSnap?.exists) jl = reverseJournal((jSnap.data() as Doc).lines as JournalLine[]);
    else jl = buildReturnJournal(out.map((x) => ({ refundPaise: x.refundPaise, gstRate: x.gstRate, intraState: true, restockCostPaise: x.unitCostPaise * x.qty, damaged: r.kind === 'return' && x.reasonCode === 'RC-RET-DEF' })), parts.map((p) => ({ mode: p.mode, amountPaise: p.amountPaise })));
    if (!journalBalanced(jl)) fail('Internal error: return journal does not balance');

    // ── loyalty clawback / restore
    const earnedLeft = (sale.pointsEarned ?? 0) - (sale.pointsClawedBack ?? 0);
    const claw = r.kind === 'void' ? earnedLeft : Math.min(earnedLeft, Math.round(((sale.pointsEarned ?? 0) * refund) / Math.max(1, sale.payablePaise)));
    const pointsBack = parts.filter((p) => p.mode === 'POINTS').reduce((a, p) => a + Math.floor(p.amountPaise / 100), 0);

    // ── writes
    if (cnNum) cnNum.write();
    retNum.write(); eng.commit(tx, c);
    const cnId = cnNum ? sanitiseId(cnNum.number) : undefined;
    if (cnNum && cnId) tx.set(col('creditNotes').doc(cnId), { number: cnNum.number, storeId: r.storeId, customerId: sale.customer?.id ?? null, balancePaise: refund, issuedPaise: refund, status: 'active', expiresAt: new Date(Date.now() + 365 * 86_400_000 + 5.5 * 3600_000).toISOString().slice(0, 10), saleId: r.saleId, returnId: retRef.id, createdAt: FieldValue.serverTimestamp() });
    refs.instr.forEach((x, i) => {
      const s = instrSnaps[i]!; const amt = parts.find((p) => p.mode === x.p.mode && p.ref === x.p.ref)?.amountPaise ?? 0; if (!s.exists || !amt) return;
      const bal = (s.get('balancePaise') ?? 0) + amt;
      tx.update(s.ref, { balancePaise: bal, status: 'active', updatedAt: FieldValue.serverTimestamp() });
      if (x.p.mode === 'GC') tx.set(s.ref.collection('txns').doc(), { kind: 'refund', amountPaise: amt, balanceAfterPaise: bal, saleId: r.saleId, storeId: r.storeId, at: FieldValue.serverTimestamp() });
    });
    if (vSnap?.exists) tx.update(vSnap.ref, { redemptionCount: FieldValue.increment(-1), status: 'active', ...(sale.customer?.id ? { [`redeemedByCustomer.${sale.customer.id}`]: FieldValue.increment(-1) } : {}) });
    if (cust && refs.cust && (claw || pointsBack)) {
      const bal = Math.max(0, (cust.pointsBalance ?? 0) - claw + pointsBack);
      tx.update(refs.cust, { pointsBalance: bal });
      if (claw) tx.set(col('loyaltyLedger').doc(), { customerId: sale.customer.id, kind: 'clawback', points: -claw, saleId: r.saleId, storeId: r.storeId, at: FieldValue.serverTimestamp() });
      if (pointsBack) tx.set(col('loyaltyLedger').doc(), { customerId: sale.customer.id, kind: 'refund', points: pointsBack, saleId: r.saleId, storeId: r.storeId, at: FieldValue.serverTimestamp() });
    }
    const payingLines = lines.filter((l) => l.netPaise > 0);
    const status = r.kind === 'void' ? 'voided' : payingLines.every((l) => l.returnedQty >= l.qty) ? 'returned' : 'partially_returned';
    tx.update(saleRef, { lines, status, pointsClawedBack: (sale.pointsClawedBack ?? 0) + claw, ...(r.kind === 'void' ? { voidedAt: FieldValue.serverTimestamp(), voidReason: r.reasonCode } : {}) });
    const retDoc = {
      returnNo: retNum.number, saleId: r.saleId, invoiceNo: sale.invoiceNo, storeId: r.storeId, tillId: r.tillId, shiftId: r.shiftId, kind: r.kind,
      lines: out.map((x) => ({ lineId: x.lineId, skuId: x.skuId, name: x.name, qty: x.qty, refundPaise: x.refundPaise, reasonCode: x.reasonCode })),
      refundPaise: refund, refundMode: r.refundMode, refundParts: parts.map((p) => ({ mode: p.mode, amountPaise: p.amountPaise })), cashRefundPaise: cashRefund, creditNoteId: cnId ?? null, approvedBy: mgr?.name ?? null,
      createdBy: c.uid, createdByName: c.name, note: r.note ?? null, createdAt: FieldValue.serverTimestamp(),
    };
    tx.set(retRef, retDoc);
    tx.set(col('journals').doc(), { event: r.kind, refType: 'return', refId: retRef.id, saleId: r.saleId, storeId: r.storeId, day: ymd(), lines: jl, balanced: true, at: FieldValue.serverTimestamp() });
    audit(tx, c, { action: r.kind === 'void' ? 'sale_void' : 'sale_return', entity: 'sales', entityId: r.saleId, before: { status: sale.status }, after: { status, refundPaise: refund, returnNo: retNum.number, approvedBy: mgr?.name ?? null, fy: financialYear(new Date()) } });
    return { returnId: retRef.id, returnNo: retNum.number, refundPaise: refund, cashRefundPaise: cashRefund, refundParts: retDoc.refundParts, saleStatus: status, approvedBy: mgr?.name ?? null, creditNote: cnId ? { id: cnId, number: cnNum!.number, balancePaise: refund } : null } as Record<string, unknown>;
  });
}
