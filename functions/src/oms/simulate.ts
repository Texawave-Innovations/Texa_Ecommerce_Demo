import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { SimulateWebOrderInput } from '@texafashions/types';
import { WAREHOUSE_ID } from '@texafashions/types';
import { DEFAULT_ALLOC_POLICY, allocateOrder, availableAt, type AllocLocation } from '@texafashions/domain';
import { col, type Caller } from '../admin';
import { fail, requireRoles } from '../engine';
import { ingestShopifyEvent } from '../shopify/ingest';
import type { Doc } from './orders';

const CITIES = [
  { city: 'Pune', state: 'Maharashtra', zip: '411001' }, { city: 'Bengaluru', state: 'Karnataka', zip: '560001' }, { city: 'Hyderabad', state: 'Telangana', zip: '500081' },
  { city: 'New Delhi', state: 'Delhi', zip: '110001' }, { city: 'Kolkata', state: 'West Bengal', zip: '700001' }, { city: 'Chennai', state: 'Tamil Nadu', zip: '600001' },
];
const FIRST = ['Asha', 'Riya', 'Meera', 'Ishaan', 'Kabir', 'Sana', 'Tara', 'Neel']; const LAST = ['Rao', 'Iyer', 'Shah', 'Reddy', 'Nair', 'Mehta', 'Das', 'Kulkarni'];
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;
const int = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

/**
 * "Simulate web order" — builds a Shopify-shaped `orders/create` payload from live stock and feeds it through the same
 * ingest path as the real webhook (everything after HMAC verification). Scenarios exercise each branch of allocation.
 */
export async function simulateWebOrder(c: Caller, i: z.output<typeof SimulateWebOrderInput>) {
  requireRoles(c, 'warehouse_manager', 'store_manager', 'cfo');
  const [stockSnap, skuSnap, storeSnap] = await Promise.all([col('stock').get(), col('skus').where('status', '==', 'active').get(), col('stores').get()]);
  // Only SKUs published to Shopify (have a variant id) can appear on a web order.
  const skus = new Map(skuSnap.docs.filter((d) => !d.get('isService') && d.id !== 'SVC-GIFTWRAP' && d.get('shopifyVariantId')).map((d) => [d.id, d.data() as Doc]));
  const locs = new Map<string, AllocLocation>();
  for (const d of stockSnap.docs) {
    const id = d.get('locationId') as string; const l = locs.get(id) ?? { id, kind: id === WAREHOUSE_ID ? 'warehouse' : 'store', stock: {} } as AllocLocation;
    l.stock[d.get('skuId')] = { onHand: d.get('onHand') ?? 0, reserved: d.get('reserved') ?? 0 }; locs.set(id, l);
  }
  const stores = storeSnap.docs.map((d) => d.id); const wh = locs.get(WAREHOUSE_ID);
  if (!wh) fail('No warehouse stock found — run the seed first');
  const avail = (loc: string, sku: string, pickup = false) => availableAt(locs.get(loc)!, sku, DEFAULT_ALLOC_POLICY, pickup);
  const inWh = [...skus.keys()].filter((s) => avail(WAREHOUSE_ID, s) >= 6);
  const n = i.count ?? 1; const results: Doc[] = [];

  for (let k = 0; k < n; k++) {
    let items: { sku: string; qty: number }[]; let pickupStore: string | undefined; const scn = i.scenario;
    const dest = i.shipToState ? CITIES.find((x) => x.state.toLowerCase() === i.shipToState!.toLowerCase()) ?? pick(CITIES) : pick(CITIES);
    if (scn === 'bad_sku') items = [{ sku: 'US-NOPE-0000', qty: 1 }];
    else if (scn === 'bopis') {
      pickupStore = i.pickupStoreId ?? pick(stores);
      const here = [...skus.keys()].filter((s) => avail(pickupStore!, s, true) >= 3);
      if (!here.length) fail(`${pickupStore} has no stock to reserve for pickup`);
      items = [pick(here), pick(here)].filter((s, ix, a) => a.indexOf(s) === ix).map((sku) => ({ sku, qty: int(1, 2) }));
    } else if (scn === 'out_of_stock') {
      const sku = pick(inWh); const total = [...locs.values()].reduce((a, l) => a + availableAt(l, sku, DEFAULT_ALLOC_POLICY), 0);
      items = [{ sku, qty: Math.min(999, total + 3) }];
    } else if (scn === 'split') {
      // Search for a basket no single location can cover: A from the warehouse, B only in some stores.
      const noWh = [...skus.keys()].filter((s) => avail(WAREHOUSE_ID, s) === 0 && stores.some((st) => avail(st, s) >= 1));
      const view = [...locs.values()]; let found: { sku: string; qty: number }[] | null = null;
      for (let t = 0; t < 400 && noWh.length && !found; t++) {
        const a = pick(inWh); const cand = [{ sku: a, qty: int(2, Math.max(2, Math.min(15, avail(WAREHOUSE_ID, a)))) }, { sku: pick(noWh), qty: int(1, 2) }];   // a bulk line stores can't cover + a store-only line
        if (cand[0]!.sku !== cand[1]!.sku && allocateOrder({ lines: cand.map((x) => ({ skuId: x.sku, qty: x.qty })), fulfilmentType: 'ship', shipTo: {} }, view, DEFAULT_ALLOC_POLICY).strategy === 'split') found = cand;
      }
      if (!found) fail('No basket needs two locations with current stock, so a split order cannot be built');
      items = found;
    } else {
      const cnt = scn === 'high_risk_cod' ? 1 : int(1, 3);
      items = [...new Set(Array.from({ length: cnt }, () => pick(inWh)))].map((sku) => ({ sku, qty: scn === 'high_risk_cod' ? 6 : int(1, 3) }));
    }
    const priced = items.map((it, ix) => { const s = skus.get(it.sku); return { id: 9_000_000 + ix, sku: it.sku, title: s?.name ?? 'Unknown item', quantity: it.qty, price: ((s?.pricePaise ?? 19900) / 100).toFixed(2) }; });
    const subtotal = priced.reduce((a, l) => a + Number(l.price) * l.quantity, 0);
    const discount = scn === 'bad_sku' ? 0 : subtotal > 2000 ? Math.round(subtotal * 5) / 100 : 0;            // live offer: 5% off above ₹2,000
    const lines = priced.map((l) => ({ ...l, total_discount: discount ? (Number(l.price) * l.quantity * 0.05).toFixed(2) : '0.00' }));
    const shipping = pickupStore || subtotal >= 999 ? 0 : 99;
    const cod = scn === 'cod' || scn === 'high_risk_cod' || (scn === 'bopis' && Math.random() < 0.4);   // some pickups are pay-at-store
    const first = pick(FIRST); const last = pick(LAST); const mobile = `9${int(100000000, 999999999)}`;
    const zip = scn === 'high_risk_cod' ? '781001' : dest.zip; const state = scn === 'high_risk_cod' ? 'Assam' : dest.state; const city = scn === 'high_risk_cod' ? 'Guwahati' : dest.city;
    const shopifyId = Date.now() * 1000 + int(0, 999) + k;
    const payload = {
      id: shopifyId, name: `#SIM${int(1000, 9999)}`, order_number: int(1000, 9999), created_at: new Date().toISOString(), financial_status: cod ? 'pending' : 'paid',
      total_price: (subtotal - discount + shipping).toFixed(2), total_discounts: discount.toFixed(2), email: `${first}.${last}@example.com`.toLowerCase(), phone: `+91${mobile}`,
      payment_gateway_names: [cod ? 'Cash on Delivery (COD)' : 'razorpay'], discount_codes: discount ? [{ code: 'ABOVE2000' }] : [],
      customer: { id: shopifyId % 1_000_000, first_name: first, last_name: last },
      shipping_address: pickupStore ? null : { name: `${first} ${last}`, address1: `${int(1, 99)}, ${pick(['MG Road', 'Park Street', 'Banjara Hills', 'Koregaon Park'])}`, city, province: state, zip, phone: mobile },
      shipping_lines: pickupStore ? [{ title: 'Pickup in store', code: 'pickup', price: '0.00' }] : [{ title: shipping ? 'Standard' : 'Free shipping', code: 'STD', price: shipping.toFixed(2) }],
      note_attributes: [...(pickupStore ? [{ name: 'pickup_store', value: pickupStore }] : []), ...(Math.random() < 0.3 ? [{ name: 'gift_note', value: 'Happy birthday! 🎂' }] : [])],
      line_items: lines,
    };
    const r = await ingestShopifyEvent({ id: `sim-${randomUUID()}`, topic: 'orders/create', shop: 'demo-simulator', payload });
    results.push({ scenario: scn, orderName: payload.name, eventStatus: r.status, ...(r.status === 'processed' ? (r.detail as Doc) : { error: r.error }) });
  }
  return { count: n, results };
}
// used by nothing else; exported for tests that want the same allocation view
export { allocateOrder };
