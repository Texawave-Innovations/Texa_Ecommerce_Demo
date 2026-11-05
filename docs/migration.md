# Migration guide — Firebase demo → PostgreSQL + NestJS

Maintained incrementally every phase. Principle: swap `FirebaseAdapter` for `RestAdapter` in `packages/data`; `packages/domain` and `packages/types` move unchanged.

## Platform mapping
| Firebase | Target |
|---|---|
| Firestore `/orgs/{orgId}/…` | PostgreSQL, `org_id` column on every table (row-level security) |
| Callable functions | NestJS REST endpoints (`POST /v1/<module>/<command>`) using the same zod schemas (via nestjs-zod) |
| Firestore triggers | Domain events → outbox table → BullMQ/Redis workers |
| Scheduled functions | `@nestjs/schedule` or BullMQ repeatable jobs |
| Auth + custom claims | JWT (OIDC) with `role`, `storeIds`, `approvalLimitPaise`; NestJS Guards |
| Security Rules | Guards + Postgres RLS |
| Realtime snapshots | SSE/WebSocket gateway (or Postgres LISTEN/NOTIFY) |
| Storage | S3/GCS with signed URLs |
| RTDB (Store Twin) | Redis pub/sub + WebSocket |
| Secret Manager | Cloud secret store / env |
| Counters (number series) | `number_series` row with `SELECT … FOR UPDATE` |
| Sharded counters / rollups | Materialised views or rollup tables |
| searchKeywords[] | `pg_trgm` / full-text index |
| Append-only ledgers | Tables with INSERT-only grants (no UPDATE/DELETE) |
| Firestore transaction | SQL transaction (SERIALIZABLE / row locks) |
| Money paise int | `bigint` paise (unchanged) |
| Timestamps | `timestamptz` UTC |

## Collection → table (grown per phase)
| Collection | Table | Phase | Notes |
|---|---|---|---|
| orgs/{org}/{master} (43 masters) | one table per master (`sku`, `vendor`, `store`, …) with `org_id`, `code` unique per org, `status`, `version`; JSON fields (`floors`, `zones`, `minMaxByStore`, `items`) → `jsonb` (or child tables) | 1 | `searchKeywords[]` → `pg_trgm`/tsvector |
| {master}/{id}/versions | `{master}_version` (FK, version int) — or temporal table | 1 | |
| approvals | `approval` (+ `approval_row` for bulk) | 1 | |
| auditLogs | `audit_log` (INSERT-only) | 1 | `before`/`after` jsonb |
| settings/org, settings/matching | `org_setting` (key/value jsonb) | 1/2 | match tolerance lives here |
| stock/{loc_sku} | `stock_balance` (PK location_id+sku_id; buckets as columns; `bins` → `stock_bin_balance`) | 2 | updated in the same SQL tx as the ledger insert |
| stockLedger | `stock_ledger` (INSERT-only, index location+sku+at) | 2 | `at` backfilled for opening rows; FIFO layers read from `kind in ('receipt','opening')` |
| stockLocks | `stock_lock` | 2 | stock-take freeze |
| counters | `number_series` (`SELECT … FOR UPDATE`) | 2 | PO/BLR-FS/26-27/00001 format in domain |
| replenishmentSuggestions | `replenishment_suggestion` | 2 | |
| purchaseRequisitions | `purchase_requisition` + `_line` | 2 | lines embedded array → child table |
| rfqs, quotations | `rfq`, `rfq_line`, `quotation`, `quotation_line` | 2 | |
| purchaseOrders (+versions) | `purchase_order`, `purchase_order_line`, `purchase_order_version` (jsonb snapshot) | 2 | `flow` → derived from FKs (view) |
| poAcks, asns | `po_ack`, `asn`, `asn_line` | 2 | |
| billsOfEntry, gateEntries | `bill_of_entry`, `gate_entry` | 2 | |
| grns, qcInspections, putawayTasks | `grn`, `grn_line`, `qc_inspection`, `putaway_task` | 2 | |
| purchaseInvoices, matchResults | `purchase_invoice`, `purchase_invoice_line`, `match_result` | 2 | |
| apBills, paymentVouchers | `ap_bill`, `payment_voucher`, `payment_allocation` | 2 | allocations array → table |
| debitNotes, purchaseReturns, landedCosts | `debit_note`, `purchase_return`, `landed_cost`, `landed_cost_line` | 2 | |
| stockTransfers, ewayBills | `stock_transfer`, `stock_transfer_line`, `eway_bill` | 2 | |
| adjustments, cycleCounts, stockTakes | `stock_adjustment`, `stock_count`, `stock_count_line` | 2 | counts merged (type column) |
| messageLog | `message_log` | 2 | mock Messaging adapter output |

## Callable → endpoint
| Function | Endpoint | Phase |
|---|---|---|
| submitMasterChange | `POST /v1/masters/:master/changes` | 1 |
| importMasters | `POST /v1/masters/:master/imports` | 1 |
| decideApproval | `POST /v1/approvals/:id/decision` | 1 |
| detectDuplicates | `POST /v1/masters/:master/duplicates` (calls Claude from the API) | 1 |
| setClaims | `PUT /v1/users/:id/role` (updates user_role + invalidates JWT) | 1 |
| listUsers | `GET /v1/users` | 1 |
| demoSignIn | not migrated — replaced by real OIDC login | 1 |
| runReplenishment / convertSuggestions | `POST /v1/scm/replenishment/run`, `POST /v1/scm/replenishment/convert` | 2 |
| createPR / decideDocument | `POST /v1/scm/requisitions`, `POST /v1/approvals/:collection/:id/decision` | 2 |
| createRFQ / submitQuotation / awardRFQ | `POST /v1/scm/rfqs`, `…/:id/quotations`, `…/:id/award` | 2 |
| createPO / amendPO / sendPO | `POST /v1/scm/purchase-orders`, `PATCH …/:id`, `POST …/:id/send` | 2 |
| ackPO / recordProforma / createASN | `POST /v1/vendor/purchase-orders/:id/ack|proforma|asn` (vendor-scoped guard) | 2 |
| saveBillOfEntry / createGateEntry | `POST /v1/scm/bills-of-entry`, `POST /v1/scm/gate-entries` | 2 |
| postGRN / postQC / postPutaway | `POST /v1/scm/grns`, `…/qc`, `…/putaway` (SQL transaction + ledger insert) | 2 |
| postPurchaseReturn / postLandedCost | `POST /v1/scm/purchase-returns/:id/dispatch`, `POST /v1/scm/landed-costs` | 2 |
| ocrInvoice / saveInvoice / resolveHold | `POST /v1/scm/invoices/ocr`, `POST /v1/scm/invoices`, `POST /v1/scm/invoices/:id/resolve` | 2 |
| postPayment | `POST /v1/scm/payments` | 2 |
| createTransfer / dispatchTransfer / receiveTransfer | `POST /v1/scm/transfers`, `…/:id/dispatch`, `…/:id/receive` | 2 |
| postAdjustment / startCount / submitCount / reconcileCount / revealBlindBox | `POST /v1/inventory/adjustments|counts|counts/:id/submit|counts/:id/reconcile|blind-box/reveal` | 2 |
| inventoryValuation / inventoryAgeing / coverHeatmap | `GET /v1/inventory/valuation|ageing|cover` (SQL window queries or materialised views) | 2 |

## Trigger → service/job
| Trigger | Target | Phase |
|---|---|---|
| nightlyReplenishment (scheduled 02:00 IST) | BullMQ repeatable job calling `ReplenishmentService.run()` — same `suggestReplenishment` domain function | 2 |
| _document-flow `flow` map updates_ | not a trigger today (written inside each command's transaction); becomes a view over FKs | 2 |

## Adapter checklist
- Implement each `*Repo` interface in `packages/data/src/rest/`.
- Subcollections (`sales/lines`, `po/versions`, `payslips`, `txns`) → child tables with FK.
- Denormalised read models → SQL views / rollup tables.
- Replace `onSnapshot` subscriptions with SSE streams or polling in TanStack Query.
- Data migration: export script per collection → COPY into Postgres; Timestamps → timestamptz.

## Phase 2 notes for the NestJS port
- `functions/src/engine.ts` (`StockEngine`) is the only code that mutates stock: reads → in-memory moves → one commit of ledger rows + summaries. Port it as a service wrapping a SQL transaction with `SELECT … FOR UPDATE` on `stock_balance` rows; the negative-stock and freeze checks stay identical.
- All business rules already live in `packages/domain` (landed cost, 3-way match, duty, valuation, replenishment, approval routing, GST split, MSME due date) and move unchanged.
- Money is `bigint` paise; foreign-currency amounts are stored as minor units (major × 100) with the FX rate captured on the PO.
- Firestore limits that disappear: 500-write transactions (counts reconcile cap), array-in-document lines, `in` queries ≤ 30 for store scoping.

## Phase 3 notes for the NestJS port (POS)
| Firebase | Target |
|---|---|
| `posOutbox` + `finaliseOutbox` trigger | `pos_outbox` table written by the tablet's sync worker (`POST /v1/pos/outbox`, idempotent on `clientSaleId`) → BullMQ worker running `completeSaleCore` |
| IndexedDB persistent cache | tablet-side store (e.g. RxDB/SQLite-WASM) fed by `GET /v1/pos/catalogue?since=` + SSE; keep the same `PosRepo` interface |
| `posPinLogin` custom token | `POST /v1/pos/auth/pin` → short-lived JWT with `role/storeIds` |
| `sales.lines[]` | `sale_line` child table |
| `giftCards/{id}/txns`, `loyaltyLedger`, `journals` | INSERT-only tables; balances via `SELECT … FOR UPDATE` |
| `salesDailyShards` | rollup table / materialised view |
| callables `completeSale, processReturn, voidSale, openShift, closeShift, sellGiftCard, issueVouchers, reserveItems, releaseReservation, sendEBill, createCustomer, visualSearch` | `POST /v1/pos/<command>` with `POS_COMMAND_SCHEMAS` |
- The promotion engine (`packages/domain/src/promotions.ts`), invoice maths, journals and Z-report maths move unchanged and are shared by the tablet (instant totals) and the server (authoritative).

## Phase 4 notes for the NestJS port (OMS + Shopify)
| Firebase | Target |
|---|---|
| `shopifyWebhook` (HTTPS) | `POST /v1/webhooks/shopify` controller with a raw-body guard (HMAC) → inserts into `shopify_event` (PK = event id, `INSERT … ON CONFLICT DO NOTHING`) and enqueues a BullMQ job; same 200-after-verify contract |
| `shopifyEvents` / `failedEvents` | `shopify_event` + `failed_event` tables; the backoff table (30 s … 16 m, dead after 6) becomes BullMQ `backoff` options; `retryFailedEvents` schedule → repeatable job |
| `webOrders` (+ `units[]`, `timeline[]`) | `web_order` + `web_order_unit` + `web_order_event` child tables; `deriveOrderStatus` unchanged |
| `pickLists`, `shipments`, `rtoCases`, `codRemittances` | `pick_list`(+`_line`), `shipment`(+`_event`), `rto_case`, `cod_remittance`(+`_line`) |
| `shopifyStock`, `stockPushRuns`, `syncHealth` | `shopify_stock`, `stock_push_run`, a metrics view; replace the full `stock` scan with a delta feed from `stock_ledger` inserts (outbox/`LISTEN/NOTIFY`) |
| callables `allocateOrder … syncHealthReport` | `POST /v1/oms/<command>` using `OMS_COMMAND_SCHEMAS` |
| `SHOPIFY_WEBHOOK_SECRET`, `SHIPROCKET_WEBHOOK_TOKEN` (Secret Manager) | same names in the platform secret store |
- The allocation engine, pack verification, web-stock buffer, retry backoff, status roll-up and COD reconciliation live in `packages/domain/src/oms.ts` and move unchanged. Reservation becomes `SELECT … FOR UPDATE` on `stock_balance` rows inside the same SQL transaction as the order insert.
- A real Shiprocket/Shopify Admin adapter replaces `MockShiprocket`/`MockShopifyAdmin` behind the existing interfaces; book couriers with `order_id = pickListId` so retries are idempotent.
