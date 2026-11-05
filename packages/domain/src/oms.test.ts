import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALLOC_POLICY, MAX_EVENT_ATTEMPTS, allocateOrder, availableAt, bopisHoldUntil, deriveOrderStatus, diffStockPush, isDeadLetter, mapShopifyOrder, normaliseMobile, orderTotalVariance,
  pickupCode, reconcileCod, retryDelaySeconds, riskScore, validateRtoQc, verifyPack, webSellableQty, type AllocLocation,
} from './oms';

const loc = (id: string, kind: 'warehouse' | 'store', city: string, state: string, stock: Record<string, [number, number?]>): AllocLocation =>
  ({ id, kind, city, state, stock: Object.fromEntries(Object.entries(stock).map(([k, [o, r]]) => [k, { onHand: o, reserved: r ?? 0 }])) });
const WH = (s: Record<string, [number, number?]>) => loc('WH', 'warehouse', 'Bhiwandi', 'Maharashtra', s);
const BLR = (s: Record<string, [number, number?]>) => loc('BLR', 'store', 'Bengaluru', 'Karnataka', s);
const HYD = (s: Record<string, [number, number?]>) => loc('HYD', 'store', 'Hyderabad', 'Telangana', s);
const SHIP = { city: 'Bengaluru', state: 'Karnataka' };

const payload = (over: Record<string, any> = {}) => ({
  id: 5501, name: '#1001', created_at: '2026-11-05T09:00:00Z', financial_status: 'paid', total_price: '1397.00', total_discounts: '100.00', email: 'a@b.in', phone: '+91 98765 43210',
  payment_gateway_names: ['razorpay'], customer: { id: 77, first_name: 'Asha', last_name: 'Rao' },
  shipping_address: { name: 'Asha Rao', address1: '12 MG Road', city: 'Bengaluru', province: 'Karnataka', zip: '560001', phone: '9876543210' },
  shipping_lines: [{ title: 'Standard', price: '99.00', code: 'STD' }],
  line_items: [{ id: 1, sku: 'US-ST-PEN-001', title: 'Gel pen', quantity: 2, price: '399.00', total_discount: '100.00' }, { id: 2, sku: 'US-BG-TOT-002', title: 'Tote', quantity: 1, price: '600.00', total_discount: '0.00' }],
  ...over,
});

describe('mapShopifyOrder', () => {
  it('maps prepaid ship order, tax-inclusive paise, mobile normalised', () => {
    const o = mapShopifyOrder(payload());
    expect(o.paymentMode).toBe('prepaid'); expect(o.fulfilmentType).toBe('ship');
    expect(o.lines[0]).toMatchObject({ sku: 'US-ST-PEN-001', qty: 2, unitPaise: 39900, discountPaise: 10000 });
    expect(o.shippingPaise).toBe(9900); expect(o.customer.mobile).toBe('9876543210');
    expect(orderTotalVariance(o)).toBe(0);    // 2*399 - 100 + 600 + 99 = 1397
  });
  it('detects COD and BOPIS (pickup_store attribute)', () => {
    expect(mapShopifyOrder(payload({ payment_gateway_names: ['Cash on Delivery (COD)'] })).paymentMode).toBe('cod');
    const b = mapShopifyOrder(payload({ note_attributes: [{ name: 'pickup_store', value: 'blr-fs' }, { name: 'gift_note', value: 'Happy bday' }], shipping_address: null }));
    expect(b.fulfilmentType).toBe('bopis'); expect(b.pickupStoreId).toBe('BLR-FS'); expect(b.giftNote).toBe('Happy bday');
  });
  it('rejects malformed payloads', () => {
    expect(() => mapShopifyOrder({ id: 1 })).toThrow(/line_items/);
    expect(() => mapShopifyOrder(payload({ line_items: [{ id: 1, title: 'x', quantity: 1, price: '1' }] }))).toThrow(/no SKU/);
    expect(() => mapShopifyOrder(payload({ shipping_address: { zip: '56' } }))).toThrow(/pincode/);
  });
  it('mobile normalisation', () => { expect(normaliseMobile('+919876543210')).toBe('9876543210'); expect(normaliseMobile('12345')).toBeUndefined(); });
});

describe('riskScore', () => {
  const base = mapShopifyOrder(payload());
  it('prepaid repeat customer is low', () => expect(riskScore(base, { priorOrders: 3 }).level).toBe('low'));
  it('COD, high value, far-flung pincode, prior RTO is high and explains itself', () => {
    const o = { ...base, paymentMode: 'cod' as const, totalPaise: 450_000, shipTo: { ...base.shipTo, pincode: '791001' } };
    const r = riskScore(o, { priorRtoCount: 1, priorOrders: 2 });
    expect(r.level).toBe('high'); expect(r.reasons.length).toBeGreaterThanOrEqual(4); expect(r.score).toBeLessThanOrEqual(100);
  });
});

describe('allocateOrder', () => {
  it('prefers the warehouse when it covers the whole order', () => {
    const r = allocateOrder({ lines: [{ skuId: 'A', qty: 2 }], fulfilmentType: 'ship', shipTo: SHIP }, [BLR({ A: [10] }), WH({ A: [5] })]);
    expect(r.strategy).toBe('single'); expect(r.allocations[0]!.locationId).toBe('WH');
  });
  it('falls back to the nearest store, honouring the 2-unit walk-in buffer', () => {
    const locs = [WH({ A: [0] }), BLR({ A: [4] }), HYD({ A: [9] })];
    expect(availableAt(locs[1]!, 'A', DEFAULT_ALLOC_POLICY)).toBe(2);
    const r = allocateOrder({ lines: [{ skuId: 'A', qty: 2 }], fulfilmentType: 'ship', shipTo: SHIP }, locs);
    expect(r.allocations[0]!.locationId).toBe('BLR');
    const r2 = allocateOrder({ lines: [{ skuId: 'A', qty: 3 }], fulfilmentType: 'ship', shipTo: SHIP }, locs);
    expect(r2.allocations[0]!.locationId).toBe('HYD');     // BLR only has 2 sellable
  });
  it('reserved units are not allocatable', () => {
    const r = allocateOrder({ lines: [{ skuId: 'A', qty: 3 }], fulfilmentType: 'ship', shipTo: SHIP }, [WH({ A: [4, 2] })]);
    expect(r.complete).toBe(false); expect(r.shortages).toEqual([{ skuId: 'A', qty: 1 }]);
  });
  it('splits across locations when none can cover everything, greedy by coverage', () => {
    const r = allocateOrder({ lines: [{ skuId: 'A', qty: 3 }, { skuId: 'B', qty: 2 }], fulfilmentType: 'ship', shipTo: SHIP }, [WH({ A: [3] }), BLR({ B: [5] })]);
    expect(r.strategy).toBe('split'); expect(r.allocations.map((a) => a.locationId).sort()).toEqual(['BLR', 'WH']);
    expect(r.allocations.flatMap((a) => a.lines).reduce((n, l) => n + l.qty, 0)).toBe(5);
  });
  it('respects maxSplits and reports shortages without partial commitment', () => {
    const r = allocateOrder({ lines: [{ skuId: 'A', qty: 1 }, { skuId: 'B', qty: 1 }, { skuId: 'C', qty: 1 }], fulfilmentType: 'ship', shipTo: SHIP }, [WH({ A: [1] }), BLR({ B: [9] }), HYD({ C: [9] })]);
    expect(r.complete).toBe(false); expect(r.shortages.length).toBeGreaterThan(0);
  });
  it('BOPIS: only the pickup store, no buffer', () => {
    const ok = allocateOrder({ lines: [{ skuId: 'A', qty: 2 }], fulfilmentType: 'bopis', pickupStoreId: 'BLR', shipTo: {} }, [WH({ A: [50] }), BLR({ A: [2] })]);
    expect(ok.complete).toBe(true); expect(ok.allocations[0]!.locationId).toBe('BLR');
    const no = allocateOrder({ lines: [{ skuId: 'A', qty: 3 }], fulfilmentType: 'bopis', pickupStoreId: 'BLR', shipTo: {} }, [WH({ A: [50] }), BLR({ A: [2] })]);
    expect(no.complete).toBe(false); expect(no.shortages).toEqual([{ skuId: 'A', qty: 1 }]);
  });
  it('duplicate SKU lines are merged', () => {
    const r = allocateOrder({ lines: [{ skuId: 'A', qty: 1 }, { skuId: 'A', qty: 2 }], fulfilmentType: 'ship', shipTo: SHIP }, [WH({ A: [3] })]);
    expect(r.allocations[0]!.lines).toEqual([{ skuId: 'A', qty: 3 }]);
  });
});

describe('web stock safety buffer', () => {
  const p = { storeBuffer: 2, warehouseBuffer: 0, lowStockFloor: 1, maxPush: 500 };
  it('sums per-location sellable after buffers and reservations', () => expect(webSellableQty([{ kind: 'warehouse', onHand: 10, reserved: 3 }, { kind: 'store', onHand: 5, reserved: 0 }, { kind: 'store', onHand: 2, reserved: 0 }], p)).toBe(10));
  it('last unit is never sold online', () => { expect(webSellableQty([{ kind: 'warehouse', onHand: 1, reserved: 0 }], p)).toBe(0); expect(webSellableQty([{ kind: 'warehouse', onHand: 2, reserved: 0 }], p)).toBe(2); });
  it('negative / over-reserved stock never goes below zero; cap applies', () => {
    expect(webSellableQty([{ kind: 'store', onHand: -3, reserved: 0 }], p)).toBe(0);
    expect(webSellableQty([{ kind: 'warehouse', onHand: 9000, reserved: 0 }], p)).toBe(500);
  });
  it('per-SKU override buffer replaces the default', () => expect(webSellableQty([{ kind: 'warehouse', onHand: 10, reserved: 0 }], p, 4)).toBe(6));
  it('push diff only returns changed SKUs', () => {
    const d = diffStockPush(new Map([['A', 5], ['B', 0], ['C', 3]]), new Map([['A', 5], ['B', 2]]));
    expect(d.changes).toEqual([{ skuId: 'B', from: 2, to: 0 }, { skuId: 'C', from: null, to: 3 }]); expect(d.unchanged).toBe(1);
    expect(diffStockPush(new Map([['A', 5]]), new Map([['A', 5]]), true).changes).toHaveLength(1);
  });
});

describe('pack verification', () => {
  const map = { '111': 'A', '222': 'B' };
  it('exact scan passes', () => expect(verifyPack([{ skuId: 'A', qty: 2 }, { skuId: 'B', qty: 1 }], ['111', '222', '111'], map).ok).toBe(true));
  it('reports missing, extra and unknown', () => {
    const v = verifyPack([{ skuId: 'A', qty: 2 }, { skuId: 'B', qty: 1 }], ['111', '222', '222', '999'], map);
    expect(v.ok).toBe(false); expect(v.missing).toEqual([{ skuId: 'A', qty: 1 }]); expect(v.extra).toEqual([{ skuId: 'B', qty: 1 }]); expect(v.unknownBarcodes).toEqual(['999']);
  });
});

describe('retry backoff', () => {
  it('doubles from 30s and dead-letters after the max attempts', () => {
    expect([1, 2, 3, 4, 5, 6].map(retryDelaySeconds)).toEqual([30, 60, 120, 240, 480, 960]); expect(retryDelaySeconds(20)).toBe(1800);
    expect(isDeadLetter(MAX_EVENT_ATTEMPTS - 1)).toBe(false); expect(isDeadLetter(MAX_EVENT_ATTEMPTS)).toBe(true);
  });
});

describe('order status roll-up', () => {
  it('walks the lifecycle', () => {
    expect(deriveOrderStatus({ pickLists: [], shipments: [], awaitingStock: true })).toBe('awaiting_stock');
    expect(deriveOrderStatus({ pickLists: [{ status: 'open' }], shipments: [] })).toBe('allocated');
    expect(deriveOrderStatus({ pickLists: [{ status: 'picked' }, { status: 'open' }], shipments: [] })).toBe('picking');
    expect(deriveOrderStatus({ pickLists: [{ status: 'shipped' }, { status: 'packed' }], shipments: [{ status: 'booked' }] })).toBe('partially_shipped');
    expect(deriveOrderStatus({ pickLists: [{ status: 'shipped' }], shipments: [{ status: 'delivered' }] })).toBe('delivered');
    expect(deriveOrderStatus({ pickLists: [{ status: 'shipped' }], shipments: [{ status: 'rto_initiated' }] })).toBe('rto');
    expect(deriveOrderStatus({ pickLists: [{ status: 'ready_for_pickup' }], shipments: [] })).toBe('ready_for_pickup');
    expect(deriveOrderStatus({ pickLists: [{ status: 'cancelled' }], shipments: [] })).toBe('cancelled');
  });
});

describe('BOPIS + RTO QC', () => {
  it('48h hold and 6-digit code', () => { expect(bopisHoldUntil(new Date('2026-11-05T10:00:00Z')).toISOString()).toBe('2026-11-07T10:00:00.000Z'); expect(pickupCode(() => 0)).toBe('100000'); expect(pickupCode(() => 0.999999)).toBe('999999'); });
  it('QC must account for every returned unit', () => {
    expect(validateRtoQc([{ skuId: 'A', qty: 3 }], [{ skuId: 'A', good: 2, damaged: 1 }])).toBeNull();
    expect(validateRtoQc([{ skuId: 'A', qty: 3 }], [{ skuId: 'A', good: 2, damaged: 0 }])).toMatch(/must equal/);
    expect(validateRtoQc([{ skuId: 'A', qty: 1 }, { skuId: 'B', qty: 1 }], [{ skuId: 'A', good: 1, damaged: 0 }])).toMatch(/Missing QC/);
  });
});

describe('COD remittance reconciliation', () => {
  const expected = [{ awb: 'A1', amountPaise: 50000 }, { awb: 'A2', amountPaise: 30000 }, { awb: 'A3', amountPaise: 20000 }];
  it('classifies matched / short / unknown / duplicate and lists pending', () => {
    const r = reconcileCod(expected, [{ awb: 'A1', amountPaise: 50000 }, { awb: 'A2', amountPaise: 29000 }, { awb: 'ZZ', amountPaise: 1000 }, { awb: 'A1', amountPaise: 50000 }]);
    expect(r.rows.map((x) => x.status)).toEqual(['matched', 'short', 'unknown_awb', 'duplicate']);
    expect(r.shortPaise).toBe(1000); expect(r.pendingAwbs).toEqual(['A3']); expect(r.remittedPaise).toBe(130000);
  });
  it('excess is flagged', () => { const r = reconcileCod(expected, [{ awb: 'A3', amountPaise: 25000 }]); expect(r.rows[0]!.status).toBe('excess'); expect(r.excessPaise).toBe(5000); });
});
