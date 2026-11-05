import { z } from 'zod';

/** Collections the POS reads through `PosRepo` (all under /orgs/texafashions). Writes: only `posOutbox` + `parkedBills` (drafts) from the client. */
export const POS_COLLECTIONS = ['tills', 'shifts', 'sales', 'returns', 'parkedBills', 'reservations', 'zReports', 'posOutbox', 'promotions', 'vouchers', 'giftCards', 'creditNotes', 'loyaltyLedger'] as const;
export type PosCollection = (typeof POS_COLLECTIONS)[number];

export const SERVICE_GIFTWRAP_SKU = 'SVC-GIFTWRAP';
export const TENDER_MODES = ['CASH', 'UPI', 'CARD', 'GC', 'CN', 'POINTS'] as const;
export type TenderMode = (typeof TENDER_MODES)[number];
/** Tenders that need connectivity (server-side balance/PSP confirmation) and are therefore blocked in offline mode. */
export const ONLINE_ONLY_TENDERS: TenderMode[] = ['UPI', 'GC', 'CN', 'POINTS'];

const id = z.string().min(1).max(80);
const paise = z.number().int().nonnegative();

export const CartLineInput = z.object({
  lineId: id, skuId: id, qty: z.number().int().positive().max(999),
  manualDiscountPaise: paise.nullish(), manualReasonCode: z.string().nullish(),
});
export const PaymentInput = z.object({
  mode: z.enum(TENDER_MODES),
  /** As tendered: cash may exceed the bill (change is derived server-side). Non-cash must be ≤ the amount still due. */
  amountPaise: z.number().int().positive(),
  /** UPI UTR · card auth code · gift-card id · credit-note id. */
  ref: z.string().nullish(), points: z.number().int().positive().nullish(),
});
export type PaymentInput = z.infer<typeof PaymentInput>;

export const CompleteSaleInput = z.object({
  clientSaleId: z.string().min(8).max(64), storeId: id, tillId: id, shiftId: id,
  lines: z.array(CartLineInput).min(1).max(60),
  customerId: z.string().nullish(), voucherCode: z.string().nullish(),
  payments: z.array(PaymentInput).min(1).max(6),
  /** Required when any line carries a manual discount. */
  managerPin: z.string().nullish(), notes: z.string().max(300).nullish(),
});
export type CompleteSaleInput = z.infer<typeof CompleteSaleInput>;

/** What the browser writes to /posOutbox/{clientSaleId} while offline. Same shape as the online call plus provisional bookkeeping. */
export const PosOutboxDocInput = z.object({
  status: z.literal('pending'),
  clientSaleId: z.string(), storeId: z.string(), tillId: z.string(), shiftId: z.string(),
  cashierId: z.string(), cashierName: z.string(),
  provisionalNo: z.string(), createdAtClient: z.string(), clientTotalPaise: paise,
  input: CompleteSaleInput.omit({ managerPin: true }),
  createdBy: z.string(),
});
export type PosOutboxDocInput = z.infer<typeof PosOutboxDocInput>;
export interface PosOutboxRow extends Omit<PosOutboxDocInput, 'status'> {
  id: string; status: 'pending' | 'finalised' | 'failed'; saleId?: string; invoiceNo?: string; error?: string; needsReview?: boolean; variancePaise?: number; finalisedAt?: string;
  /** Client-side only: true while the write has not reached the server. */
  unsynced?: boolean;
}

export const OpenShiftInput = z.object({ tillId: id, storeId: id, openingFloatPaise: paise.max(5_000_000) });
export const CloseShiftInput = z.object({
  shiftId: id, denominations: z.record(z.string(), z.number().int().nonnegative()), paidInPaise: paise.nullish(), paidOutPaise: paise.nullish(),
  managerPin: z.string().nullish(), note: z.string().max(300).nullish(),
});
export const VerifyManagerPinInput = z.object({ storeId: id, pin: z.string().min(4).max(8) });
export const ProcessReturnInput = z.object({
  saleId: id, storeId: id, tillId: id, shiftId: id,
  lines: z.array(z.object({ lineId: id, qty: z.number().int().positive(), reasonCode: z.string().min(1) })).min(1).max(60),
  /** CASH = cash back · CN = store-credit note (used for exchanges) · ORIGINAL = reverse the original non-cash tenders. */
  refundMode: z.enum(['CASH', 'CN', 'ORIGINAL']), managerPin: z.string().nullish(), note: z.string().max(300).nullish(),
});
export const VoidSaleInput = z.object({ saleId: id, storeId: id, tillId: id, shiftId: id, reasonCode: z.string().min(1), managerPin: z.string().min(4) });
export const SellGiftCardInput = z.object({
  storeId: id, tillId: id, shiftId: id, seriesId: z.string().default('GCS-PHYS'), amountPaise: z.number().int().min(10_000).max(1_000_000),
  /** Existing card id = top-up; omitted = issue a new card. */
  topUpCardId: z.string().nullish(), customerId: z.string().nullish(), payment: z.object({ mode: z.enum(['CASH', 'UPI', 'CARD']), ref: z.string().nullish() }),
});
export const IssueVouchersInput = z.object({ seriesId: id, count: z.number().int().min(1).max(500), customerId: z.string().nullish() });
export const SendEBillInput = z.object({ saleId: id, mobile: z.string().regex(/^[6-9]\d{9}$/).nullish() });
export const ReserveItemsInput = z.object({
  storeId: id, customerName: z.string().min(1).max(80), mobile: z.string().nullish(), holdHours: z.number().int().min(1).max(72).default(24),
  lines: z.array(z.object({ skuId: id, qty: z.number().int().positive().max(99) })).min(1).max(20),
});
export const ReleaseReservationInput = z.object({ reservationId: id, reason: z.enum(['collected', 'cancelled', 'expired']).default('cancelled') });
export const VisualSearchInput = z.object({ imageBase64: z.string().max(4_000_000), mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']).default('image/jpeg'), storeId: id });
export const CreateCustomerInput = z.object({
  name: z.string().min(2).max(80), mobile: z.string().regex(/^[6-9]\d{9}$/), whatsappOptIn: z.boolean().default(true),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});
export const PosStaffListInput = z.object({ storeId: id });
export const PosPinLoginInput = z.object({ storeId: id, employeeCode: id, pin: z.string().min(4).max(8) });

/** name → input schema. `PosRepo.command()` is typed from this; names are the callable names and the REST route names later. */
export const POS_COMMAND_SCHEMAS = {
  completeSale: CompleteSaleInput, openShift: OpenShiftInput, closeShift: CloseShiftInput, verifyManagerPin: VerifyManagerPinInput,
  processReturn: ProcessReturnInput, voidSale: VoidSaleInput, sellGiftCard: SellGiftCardInput, issueVouchers: IssueVouchersInput,
  sendEBill: SendEBillInput, createCustomer: CreateCustomerInput, reserveItems: ReserveItemsInput, releaseReservation: ReleaseReservationInput, visualSearch: VisualSearchInput,
} as const;
export type PosCommandName = keyof typeof POS_COMMAND_SCHEMAS;
export type PosCommandInput<K extends PosCommandName> = z.input<(typeof POS_COMMAND_SCHEMAS)[K]>;

// ───────── Read models
export interface PosSku {
  id: string; code: string; name: string; barcode: string; departmentId: string; categoryId?: string; subCategoryId?: string; brandId?: string;
  character?: string; colour?: string; hsn: string; gstRate: number; mrpPaise: number; pricePaise: number; imageUrl?: string; badges?: string[]; isBlindBox?: boolean; isService?: boolean;
}
export interface PosCustomer { id: string; code: string; name: string; mobile: string; tierId?: string; pointsBalance: number; birthday?: string; whatsappOptIn?: boolean; lifetimeSpendPaise?: number }
export interface PosStaff { employeeCode: string; name: string; role: 'cashier' | 'store_manager' }

export interface SaleLineDoc {
  lineId: string; skuId: string; name: string; hsn?: string; qty: number; gstRate: number;
  grossPaise: number; discountPaise: number; netPaise: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number;
  unitCostPaise: number; returnedQty: number; refundedPaise: number; isFreeGift?: boolean; isService?: boolean;
  allocations?: { promoId: string; name: string; amountPaise: number }[];
}
export interface SaleDoc {
  id: string; invoiceNo: string; provisionalNo?: string; source: 'online' | 'offline';
  storeId: string; storeName?: string; storeGstin?: string; tillId: string; shiftId: string; cashierId: string; cashierName: string;
  customer?: { id: string; name: string; mobile: string; tierId?: string } | null;
  lines: SaleLineDoc[];
  applied: { promoId: string; name: string; kind: string; amountPaise: number; detail?: string }[];
  taxSummary: { gstRate: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number }[];
  grossPaise: number; discountPaise: number; netPaise: number; taxablePaise: number; totalTaxPaise: number; roundOffPaise: number; payablePaise: number;
  payments: { mode: TenderMode; amountPaise: number; ref?: string; points?: number }[]; changeGivenPaise: number;
  pointsEarned: number; pointsRedeemed: number; voucherCode?: string; overrides?: { lineId: string; amountPaise: number; reasonCode?: string; approvedBy: string }[];
  status: 'completed' | 'partially_returned' | 'returned' | 'voided';
  billQr: string; createdAt: string; negativeStock?: boolean; needsReview?: boolean; variancePaise?: number; notes?: string;
  /** Mock e-invoice (IRN/QR) — the real NIC IRP integration is Phase 5+ scope, this demo always mocks it. */
  einvoice?: { irn: string; ackNo: string; ackDate: string; qrPayload: string; mock: true };
}
export interface ReturnDoc {
  id: string; returnNo: string; saleId: string; invoiceNo: string; storeId: string; tillId: string; shiftId: string; kind: 'return' | 'void';
  lines: { lineId: string; skuId: string; name: string; qty: number; refundPaise: number; reasonCode: string }[];
  refundPaise: number; refundMode: 'CASH' | 'CN' | 'ORIGINAL'; creditNoteId?: string; approvedBy?: string; createdBy: string; createdByName: string; createdAt: string;
}
export interface ShiftDoc {
  id: string; shiftNo: string; tillId: string; storeId: string; status: 'open' | 'closed'; openingFloatPaise: number; openedBy: string; openedByName: string; openedAt: string; closedAt?: string; zReportId?: string;
}
export interface ZReportDoc {
  id: string; shiftId: string; shiftNo: string; storeId: string; tillId: string; cashierName: string; openedAt: string; closedAt: string;
  openingFloatPaise: number; billCount: number; grossSalesPaise: number; discountPaise: number; taxPaise: number; returnsPaise: number; netSalesPaise: number;
  byTender: Record<string, number>; cashSalesPaise: number; cashRefundsPaise: number; expectedCashPaise: number; countedCashPaise: number; variancePaise: number;
  denominations: Record<string, number>; paidInPaise: number; paidOutPaise: number; managerApprovedBy?: string; note?: string; voidCount: number; returnCount: number;
}
