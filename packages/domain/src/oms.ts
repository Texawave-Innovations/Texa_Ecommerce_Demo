/** OMS rules — Shopify order mapping, risk score, allocation, web stock buffer, pack verification, retry backoff, COD reconciliation. Pure TS. */

// ───────────────────────────────────────────────────────────── Shopify order mapping
export const toPaise = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid money value "${String(v)}"`);
  return Math.round(n * 100);
};

type Dict = Record<string, any>;
export interface NormalisedWebOrder {
  shopifyOrderId: string; orderName: string; createdAt: string; financialStatus: string; paymentMode: 'prepaid' | 'cod'; gateway: string;
  fulfilmentType: 'ship' | 'bopis'; pickupStoreId?: string; giftNote?: string; note?: string;
  customer: { name: string; email?: string; mobile?: string; shopifyCustomerId?: string };
  shipTo: { name: string; address1: string; address2?: string; city: string; state: string; pincode: string; phone?: string };
  lines: { shopifyLineId: string; sku: string; title: string; qty: number; unitPaise: number; discountPaise: number }[];
  shippingPaise: number; discountPaise: number; totalPaise: number; discountCodes: string[];
}

/**
 * Shopify `orders/create` payload → normalised order. Indian Shopify stores sell tax-INCLUSIVE, so `price` is the GST-inclusive unit price.
 * Throws a descriptive Error on a malformed payload (the connector turns that into a failedEvents row).
 */
export function mapShopifyOrder(p: Dict): NormalisedWebOrder {
  if (!p || p.id === undefined || !Array.isArray(p.line_items) || p.line_items.length === 0) throw new Error('Order payload has no id or line_items');
  const attrs = new Map<string, string>(((p.note_attributes ?? []) as Dict[]).map((a) => [String(a.name).toLowerCase(), String(a.value)]));
  const gateways = ((p.payment_gateway_names ?? [p.gateway]) as (string | undefined)[]).filter(Boolean).map((g) => String(g).toLowerCase());
  const cod = gateways.some((g) => g.includes('cod') || g.includes('cash on delivery')) || (p.financial_status === 'pending' && gateways.some((g) => g.includes('manual')));
  const ship = p.shipping_address ?? {}; const cust = p.customer ?? {};
  const shipping = ((p.shipping_lines ?? []) as Dict[]);
  const pickupTitle = shipping.some((s) => /pick\s*-?up|click\s*&\s*collect/i.test(`${s.title ?? ''} ${s.code ?? ''}`));
  const pickupStore = attrs.get('pickup_store') ?? attrs.get('pickup_location');
  const bopis = !!pickupStore || pickupTitle;
  const lines = (p.line_items as Dict[]).map((li) => {
    const sku = String(li.sku ?? '').trim();
    if (!sku) throw new Error(`Line "${li.title ?? li.id}" has no SKU`);
    const qty = Number(li.quantity);
    if (!Number.isInteger(qty) || qty <= 0) throw new Error(`Line ${sku} has invalid quantity`);
    return { shopifyLineId: String(li.id), sku, title: String(li.title ?? sku), qty, unitPaise: toPaise(li.price), discountPaise: toPaise(li.total_discount) };
  });
  const customerName = [cust.first_name, cust.last_name].filter(Boolean).join(' ') || ship.name || 'Guest';
  const out: NormalisedWebOrder = {
    shopifyOrderId: String(p.id), orderName: String(p.name ?? `#${p.order_number ?? p.id}`), createdAt: String(p.created_at ?? new Date().toISOString()),
    financialStatus: String(p.financial_status ?? 'pending'), paymentMode: cod ? 'cod' : 'prepaid', gateway: gateways[0] ?? 'unknown',
    fulfilmentType: bopis ? 'bopis' : 'ship', pickupStoreId: pickupStore ? pickupStore.trim().toUpperCase() : undefined,
    giftNote: attrs.get('gift_note'), note: p.note ? String(p.note) : undefined,
    customer: { name: customerName, email: p.email ?? cust.email ?? undefined, mobile: normaliseMobile(p.phone ?? ship.phone ?? cust.phone), shopifyCustomerId: cust.id ? String(cust.id) : undefined },
    shipTo: { name: ship.name ?? customerName, address1: ship.address1 ?? '', address2: ship.address2 ?? undefined, city: ship.city ?? '', state: ship.province ?? '', pincode: String(ship.zip ?? '').replace(/\s/g, ''), phone: normaliseMobile(ship.phone ?? p.phone) },
    lines, shippingPaise: shipping.reduce((a, s) => a + toPaise(s.price), 0), discountPaise: toPaise(p.total_discounts), totalPaise: toPaise(p.total_price),
    discountCodes: ((p.discount_codes ?? []) as Dict[]).map((d) => String(d.code)),
  };
  if (!bopis && !/^\d{6}$/.test(out.shipTo.pincode)) throw new Error(`Invalid delivery pincode "${out.shipTo.pincode}"`);
  return out;
}
export function normaliseMobile(v: unknown): string | undefined {
  const d = String(v ?? '').replace(/\D/g, '');
  const m = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : d;
  return /^[6-9]\d{9}$/.test(m) ? m : undefined;
}

/** Sum of line nets + shipping vs Shopify's own total — a mismatch above ₹1 is flagged for review rather than blocked. */
export const orderTotalVariance = (o: Pick<NormalisedWebOrder, 'lines' | 'shippingPaise' | 'totalPaise'>) =>
  o.lines.reduce((a, l) => a + l.unitPaise * l.qty - l.discountPaise, 0) + o.shippingPaise - o.totalPaise;

// ───────────────────────────────────────────────────────────── COD / fraud risk (rule-based, explainable)
export const HIGH_RTO_PIN_PREFIXES = ['78', '79', '19', '18', '74'];
export interface RiskResult { score: number; level: 'low' | 'medium' | 'high'; reasons: string[] }
export function riskScore(o: Pick<NormalisedWebOrder, 'paymentMode' | 'totalPaise' | 'shipTo' | 'lines' | 'customer' | 'createdAt' | 'fulfilmentType'>, ctx: { priorRtoCount?: number; priorOrders?: number } = {}): RiskResult {
  let s = 0; const reasons: string[] = [];
  const add = (n: number, why: string) => { s += n; reasons.push(`${why} (+${n})`); };
  if (o.paymentMode === 'cod') {
    add(20, 'Cash on delivery');
    if (o.totalPaise > 300_000) add(15, 'COD above ₹3,000');
    if (HIGH_RTO_PIN_PREFIXES.some((p) => o.shipTo.pincode.startsWith(p))) add(20, 'Pincode region with high RTO history');
  }
  if (o.totalPaise > 750_000) add(10, 'High order value');
  if (!o.shipTo.phone && !o.customer.mobile) add(20, 'No valid mobile number');
  if (o.lines.some((l) => l.qty > 5)) add(10, 'Bulk quantity on a single line');
  if (!ctx.priorOrders) add(5, 'First-time customer');
  if (ctx.priorRtoCount) add(Math.min(40, 20 * ctx.priorRtoCount), `${ctx.priorRtoCount} earlier RTO(s)`);
  const hourIst = new Date(new Date(o.createdAt).getTime() + 5.5 * 3600_000).getUTCHours();
  if (hourIst < 5) add(5, 'Placed between midnight and 5 AM');
  const score = Math.min(100, s);
  return { score, level: score >= 65 ? 'high' : score >= 35 ? 'medium' : 'low', reasons };
}

// ───────────────────────────────────────────────────────────── Allocation engine
export interface AllocLocation { id: string; kind: 'warehouse' | 'store'; state?: string; city?: string; stock: Record<string, { onHand: number; reserved: number }> }
export interface AllocPolicy {
  /** Units a store keeps back for walk-in customers (web never sells the last N shelf units). */
  storeBuffer: number; warehouseBuffer: number;
  /** Added to the cost of shipping from a store so the warehouse is preferred unless it cannot fulfil. */
  storePenalty: number; maxSplits: number;
}
export const DEFAULT_ALLOC_POLICY: AllocPolicy = { storeBuffer: 2, warehouseBuffer: 0, storePenalty: 3, maxSplits: 2 };
export interface AllocLine { skuId: string; qty: number }
export interface Allocation { locationId: string; lines: AllocLine[]; reason: string }
export interface AllocationResult {
  strategy: 'pickup_store' | 'single' | 'split' | 'insufficient'; complete: boolean; allocations: Allocation[]; shortages: AllocLine[];
}

export function availableAt(loc: AllocLocation, skuId: string, policy: AllocPolicy, forPickup = false): number {
  const s = loc.stock[skuId]; if (!s) return 0;
  const buffer = forPickup ? 0 : loc.kind === 'store' ? policy.storeBuffer : policy.warehouseBuffer;
  return Math.max(0, s.onHand - s.reserved - buffer);
}
const proximity = (loc: AllocLocation, shipTo: { state?: string; city?: string }) =>
  shipTo.city && loc.city && shipTo.city.toLowerCase() === loc.city.toLowerCase() ? 0 : shipTo.state && loc.state && shipTo.state.toLowerCase() === loc.state.toLowerCase() ? 1 : 2;
export const locationCost = (loc: AllocLocation, shipTo: { state?: string; city?: string }, p: AllocPolicy) => proximity(loc, shipTo) + (loc.kind === 'store' ? p.storePenalty : 0);

/**
 * All-or-nothing allocation:
 *  - BOPIS → only the pickup store (no web buffer: the shelf unit is promised to this customer).
 *  - ship  → cheapest SINGLE location that covers every line (warehouse first, then nearest store);
 *            otherwise a greedy split (location covering the most units first) limited to `maxSplits` parcels.
 * An order that cannot be fully covered returns `complete:false` with the shortages and best-effort suggestion; nothing is reserved.
 */
export function allocateOrder(o: { lines: AllocLine[]; fulfilmentType: 'ship' | 'bopis'; pickupStoreId?: string; shipTo: { state?: string; city?: string } }, locations: AllocLocation[], policy: AllocPolicy = DEFAULT_ALLOC_POLICY): AllocationResult {
  const need = new Map<string, number>();
  for (const l of o.lines) need.set(l.skuId, (need.get(l.skuId) ?? 0) + l.qty);
  const lines = [...need].map(([skuId, qty]) => ({ skuId, qty }));

  if (o.fulfilmentType === 'bopis') {
    const loc = locations.find((l) => l.id === o.pickupStoreId);
    if (!loc) return { strategy: 'insufficient', complete: false, allocations: [], shortages: lines };
    const short = lines.filter((l) => availableAt(loc, l.skuId, policy, true) < l.qty).map((l) => ({ skuId: l.skuId, qty: l.qty - availableAt(loc, l.skuId, policy, true) }));
    return short.length ? { strategy: 'pickup_store', complete: false, allocations: [], shortages: short } : { strategy: 'pickup_store', complete: true, allocations: [{ locationId: loc.id, lines, reason: 'Pickup store holds the order' }], shortages: [] };
  }

  const ranked = [...locations].sort((a, b) => locationCost(a, o.shipTo, policy) - locationCost(b, o.shipTo, policy) || a.id.localeCompare(b.id));
  const single = ranked.find((loc) => lines.every((l) => availableAt(loc, l.skuId, policy) >= l.qty));
  if (single) return { strategy: 'single', complete: true, allocations: [{ locationId: single.id, lines, reason: `${single.kind === 'warehouse' ? 'Warehouse' : 'Store'} covers the whole order` }], shortages: [] };

  const remaining = new Map(need); const allocations: Allocation[] = []; const used = new Set<string>();
  for (let i = 0; i < policy.maxSplits; i++) {
    let best: { loc: AllocLocation; covered: number } | null = null;
    for (const loc of ranked) {
      if (used.has(loc.id)) continue;
      const covered = [...remaining].reduce((a, [sku, q]) => a + Math.min(q, availableAt(loc, sku, policy)), 0);
      if (covered > 0 && (!best || covered > best.covered)) best = { loc, covered };   // ranked order breaks ties by cost
    }
    if (!best) break;
    used.add(best.loc.id);
    const take: AllocLine[] = [];
    for (const [sku, q] of remaining) { const n = Math.min(q, availableAt(best.loc, sku, policy)); if (n > 0) { take.push({ skuId: sku, qty: n }); remaining.set(sku, q - n); } }
    allocations.push({ locationId: best.loc.id, lines: take, reason: `Split ${i + 1}: covers ${best.covered} unit(s)` });
    if ([...remaining.values()].every((q) => q === 0)) break;
  }
  const shortages = [...remaining].filter(([, q]) => q > 0).map(([skuId, qty]) => ({ skuId, qty }));
  return shortages.length ? { strategy: 'insufficient', complete: false, allocations, shortages } : { strategy: 'split', complete: true, allocations, shortages: [] };
}

// ───────────────────────────────────────────────────────────── Web stock with safety buffer
export interface StockPoint { kind: 'warehouse' | 'store'; onHand: number; reserved: number }
/**
 * Quantity pushed to Shopify for one SKU: Σ (onHand − reserved − buffer) over locations that sell online, floored at 0.
 * Two oversell guards: per-location buffer (walk-in protection) and a global floor — at or below `lowStockFloor` the SKU shows 0 on the web.
 */
export function webSellableQty(points: StockPoint[], p: { storeBuffer: number; warehouseBuffer: number; lowStockFloor: number; maxPush: number }, skuOverrideBuffer?: number): number {
  let total = 0;
  for (const s of points) total += Math.max(0, s.onHand - s.reserved - (skuOverrideBuffer ?? (s.kind === 'store' ? p.storeBuffer : p.warehouseBuffer)));
  if (total <= p.lowStockFloor) return 0;
  return Math.min(total, p.maxPush);
}
/** Which SKUs need a push: changed vs last pushed value (or never pushed). */
export function diffStockPush(current: Map<string, number>, last: Map<string, number>, force = false) {
  const changes: { skuId: string; from: number | null; to: number }[] = []; let unchanged = 0;
  for (const [skuId, to] of current) { const from = last.get(skuId); if (force || from === undefined || from !== to) changes.push({ skuId, from: from ?? null, to }); else unchanged++; }
  return { changes, unchanged };
}

// ───────────────────────────────────────────────────────────── Pack verification
export interface PackVerdict { ok: boolean; scanned: Record<string, number>; missing: AllocLine[]; extra: AllocLine[]; unknownBarcodes: string[] }
/** Each scan is one unit. OK only when scanned units equal expected units per SKU exactly. */
export function verifyPack(expected: AllocLine[], scans: string[], barcodeToSku: Record<string, string>): PackVerdict {
  const scanned: Record<string, number> = {}; const unknown: string[] = [];
  for (const raw of scans) { const sku = barcodeToSku[raw.trim()]; if (!sku) { unknown.push(raw); continue; } scanned[sku] = (scanned[sku] ?? 0) + 1; }
  const exp = new Map(expected.map((l) => [l.skuId, l.qty]));
  const missing = [...exp].filter(([s, q]) => (scanned[s] ?? 0) < q).map(([skuId, q]) => ({ skuId, qty: q - (scanned[skuId] ?? 0) }));
  const extra = Object.entries(scanned).filter(([s, n]) => n > (exp.get(s) ?? 0)).map(([skuId, n]) => ({ skuId, qty: n - (exp.get(skuId) ?? 0) }));
  return { ok: !missing.length && !extra.length && !unknown.length, scanned, missing, extra, unknownBarcodes: unknown };
}

// ───────────────────────────────────────────────────────────── Retry of failed events
export const MAX_EVENT_ATTEMPTS = 6;
/** 30s, 1m, 2m, 4m, 8m, 16m after attempts 1…6 (capped at 30m). */
export const retryDelaySeconds = (attempt: number) => Math.min(1800, 30 * 2 ** Math.max(0, attempt - 1));
export const nextRetryAt = (now: Date, attempt: number) => new Date(now.getTime() + retryDelaySeconds(attempt) * 1000);
export const isDeadLetter = (attempts: number) => attempts >= MAX_EVENT_ATTEMPTS;

// ───────────────────────────────────────────────────────────── Order status roll-up
export function deriveOrderStatus(o: { cancelled?: boolean; awaitingStock?: boolean; pickLists: { status: string }[]; shipments: { status: string }[] }): string {
  const pls = o.pickLists.filter((p) => p.status !== 'cancelled');
  if (o.cancelled || (o.pickLists.length && !pls.length)) return 'cancelled';
  if (!pls.length) return o.awaitingStock ? 'awaiting_stock' : 'new';
  if (pls.every((p) => p.status === 'expired')) return 'expired';
  if (pls.every((p) => p.status === 'collected')) return 'collected';
  if (pls.some((p) => p.status === 'ready_for_pickup')) return 'ready_for_pickup';
  const live = o.shipments.filter((s) => s.status !== 'cancelled');
  if (live.length && live.every((s) => s.status.startsWith('rto'))) return 'rto';
  if (live.length && live.length === pls.length && live.every((s) => s.status === 'delivered')) return 'delivered';
  if (pls.every((p) => p.status === 'shipped')) return 'shipped';
  if (pls.some((p) => p.status === 'shipped')) return 'partially_shipped';
  if (pls.some((p) => p.status === 'packed')) return pls.every((p) => p.status === 'packed') ? 'packed' : 'picking';
  if (pls.some((p) => p.status === 'picked')) return 'picking';
  return 'allocated';
}

// ───────────────────────────────────────────────────────────── BOPIS
export const BOPIS_HOLD_HOURS = 48;
export const bopisHoldUntil = (readyAt: Date, hours = BOPIS_HOLD_HOURS) => new Date(readyAt.getTime() + hours * 3600_000);
/** 6-digit handover code from a [0,1) random source (injected so tests are deterministic). */
export const pickupCode = (rand: () => number = Math.random) => String(100000 + Math.floor(rand() * 900000));

// ───────────────────────────────────────────────────────────── RTO QC
export function validateRtoQc(received: AllocLine[], qc: { skuId: string; good: number; damaged: number }[]): string | null {
  const rec = new Map(received.map((l) => [l.skuId, l.qty]));
  for (const l of qc) {
    const q = rec.get(l.skuId);
    if (q === undefined) return `${l.skuId} was not in the returned parcel`;
    if (l.good + l.damaged !== q) return `${l.skuId}: good + damaged (${l.good + l.damaged}) must equal received ${q}`;
  }
  const missing = [...rec.keys()].filter((s) => !qc.some((l) => l.skuId === s));
  return missing.length ? `Missing QC result for ${missing.join(', ')}` : null;
}

// ───────────────────────────────────────────────────────────── COD remittance reconciliation
export interface CodExpected { awb: string; amountPaise: number }
export type CodLineStatus = 'matched' | 'short' | 'excess' | 'unknown_awb' | 'duplicate';
export interface CodReconRow { awb: string; expectedPaise: number; remittedPaise: number; diffPaise: number; status: CodLineStatus }
export interface CodReconResult { rows: CodReconRow[]; matchedPaise: number; shortPaise: number; excessPaise: number; remittedPaise: number; pendingAwbs: string[] }
/**
 * Matches a courier's remittance advice to delivered COD shipments by AWB.
 * `pendingAwbs` = delivered COD parcels not yet in any remittance (normal: couriers remit in weekly batches).
 */
export function reconcileCod(expected: CodExpected[], remitted: CodExpected[]): CodReconResult {
  const exp = new Map(expected.map((e) => [e.awb, e.amountPaise])); const seen = new Set<string>();
  const rows: CodReconRow[] = []; let matched = 0, short = 0, excess = 0, remittedTotal = 0;
  for (const r of remitted) {
    remittedTotal += r.amountPaise;
    if (seen.has(r.awb)) { rows.push({ awb: r.awb, expectedPaise: 0, remittedPaise: r.amountPaise, diffPaise: r.amountPaise, status: 'duplicate' }); excess += r.amountPaise; continue; }
    seen.add(r.awb);
    const e = exp.get(r.awb);
    if (e === undefined) { rows.push({ awb: r.awb, expectedPaise: 0, remittedPaise: r.amountPaise, diffPaise: r.amountPaise, status: 'unknown_awb' }); excess += r.amountPaise; continue; }
    const diff = r.amountPaise - e;
    const status: CodLineStatus = diff === 0 ? 'matched' : diff < 0 ? 'short' : 'excess';
    if (diff === 0) matched += r.amountPaise; else if (diff < 0) { short += -diff; matched += r.amountPaise; } else { excess += diff; matched += e; }
    rows.push({ awb: r.awb, expectedPaise: e, remittedPaise: r.amountPaise, diffPaise: diff, status });
  }
  return { rows, matchedPaise: matched, shortPaise: short, excessPaise: excess, remittedPaise: remittedTotal, pendingAwbs: [...exp.keys()].filter((a) => !seen.has(a)) };
}
