import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  CloseShiftInput, CompleteSaleInput, CreateCustomerInput, IssueVouchersInput, OpenShiftInput, ProcessReturnInput, ReleaseReservationInput, ReserveItemsInput, SellGiftCardInput, SendEBillInput, VerifyManagerPinInput, VisualSearchInput, VoidSaleInput,
  AckPOInput, AgeingInput, AmendPOInput, AwardRFQInput, ConvertSuggestionsInput, CreateASNInput, CreateGateEntryInput, CreatePOInput, CreatePRInput, CreateRFQInput,
  CreateTransferInput, DecideDocInput, DispatchTransferInput, OcrInvoiceInput, PostAdjustmentInput, PostGRNInput, PostLandedCostInput, PostPaymentInput, PostPurchaseReturnInput,
  PostPutawayInput, PostQCInput, ReceiveTransferInput, ReconcileCountInput, RecordProformaInput, ResolveHoldInput, RevealBlindBoxInput, RunReplenishmentInput, SaveBoEInput,
  SaveInvoiceInput, SendPOInput, StartCountInput, SubmitCountInput, SubmitQuotationInput, ValuationInput,
  AllocateOrderInput, CancelOrderInput, CollectBopisInput, ConfirmPickInput, CourierEventInput, CreateShipmentInput, ExpireBopisInput, ImportCodRemittanceInput, MarkReadyForPickupInput,
  PackOrderInput, PushStockNowInput, QcRtoInput, ReceiveRtoInput, RetryFailedEventInput, SimulateCodRemittanceInput, SimulateWebOrderInput,
  ApAgeingReportInput, ArAgeingReportInput, BudgetVsActualReportInput, SetBudgetInput, StorePnlReportInput,
  Gstr1ReportInput, Gstr2bMismatchReportInput, Gstr3bReportInput, ExportTallyXmlInput, RetryTallySyncInput,
  RunReconInput, DecideReconMatchInput, ReconAiSuggestInput,
  AddCandidateInput, MoveCandidateStageInput, ToggleOnboardingTaskInput, CheckInInput, CheckOutInput, ApplyLeaveInput, DecideLeaveInput, SaveRosterInput,
  RunPayrollInput, InboxActionInput, DemoControlInput,
} from '@texafashions/types';
import { z } from 'zod';
import { REGION } from './admin';
import { callable } from './commands';
import * as Fin from './finance/reports';
import * as Gst from './finance/gst';
import * as Tally from './finance/tally';
import * as Recon from './finance/recon';
import * as Rec from './hr/recruitment';
import * as Onb from './hr/onboarding';
import * as Att from './hr/attendance';
import * as Lv from './hr/leave';
import * as Ros from './hr/roster';
import * as Pay from './hr/payroll';
import * as Ins from './ai/insights';
import * as Demo from './demo';
import * as P from './scm/procure';
import * as R from './scm/receiving';
import * as A from './scm/payables';
import * as T from './scm/transfers';
import * as I from './inventory';
import * as Sale from './pos/sale';
import * as Shift from './pos/shift';
import * as Ret from './pos/returns';
import * as Inst from './pos/instruments';
import { verifyManagerPin as verifyPin } from './pos/pin';
import * as Oms from './oms/orders';
import * as Ful from './oms/fulfil';
import * as Bop from './oms/bopis';
import * as Rto from './oms/rto';
import * as Cod from './oms/cod';
import { simulateWebOrder as simulate } from './oms/simulate';
import { pushStock } from './shopify/stockPush';
import { retryDueEvents, retryFailedEvent as retryOne } from './shopify/ingest';
import { syncHealthReport as healthReport } from './shopify/health';
import { requireRoles } from './engine';

export { aiChat } from './ai/chat';
export { demoSignIn, setClaims, listUsers } from './auth';
export { posStaffList, posPinLogin } from './pos/pin';
export { finaliseOutbox } from './pos/outbox';
export { shopifyWebhook, courierWebhook } from './shopify/webhook';
export { submitMasterChange, importMasters, decideApproval, detectDuplicates } from './masters';
export {
  postSaleJournal, postReturnJournal, postGrnJournal, postPurchaseInvoiceJournal, postPaymentVoucherJournal, postStockTransferJournal, enqueueTallySync,
} from './finance/triggers';

// Procurement
export const runReplenishment = callable(RunReplenishmentInput, P.runReplenishment, { timeoutSeconds: 120 });
export const convertSuggestions = callable(ConvertSuggestionsInput, P.convertSuggestions);
export const createPR = callable(CreatePRInput, P.createPR);
export const createRFQ = callable(CreateRFQInput, P.createRFQ);
export const submitQuotation = callable(SubmitQuotationInput, P.submitQuotation);
export const awardRFQ = callable(AwardRFQInput, P.awardRFQ);
export const createPO = callable(CreatePOInput, P.createPO);
export const amendPO = callable(AmendPOInput, P.amendPO);
export const sendPO = callable(SendPOInput, P.sendPO);
export const decideDocument = callable(DecideDocInput, P.decideDocument);
// Vendor portal
export const ackPO = callable(AckPOInput, P.ackPO);
export const recordProforma = callable(RecordProformaInput, P.recordProforma);
export const createASN = callable(CreateASNInput, P.createASN);
export const saveBillOfEntry = callable(SaveBoEInput, P.saveBillOfEntry);
// Receiving
export const createGateEntry = callable(CreateGateEntryInput, R.createGateEntry);
export const postGRN = callable(PostGRNInput, R.postGRN);
export const postQC = callable(PostQCInput, R.postQC);
export const postPutaway = callable(PostPutawayInput, R.postPutaway);
export const postPurchaseReturn = callable(PostPurchaseReturnInput, R.postPurchaseReturn);
export const postLandedCost = callable(PostLandedCostInput, R.postLandedCost);
// Payables
export const ocrInvoice = callable(OcrInvoiceInput, A.ocrInvoice, { claude: true, timeoutSeconds: 120 });
export const saveInvoice = callable(SaveInvoiceInput, A.saveInvoice);
export const resolveHold = callable(ResolveHoldInput, A.resolveHold);
export const postPayment = callable(PostPaymentInput, A.postPayment);
// Transfers
export const createTransfer = callable(CreateTransferInput, T.createTransfer);
export const dispatchTransfer = callable(DispatchTransferInput, T.dispatchTransfer);
export const receiveTransfer = callable(ReceiveTransferInput, T.receiveTransfer);
// Inventory
export const postAdjustment = callable(PostAdjustmentInput, I.postAdjustment);
export const startCount = callable(StartCountInput, I.startCount);
export const submitCount = callable(SubmitCountInput, I.submitCount);
export const reconcileCount = callable(ReconcileCountInput, I.reconcileCount);
export const revealBlindBox = callable(RevealBlindBoxInput, I.revealBlindBox);
export const inventoryValuation = callable(ValuationInput, I.inventoryValuation);
export const inventoryAgeing = callable(AgeingInput, I.inventoryAgeing, { timeoutSeconds: 120 });
export const coverHeatmap = callable(z.object({}), I.coverHeatmap, { timeoutSeconds: 120 });

// POS
export const completeSale = callable(CompleteSaleInput, (c, i) => Sale.completeSaleCore(c, i), { timeoutSeconds: 90 });
export const openShift = callable(OpenShiftInput, Shift.openShift);
export const closeShift = callable(CloseShiftInput, Shift.closeShift);
export const verifyManagerPin = callable(VerifyManagerPinInput, verifyPin);
export const processReturn = callable(ProcessReturnInput, Ret.processReturn);
export const voidSale = callable(VoidSaleInput, Ret.voidSale);
export const sellGiftCard = callable(SellGiftCardInput, Inst.sellGiftCard);
export const issueVouchers = callable(IssueVouchersInput, Inst.issueVouchers);
export const sendEBill = callable(SendEBillInput, Inst.sendEBill);
export const createCustomer = callable(CreateCustomerInput, Inst.createCustomer);
export const reserveItems = callable(ReserveItemsInput, Inst.reserveItems);
export const releaseReservation = callable(ReleaseReservationInput, Inst.releaseReservation);
export const visualSearch = callable(VisualSearchInput, Inst.visualSearch, { claude: true, timeoutSeconds: 90 });

/** Nightly min/max + forecast replenishment for every store and the warehouse (02:00 IST). */
export const nightlyReplenishment = onSchedule({ region: REGION, schedule: '0 2 * * *', timeZone: 'Asia/Kolkata', timeoutSeconds: 540, memory: '512MiB' }, async () => {
  await P.runReplenishmentCore(P.SYSTEM, {});
});

// ───────── Phase 4: OMS + Shopify connector
export const simulateWebOrder = callable(SimulateWebOrderInput, simulate, { timeoutSeconds: 120 });
export const allocateOrder = callable(AllocateOrderInput, Oms.allocateOrderCmd);
export const cancelOrder = callable(CancelOrderInput, Oms.cancelOrder);
export const confirmPick = callable(ConfirmPickInput, Ful.confirmPick);
export const packOrder = callable(PackOrderInput, Ful.packOrder);
export const createShipment = callable(CreateShipmentInput, Ful.createShipment);
export const courierEvent = callable(CourierEventInput, Ful.courierEvent);
export const markReadyForPickup = callable(MarkReadyForPickupInput, Bop.markReadyForPickup);
export const collectBopis = callable(CollectBopisInput, Bop.collectBopis);
export const expireBopis = callable(ExpireBopisInput, Bop.expireBopis);
export const receiveRto = callable(ReceiveRtoInput, Rto.receiveRto);
export const qcRto = callable(QcRtoInput, Rto.qcRto);
export const importCodRemittance = callable(ImportCodRemittanceInput, Cod.importCodRemittance);
export const simulateCodRemittance = callable(SimulateCodRemittanceInput, Cod.simulateCodRemittance);
export const retryFailedEvent = callable(RetryFailedEventInput, async (c, i) => { requireRoles(c, 'warehouse_manager', 'cfo'); return retryOne(i.eventId, { manual: true }); });
export const runRetries = callable(z.object({}), async (c) => { requireRoles(c, 'warehouse_manager', 'cfo'); return retryDueEvents(); }, { timeoutSeconds: 120 });
export const pushStockNow = callable(PushStockNowInput, async (c, i) => { requireRoles(c, 'warehouse_manager', 'buyer', 'cfo'); return pushStock({ skuIds: i.skuIds, force: !!i.force, trigger: 'manual', simulateOutage: !!i.simulateOutage }); }, { timeoutSeconds: 120 });
export const syncHealthReport = callable(z.object({}), (c) => healthReport(c), { timeoutSeconds: 60 });

// ───────── Phase 5: Finance
export const apAgeingReport = callable(ApAgeingReportInput, Fin.apAgeingReport);
export const arAgeingReport = callable(ArAgeingReportInput, Fin.arAgeingReport);
export const storePnlReport = callable(StorePnlReportInput, Fin.storePnlReport);
export const budgetVsActualReport = callable(BudgetVsActualReportInput, Fin.budgetVsActualReport);
export const setBudget = callable(SetBudgetInput, Fin.setBudget);
export const gstr1Report = callable(Gstr1ReportInput, Gst.gstr1Report);
export const gstr3bReport = callable(Gstr3bReportInput, Gst.gstr3bReport);
export const gstr2bMismatchReport = callable(Gstr2bMismatchReportInput, Gst.gstr2bMismatchReport);
export const exportTallyXml = callable(ExportTallyXmlInput, Tally.exportTallyXml);
export const retryTallySync = callable(RetryTallySyncInput, Tally.retryTallySync);
export const runRecon = callable(RunReconInput, Recon.runRecon);
export const decideReconMatch = callable(DecideReconMatchInput, Recon.decideReconMatch);
export const reconAiSuggest = callable(ReconAiSuggestInput, Recon.reconAiSuggest, { claude: true, timeoutSeconds: 90 });

// ───────── Phase 6: HR Core
export const addCandidate = callable(AddCandidateInput, Rec.addCandidate);
export const moveCandidateStage = callable(MoveCandidateStageInput, Rec.moveCandidateStage);
export const toggleOnboardingTask = callable(ToggleOnboardingTaskInput, Onb.toggleOnboardingTask);
export const checkIn = callable(CheckInInput, Att.checkIn);
export const checkOut = callable(CheckOutInput, Att.checkOut);
export const applyLeave = callable(ApplyLeaveInput, Lv.applyLeave);
export const decideLeave = callable(DecideLeaveInput, Lv.decideLeave);
export const saveRoster = callable(SaveRosterInput, Ros.saveRoster);
export const runPayroll = callable(RunPayrollInput, Pay.runPayroll, { timeoutSeconds: 180 });

/** Every 15 min: push changed web-sellable quantities (after safety buffers) to Shopify. */
export const scheduledStockPush = onSchedule({ region: REGION, schedule: 'every 15 minutes', timeZone: 'Asia/Kolkata', timeoutSeconds: 300, memory: '512MiB' }, async () => { await pushStock({ trigger: 'schedule' }); });
/** Every 5 min: replay failed webhook / stock-push events whose backoff has elapsed. */
export const retryFailedEvents = onSchedule({ region: REGION, schedule: 'every 5 minutes', timeoutSeconds: 300 }, async () => { await retryDueEvents(); });
/** Hourly: release click-and-collect holds older than 48 h. */
export const expireBopisHolds = onSchedule({ region: REGION, schedule: 'every 60 minutes', timeoutSeconds: 300 }, async () => { await Bop.expireBopisCore(Oms.OMS_SYSTEM); });

// ───────── Phase 7: notifications + insights
export const demoControl = callable(DemoControlInput, Demo.demoControl, { timeoutSeconds: 120 });
export const runAlertsNow = callable(z.object({}), Ins.runAlertsNow, { timeoutSeconds: 120 });
export const inboxAction = callable(InboxActionInput, Ins.inboxAction);
export const dailyBriefing = callable(z.object({}), Ins.dailyBriefing, { claude: true, timeoutSeconds: 120 });
/** Every 30 min: evaluate all alert rules + forecast suggestions and fan new insights out to inboxes. */
export const scheduledAlerts = onSchedule({ region: REGION, schedule: 'every 30 minutes', timeZone: 'Asia/Kolkata', timeoutSeconds: 300, memory: '512MiB' }, async () => { await Ins.runAlerts(); });
