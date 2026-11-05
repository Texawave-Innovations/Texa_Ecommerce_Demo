/** Phase 4 seed: web orders at every stage of the OMS, created through the real handlers (the simulator feeds the same ingest path as the Shopify webhook). */
import { ORG_ID } from '@texafashions/types';
import type { Firestore } from 'firebase-admin/firestore';

const P = (c: string) => `orgs/${ORG_ID}/${c}`;

export async function seedOms(db: Firestore) {
  const { OMS_SYSTEM } = await import('../../../functions/src/oms/orders');
  const { simulateWebOrder } = await import('../../../functions/src/oms/simulate');
  const F = await import('../../../functions/src/oms/fulfil');
  const B = await import('../../../functions/src/oms/bopis');
  const R = await import('../../../functions/src/oms/rto');
  const { pushStock } = await import('../../../functions/src/shopify/stockPush');
  const c = OMS_SYSTEM; const log = (m: string) => console.log('  · ' + m);
  const get = async (col: string, id: string) => (await db.doc(`${P(col)}/${id}`).get()).data() as Record<string, any>;

  const sim = async (scenario: Parameters<typeof simulateWebOrder>[1]['scenario'], extra: Record<string, unknown> = {}) => {
    const r = await simulateWebOrder(c, { scenario, count: 1, ...extra } as never);
    const x = r.results[0]!; if (x.eventStatus !== 'processed' && scenario !== 'bad_sku') throw new Error(`seed ${scenario}: ${JSON.stringify(x)}`);
    return x as { orderId: string; status: string };
  };
  const scansFor = (pl: Record<string, any>) => (pl.lines as Record<string, any>[]).flatMap((l) => Array(l.qty).fill(l.barcode ?? l.skuId) as string[]);
  const pickPackShip = async (orderId: string, upTo: 'picked' | 'packed' | 'shipped') => {
    for (const u of (await get('webOrders', orderId)).units as Record<string, any>[]) {
      const pl = await get('pickLists', u.pickListId);
      await F.confirmPick(c, { pickListId: u.pickListId, picks: pl.lines.map((l: any) => ({ skuId: l.skuId, pickedQty: l.qty })) });
      if (upTo === 'picked') continue;
      await F.packOrder(c, { pickListId: u.pickListId, scans: scansFor(pl), giftNote: null, weightG: null });
      if (upTo === 'packed') continue;
      await F.createShipment(c, { pickListId: u.pickListId });
    }
  };
  const track = async (orderId: string, ...events: ('picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'ndr' | 'rto_initiated' | 'rto_delivered')[]) => {
    for (const u of (await get('webOrders', orderId)).units as Record<string, any>[]) {
      const awb = (await get('pickLists', u.pickListId)).awb as string;
      for (const e of events) await F.applyCourierEvent(c, { awb, event: e });
    }
  };

  const delivered = ['picked_up', 'in_transit', 'out_for_delivery', 'delivered'] as const;
  // Prepaid: delivered / in transit / packed / freshly allocated
  const a = await sim('prepaid'); await pickPackShip(a.orderId, 'shipped'); await track(a.orderId, ...delivered);
  const b = await sim('prepaid'); await pickPackShip(b.orderId, 'shipped'); await track(b.orderId, 'picked_up', 'in_transit');
  const cc = await sim('prepaid'); await pickPackShip(cc.orderId, 'packed');
  await sim('prepaid');
  // COD: three delivered (cash sits with the courier → remittance demo), one RTO back at origin, one high-risk
  for (let i = 0; i < 3; i++) { const o = await sim('cod'); await pickPackShip(o.orderId, 'shipped'); await track(o.orderId, ...delivered); }
  const rto = await sim('cod'); await pickPackShip(rto.orderId, 'shipped'); await track(rto.orderId, 'picked_up', 'in_transit', 'out_for_delivery', 'ndr', 'rto_initiated', 'rto_delivered');
  const rto2 = await sim('prepaid'); await pickPackShip(rto2.orderId, 'shipped'); await track(rto2.orderId, 'picked_up', 'in_transit', 'rto_initiated', 'rto_delivered');
  for (const u of (await get('webOrders', rto2.orderId)).units as Record<string, any>[]) await R.receiveRto(c, { shipmentId: u.shipmentId, scans: null });
  await sim('high_risk_cod');
  // BOPIS: one ready at the counter, one still to pick
  const bo = await sim('bopis'); await pickPackShip(bo.orderId, 'packed');
  for (const u of (await get('webOrders', bo.orderId)).units as Record<string, any>[]) await B.markReadyForPickup(c, { pickListId: u.pickListId });
  await sim('bopis');
  // Allocation edge cases + a poison webhook that lands in failedEvents
  try { await sim('split'); } catch (e) { log(`split scenario skipped: ${(e as Error).message}`); }
  await sim('out_of_stock');
  await simulateWebOrder(c, { scenario: 'bad_sku', count: 1 } as never);
  // Stock → Shopify (mock store), after reservations so nothing shows as drift
  const push = await pushStock({ trigger: 'schedule' });
  const n = (await db.collection(P('webOrders')).get()).size;
  log(`${n} web orders across every OMS stage, 1 failed webhook awaiting retry, stock pushed for ${push.pushed} SKUs`);
}
