# Demo script — 15-minute click path

Story: *a lifestyle retailer buys stock, sells it in a mall store and online, closes the books, pays its people, and an AI layer watches over all of it.*

## Before you start (2 min, off-stage)
1. `pnpm demo` (emulators → seed → web :3100, POS :3101, Twin sim for Pune + Mumbai). Emulator UI is on :4000.
2. Fresh state: sign in as **Super Admin → Demo controls → Reset to baseline** (about a minute), or re-run `pnpm seed`.
3. Open three tabs: web `http://localhost:3100`, POS `http://localhost:3101`, and keep the web tab on `/login`.
4. Maker ≠ checker is enforced, so approvals need a role switch (avatar menu → *Switch demo role*). Each role lands on its own dashboard.

| Min | Act | Role | Where |
|---|---|---|---|
| 0:00 | 1. Master Data | Super Admin | `/master/skus` |
| 1:30 | 2. Purchase order | Merchandiser / Buyer | `/scm/purchase` |
| 3:00 | 3. GRN | Warehouse Manager | `/scm/receiving` |
| 4:30 | 4. POS sale with an offer | Cashier (POS app) | `:3101` |
| 6:30 | 5. Web order | Warehouse Manager | `/oms` |
| 8:00 | 6. Journal → Tally → Reconciliation | CFO | `/finance/*` |
| 10:15 | 7. Payroll | HR Manager | `/hr/payroll` |
| 11:15 | 8. Uni + alert “Ask why” | Super Admin | AI orb, bell |
| 13:00 | 9. Store projection | Super Admin | `/projections` |
| 13:45 | 10. Store Twin busy hour | Super Admin | `/admin/demo` → `/twin` |

## 1. Master Data (0:00)
- Sign in as **Super Admin** (lands on Home). Open **Master Data → SKUs**.
- Show search (type a character name), the 43 masters list, and **History** on any row (versions + audit).
- Talking point: every master is versioned, maker-checker approved, and imported/exported in bulk.

## 2. Purchase order (1:30)
- Switch role → **Merchandiser / Buyer** (lands on Supply chain). **Purchase → Purchase orders → New purchase order**: pick an Asian vendor, add two SKUs, save, submit.
- Switch role → **Super Admin** (or CFO if above the buyer's limit) and approve from the approvals queue; then send the PO.
- Talking point: approval routing by value, landed-cost fields, vendor portal for acknowledgement.

## 3. GRN (3:00)
- Switch role → **Warehouse Manager** (lands on Inventory). **Receiving → New GRN** against that PO.
- Scan or type barcodes, short-receive one line to show the variance, post.
- Talking point: stock ledger is append-only; the GRN posts a journal automatically (you will see it in act 6). The variance also feeds the alerts engine.

## 4. POS sale with an offer (4:30)
- In the **POS** tab: **Pune → Imran Shaikh → PIN `1234`**, open a shift (float ₹2,000). Manager PIN is `4321`.
- Scan/tap two SKUs. Show the promotion applying automatically. Enter voucher `WEL-DEMO1` for the welcome discount.
- Take **Cash**, finish, show the e-bill. Optional: tap **Offline demo** in the top bar, ring one more sale (it queues in the outbox), then tap again to sync.
- Talking point: pricing, promotions, stock, GST invoice, journal and loyalty points all post in one transaction on the server.

## 5. Web order (6:30)
- As **Warehouse Manager** open **E-commerce / OMS → Simulate web order** (a Shopify-shaped order goes through the same ingest path as the real webhook).
- Open the order: show allocation (which location was chosen and why), **Pick → Pack (scan) → Create shipment**; the mock Shiprocket tracks it.
- Talking point: HMAC-verified webhooks, stock pushed back to Shopify, sync-health page with retries.

## 6. Journal → Tally → Reconciliation (8:00)
- Switch role → **CFO** (lands on Finance). **Journals**: find the sale and the GRN entries from acts 3 and 4 (balanced, append-only).
- **Tally sync**: the queue shows vouchers; download one XML, or point out the local Tally agent that posts them to TallyPrime.
- **Reconciliation**: run the bank or UPI recon, show the match-rate gauge, accept an AI suggestion on one unmatched pair.
- Talking point: GST (GSTR-1/3B/2B), budget vs actual and store P&L all read the same ledger.

## 7. Payroll (10:15)
- Switch role → **HR Manager** (lands on HR). **Payroll → Run payroll**: choose the month, **Next: Review** (attendance-driven, PF/ESI/PT/TDS lines), **Next: Approve**, post.
- Talking point: statutory settings are masters, payslips are generated per employee, and attendance comes from the roster/geo-fenced check-in.

## 8. Uni assistant and “Ask why” (11:15)
- Switch role → **Super Admin**. Click the **orb** (bottom right) and ask: *“How were sales across all stores this week?”* Show the streamed answer, the table card and the chart.
- Go to **Admin → Demo controls → Trigger alert**. Open the **bell**: a critical cash-variance alert appears. Tap **Ask why**: Uni opens with the alert as context and investigates the data.
- Talking point: Claude runs only inside Cloud Functions, with tool use over real data and a deterministic fallback when no API key is configured.

## 9. Store projection (13:00)
- **Store projections**: pick a new city (e.g. Chennai), nudge footfall and rent, flip **Conservative / Base / Optimistic**.
- Point at the 24-month ramp with the confidence band, break-even month, payback, opening stock by department and staffing. The pin drops onto the India map beside the 8 existing stores; the 3/6/12-month forecast cards sit underneath.

## 10. Store Twin busy hour (13:45)
- **Admin → Demo controls → Simulate busy hour** (10 real POS sales at Pune plus the crowd at peak). Switch immediately to **Store Twin** (Phoenix Market City Pune).
- Show avatars walking zone to zone, the floor flip (Ground ↔ First), live counters, the **Cash Wrap queue and wait**, the **Dwell heatmap** toggle, a **ripple at the till** as each sale lands, and the staff suggestion changing as the queue grows.
- Close on the **conversion today** card.

## Backup moves
- **Simulate 5 web orders** (Demo controls) if the OMS list looks thin.
- **Reset to baseline** between runs. The reset runs the seed against the emulators, so it only works in `pnpm demo`.
- If a Claude answer is slow or no `ANTHROPIC_API_KEY` is set in `functions/.secret.local`, Uni falls back to deterministic answers: say so and move on.
- The Twin shows an *offline* hint if the sim is not running: `pnpm twin:sim PUN-PMC MUM-PMC`.
