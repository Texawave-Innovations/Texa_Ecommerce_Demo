import type { Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import type { AllocateOrderInput, CancelOrderInput } from '@texafashions/types';
import {
  DEFAULT_ALLOC_POLICY, allocateOrder, deriveOrderStatus, orderTotalVariance, riskScore, type AllocLine, type Allocation, type AllocLocation, type NormalisedWebOrder,
} from '@texafashions/domain';
import { FieldValue, Timestamp, col, db, type Caller } from '../admin';
import { StockEngine, audit, fail, getMasterDocs, must, requireRoles, reserveNumber } from '../engine';

export type Doc = Record<string, any>;
export const OMS_SYSTEM: Caller = { uid: 'shopify-connector', name: 'Shopify connector', claims: { role: 'super_admin', storeIds: [], approvalLimitPaise: 0 } };
export const OPS_ROLES = ['warehouse_manager', 'store_manager', 'sales_associate', 'cashier'] as const;
export const requireOps = (c: Caller) => requireRoles(c, ...OPS_ROLES);
export const SLA_HOURS = 24;
const stamp = () => FieldValue.serverTimestamp();
const iso = () => new Date().toISOString();

export interface LocInfo { id: string; name: string; kind: 'warehouse' | 'store'; state?: string; city?: string; gstinId?: string }
export async function loadLocations(): Promise<LocInfo[]> {
  const [w, s] = await Promise.all([col('warehouses').get(), col('stores').get()]);
  const one = (kind: LocInfo['kind']) => (d: FirebaseFirestore.QueryDocumentSnapshot): LocInfo => ({ id: d.id, name: d.get('name'), kind, state: d.get('state'), city: d.get('city'), gstinId: d.get('gstinId') });
  return [...w.docs.filter((d) => d.get('status') !== 'inactive').map(one('warehouse')), ...s.docs.filter((d) => d.get('status') !== 'inactive').map(one('store'))];
}

/** Order status is rolled up from `units` (one per pick list) kept on the order doc, so every mutation only touches the order + its own pick list. */
export function rollup(order: Doc, units: Doc[], extra: { cancelled?: boolean } = {}): string {
  return deriveOrderStatus({ cancelled: extra.cancelled ?? order.status === 'cancelled', awaitingStock: order.awaitingStock && !units.length, pickLists: units.map((u) => ({ status: u.status })), shipments: units.filter((u) => u.shipmentId).map((u) => ({ status: u.shipmentStatus })) });
}
export const patchUnit = (units: Doc[], pickListId: string, patch: Doc) => units.map((u) => (u.pickListId === pickListId ? { ...u, ...patch } : u));

/** Allocation view of stock: reads the (already loaded) engine, so it sees this transaction's earlier moves. */
function allocView(locs: LocInfo[], eng: StockEngine, skuIds: string[]): AllocLocation[] {
  return locs.map((l) => ({ id: l.id, kind: l.kind, state: l.state, city: l.city, stock: Object.fromEntries(skuIds.map((s) => { const d = eng.get(l.id, s); return [s, { onHand: d.onHand, reserved: d.reserved ?? 0 }]; })) }));
}
export const stockPairs = (locs: LocInfo[], skuIds: string[]) => locs.flatMap((l) => skuIds.map((s) => [l.id, s] as [string, string]));

/**
 * Reserves stock and writes one pick list per allocation. Must run AFTER all transaction reads and BEFORE `eng.commit`.
 * Exact money: every SKU keeps `unallocQty/unallocNet`; each part takes a pro-rata share and the last part takes the remainder.
 */
export function writePickLists(tx: Transaction, o: { orderId: string; order: Doc; allocations: Allocation[]; eng: StockEngine; locs: LocInfo[]; skus: Map<string, Doc> }) {
  const { orderId, order, allocations, eng, locs, skus } = o;
  const lines: Doc[] = order.lines.map((l: Doc) => ({ ...l }));
  const units: Doc[] = []; let shippingLeft = order.shippingUnassignedPaise ?? order.shippingPaise ?? 0; let n = order.pickListCount ?? 0;
  for (const a of allocations) {
    const loc = must(locs.find((l) => l.id === a.locationId), `Unknown location ${a.locationId}`);
    n++; const id = `${orderId}_P${n}`; const number = `${order.number}-P${n}`;
    const plLines = a.lines.map((al) => {
      const ol = must(lines.find((l) => l.skuId === al.skuId), `Order has no line ${al.skuId}`);
      const net = al.qty === ol.unallocQty ? ol.unallocNet : Math.round((ol.unallocNet * al.qty) / ol.unallocQty);
      ol.unallocQty -= al.qty; ol.unallocNet -= net;
      const d = eng.get(a.locationId, al.skuId); const bin = Object.entries(d.bins ?? {}).sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
      eng.move({ locationId: a.locationId, skuId: al.skuId, bucket: 'reserved', qty: al.qty, kind: 'move', refType: 'webOrder', refId: orderId, reason: `Reserved for ${order.orderName}` });
      const s = skus.get(al.skuId) ?? {};
      return { skuId: al.skuId, name: ol.name, barcode: s.barcode ?? null, qty: al.qty, pickedQty: 0, netPaise: net, gstRate: ol.gstRate, hsn: ol.hsn ?? null, binId: bin };
    }).sort((x, y) => String(x.binId ?? '~').localeCompare(String(y.binId ?? '~')) || x.name.localeCompare(y.name));
    const shipping = shippingLeft; shippingLeft = 0;
    const payable = plLines.reduce((s, l) => s + l.netPaise, 0) + shipping;
    tx.set(col('pickLists').doc(id), {
      orderId, orderNumber: order.number, orderName: order.orderName, number, locationId: a.locationId, locationName: loc.name, locationState: loc.state ?? null, locationCity: loc.city ?? null,
      type: order.fulfilmentType, status: 'open', lines: plLines, shippingPaise: shipping, payablePaise: payable, paymentMode: order.paymentMode, codAmountPaise: order.paymentMode === 'cod' && order.fulfilmentType === 'ship' ? payable : 0,
      shipTo: order.shipTo, customerName: order.customer?.name ?? null, customerMobile: order.customer?.mobile ?? null, giftNote: order.giftNote ?? null, allocationReason: a.reason,
      slaDueAt: Timestamp.fromMillis(Date.now() + SLA_HOURS * 3600_000), createdAt: stamp(),
    });
    units.push({ pickListId: id, number, locationId: a.locationId, locationName: loc.name, type: order.fulfilmentType, status: 'open', shipmentId: null, shipmentStatus: null, awb: null });
  }
  return { lines, units, pickListCount: n, shippingUnassignedPaise: shippingLeft };
}

// ───────────────────────────────────────────────────────────── create (Shopify orders/create → webOrders + allocation + reservation, one transaction)
export async function createWebOrder(c: Caller, n: NormalisedWebOrder, meta: { source: 'shopify' | 'simulated'; eventId?: string }) {
  const orderId = `SH${n.shopifyOrderId}`; const ref = col('webOrders').doc(orderId);
  const skuCodes = [...new Set(n.lines.map((l) => l.sku))];
  const [skus, locs] = await Promise.all([getMasterDocs<Doc>('skus', skuCodes), loadLocations()]);
  for (const code of skuCodes) if (!skus.has(code)) throw new Error(`Order ${n.orderName}: unknown SKU "${code}" — fix the SKU on Shopify or in master data, then retry`);
  if (n.fulfilmentType === 'bopis') {
    const st = locs.find((l) => l.id === n.pickupStoreId && l.kind === 'store');
    if (!st) throw new Error(`Order ${n.orderName}: pickup store "${n.pickupStoreId ?? '(none)'}" is not a store in master data`);
  }
  // Customer link + history for the risk score (best effort, outside the transaction).
  let customerId: string | null = null; let priorOrders = 0; let priorRto = 0;
  if (n.customer.mobile) {
    const [cs, os] = await Promise.all([col('customers').where('mobile', '==', n.customer.mobile).limit(1).get(), col('webOrders').where('customer.mobile', '==', n.customer.mobile).limit(20).get()]);
    customerId = cs.docs[0]?.id ?? null; priorOrders = os.size; priorRto = os.docs.filter((d) => d.get('status') === 'rto').length;
  }
  const risk = riskScore(n, { priorOrders, priorRtoCount: priorRto });

  // One line per SKU (Shopify may repeat a SKU on two lines).
  const merged = new Map<string, Doc>();
  for (const l of n.lines) {
    const s = skus.get(l.sku)!; const net = l.unitPaise * l.qty - l.discountPaise; const prev = merged.get(l.sku);
    if (prev) { prev.qty += l.qty; prev.netPaise += net; prev.discountPaise += l.discountPaise; prev.unallocQty += l.qty; prev.unallocNet += net; }
    else merged.set(l.sku, { lineId: l.shopifyLineId, skuId: l.sku, name: s.name, qty: l.qty, unitPaise: l.unitPaise, discountPaise: l.discountPaise, netPaise: net, gstRate: Number(s.gstRate ?? 0), hsn: s.hsn ?? null, unallocQty: l.qty, unallocNet: net });
  }
  const variance = orderTotalVariance(n);
  const skuList = [...merged.keys()];

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) return { orderId, number: existing.get('number') as string, status: existing.get('status') as string, duplicate: true };
    const num = await reserveNumber(tx, 'WEB', 'ONL');
    const eng = await StockEngine.load(tx, stockPairs(locs, skuList), { ignoreLock: true });
    const result = allocateOrder({ lines: skuList.map((s) => ({ skuId: s, qty: merged.get(s)!.qty })), fulfilmentType: n.fulfilmentType, pickupStoreId: n.pickupStoreId, shipTo: { state: n.shipTo.state, city: n.shipTo.city } }, allocView(locs, eng, skuList), DEFAULT_ALLOC_POLICY);

    const order: Doc = {
      number: num.number, shopifyOrderId: n.shopifyOrderId, orderName: n.orderName, source: meta.source, shopifyEventId: meta.eventId ?? null, fulfilmentType: n.fulfilmentType, pickupStoreId: n.pickupStoreId ?? null,
      paymentMode: n.paymentMode, financialStatus: n.financialStatus, gateway: n.gateway, customer: { ...n.customer, id: customerId }, shipTo: n.shipTo, giftNote: n.giftNote ?? null, note: n.note ?? null,
      lines: [...merged.values()], shippingPaise: n.shippingPaise, shippingUnassignedPaise: n.shippingPaise, discountPaise: n.discountPaise, totalPaise: n.totalPaise, discountCodes: n.discountCodes,
      totalVariancePaise: variance, needsReview: variance !== 0 && Math.abs(variance) > 100, risk, pickListCount: 0, units: [], locationIds: [], awaitingStock: false, refundDue: false,
      placedAt: Timestamp.fromDate(new Date(n.createdAt)), createdAt: stamp(), updatedAt: stamp(), timeline: [{ at: iso(), text: `Received from ${meta.source === 'shopify' ? 'Shopify' : 'the demo simulator'}` }],
    };
    if (result.complete) {
      const w = writePickLists(tx, { orderId, order, allocations: result.allocations, eng, locs, skus });
      Object.assign(order, { lines: w.lines, units: w.units, pickListCount: w.pickListCount, shippingUnassignedPaise: w.shippingUnassignedPaise, locationIds: [...new Set(w.units.map((u) => u.locationId))] });
      order.status = rollup(order, w.units);
      order.allocation = { strategy: result.strategy, complete: true, shortages: [], at: iso(), parcels: w.units.length };
      order.timeline.push({ at: iso(), text: `Allocated (${result.strategy}): ${result.allocations.map((a) => `${a.locationId} ×${a.lines.reduce((s, l) => s + l.qty, 0)}`).join(', ')}` });
    } else {
      order.status = 'awaiting_stock'; order.awaitingStock = true;
      order.allocation = { strategy: result.strategy, complete: false, shortages: result.shortages, at: iso(), parcels: 0 };
      order.timeline.push({ at: iso(), text: `Cannot allocate — short ${result.shortages.map((s) => `${s.qty}×${s.skuId}`).join(', ')}` });
    }
    num.write(); eng.commit(tx, c);
    tx.set(ref, order);
    audit(tx, c, { action: 'web_order_created', entity: 'webOrders', entityId: orderId, before: null, after: { number: num.number, orderName: n.orderName, status: order.status, strategy: result.strategy, totalPaise: n.totalPaise } });
    return { orderId, number: num.number, status: order.status as string, duplicate: false, strategy: result.strategy, parcels: order.units.length as number, risk };
  });
}

// ───────────────────────────────────────────────────────────── re-run allocation (awaiting_stock orders, after replenishment)
export async function allocateOrderCmd(c: Caller, i: z.output<typeof AllocateOrderInput>) {
  requireOps(c);
  const ref = col('webOrders').doc(i.orderId); const locs = await loadLocations();
  const pre = must((await ref.get()).data() as Doc | undefined, 'Order not found');
  const skuList = (pre.lines as Doc[]).map((l) => l.skuId); const skus = await getMasterDocs<Doc>('skus', skuList);
  return db.runTransaction(async (tx) => {
    const order = must((await tx.get(ref)).data() as Doc | undefined, 'Order not found');
    if (order.status !== 'awaiting_stock') fail(`Order is ${order.status}; only awaiting_stock orders can be re-allocated`);
    const eng = await StockEngine.load(tx, stockPairs(locs, skuList), { ignoreLock: true });
    const need = (order.lines as Doc[]).filter((l) => l.unallocQty > 0).map((l) => ({ skuId: l.skuId, qty: l.unallocQty }));
    const r = allocateOrder({ lines: need, fulfilmentType: order.fulfilmentType, pickupStoreId: order.pickupStoreId ?? undefined, shipTo: { state: order.shipTo?.state, city: order.shipTo?.city } }, allocView(locs, eng, skuList));
    if (!r.complete) return { status: 'awaiting_stock', shortages: r.shortages };
    const w = writePickLists(tx, { orderId: i.orderId, order, allocations: r.allocations, eng, locs, skus });
    const units = [...(order.units as Doc[]), ...w.units];
    eng.commit(tx, c);
    tx.update(ref, { lines: w.lines, units, pickListCount: w.pickListCount, shippingUnassignedPaise: w.shippingUnassignedPaise, locationIds: [...new Set(units.map((u) => u.locationId))], awaitingStock: false, status: rollup({ ...order, awaitingStock: false }, units), allocation: { strategy: r.strategy, complete: true, shortages: [], at: iso(), parcels: units.length }, updatedAt: stamp(), timeline: FieldValue.arrayUnion({ at: iso(), text: `Re-allocated (${r.strategy}) by ${c.name}` }) });
    audit(tx, c, { action: 'web_order_reallocated', entity: 'webOrders', entityId: i.orderId, before: { status: 'awaiting_stock' }, after: { strategy: r.strategy } });
    return { status: 'allocated', strategy: r.strategy, parcels: w.units.length };
  });
}

// ───────────────────────────────────────────────────────────── cancel (releases reservations)
export async function cancelOrderCore(c: Caller, i: { orderId: string; reason: string }) {
  const ref = col('webOrders').doc(i.orderId);
  const pre = must((await ref.get()).data() as Doc | undefined, 'Order not found');
  const plRefs = (pre.units as Doc[]).map((u) => col('pickLists').doc(u.pickListId));
  return db.runTransaction(async (tx) => {
    const [oSnap, ...plSnaps] = await tx.getAll(ref, ...plRefs);
    const order = must(oSnap!.data() as Doc | undefined, 'Order not found');
    if (order.status === 'cancelled') return { status: 'cancelled', already: true };
    if (['collected', 'delivered'].includes(order.status)) fail(`Order is already ${order.status}`);
    if ((order.units as Doc[]).some((u) => u.shipmentId && !String(u.shipmentStatus).startsWith('rto') && u.shipmentStatus !== 'cancelled')) fail('A parcel is already with the courier — wait for delivery or RTO instead of cancelling');
    const live = plSnaps.map((s, k) => ({ ref: plRefs[k]!, d: s!.data() as Doc | undefined })).filter((x): x is { ref: typeof x.ref; d: Doc } => !!x.d && ['open', 'picked', 'packed', 'ready_for_pickup'].includes(x.d.status));
    const eng = live.length ? await StockEngine.load(tx, live.flatMap(({ d }) => (d.lines as Doc[]).map((l) => [d.locationId, l.skuId] as [string, string])), { ignoreLock: true }) : null;
    for (const { d } of live) for (const l of d.lines as Doc[]) {
      const have = eng!.get(d.locationId, l.skuId).reserved ?? 0;
      eng!.move({ locationId: d.locationId, skuId: l.skuId, bucket: 'reserved', qty: -Math.min(l.qty, have), kind: 'move', refType: 'webOrder', refId: i.orderId, reason: `Order cancelled: ${i.reason}` });
    }
    eng?.commit(tx, c);
    for (const { ref: r } of live) tx.update(r, { status: 'cancelled', cancelledAt: stamp() });
    const units = (order.units as Doc[]).map((u) => (u.shipmentId ? u : { ...u, status: 'cancelled' }));
    const refundDue = order.paymentMode === 'prepaid' && order.financialStatus === 'paid';
    tx.update(ref, { status: 'cancelled', units, awaitingStock: false, refundDue, cancelReason: i.reason, updatedAt: stamp(), timeline: FieldValue.arrayUnion({ at: iso(), text: `Cancelled: ${i.reason}${refundDue ? ' — prepaid refund due' : ''}` }) });
    audit(tx, c, { action: 'web_order_cancelled', entity: 'webOrders', entityId: i.orderId, before: { status: order.status }, after: { status: 'cancelled', reason: i.reason, refundDue } });
    return { status: 'cancelled', refundDue, released: live.length };
  });
}
export async function cancelOrder(c: Caller, i: z.output<typeof CancelOrderInput>) { requireRoles(c, 'warehouse_manager', 'store_manager'); return cancelOrderCore(c, i); }
export type { AllocLine };
