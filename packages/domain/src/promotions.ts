/**
 * Promotion engine — pure TypeScript, no I/O. The SAME code prices the cart instantly in the POS and authoritatively in the
 * `completeSale` Cloud Function (and later in NestJS). Money = integer paise; prices are GST-inclusive (Indian MRP convention),
 * so every `netPaise` below includes tax. Discounts reduce the taxable value (see `invoice.ts`).
 *
 * Pipeline (each stage works on the running net of every line):
 *   0 manual overrides → 1 line offers (markdown, happy hour, BxGy, bundle, free gift) → 2 cart offers (tiered, threshold, loyalty tier)
 *   → 3 voucher → 4 tender offers (UPI …).  Stackable promos combine sequentially (compounding) in priority order.
 *
 * Stacking matrix:
 *   · `stackable: true`  promos all apply together, subject to `exclusiveGroup` (only the best member of a group applies).
 *   · `stackable: false` promos never combine: the engine compares "all stackable promos" against "each non-stackable alone"
 *     and keeps whichever gives the customer the larger discount.
 *   · Budget caps (`budgetPaise` − `budgetUsedPaise`) clip a promo's discount; an exhausted promo is skipped.
 */
import { apportion } from './landedCost';
import { percentOf } from './money';

export type TenderKind = 'CASH' | 'UPI' | 'CARD' | 'GC' | 'CN' | 'POINTS' | 'COD' | 'SHOPIFY';

export interface Scope { skuIds?: string[]; subCategoryIds?: string[]; categoryIds?: string[]; departmentIds?: string[]; brandIds?: string[] }

export interface CartLine {
  lineId: string; skuId: string; name: string; qty: number;
  /** Selling price per unit, GST-inclusive. */
  unitPricePaise: number; mrpPaise?: number; gstRate: number; hsn?: string;
  departmentId?: string; categoryId?: string; subCategoryId?: string; brandId?: string;
  /** Service lines (gift wrap) carry GST but no stock and are excluded from every offer. */
  isService?: boolean; noDiscount?: boolean;
  /** Manager-approved discount for the whole line (paise). */
  manualDiscountPaise?: number; manualReasonCode?: string;
  isFreeGift?: boolean;
}

export type PromoKind = 'tender' | 'cart_threshold' | 'bxgy' | 'bundle' | 'markdown' | 'tiered' | 'loyalty_tier' | 'happy_hour' | 'free_gift';

export interface PromoBase {
  id: string; name: string; kind: PromoKind;
  /** Lower runs first inside its stage. */
  priority: number; stackable: boolean; exclusiveGroup?: string;
  status?: 'active' | 'draft' | 'pending_approval' | 'inactive';
  validFrom?: string; validTo?: string;               // ISO date or datetime (inclusive)
  channels?: ('store' | 'web')[]; storeIds?: string[];
  budgetPaise?: number; budgetUsedPaise?: number;
}
export interface TenderPromo extends PromoBase { kind: 'tender'; tenders: TenderKind[]; pct: number; maxPaise?: number }
export interface CartThresholdPromo extends PromoBase {
  kind: 'cart_threshold'; minPaise: number;
  /** `false` means the spend must be strictly ABOVE minPaise ("above ₹2,000"). Default true. */
  inclusive?: boolean; pct?: number; flatPaise?: number; maxPaise?: number;
}
export interface BxGyPromo extends PromoBase { kind: 'bxgy'; scope: Scope; buyQty: number; getQty: number; /** 100 = free. */ discountPct: number }
export interface BundlePromo extends PromoBase { kind: 'bundle'; items: { scope: Scope; qty: number }[]; bundlePricePaise: number }
export interface MarkdownPromo extends PromoBase { kind: 'markdown'; scope: Scope; pct?: number; flatPaise?: number }
export interface TieredPromo extends PromoBase { kind: 'tiered'; scope?: Scope; tiers: { minPaise: number; pct: number }[] }
export interface LoyaltyTierPromo extends PromoBase { kind: 'loyalty_tier'; tierPcts: Record<string, number> }
export interface HappyHourPromo extends PromoBase { kind: 'happy_hour'; scope: Scope; pct: number; /** 0=Sun … 6=Sat, evaluated in IST. */ days: number[]; fromHour: number; toHour: number }
export interface FreeGiftPromo extends PromoBase {
  kind: 'free_gift'; minPaise: number;
  gift: { skuId: string; name: string; mrpPaise: number; gstRate: number; hsn?: string; departmentId?: string; categoryId?: string; subCategoryId?: string; brandId?: string };
}
export type Promotion = TenderPromo | CartThresholdPromo | BxGyPromo | BundlePromo | MarkdownPromo | TieredPromo | LoyaltyTierPromo | HappyHourPromo | FreeGiftPromo;

/** Voucher document (see vouchers.ts for validation). Embedded here to avoid a circular import. */
export interface Voucher {
  code: string; seriesId?: string;
  valuePaise?: number; percentOff?: number; maxDiscountPaise?: number; minSpendPaise?: number;
  usage: 'single' | 'multi'; maxRedemptions?: number; redemptionCount?: number;
  perCustomerLimit?: number; redeemedByCustomer?: Record<string, number>;
  validFrom?: string; validTo?: string; channel?: 'All' | 'Store' | 'Web';
  status?: 'active' | 'redeemed' | 'void'; customerId?: string;
  /** false → cannot combine with promotions; the better of (voucher alone, promos alone) wins. Default true. */
  combinable?: boolean;
}

export interface PricingContext {
  channel: 'store' | 'web'; storeId?: string; at: Date;
  customer?: { id: string; tierId?: string } | null;
  /** The tender that settles the bill (undefined until chosen). Gift cards / points / credit notes are instruments, not tenders. */
  tender?: TenderKind;
  voucher?: Voucher | null; voucherCustomerId?: string;
}

export interface LineAllocation { promoId: string; name: string; amountPaise: number }
export interface PricedLine extends CartLine {
  grossPaise: number; discountPaise: number; /** GST-inclusive amount payable for the line. */ netPaise: number; allocations: LineAllocation[];
}
export interface AppliedDiscount {
  promoId: string; name: string; kind: PromoKind | 'voucher' | 'manual'; level: 'manual' | 'line' | 'cart' | 'voucher' | 'tender';
  amountPaise: number; lineAllocations: Record<string, number>; detail?: string;
}
export interface Nudge { promoId: string; kind: PromoKind; message: string; remainingPaise?: number; remainingQty?: number }
export interface Rejection { promoId: string; reason: string }
export interface PricingResult {
  lines: PricedLine[]; applied: AppliedDiscount[]; nudges: Nudge[]; rejected: Rejection[];
  grossPaise: number; discountPaise: number; netPaise: number; /** Voucher problems are surfaced, not thrown. */ voucherError?: string;
}

const matches = (l: CartLine, s: Scope | undefined): boolean => {
  if (!s) return true;
  const any = s.skuIds?.length || s.subCategoryIds?.length || s.categoryIds?.length || s.departmentIds?.length || s.brandIds?.length;
  if (!any) return true;
  return !!((s.skuIds?.includes(l.skuId)) || (l.subCategoryId && s.subCategoryIds?.includes(l.subCategoryId)) || (l.categoryId && s.categoryIds?.includes(l.categoryId))
    || (l.departmentId && s.departmentIds?.includes(l.departmentId)) || (l.brandId && s.brandIds?.includes(l.brandId)));
};
const discountable = (l: CartLine) => !l.isService && !l.noDiscount && !l.isFreeGift;

/** Hour-of-day and weekday in IST for happy-hour rules. */
export function istParts(d: Date) { const t = new Date(d.getTime() + 5.5 * 3600_000); return { day: t.getUTCDay(), hour: t.getUTCHours() + t.getUTCMinutes() / 60 }; }

function inWindow(p: PromoBase, at: Date): boolean {
  const t = at.getTime();
  if (p.validFrom && t < Date.parse(p.validFrom.length <= 10 ? `${p.validFrom}T00:00:00+05:30` : p.validFrom)) return false;
  if (p.validTo && t > Date.parse(p.validTo.length <= 10 ? `${p.validTo}T23:59:59.999+05:30` : p.validTo)) return false;
  return true;
}

/** Why a promotion cannot be considered at all for this context (undefined = eligible). */
export function ineligibleReason(p: Promotion, ctx: PricingContext): string | undefined {
  if (p.status && p.status !== 'active') return `Promotion is ${p.status.replace('_', ' ')}`;
  if (!inWindow(p, ctx.at)) return 'Outside validity window';
  if (p.channels?.length && !p.channels.includes(ctx.channel)) return `Not valid on ${ctx.channel}`;
  if (p.storeIds?.length && (!ctx.storeId || !p.storeIds.includes(ctx.storeId))) return 'Not valid at this store';
  if (p.budgetPaise !== undefined && (p.budgetUsedPaise ?? 0) >= p.budgetPaise) return 'Budget exhausted';
  if (p.kind === 'loyalty_tier' && !(ctx.customer?.tierId && p.tierPcts[ctx.customer.tierId])) return 'Customer tier not eligible';
  if (p.kind === 'tender' && (!ctx.tender || !p.tenders.includes(ctx.tender))) return 'Tender not selected';
  if (p.kind === 'happy_hour') { const { day, hour } = istParts(ctx.at); if (!p.days.includes(day) || hour < p.fromHour || hour >= p.toHour) return 'Outside happy-hour window'; }
  return undefined;
}

// ───────────────────────────────────────────────────────────── working state
interface State { lines: PricedLine[]; applied: AppliedDiscount[]; budgetLeft: Map<string, number> }
const newState = (lines: CartLine[], promos: Promotion[]): State => ({
  lines: lines.map((l) => ({ ...l, grossPaise: l.qty * l.unitPricePaise, discountPaise: 0, netPaise: l.qty * l.unitPricePaise, allocations: [] })),
  applied: [],
  budgetLeft: new Map(promos.filter((p) => p.budgetPaise !== undefined).map((p) => [p.id, (p.budgetPaise ?? 0) - (p.budgetUsedPaise ?? 0)])),
});

/** Commits per-line allocations (already clipped to each line's running net) and clips to the promo budget. */
function commit(s: State, meta: Pick<AppliedDiscount, 'promoId' | 'name' | 'kind' | 'level' | 'detail'>, alloc: Record<string, number>, budgetKey?: string) {
  let total = Object.values(alloc).reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  const left = budgetKey !== undefined ? s.budgetLeft.get(budgetKey) : undefined;
  if (left !== undefined) {
    if (left <= 0) return 0;
    if (total > left) { // scale down proportionally to the remaining budget
      const ids = Object.keys(alloc); const parts = apportion(left, ids.map((i) => alloc[i]!));
      ids.forEach((id, k) => { alloc[id] = parts[k]!; }); total = left;
    }
    s.budgetLeft.set(budgetKey!, left - total);
  }
  const done: Record<string, number> = {};
  for (const l of s.lines) {
    const a = Math.min(alloc[l.lineId] ?? 0, l.netPaise);
    if (a <= 0) continue;
    l.netPaise -= a; l.discountPaise += a; l.allocations.push({ promoId: meta.promoId, name: meta.name, amountPaise: a }); done[l.lineId] = a;
  }
  const amount = Object.values(done).reduce((a, b) => a + b, 0);
  if (amount > 0) s.applied.push({ ...meta, amountPaise: amount, lineAllocations: done });
  return amount;
}

const eligibleLines = (s: State, scope?: Scope) => s.lines.filter((l) => discountable(l) && l.netPaise > 0 && matches(l, scope));
const sumNet = (ls: PricedLine[]) => ls.reduce((a, l) => a + l.netPaise, 0);
/** Spread a discount over lines proportionally to their running net (largest remainder → exact). */
function spread(total: number, ls: PricedLine[]): Record<string, number> {
  if (total <= 0 || !ls.length) return {};
  const parts = apportion(Math.min(total, sumNet(ls)), ls.map((l) => l.netPaise));
  return Object.fromEntries(ls.map((l, i) => [l.lineId, parts[i]!]));
}
/** Expands lines into per-unit entries (running net split evenly, remainder on the first units). */
function units(ls: PricedLine[]): { lineId: string; net: number; skuId: string }[] {
  const out: { lineId: string; net: number; skuId: string }[] = [];
  for (const l of ls) { const base = Math.floor(l.netPaise / l.qty); const extra = l.netPaise - base * l.qty; for (let i = 0; i < l.qty; i++) out.push({ lineId: l.lineId, net: base + (i < extra ? 1 : 0), skuId: l.skuId }); }
  return out;
}
const sumUnits = (us: { lineId: string; net: number }[], pct: number) => { const o: Record<string, number> = {}; for (const u of us) o[u.lineId] = (o[u.lineId] ?? 0) + percentOf(u.net, pct); return o; };

const STAGE: Record<PromoKind, number> = { markdown: 1, happy_hour: 1, bxgy: 1, bundle: 1, free_gift: 1, tiered: 2, cart_threshold: 2, loyalty_tier: 2, tender: 4 };
const byOrder = (a: Promotion, b: Promotion) => STAGE[a.kind] - STAGE[b.kind] || a.priority - b.priority || a.id.localeCompare(b.id);

function applyPromo(s: State, p: Promotion, ctx: PricingContext): void {
  const meta = { promoId: p.id, name: p.name, kind: p.kind, level: (STAGE[p.kind] === 1 ? 'line' : p.kind === 'tender' ? 'tender' : 'cart') as AppliedDiscount['level'] };
  switch (p.kind) {
    case 'markdown': {
      const ls = eligibleLines(s, p.scope); const alloc: Record<string, number> = {};
      for (const l of ls) alloc[l.lineId] = p.flatPaise !== undefined ? Math.min(l.netPaise, p.flatPaise * l.qty) : percentOf(l.netPaise, p.pct ?? 0);
      commit(s, meta, alloc, p.id); return;
    }
    case 'happy_hour': {
      const ls = eligibleLines(s, p.scope); const alloc: Record<string, number> = {};
      for (const l of ls) alloc[l.lineId] = percentOf(l.netPaise, p.pct);
      commit(s, meta, alloc, p.id); return;
    }
    case 'bxgy': {
      const us = units(eligibleLines(s, p.scope)).sort((a, b) => a.net - b.net);
      const group = p.buyQty + p.getQty; const free = Math.floor(us.length / group) * p.getQty;
      if (free <= 0) return;
      // cheapest units of the qualifying set receive the discount ("get" items are the lowest priced)
      commit(s, { ...meta, detail: `Buy ${p.buyQty} get ${p.getQty}${p.discountPct === 100 ? ' free' : ` at ${p.discountPct}% off`} × ${free}` }, sumUnits(us.slice(0, free), p.discountPct), p.id); return;
    }
    case 'bundle': {
      const pool = units(eligibleLines(s)).sort((a, b) => b.net - a.net);        // most valuable first → best deal for the customer
      const used = new Set<number>(); const chosenPerComp: number[][] = [];
      const avail = p.items.map((it) => pool.map((u, i) => ({ u, i })).filter(({ u }) => { const l = s.lines.find((x) => x.lineId === u.lineId)!; return matches(l, it.scope); }));
      // greedy per component; overlapping scopes consume each unit once
      const take = (k: number) => {
        used.clear(); chosenPerComp.length = 0;
        for (let c = 0; c < p.items.length; c++) {
          const picked: number[] = [];
          for (const { i } of avail[c]!) { if (picked.length >= k * p.items[c]!.qty) break; if (!used.has(i)) { used.add(i); picked.push(i); } }
          if (picked.length < k * p.items[c]!.qty) return false;
          chosenPerComp.push(picked);
        }
        return true;
      };
      let bundles = 0; while (take(bundles + 1)) bundles++;
      if (bundles <= 0) return;
      take(bundles);
      const chosen = chosenPerComp.flat().map((i) => pool[i]!);
      const value = chosen.reduce((a, u) => a + u.net, 0);
      const disc = value - bundles * p.bundlePricePaise;
      if (disc <= 0) return;
      const parts = apportion(disc, chosen.map((u) => u.net)); const alloc: Record<string, number> = {};
      chosen.forEach((u, k) => { alloc[u.lineId] = (alloc[u.lineId] ?? 0) + parts[k]!; });
      commit(s, { ...meta, detail: `${bundles} bundle${bundles > 1 ? 's' : ''} at ${p.bundlePricePaise / 100}` }, alloc, p.id); return;
    }
    case 'free_gift': {
      const base = sumNet(eligibleLines(s));
      if (base < p.minPaise || s.lines.some((l) => l.lineId === `gift-${p.id}`)) return;
      const g = p.gift;
      s.lines.push({ lineId: `gift-${p.id}`, skuId: g.skuId, name: `${g.name} (free gift)`, qty: 1, unitPricePaise: g.mrpPaise, mrpPaise: g.mrpPaise, gstRate: g.gstRate, hsn: g.hsn, departmentId: g.departmentId, categoryId: g.categoryId, subCategoryId: g.subCategoryId, brandId: g.brandId, isFreeGift: true, grossPaise: g.mrpPaise, discountPaise: g.mrpPaise, netPaise: 0, allocations: [{ promoId: p.id, name: p.name, amountPaise: g.mrpPaise }] });
      s.applied.push({ ...meta, amountPaise: g.mrpPaise, lineAllocations: { [`gift-${p.id}`]: g.mrpPaise }, detail: `Free ${g.name}` }); return;
    }
    case 'cart_threshold': {
      const ls = eligibleLines(s); const base = sumNet(ls);
      const ok = p.inclusive === false ? base > p.minPaise : base >= p.minPaise;
      if (!ok) return;
      let d = p.flatPaise !== undefined ? p.flatPaise : percentOf(base, p.pct ?? 0);
      if (p.maxPaise !== undefined) d = Math.min(d, p.maxPaise);
      commit(s, meta, spread(d, ls), p.id); return;
    }
    case 'tiered': {
      const ls = eligibleLines(s, p.scope); const base = sumNet(ls);
      const tier = [...p.tiers].sort((a, b) => b.minPaise - a.minPaise).find((t) => base >= t.minPaise);
      if (!tier) return;
      commit(s, { ...meta, detail: `${tier.pct}% on spend ≥ ${tier.minPaise / 100}` }, spread(percentOf(base, tier.pct), ls), p.id); return;
    }
    case 'loyalty_tier': {
      const pct = ctx.customer?.tierId ? p.tierPcts[ctx.customer.tierId] ?? 0 : 0;
      const ls = eligibleLines(s);
      commit(s, { ...meta, detail: `${ctx.customer?.tierId} ${pct}%` }, spread(percentOf(sumNet(ls), pct), ls), p.id); return;
    }
    case 'tender': {
      const ls = eligibleLines(s); let d = percentOf(sumNet(ls), p.pct);
      if (p.maxPaise !== undefined) d = Math.min(d, p.maxPaise);
      commit(s, { ...meta, detail: `${p.pct}% on ${ctx.tender}` }, spread(d, ls), p.id); return;
    }
  }
}

/** Returns a voucher's discount on `netPaise` or the reason it cannot be used. */
export function checkVoucher(v: Voucher, o: { netPaise: number; customerId?: string; channel: 'store' | 'web'; at: Date }): { ok: true; discountPaise: number } | { ok: false; reason: string } {
  const t = o.at.getTime();
  if (v.status === 'void') return { ok: false, reason: 'Voucher is void' };
  if (v.status === 'redeemed') return { ok: false, reason: 'Voucher already redeemed' };
  if (v.validFrom && t < Date.parse(v.validFrom.length <= 10 ? `${v.validFrom}T00:00:00+05:30` : v.validFrom)) return { ok: false, reason: 'Voucher is not valid yet' };
  if (v.validTo && t > Date.parse(v.validTo.length <= 10 ? `${v.validTo}T23:59:59.999+05:30` : v.validTo)) return { ok: false, reason: 'Voucher has expired' };
  if (v.channel && v.channel !== 'All' && v.channel.toLowerCase() !== o.channel) return { ok: false, reason: `Voucher is valid on ${v.channel.toLowerCase()} only` };
  if (v.customerId && v.customerId !== o.customerId) return { ok: false, reason: 'Voucher belongs to another customer' };
  if (v.usage === 'single' && (v.redemptionCount ?? 0) >= 1) return { ok: false, reason: 'Voucher already redeemed' };
  if (v.maxRedemptions !== undefined && (v.redemptionCount ?? 0) >= v.maxRedemptions) return { ok: false, reason: 'Voucher redemption limit reached' };
  if (v.perCustomerLimit !== undefined) {
    const used = v.redeemedByCustomer?.[o.customerId ?? 'anonymous'] ?? 0;
    if (used >= v.perCustomerLimit) return { ok: false, reason: `Limit of ${v.perCustomerLimit} use${v.perCustomerLimit > 1 ? 's' : ''} per customer reached` };
  }
  if (v.minSpendPaise !== undefined && o.netPaise < v.minSpendPaise) return { ok: false, reason: `Minimum spend ₹${v.minSpendPaise / 100} (add ₹${(v.minSpendPaise - o.netPaise) / 100} more)` };
  let d = v.valuePaise ?? 0;
  if (v.percentOff) d = percentOf(o.netPaise, v.percentOff);
  if (v.maxDiscountPaise !== undefined) d = Math.min(d, v.maxDiscountPaise);
  d = Math.min(d, o.netPaise);
  if (d <= 0) return { ok: false, reason: 'Voucher has no value for this cart' };
  return { ok: true, discountPaise: d };
}

function runPipeline(lines: CartLine[], promos: Promotion[], ctx: PricingContext, voucher: Voucher | null): { state: State; voucherError?: string } {
  const s = newState(lines, promos);
  // 0 — manual overrides (manager approved)
  for (const l of s.lines) {
    const src = lines.find((x) => x.lineId === l.lineId)!;
    if (src.manualDiscountPaise && src.manualDiscountPaise > 0 && discountable(l)) commit(s, { promoId: `manual-${l.lineId}`, name: `Manager discount${src.manualReasonCode ? ` (${src.manualReasonCode})` : ''}`, kind: 'manual', level: 'manual' }, { [l.lineId]: src.manualDiscountPaise });
  }
  const ordered = [...promos].sort(byOrder);
  let voucherError: string | undefined;
  let voucherDone = false;
  const doVoucher = () => {
    voucherDone = true;
    if (!voucher) return;
    const ls = eligibleLines(s);
    const r = checkVoucher(voucher, { netPaise: sumNet(ls), customerId: ctx.voucherCustomerId ?? ctx.customer?.id, channel: ctx.channel, at: ctx.at });
    if (!r.ok) { voucherError = r.reason; return; }
    commit(s, { promoId: `voucher-${voucher.code}`, name: `Voucher ${voucher.code}`, kind: 'voucher', level: 'voucher' }, spread(r.discountPaise, ls));
  };
  for (const p of ordered) {
    if (!voucherDone && STAGE[p.kind] >= 4) doVoucher();
    applyPromo(s, p, ctx);
  }
  if (!voucherDone) doVoucher();
  for (const l of s.lines) l.netPaise = Math.max(0, l.netPaise);
  return { state: s, voucherError };
}

const totalDiscount = (s: State) => s.lines.reduce((a, l) => a + l.discountPaise, 0);

/** Prices a cart. Never throws on business conditions; reasons surface in `rejected`, `voucherError` and `nudges`. */
export function priceCart(lines: CartLine[], promotions: Promotion[], ctx: PricingContext): PricingResult {
  const rejected: Rejection[] = [];
  const eligible: Promotion[] = [];
  for (const p of promotions) { const r = ineligibleReason(p, ctx); if (r) { if (p.status === undefined || p.status === 'active') rejected.push({ promoId: p.id, reason: r }); } else eligible.push(p); }

  // exclusive groups: keep the best member of each group
  const groups = new Map<string, Promotion[]>();
  for (const p of eligible) if (p.exclusiveGroup) groups.set(p.exclusiveGroup, [...(groups.get(p.exclusiveGroup) ?? []), p]);
  const dropped = new Set<string>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const best = members.map((m) => ({ m, d: totalDiscount(runPipeline(lines, [m], ctx, null).state) })).sort((a, b) => b.d - a.d || a.m.priority - b.m.priority)[0]!.m;
    for (const m of members) if (m !== best) { dropped.add(m.id); rejected.push({ promoId: m.id, reason: `Superseded by "${best.name}" (same exclusive group)` }); }
  }
  const live = eligible.filter((p) => !dropped.has(p.id));
  const stackable = live.filter((p) => p.stackable);
  const solo = live.filter((p) => !p.stackable);
  const voucher = ctx.voucher ?? null;
  const combinableVoucher = voucher && voucher.combinable !== false ? voucher : null;

  type Candidate = { state: State; voucherError?: string; label: string };
  const candidates: Candidate[] = [{ ...runPipeline(lines, stackable, ctx, combinableVoucher), label: 'stack' }];
  for (const p of solo) candidates.push({ ...runPipeline(lines, [p], ctx, null), label: p.id });
  if (voucher && voucher.combinable === false) {
    candidates.push({ ...runPipeline(lines, [], ctx, voucher), label: 'voucher-alone' });
  }
  let best = candidates[0]!;
  for (const c of candidates) if (totalDiscount(c.state) > totalDiscount(best.state)) best = c;
  for (const c of candidates) if (c !== best && c.label !== 'stack' && c.label !== 'voucher-alone') {
    const p = solo.find((x) => x.id === c.label)!;
    if (!best.state.applied.some((a) => a.promoId === p.id)) rejected.push({ promoId: p.id, reason: 'Not stackable — a better offer was applied' });
  }
  const voucherError = best.label === 'voucher-alone' ? best.voucherError : candidates[0]!.voucherError ?? (voucher && voucher.combinable === false && best.label !== 'voucher-alone' ? 'Voucher cannot be combined with promotions — promotions gave a better price' : undefined);

  const st = best.state;
  const lns = st.lines;
  const gross = lns.reduce((a, l) => a + l.grossPaise, 0);
  const net = lns.reduce((a, l) => a + l.netPaise, 0);
  return { lines: lns, applied: st.applied, nudges: nudgesFor(lines, live, st, ctx), rejected, grossPaise: gross, discountPaise: gross - net, netPaise: net, voucherError };
}

/** "Add ₹X to unlock …" suggestions for offers that are close but not yet applied. */
function nudgesFor(src: CartLine[], promos: Promotion[], st: State, ctx: PricingContext): Nudge[] {
  const out: Nudge[] = [];
  const appliedIds = new Set(st.applied.map((a) => a.promoId));
  const base = sumNet(st.lines.filter(discountable));
  const inr = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;
  for (const p of promos) {
    if (appliedIds.has(p.id)) continue;
    if (p.kind === 'cart_threshold') {
      const need = (p.inclusive === false ? p.minPaise + 1 : p.minPaise) - base;
      if (need > 0 && base > 0 && need <= Math.max(p.minPaise * 0.7, 50_000)) out.push({ promoId: p.id, kind: p.kind, remainingPaise: need, message: `Add ${inr(need)} more to unlock ${p.pct ? `${p.pct}% off` : `${inr(p.flatPaise ?? 0)} off`}` });
    } else if (p.kind === 'tiered') {
      const ls = st.lines.filter((l) => discountable(l) && matches(l, p.scope)); const b = sumNet(ls);
      const next = [...p.tiers].sort((a, b2) => a.minPaise - b2.minPaise).find((t) => t.minPaise > b);
      if (next && b > 0) out.push({ promoId: p.id, kind: p.kind, remainingPaise: next.minPaise - b, message: `Add ${inr(next.minPaise - b)} more to unlock ${next.pct}% off` });
    } else if (p.kind === 'free_gift') {
      const need = p.minPaise - base;
      if (need > 0 && base > 0) out.push({ promoId: p.id, kind: p.kind, remainingPaise: need, message: `Add ${inr(need)} more to get a free ${p.gift.name}` });
    } else if (p.kind === 'bxgy') {
      const n = src.filter((l) => discountable(l) && matches(l, p.scope)).reduce((a, l) => a + l.qty, 0); const grp = p.buyQty + p.getQty; const r = n % grp;
      if (n > 0 && r >= p.buyQty - 1 && r < grp) { const need = grp - r; out.push({ promoId: p.id, kind: p.kind, remainingQty: need, message: `Add ${need} more eligible item${need > 1 ? 's' : ''} — ${p.name}` }); }
    } else if (p.kind === 'tender' && !ctx.tender) {
      out.push({ promoId: p.id, kind: p.kind, message: `${p.pct}% off when you pay with ${p.tenders.join('/')}` });
    }
  }
  return out;
}

/** Margin impact of a result given unit costs — used by the (Phase 7) margin simulator and POS manager view. */
export function marginImpact(result: PricingResult, unitCostPaiseBySku: Record<string, number>, gstInclusive = true) {
  let revenue = 0, cost = 0;
  for (const l of result.lines) {
    revenue += gstInclusive ? Math.round((l.netPaise * 100) / (100 + l.gstRate)) : l.netPaise;
    cost += (unitCostPaiseBySku[l.skuId] ?? 0) * l.qty;
  }
  return { revenuePaise: revenue, costPaise: cost, marginPaise: revenue - cost, marginPct: revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0 };
}
