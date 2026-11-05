import { z } from 'zod';
import { OMS_COMMAND_SCHEMAS } from './oms';
import { FINANCE_COLLECTIONS, FINANCE_COMMAND_SCHEMAS } from './finance';
import { GST_COLLECTIONS, GST_COMMAND_SCHEMAS } from './gst';
import { TALLY_COLLECTIONS, TALLY_COMMAND_SCHEMAS } from './tally';
import { RECON_COLLECTIONS, RECON_COMMAND_SCHEMAS } from './recon';
import { HR_COLLECTIONS, HR_COMMAND_SCHEMAS } from './hr';
import { PAYROLL_COLLECTIONS, PAYROLL_COMMAND_SCHEMAS } from './payroll';

// ───────── Shared enums
export const Bucket = z.enum(['onHand', 'inQC', 'inTransit', 'damaged', 'tester', 'reserved']);
export type Bucket = z.infer<typeof Bucket>;
export const BUCKET_LABELS: Record<Bucket, string> = { onHand: 'On hand', inQC: 'In QC', inTransit: 'In transit', damaged: 'Damaged', tester: 'Tester', reserved: 'Reserved' };

export const WAREHOUSE_ID = 'WH-CENTRAL';
export const Currency = z.enum(['INR', 'KRW', 'CNY', 'USD']);
export type Currency = z.infer<typeof Currency>;

/** Every collection the SCM / inventory UI may read through the generic list repo. */
export const SCM_COLLECTIONS = [
  'replenishmentSuggestions', 'purchaseRequisitions', 'rfqs', 'quotations', 'purchaseOrders', 'poAcks', 'asns', 'billsOfEntry', 'gateEntries',
  'grns', 'qcInspections', 'putawayTasks', 'purchaseInvoices', 'matchResults', 'paymentVouchers', 'debitNotes', 'purchaseReturns', 'landedCosts',
  'stockTransfers', 'ewayBills', 'stock', 'stockLedger', 'cycleCounts', 'stockTakes', 'adjustments', 'apBills', 'messageLog',
  // Phase 4 (OMS + Shopify connector) — see oms.ts
  'webOrders', 'pickLists', 'shipments', 'rtoCases', 'codRemittances', 'shopifyEvents', 'failedEvents', 'stockPushRuns', 'shopifyStock', 'syncHealth',
  // Phase 5 (Finance) — see finance.ts
  ...FINANCE_COLLECTIONS,
  // Phase 5 (GST + Tally) — see gst.ts, tally.ts
  ...GST_COLLECTIONS, ...TALLY_COLLECTIONS,
  // Phase 5 (Reconciliation Centre) — see recon.ts
  ...RECON_COLLECTIONS,
  // Phase 6 (HR Core) — see hr.ts
  ...HR_COLLECTIONS,
  // Phase 6 (Payroll) — see payroll.ts
  ...PAYROLL_COLLECTIONS,
] as const;
export type ScmCollection = (typeof SCM_COLLECTIONS)[number];

/** Document-flow stepper stages (PO is the hub; every child updates `flow` on its PO). */
export const FLOW_STEPS = ['PR', 'PO', 'ASN', 'GRN', 'QC', 'Invoice', 'Paid'] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];
export type FlowState = Partial<Record<FlowStep, { id: string; number: string; at?: string }>>;

export const PO_STATUSES = ['draft', 'pending_approval', 'approved', 'sent', 'acknowledged', 'partially_received', 'received', 'closed', 'rejected', 'cancelled'] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

// ───────── Command inputs (shared by client, functions and the future NestJS DTOs)
const sku = z.string().min(1);
const qty = z.number().int().positive();
const lines = <T extends z.ZodTypeAny>(l: T) => z.array(l).min(1).max(120);

export const CreatePRInput = z.object({
  storeId: z.string(), lines: lines(z.object({ skuId: sku, qty, note: z.string().nullish() })),
  neededBy: z.string().nullish(), notes: z.string().nullish(), suggestionIds: z.array(z.string()).nullish(),
});
export const CreateRFQInput = z.object({ prId: z.string(), vendorIds: z.array(z.string()).min(1).max(8), dueDate: z.string().nullish() });
export const SubmitQuotationInput = z.object({
  rfqId: z.string(), vendorId: z.string(), currency: Currency, leadTimeDays: z.number().int().min(0), validTill: z.string().nullish(),
  paymentTermsDays: z.number().int().min(0).nullish(), incoterm: z.string().nullish(),
  lines: lines(z.object({ skuId: sku, unitPriceMinor: z.number().int().nonnegative() })),
});
export const AwardRFQInput = z.object({ rfqId: z.string(), vendorId: z.string() });

export const POLineInput = z.object({ skuId: sku, qty, unitPriceMinor: z.number().int().nonnegative(), weightGrams: z.number().int().nonnegative().nullish() });
export const POScheduleInput = z.object({ locationId: z.string(), skuId: sku, qty, dueDate: z.string() });
export const CreatePOInput = z.object({
  vendorId: z.string(), type: z.enum(['domestic', 'import']), currency: Currency, incoterm: z.string().nullish(),
  lines: lines(POLineInput), schedule: z.array(POScheduleInput).max(200).nullish(),
  paymentTermsDays: z.number().int().min(0).nullish(), expectedDate: z.string().nullish(),
  prId: z.string().nullish(), rfqId: z.string().nullish(), notes: z.string().nullish(),
});
export const AmendPOInput = z.object({
  poId: z.string(), reason: z.string().min(3), lines: z.array(POLineInput).min(1).max(120).nullish(),
  schedule: z.array(POScheduleInput).max(200).nullish(), expectedDate: z.string().nullish(),
});
export const SendPOInput = z.object({ poId: z.string(), channel: z.enum(['email', 'whatsapp']) });

export const AckPOInput = z.object({ poId: z.string(), promisedDate: z.string().nullish(), note: z.string().nullish() });
export const RecordProformaInput = z.object({ poId: z.string(), storagePath: z.string(), amountMinor: z.number().int().nonnegative().nullish(), note: z.string().nullish() });
export const CreateASNInput = z.object({
  poId: z.string(), eta: z.string(), awb: z.string().nullish(), containerNo: z.string().nullish(), boxes: z.number().int().nonnegative().nullish(),
  lines: lines(z.object({ skuId: sku, qty })),
});
export const SaveBoEInput = z.object({
  poId: z.string(), asnId: z.string().nullish(), beNumber: z.string().min(3), beDate: z.string(), port: z.string(), chaId: z.string().nullish(),
  assessableValuePaise: z.number().int().positive(), bcdPct: z.number().min(0).max(100), swsPct: z.number().min(0).max(100).default(10), igstPct: z.number().min(0).max(100),
  chaChargesPaise: z.number().int().nonnegative().default(0), otherChargesPaise: z.number().int().nonnegative().default(0),
});
export const CreateGateEntryInput = z.object({
  poId: z.string().nullish(), asnId: z.string().nullish(), vendorId: z.string(), vehicleNo: z.string().min(3), driverName: z.string().min(2),
  driverPhone: z.string().nullish(), lrNo: z.string().nullish(), invoiceNo: z.string().nullish(), locationId: z.string().default('WH-CENTRAL'),
});
export const PostGRNInput = z.object({
  poId: z.string(), gateEntryId: z.string().nullish(), asnId: z.string().nullish(), locationId: z.string().default('WH-CENTRAL'),
  lines: lines(z.object({ skuId: sku, receivedQty: z.number().int().nonnegative(), damagedQty: z.number().int().nonnegative().default(0) })),
  notes: z.string().nullish(),
});
export const PostQCInput = z.object({
  grnId: z.string(),
  lines: lines(z.object({
    skuId: sku, passQty: z.number().int().nonnegative(), rejectQty: z.number().int().nonnegative(), reworkQty: z.number().int().nonnegative().default(0),
    reasonCode: z.string().nullish(), defectNote: z.string().nullish(), photoPaths: z.array(z.string()).max(6).nullish(),
  })),
});
export const PostPutawayInput = z.object({ taskId: z.string(), binId: z.string(), qty: z.number().int().positive().nullish() });
export const OcrInvoiceInput = z.object({ storagePath: z.string(), poId: z.string().nullish() });
export const SaveInvoiceInput = z.object({
  vendorId: z.string(), poId: z.string(), invoiceNo: z.string().min(1), invoiceDate: z.string(), filePath: z.string().nullish(),
  lines: lines(z.object({ skuId: sku, qty, unitPriceMinor: z.number().int().nonnegative(), gstRate: z.number().min(0).max(28).default(0) })),
  freightMinor: z.number().int().nonnegative().nullish(), ocrUsed: z.enum(['claude', 'mock']).nullish(),
});
export const ResolveHoldInput = z.object({ invoiceId: z.string(), action: z.enum(['override', 'reject', 'rematch']), note: z.string().min(3) });
export const PostPaymentInput = z.object({
  vendorId: z.string(), kind: z.enum(['advance', 'part', 'full']), invoiceIds: z.array(z.string()).max(20).nullish(), poId: z.string().nullish(),
  amountPaise: z.number().int().positive(), mode: z.enum(['bank_transfer', 'upi', 'cheque', 'cash']), bankAccountId: z.string().nullish(),
  tdsOverridePct: z.number().min(0).max(30).nullish(), note: z.string().nullish(),
});
export const PostPurchaseReturnInput = z.object({ returnId: z.string() });
export const PostLandedCostInput = z.object({
  poId: z.string(), grnIds: z.array(z.string()).min(1).max(20), basis: z.enum(['value', 'weight', 'qty']), boeId: z.string().nullish(),
  charges: z.array(z.object({ type: z.string(), amountPaise: z.number().int().nonnegative() })).max(20),
});
export const CreateTransferInput = z.object({ fromLocationId: z.string(), toLocationId: z.string(), lines: lines(z.object({ skuId: sku, qty })), notes: z.string().nullish() });
export const DispatchTransferInput = z.object({ transferId: z.string(), vehicleNo: z.string().nullish() });
export const ReceiveTransferInput = z.object({
  transferId: z.string(), lines: lines(z.object({ skuId: sku, receivedQty: z.number().int().nonnegative(), damagedQty: z.number().int().nonnegative().default(0) })),
});
export const DecideDocInput = z.object({
  collection: z.enum(['purchaseRequisitions', 'purchaseOrders', 'paymentVouchers', 'adjustments']), id: z.string(), approve: z.boolean(), note: z.string().nullish(),
});

// Inventory
export const PostAdjustmentInput = z.object({
  locationId: z.string(), skuId: sku, qtyDelta: z.number().int().refine((n) => n !== 0, 'Quantity must not be 0'),
  toBucket: z.enum(['tester', 'damaged']).nullish(), reasonCode: z.string().min(1), note: z.string().nullish(),
});
export const StartCountInput = z.object({ type: z.enum(['cycle', 'full']), locationId: z.string(), abcClass: z.enum(['A', 'B', 'C']).nullish(), limit: z.number().int().min(1).max(200).nullish() });
export const SubmitCountInput = z.object({ countId: z.string(), counts: z.array(z.object({ skuId: sku, countedQty: z.number().int().nonnegative() })).min(1).max(400) });
export const ReconcileCountInput = z.object({ countId: z.string(), reasonCode: z.string().default('RC-ADJ-FOUND') });
export const RevealBlindBoxInput = z.object({ locationId: z.string(), skuId: sku, qty });
export const RunReplenishmentInput = z.object({ storeId: z.string().nullish() });
export const ConvertSuggestionsInput = z.object({ storeId: z.string(), suggestionIds: z.array(z.string()).min(1).max(120) });
export const ValuationInput = z.object({ method: z.enum(['WAC', 'FIFO']), locationId: z.string() });
export const AgeingInput = z.object({ locationId: z.string() });

// ───────── Read models returned by report callables
export interface StockDoc {
  id: string; locationId: string; skuId: string; onHand: number; inQC: number; inTransit: number; damaged: number; tester: number; reserved: number;
  revealed?: number; unputaway?: number; avgCostPaise: number; dailyDemand?: number; bins?: Record<string, number>; updatedAt?: string;
}
export const atp = (s: Pick<StockDoc, 'onHand' | 'reserved'>) => Math.max(0, s.onHand - s.reserved);

export interface LedgerRow {
  id: string; locationId: string; skuId: string; bucket: Bucket; qty: number; balanceAfter: number; unitCostPaise?: number; kind: string;
  refType: string; refId: string; reason?: string; binId?: string; userName?: string; at?: string;
}
export interface ValuationRow { skuId: string; qty: number; unitCostPaise: number; valuePaise: number }
export interface AgeingRow { skuId: string; total: number; buckets: Record<'0-30' | '31-60' | '61-90' | '90+', { qty: number; valuePaise: number }> }
export interface CoverCell { storeId: string; departmentId: string; onHand: number; dailyDemand: number; days: number }

// ───────── Command registry: name → input schema. The repo's `command()` is typed from this map, and the same names become REST endpoints later.
export const COMMAND_SCHEMAS = {
  runReplenishment: RunReplenishmentInput, convertSuggestions: ConvertSuggestionsInput, createPR: CreatePRInput, createRFQ: CreateRFQInput, submitQuotation: SubmitQuotationInput,
  awardRFQ: AwardRFQInput, createPO: CreatePOInput, amendPO: AmendPOInput, sendPO: SendPOInput, decideDocument: DecideDocInput, ackPO: AckPOInput, recordProforma: RecordProformaInput,
  createASN: CreateASNInput, saveBillOfEntry: SaveBoEInput, createGateEntry: CreateGateEntryInput, postGRN: PostGRNInput, postQC: PostQCInput, postPutaway: PostPutawayInput,
  postPurchaseReturn: PostPurchaseReturnInput, postLandedCost: PostLandedCostInput, ocrInvoice: OcrInvoiceInput, saveInvoice: SaveInvoiceInput, resolveHold: ResolveHoldInput,
  postPayment: PostPaymentInput, createTransfer: CreateTransferInput, dispatchTransfer: DispatchTransferInput, receiveTransfer: ReceiveTransferInput, postAdjustment: PostAdjustmentInput,
  startCount: StartCountInput, submitCount: SubmitCountInput, reconcileCount: ReconcileCountInput, revealBlindBox: RevealBlindBoxInput, inventoryValuation: ValuationInput,
  inventoryAgeing: AgeingInput, coverHeatmap: z.object({}),
  ...OMS_COMMAND_SCHEMAS,
  ...FINANCE_COMMAND_SCHEMAS,
  ...GST_COMMAND_SCHEMAS,
  ...TALLY_COMMAND_SCHEMAS,
  ...RECON_COMMAND_SCHEMAS,
  ...HR_COMMAND_SCHEMAS,
  ...PAYROLL_COMMAND_SCHEMAS,
} as const;
export type CommandName = keyof typeof COMMAND_SCHEMAS;
export type CommandInput<K extends CommandName> = z.input<(typeof COMMAND_SCHEMAS)[K]>;
