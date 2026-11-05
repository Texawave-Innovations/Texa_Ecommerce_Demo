import { getStorage } from 'firebase-admin/storage';
import type { Transaction, DocumentReference } from 'firebase-admin/firestore';
import type { z } from 'zod';
import { OcrInvoiceInput, PostPaymentInput, ResolveHoldInput, SaveInvoiceInput } from '@texafashions/types';
import { DEFAULT_TOLERANCE, dueDate, routeApproval, similarity, splitGst, tdsAmount, threeWayMatch, toInrPaise } from '@texafashions/domain';
import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, col, db, type Caller } from '../admin';
import { getClaude, CLAUDE_MODEL } from '../claude';
import { audit, fail, loadMatrix, must, requireRoles, reserveNumber } from '../engine';

type Doc = Record<string, any>;

// ───────────────────────── OCR
const bucketName = () => process.env.STORAGE_BUCKET ?? `${process.env.GCLOUD_PROJECT ?? 'demo-texafashions'}.appspot.com`;

export async function ocrInvoice(c: Caller, input: z.output<typeof OcrInvoiceInput>) {
  requireRoles(c, 'cfo', 'buyer');
  const po = input.poId ? ((await col('purchaseOrders').doc(input.poId).get()).data() as Doc | undefined) : undefined;
  const claude = getClaude();
  let extraction: Doc | null = null; let usedClaude = false;
  if (claude) {
    try {
      const file = getStorage().bucket(bucketName()).file(input.storagePath);
      const [buf] = await file.download();
      const [meta] = await file.getMetadata();
      const mt = String(meta.contentType ?? 'application/pdf');
      const data = buf.toString('base64');
      const block = mt === 'application/pdf'
        ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data } }
        : { type: 'image' as const, source: { type: 'base64' as const, media_type: (mt.startsWith('image/') ? mt : 'image/png') as 'image/png', data } };
      const res = await claude.messages.create({
        model: CLAUDE_MODEL, max_tokens: 2000,
        system: 'You extract data from supplier tax invoices. Reply with ONLY JSON: {"invoiceNo":string,"invoiceDate":"YYYY-MM-DD","vendorName":string,"gstin":string|null,"currency":string,"lines":[{"description":string,"sku":string|null,"qty":number,"unitPrice":number,"gstRate":number}],"total":number}. unitPrice is per unit before tax in major currency units.',
        messages: [{ role: 'user', content: [block, { type: 'text', text: 'Extract this invoice.' }] }],
      });
      const txt = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
      extraction = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
      usedClaude = true;
    } catch (e) { console.warn('Claude OCR failed, falling back to mock', e); }
  }
  if (!extraction) {
    // Mock OCR (no API key / call failed): propose the billable balance of the PO so the demo flow continues. Clearly labelled mock.
    extraction = {
      invoiceNo: `INV-${String(Math.floor(Math.random() * 90000) + 10000)}`, invoiceDate: new Date().toISOString().slice(0, 10), vendorName: po?.vendorName ?? 'Unknown', gstin: null, currency: po?.currency ?? 'INR',
      lines: ((po?.lines ?? []) as Doc[]).filter((l) => l.acceptedQty - l.billedQty > 0).map((l) => ({ description: l.name, sku: l.skuId, qty: l.acceptedQty - l.billedQty, unitPrice: l.unitPriceMinor / 100, gstRate: l.gstRate })), total: 0,
    };
  }
  // Map extracted lines onto PO SKUs (exact sku code, else best fuzzy name match ≥ 0.5)
  const poLines = (po?.lines ?? []) as Doc[];
  const lines = ((extraction.lines ?? []) as Doc[]).map((l) => {
    let match = poLines.find((p) => p.skuId === l.sku);
    let confidence = match ? 1 : 0;
    if (!match) for (const p of poLines) { const s = similarity(p.name, String(l.description ?? '')); if (s > confidence) { confidence = s; match = p; } }
    return { skuId: confidence >= 0.5 ? match?.skuId ?? null : null, description: l.description, qty: Math.round(Number(l.qty)), unitPriceMinor: Math.round(Number(l.unitPrice) * 100), gstRate: Number(l.gstRate ?? 0), confidence: Math.round(confidence * 100) / 100 };
  });
  return { usedClaude, mock: !usedClaude, invoiceNo: extraction.invoiceNo, invoiceDate: extraction.invoiceDate, vendorName: extraction.vendorName, gstin: extraction.gstin ?? null, currency: extraction.currency, lines };
}

// ───────────────────────── Invoice + match
async function matchSettings() {
  const s = (await col('settings').doc('matching').get()).data() as Doc | undefined;
  return { priceBps: s?.priceBps ?? DEFAULT_TOLERANCE.priceBps, qtyUnits: s?.qtyUnits ?? DEFAULT_TOLERANCE.qtyUnits, totalBps: s?.totalBps ?? DEFAULT_TOLERANCE.totalBps };
}
function runMatch(po: Doc, invLines: { skuId: string; qty: number; unitPriceMinor: number }[], tol: Awaited<ReturnType<typeof matchSettings>>) {
  const lines = po.lines as Doc[];
  return threeWayMatch(
    lines.map((l) => ({ skuId: l.skuId, orderedQty: l.qty, unitPriceMinor: l.unitPriceMinor })),
    lines.map((l) => ({ skuId: l.skuId, acceptedQty: l.acceptedQty })), invLines, Object.fromEntries(lines.map((l) => [l.skuId, l.billedQty])), tol,
  );
}
function money(po: Doc, lines: { qty: number; unitPriceMinor: number; gstRate: number }[]) {
  const rate = po.fxRatePaisePerUnit as number;
  let taxable = 0, tax = 0;
  lines.forEach((l) => { const t = toInrPaise(l.qty * l.unitPriceMinor, rate); taxable += t; tax += po.type === 'domestic' ? splitGst(t, l.gstRate, !!po.intraState).totalTaxPaise : 0; });
  return { taxablePaise: taxable, taxPaise: tax, totalPaise: taxable + tax };
}

/** Accepts an invoice into AP: bumps PO billed qty, creates the AP bill (net of unapplied debit notes). Caller must have done all reads. */
async function createBillWrites(tx: Transaction, c: Caller, invRef: DocumentReference, inv: Doc, po: Doc, poRef: DocumentReference, vendor: Doc, dns: FirebaseFirestore.QueryDocumentSnapshot[], overridden: boolean) {
  const poLines = (po.lines as Doc[]).map((l) => { const il = (inv.lines as Doc[]).find((x) => x.skuId === l.skuId); return il ? { ...l, billedQty: l.billedQty + il.qty } : l; });
  const net = inv.totalPaise as number; let dnApplied = 0;
  for (const d of dns) { const amt = Math.min(d.get('amountPaise') as number, net - dnApplied); if (amt > 0) { dnApplied += amt; tx.update(d.ref, { applied: true, appliedToInvoice: invRef.id }); } }
  const due = dueDate(new Date(inv.invoiceDate), po.paymentTermsDays ?? 30, !!vendor.isMsme);
  const billRef = col('apBills').doc(invRef.id);
  tx.set(billRef, {
    invoiceId: invRef.id, invoiceNo: inv.invoiceNo, vendorId: inv.vendorId, vendorName: inv.vendorName, poId: inv.poId, poNumber: inv.poNumber, invoiceDate: inv.invoiceDate, dueDate: due.toISOString().slice(0, 10), isMsme: !!vendor.isMsme,
    taxablePaise: inv.taxablePaise, taxPaise: inv.taxPaise, grossPaise: inv.totalPaise, debitNotePaise: dnApplied, totalPaise: inv.totalPaise - dnApplied, paidPaise: 0, balancePaise: inv.totalPaise - dnApplied,
    tdsRatePct: vendor.tdsRatePct ?? 0, status: 'open', overridden, createdAt: FieldValue.serverTimestamp(),
  });
  tx.update(poRef, { lines: poLines, 'flow.Invoice': { id: invRef.id, number: inv.invoiceNo } });
  tx.update(invRef, { status: overridden ? 'overridden' : 'matched', apBillId: billRef.id });
}

export async function saveInvoice(c: Caller, input: z.output<typeof SaveInvoiceInput>) {
  requireRoles(c, 'cfo');
  const poRef = col('purchaseOrders').doc(input.poId);
  const po = must((await poRef.get()).data() as Doc | undefined, 'PO not found');
  if (po.vendorId !== input.vendorId) fail('Invoice vendor does not match the PO');
  const dupe = await col('purchaseInvoices').where('vendorId', '==', input.vendorId).where('invoiceNo', '==', input.invoiceNo).limit(1).get();
  if (!dupe.empty) fail(`Invoice ${input.invoiceNo} from this vendor is already recorded`);
  const vendor = (await col('vendors').doc(input.vendorId).get()).data() as Doc;
  const tol = await matchSettings();
  const res = runMatch(po, input.lines, tol);
  const m = money(po, input.lines);
  const dns = (await col('debitNotes').where('poId', '==', input.poId).where('status', '==', 'issued').get()).docs.filter((d) => d.get('applied') === false);
  const invRef = col('purchaseInvoices').doc();
  return db.runTransaction(async (tx) => {
    const fresh = (await tx.get(poRef)).data() as Doc;
    const num = await reserveNumber(tx, 'PINV', 'WH-CENTRAL');
    const inv = {
      number: num.number, vendorId: input.vendorId, vendorName: po.vendorName, poId: input.poId, poNumber: po.number, invoiceNo: input.invoiceNo, invoiceDate: input.invoiceDate, filePath: input.filePath ?? null, ocrUsed: input.ocrUsed ?? null,
      lines: input.lines, currency: po.currency, ...m, freightMinor: input.freightMinor ?? 0, createdBy: c.uid, createdByName: c.name, createdAt: FieldValue.serverTimestamp(),
    };
    num.write();
    tx.set(invRef, { ...inv, status: res.status });
    tx.set(col('matchResults').doc(invRef.id), { invoiceId: invRef.id, invoiceNo: input.invoiceNo, poId: input.poId, ...res, tolerance: tol, at: FieldValue.serverTimestamp() });
    if (res.status === 'matched') await createBillWrites(tx, c, invRef, inv, fresh, poRef, vendor, dns, false);
    audit(tx, c, { action: 'save_invoice', entity: 'purchaseInvoices', entityId: invRef.id, before: null, after: { invoiceNo: input.invoiceNo, match: res.status, reasons: res.reasons } });
    return { id: invRef.id, status: res.status, reasons: res.reasons, totalPaise: m.totalPaise };
  });
}

export async function resolveHold(c: Caller, input: z.output<typeof ResolveHoldInput>) {
  requireRoles(c, 'cfo');
  const invRef = col('purchaseInvoices').doc(input.invoiceId);
  const inv = must((await invRef.get()).data() as Doc | undefined, 'Invoice not found');
  if (inv.status !== 'hold') fail(`Invoice is ${inv.status}, not on hold`);
  const poRef = col('purchaseOrders').doc(inv.poId);
  const vendor = (await col('vendors').doc(inv.vendorId).get()).data() as Doc;
  const dns = (await col('debitNotes').where('poId', '==', inv.poId).where('status', '==', 'issued').get()).docs.filter((d) => d.get('applied') === false);
  const tol = await matchSettings();
  return db.runTransaction(async (tx) => {
    const po = (await tx.get(poRef)).data() as Doc;
    if (input.action === 'reject') {
      tx.update(invRef, { status: 'rejected', holdNote: input.note, resolvedBy: c.uid, resolvedAt: FieldValue.serverTimestamp() });
      audit(tx, c, { action: 'reject_invoice', entity: 'purchaseInvoices', entityId: input.invoiceId, before: { status: 'hold' }, after: { note: input.note } });
      return { status: 'rejected' };
    }
    if (input.action === 'rematch') {
      const res = runMatch(po, inv.lines, tol);
      tx.set(col('matchResults').doc(input.invoiceId), { invoiceId: input.invoiceId, invoiceNo: inv.invoiceNo, poId: inv.poId, ...res, tolerance: tol, at: FieldValue.serverTimestamp(), rematched: true });
      if (res.status === 'matched') await createBillWrites(tx, c, invRef, inv, po, poRef, vendor, dns, false);
      audit(tx, c, { action: 'rematch_invoice', entity: 'purchaseInvoices', entityId: input.invoiceId, before: { status: 'hold' }, after: { status: res.status } });
      return { status: res.status, reasons: res.reasons };
    }
    await createBillWrites(tx, c, invRef, inv, po, poRef, vendor, dns, true);
    tx.update(invRef, { holdNote: input.note, resolvedBy: c.uid, resolvedAt: FieldValue.serverTimestamp() });
    audit(tx, c, { action: 'override_hold', entity: 'purchaseInvoices', entityId: input.invoiceId, before: { status: 'hold' }, after: { note: input.note } });
    return { status: 'overridden' };
  });
}

// ───────────────────────── Payments
export async function postPayment(c: Caller, input: z.output<typeof PostPaymentInput>) {
  requireRoles(c, 'cfo');
  const vendor = must((await col('vendors').doc(input.vendorId).get()).data() as Doc | undefined, 'Vendor not found');
  const rate = input.tdsOverridePct ?? vendor.tdsRatePct ?? 0;
  if (input.kind === 'advance') { if (!input.poId) fail('An advance needs a PO'); }
  else if (!input.invoiceIds?.length) fail('Choose the invoices (AP bills) to pay');
  const matrix = await loadMatrix();
  const route = routeApproval('PAYMENT', input.amountPaise, matrix, { role: c.claims.role, approvalLimitPaise: c.claims.approvalLimitPaise });
  const ref = col('paymentVouchers').doc();
  return db.runTransaction(async (tx) => {
    const num = await reserveNumber(tx, 'PAY', 'WH-CENTRAL');
    const base: Doc = {
      number: num.number, vendorId: input.vendorId, vendorName: vendor.name, kind: input.kind, poId: input.poId ?? null, invoiceIds: input.invoiceIds ?? [], amountPaise: input.amountPaise,
      tdsRatePct: rate, mode: input.mode, bankAccountId: input.bankAccountId ?? null, note: input.note ?? null, approverRole: route.approverRole, requestedBy: c.uid, requestedByName: c.name, createdAt: FieldValue.serverTimestamp(),
    };
    if (route.autoApprove) {
      await applyPaymentEffects(tx, c, ref, { ...base, status: 'pending_approval' }, { decidedBy: c.uid, decidedByName: `${c.name} (auto, within authority)`, decidedAt: FieldValue.serverTimestamp() });
      num.write();
      audit(tx, c, { action: 'post_payment', entity: 'paymentVouchers', entityId: ref.id, before: null, after: { number: num.number, amountPaise: input.amountPaise, status: 'posted' } });
      return { id: ref.id, number: num.number, status: 'posted' };
    }
    num.write();
    tx.set(ref, { ...base, status: 'pending_approval' });
    audit(tx, c, { action: 'request_payment', entity: 'paymentVouchers', entityId: ref.id, before: null, after: { number: num.number, amountPaise: input.amountPaise, approverRole: route.approverRole } });
    return { id: ref.id, number: num.number, status: 'pending_approval', approverRole: route.approverRole };
  });
}

/** Posts a payment: allocates to bills oldest-due first, computes TDS, updates bill/invoice/PO state. Does ALL reads before writes. */
const rows0poId = (bills: FirebaseFirestore.DocumentSnapshot[]) => (bills.find((b) => b.exists)?.get('poId') as string | undefined) ?? null;

export async function applyPaymentEffects(tx: Transaction, c: Caller, ref: DocumentReference, v: Doc, decided: Doc) {
  const billIds = (v.invoiceIds as string[]) ?? [];
  const bills = billIds.length ? await tx.getAll(...billIds.map((id) => col('apBills').doc(id))) : [];
  const poId = (v.poId ?? rows0poId(bills)) as string | null;
  const poRef = poId ? col('purchaseOrders').doc(poId) : null;
  const poSnap = poRef ? await tx.get(poRef) : null;
  const poBills = poId && v.kind !== 'advance' ? await tx.get(col('apBills').where('poId', '==', poId)) : null;
  const rows = bills.map((b) => must<Doc>(b.exists ? ({ ...(b.data() as Doc), id: b.id } as Doc) : null, 'AP bill not found')).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  rows.forEach((b) => { if (b.vendorId !== v.vendorId) fail('Bill belongs to another vendor'); });
  const open = rows.reduce((a, b) => a + b.balancePaise, 0);
  let remaining = v.amountPaise as number; let tds = 0;
  const allocations: { billId: string; paidPaise: number; tdsPaise: number }[] = [];
  if (v.kind === 'advance') tds = tdsAmount(remaining, v.tdsRatePct);
  else {
    if (v.amountPaise > open) fail(`Payment ₹${(v.amountPaise / 100).toFixed(2)} exceeds the outstanding ₹${(open / 100).toFixed(2)}`);
    if (v.kind === 'full' && v.amountPaise !== open) fail('A full payment must equal the outstanding balance of the selected bills');
    if (v.kind === 'part' && v.amountPaise >= open) fail('A part payment must be less than the outstanding balance — use "full"');
    for (const b of rows) {
      if (remaining <= 0) break;
      const pay = Math.min(b.balancePaise, remaining); remaining -= pay;
      const t = tdsAmount(Math.round(pay * (b.taxablePaise / b.grossPaise)), v.tdsRatePct);
      tds += t; allocations.push({ billId: b.id, paidPaise: pay, tdsPaise: t });
      const balance = b.balancePaise - pay;
      tx.update(col('apBills').doc(b.id), { paidPaise: b.paidPaise + pay, balancePaise: balance, status: balance === 0 ? 'paid' : 'partially_paid', lastPaymentId: ref.id });
      tx.update(col('purchaseInvoices').doc(b.invoiceId), { status: balance === 0 ? 'paid' : 'partially_paid' });
    }
  }
  if (poRef && poSnap?.exists) {
    // "Paid" step completes when every AP bill on the PO is fully settled after this payment.
    const paidNow = new Map(allocations.map((a) => [a.billId, a.paidPaise]));
    const allPaid = v.kind !== 'advance' && !!poBills && poBills.docs.length > 0 && poBills.docs.every((d) => (d.get('balancePaise') as number) - (paidNow.get(d.id) ?? 0) <= 0);
    const patch: Doc = { ...(v.kind === 'advance' ? { advancePaise: ((poSnap.get('advancePaise') as number) ?? 0) + v.amountPaise } : {}), ...(allPaid ? { 'flow.Paid': { id: ref.id, number: v.number } } : {}) };
    if (Object.keys(patch).length) tx.update(poRef, patch);
  }
  tx.set(ref, { ...v, status: 'posted', tdsPaise: tds, netPaise: (v.amountPaise as number) - tds, allocations, postedAt: FieldValue.serverTimestamp(), ...decided }, { merge: true });
  void c; void HttpsError;
}
