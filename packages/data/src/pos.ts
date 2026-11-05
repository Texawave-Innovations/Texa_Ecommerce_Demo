import type { Promotion } from '@texafashions/domain';
import type {
  PosCommandInput, PosCommandName, PosCustomer, PosOutboxDocInput, PosOutboxRow, PosSku, PosStaff, ReturnDoc, SaleDoc, ShiftDoc, ZReportDoc,
} from '@texafashions/types';
import type { Unsubscribe } from './interfaces';

export interface TillRow { id: string; storeId: string; name: string; openShiftId: string | null }
export interface ParkedBill {
  id: string; storeId: string; tillId: string; cashierId: string; label: string;
  customer?: { id: string; name: string; mobile: string; tierId?: string } | null;
  lines: { lineId: string; skuId: string; qty: number; manualDiscountPaise?: number | null; manualReasonCode?: string | null }[];
  createdAt?: string; updatedAt?: string;
}
export interface VoucherRow { id: string; code: string; [k: string]: any }
export interface StockMap { [skuId: string]: { onHand: number; reserved: number } }
export interface ReservationRow { id: string; storeId: string; customerName: string; mobile?: string; status: string; expiresAt?: string; lines: { skuId: string; qty: number }[]; createdAt?: string }

/**
 * Everything the offline-first POS needs. Reads are snapshot-driven so the IndexedDB cache keeps working without a network;
 * every money/stock/status change is a named `command` (callable today, `POST /v1/pos/<command>` later).
 * The only direct client writes are drafts: `enqueueOutbox` (offline sale intent) and `parkedBills`.
 */
export interface PosRepo {
  staffList(storeId: string): Promise<PosStaff[]>;
  /** Signs in with a store PIN (custom token minted by `posPinLogin`). */
  pinLogin(storeId: string, employeeCode: string, pin: string): Promise<void>;

  subscribeCatalogue(cb: (skus: PosSku[]) => void): Unsubscribe;
  subscribeStock(storeId: string, cb: (m: StockMap) => void): Unsubscribe;
  subscribePromotions(cb: (p: Promotion[]) => void): Unsubscribe;
  /** Reads all customers once so mobile look-ups keep working offline (served from the persistent cache afterwards). */
  warmCustomerCache(): Promise<number>;
  findCustomers(query: string): Promise<PosCustomer[]>;
  getCustomer(id: string): Promise<PosCustomer | null>;
  getVoucher(code: string): Promise<VoucherRow | null>;
  getGiftCard(id: string): Promise<Record<string, any> | null>;
  getCreditNote(id: string): Promise<Record<string, any> | null>;

  subscribeTills(storeId: string, cb: (t: TillRow[]) => void): Unsubscribe;
  subscribeShift(shiftId: string, cb: (s: ShiftDoc | null) => void): Unsubscribe;
  subscribeSales(storeId: string, shiftId: string, cb: (s: SaleDoc[]) => void): Unsubscribe;
  subscribeReturns(storeId: string, shiftId: string, cb: (r: ReturnDoc[]) => void): Unsubscribe;
  subscribeSale(saleId: string, cb: (s: SaleDoc | null) => void): Unsubscribe;
  /** Look up by sale id, bill-QR payload (`INV|<id>`) or invoice number. */
  findSale(ref: string, storeId: string): Promise<SaleDoc | null>;
  recentSales(storeId: string, limit?: number): Promise<SaleDoc[]>;
  getZReport(id: string): Promise<ZReportDoc | null>;

  subscribeOutbox(storeId: string, tillId: string, cb: (rows: PosOutboxRow[]) => void): Unsubscribe;
  /** Writes the offline sale intent to /posOutbox. Returns immediately — the promise of a Firestore write only settles when the server acks, which never happens offline. */
  enqueueOutbox(doc: PosOutboxDocInput): void;
  subscribeParked(storeId: string, cb: (b: ParkedBill[]) => void): Unsubscribe;
  saveParked(bill: Omit<ParkedBill, 'createdAt' | 'updatedAt'>): Promise<void>;
  deleteParked(id: string): Promise<void>;
  subscribeReservations(storeId: string, cb: (r: ReservationRow[]) => void): Unsubscribe;

  /** Demo toggle: disables/enables the Firestore network so the offline path can be shown on stage. */
  setNetwork(online: boolean): Promise<void>;
  command<K extends PosCommandName>(name: K, input: PosCommandInput<K>): Promise<Record<string, any>>;
}
