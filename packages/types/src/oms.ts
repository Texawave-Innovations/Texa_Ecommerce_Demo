import { z } from 'zod';

/** Phase 4 collections (all under /orgs/texafashions). Read through the generic `scm` repo; every write is a callable/HTTPS function. */
export const OMS_COLLECTIONS = [
  'webOrders', 'pickLists', 'shipments', 'rtoCases', 'codRemittances', 'shopifyEvents', 'failedEvents', 'stockPushRuns', 'shopifyStock', 'syncHealth',
] as const;
export type OmsCollection = (typeof OMS_COLLECTIONS)[number];

export const WEB_ORDER_STATUSES = ['new', 'awaiting_stock', 'allocated', 'picking', 'packed', 'partially_shipped', 'shipped', 'ready_for_pickup', 'delivered', 'collected', 'rto', 'expired', 'cancelled'] as const;
export type WebOrderStatus = (typeof WEB_ORDER_STATUSES)[number];
export const SHIPMENT_STATUSES = ['booked', 'picked_up', 'in_transit', 'out_for_delivery', 'ndr', 'delivered', 'rto_initiated', 'rto_delivered', 'rto_received', 'cancelled'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
export const COURIER_EVENTS = ['picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'ndr', 'rto_initiated', 'rto_delivered'] as const;
export type CourierEventName = (typeof COURIER_EVENTS)[number];
export const SHOPIFY_TOPICS = ['orders/create', 'orders/paid', 'orders/cancelled', 'refunds/create', 'products/update', 'inventory_levels/update', 'customers/create'] as const;

/** Stock-push policy (also shown on the sync-health page). */
export const STOCK_PUSH_POLICY = { storeBuffer: 2, warehouseBuffer: 0, lowStockFloor: 1, maxPush: 500 } as const;

const id = z.string().min(1).max(100);
const paise = z.number().int().nonnegative();

export const SimulateWebOrderInput = z.object({
  scenario: z.enum(['prepaid', 'cod', 'bopis', 'split', 'out_of_stock', 'bad_sku', 'high_risk_cod']).default('prepaid'),
  count: z.number().int().min(1).max(10).nullish(), pickupStoreId: z.string().nullish(), shipToState: z.string().nullish(),
});
export const AllocateOrderInput = z.object({ orderId: id });
export const CancelOrderInput = z.object({ orderId: id, reason: z.string().min(2).max(200) });
export const ConfirmPickInput = z.object({ pickListId: id, picks: z.array(z.object({ skuId: id, pickedQty: z.number().int().nonnegative().max(999) })).min(1).max(80) });
export const PackOrderInput = z.object({ pickListId: id, scans: z.array(z.string().min(3).max(64)).min(1).max(400), giftNote: z.string().max(240).nullish(), weightG: z.number().int().min(10).max(30000).nullish() });
export const CreateShipmentInput = z.object({ pickListId: id });
export const CourierEventInput = z.object({ awb: id, event: z.enum(COURIER_EVENTS), note: z.string().max(200).nullish() });
export const MarkReadyForPickupInput = z.object({ pickListId: id });
export const CollectBopisInput = z.object({ pickListId: id, code: z.string().min(4).max(8), paidAtStore: z.object({ mode: z.enum(['CASH', 'UPI', 'CARD']), ref: z.string().nullish() }).nullish() });
export const ReceiveRtoInput = z.object({ shipmentId: id, scans: z.array(z.string().min(3).max(64)).max(400).nullish() });
export const QcRtoInput = z.object({ rtoId: id, lines: z.array(z.object({ skuId: id, good: z.number().int().nonnegative(), damaged: z.number().int().nonnegative() })).min(1).max(80), note: z.string().max(200).nullish() });
export const ImportCodRemittanceInput = z.object({
  courier: z.string().min(2), utr: z.string().min(4).max(40), remittedOn: z.string().min(8).max(30),
  lines: z.array(z.object({ awb: id, amountPaise: paise })).min(1).max(500), feesPaise: paise.default(0),
});
export const SimulateCodRemittanceInput = z.object({ shortLines: z.number().int().min(0).max(5).nullish() });
export const RetryFailedEventInput = z.object({ eventId: id });
export const PushStockNowInput = z.object({ skuIds: z.array(z.string()).max(400).nullish(), force: z.boolean().nullish(), simulateOutage: z.boolean().nullish() });
export const ExpireBopisInput = z.object({ force: z.boolean().nullish() });

export const OMS_COMMAND_SCHEMAS = {
  simulateWebOrder: SimulateWebOrderInput, allocateOrder: AllocateOrderInput, cancelOrder: CancelOrderInput, confirmPick: ConfirmPickInput, packOrder: PackOrderInput,
  createShipment: CreateShipmentInput, courierEvent: CourierEventInput, markReadyForPickup: MarkReadyForPickupInput, collectBopis: CollectBopisInput, receiveRto: ReceiveRtoInput,
  qcRto: QcRtoInput, importCodRemittance: ImportCodRemittanceInput, simulateCodRemittance: SimulateCodRemittanceInput, retryFailedEvent: RetryFailedEventInput,
  pushStockNow: PushStockNowInput, expireBopis: ExpireBopisInput, syncHealthReport: z.object({}), runRetries: z.object({}),
} as const;
export type OmsCommandName = keyof typeof OMS_COMMAND_SCHEMAS;

/** Emulator-only fallback for the Shopify webhook secret (production reads Secret Manager `SHOPIFY_WEBHOOK_SECRET`; functions refuse to run without it). */
export const DEV_SHOPIFY_SECRET = 'demo-shopify-webhook-secret';
export const DEV_SHIPROCKET_TOKEN = 'demo-shiprocket-token';
