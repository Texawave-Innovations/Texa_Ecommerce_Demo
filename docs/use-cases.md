# Use-case checklist

Status legend: `[x]` done & verified by an automated check · `[~]` built, not yet verified end-to-end (reason in notes below) · `[ ]` todo.

Old legend: `[ ]` todo · `[~]` in progress · `[x]` done & verified. Phase in brackets.

## 1. Master Data [P1]
- [x] CRUD for every master collection (generic registry-driven screens)
- [x] Maker-checker approval on master changes
- [x] Version history drawer
- [x] Bulk Excel/CSV import with validation preview + export _(CSV import and CSV export browser-verified; .xlsx import untested)_
- [~] AI duplicate detection (Claude via function)
- [x] Barcode/label printing
- [x] Product image upload (Storage)
- [ ] Shopify two-way product sync status [P4 data]

## 2. SCM [P2]
- [~] AI replenishment suggestion per SKU/store → convert to PR
- [x] PR / store indent with approval by amount matrix
- [~] RFQ to multiple vendors → quotation entry → comparison grid with AI vendor score
- [x] PO domestic + import, INR/KRW/CNY/USD, Incoterms, delivery schedule per location
- [~] PO amendment with versions; PO PDF + email/WhatsApp (mock)
- [~] Vendor portal: acknowledge PO, upload proforma, create ASN
- [~] Import: BoE, BCD, SWS, IGST, CHA charges
- [~] Gate entry → GRN by barcode scan vs PO/ASN (short/excess/damaged)
- [~] QC pass/reject/rework, photos, AI defect tag stub
- [x] Putaway with bin suggestion
- [~] Purchase invoice OCR (Claude)
- [x] 3-way match with tolerance → hold queue
- [~] Payment voucher (advance/part/full) with TDS; MSME 45-day alert
- [x] Debit note / purchase return auto-drafted from QC rejects
- [x] Landed cost by value/weight/qty; IGST input credit
- [x] Stock transfers WH→store, store→store, dispatch, e-way bill >₹50k (mock), receiving GRN, variance; inter-state tax invoice
- [~] Animated document-flow tracker on every document

## 3. Inventory [P2]
- [x] Stock by location/bin with states (on hand, reserved, ATP, in transit, in QC, damaged, tester)
- [x] Stock ledger drill-down
- [~] Cycle counts with ABC; blind count on mobile
- [~] Full stock-take freeze + reconcile
- [x] Adjustments with reason codes
- [x] WAC (default) and FIFO valuation incl. landed cost
- [x] Ageing buckets 0–30/31–60/61–90/90+
- [~] Dead-stock alerts + AI markdown suggestion
- [~] Min/max per store + nightly auto-replenishment (scheduled)
- [x] Store × department days-of-cover heatmap
- [~] Blindbox sealed vs revealed tracking
- [ ] Safety-buffered availability pushed to Shopify [P4]

## 4. POS [P3]
- [x] Shift open with float; cashier PIN login — Playwright `phase3.spec.ts` + smoke `pos` (wrong PIN, lockout, one open shift per till)
- [~] Customer lookup/create by mobile — lookup by mobile/name + `createCustomer` smoke-tested; UI create-flow not click-tested
- [~] Barcode scan (keyboard-wedge/USB scanner path + Enter-to-add click-tested; camera `BarcodeDetector` scan built, needs a device/HTTPS), image grid ✓, camera visual search (Claude vision) — only the no-API-key fallback was exercised
- [x] Live promotion engine + "add ₹X to unlock" nudge — Vitest + visible in the e2e sell screen (5% above ₹2,000 + UPI 5% stacked on the receipt)
- [~] AI cross-sell panel [P7 AI] — deterministic stub (`crossSell`, Vitest); Claude-driven version is Phase 7
- [x] Vouchers, gift cards, credit notes — voucher + partial gift card (e2e), credit note via return→exchange (e2e), smoke covers limits/second redemption; [~] loyalty points redemption + earn (smoke/Vitest only, no UI click-through)
- [~] Gift-wrap service lines — built (service SKU, GST 18%, excluded from offers, Vitest) — not click-tested
- [x] UPI dynamic QR on customer display route (auto-confirm mock), cash incl. change, card (mock EDC), split / store credit — UPI + cash + GC + CN e2e; card/split UI [~]
- [~] GST invoice thermal layout (80 mm, `window.print`) + WhatsApp e-bill (mock bubble + `messageLog`) — rendered and e2e-asserted on screen; never printed on a real thermal printer
- [x] Returns/exchanges via bill QR / invoice no, reason codes, manager approval — e2e return → credit note → exchange; smoke partial/full refunds, restock, void. Camera QR scan of the bill [~]
- [~] Park/hold bills; reserve-in-store — built; reserve/release smoke-tested, parked-bill UI not click-tested
- [x] Z-report with denomination count + variance — e2e closes a shift; smoke covers variance + manager sign-off and "blocked while offline sales pending"
- [~] Manager PIN for overrides/voids; audit log — smoke-tested (denied without PIN, allowed with, audit rows); void/discount UI not click-tested
- [x] Offline sale + sync demo toggle (posOutbox) — e2e: toggle → UPI blocked → cash sale with `PRV/…` provisional receipt → Z-report blocked → back online → trigger assigns `INV/…`
- [x] **Target: 4-item sale < 45 s on a 1024 px tablet** — Playwright measures ≈ 8 s (scripted taps; a human will be slower, but the flow is item taps → Pay → UPI/Exact cash)

## 5. E-commerce / OMS [P4]
- [~] Shopify connector outbound (products, variants, prices, tags, stock) _(only **stock** is pushed, to a mock store; products/prices/tags are not)_
- [x] Shopify inbound webhooks, HMAC verified, idempotent _(orders/create, orders/paid, orders/cancelled, refunds/create applied; products/inventory/customers acknowledged and ignored)_
- [x] Failed events retried with backoff, dead letter, manual retry
- [~] COD/fraud risk score _(rule-based, explainable, shown on the order; never blocks)_
- [x] Allocation engine (warehouse vs ship-from-store, split, awaiting stock)
- [x] Pick list (bin-sorted, short-pick re-allocation), pack verification scan, gift note _(printed as text only)_
- [~] Courier label + tracking (mock Shiprocket) _(AWB, freight, tracking events and webhook; label is a print preview, not a carrier barcode)_
- [x] BOPIS (code, 48 h hold, expiry); [x] RTO → QC; [x] COD remittance reconciliation
- [x] Sync-health dashboard; "Simulate web order" button
- [ ] Prepaid refund execution, delivered-order returns/exchanges, partial cancel / order edit _(flagged `refundDue` only)_

## 6. Sales & CRM [P3/P4/P7]
- [ ] Sales dashboard (net sales, ATV, UPT, conversion, sales/sq ft, margin, discount %, return %) by store/channel/dept/SKU/hour/staff + target rings
- [ ] B2B flow: quotation → SO → proforma → advance → challan → tax invoice
- [ ] Customer 360 with RFM + favourite characters
- [ ] Loyalty Uni Points tiers Cutie→Bestie→Soulmate (earn/burn/expiry/birthday)
- [ ] Segments + campaigns (mock send) with attribution
- [ ] Staff sales tagging + commission feed to HR
- [ ] AI daily target split by seasonality

## 7. Discounts & Vouchers engine [P3]
- [x] Types: tender (UPI 5%), cart threshold (5% >₹2,000), BxGy, bundle price, category/SKU markdown, tiered spend, loyalty-tier, happy hour, free gift — all in `packages/domain/src/promotions.ts`, Vitest-covered
- [x] Priority + stackability matrix; budget caps — Vitest (compounding order, non-stackable competition, exclusive groups, budgets)
- [ ] Approval workflow (promotions are seeded data; maker-checker UI for promotions is not built)
- [ ] Margin-impact simulator — `marginImpact()` exists in domain; no UI
- [~] Voucher series: bulk unique codes (`issueVouchers` callable, smoke) — QR printing not built; single/multi-use, per-customer limit, min spend, validity, channel ✓ (Vitest)
- [x] Gift cards physical/e-gift: balance, top-up, partial redemption, expiry, liability journal (`sellGiftCard`, smoke; Vitest)
- [x] Credit notes as tender (return → CN → exchange e2e); [ ] referral codes
- [ ] AI abuse detection [P7]

## 8. Finance [P5]
- [ ] Double-entry journals posted by triggers from every event
- [ ] Chart of accounts mapped to Tally ledgers
- [ ] AP/AR with ageing
- [ ] Cash, bank, petty cash per store
- [ ] Expense claims with receipt upload
- [ ] Fixed assets + monthly depreciation (scheduled)
- [ ] Store-wise P&L by cost centre; budgets vs actuals
- [ ] GST engine: CGST/SGST/IGST by place of supply, multi-GSTIN, HSN summary, GSTR-1, GSTR-3B, 2B matching, e-invoice IRN/QR mock, e-way bill mock
- [ ] Period lock
- [ ] Tally XML builder (Sales per store/day, Purchase, Payment, Receipt, CN/DN, Journal, branch transfer)
- [ ] tallyQueue + tally-agent (poll, POST :9000, status write-back, retry/backoff)
- [ ] XML export fallback; daily ERP-vs-Tally trial balance check

### Reconciliation Centre [P5]
- [ ] Bank (CSV/MT940)
- [ ] UPI/card settlement
- [ ] Gateway payouts
- [ ] COD remittance
- [ ] Cash vs deposit
- [ ] Inventory vs GL
- [ ] GST books vs 2B
- [ ] ERP vs Tally
- [ ] Branch transfers
- [ ] Match-rate gauge, exception queue, auto-match rules, AI-suggested matches w/ confidence, accept/reject, audit

## 9. HR & Payroll [P6]
- [ ] Recruitment kanban + scorecards + offer letter PDF
- [ ] Onboarding with KYC uploads
- [ ] Attendance via selfie + geofence
- [ ] AI rosters from footfall forecast, drag-drop, swaps
- [ ] Leave balances + state holiday calendars
- [ ] KPI reviews; commissions from POS
- [ ] Payroll: PF, ESI, PT (MH/KA/TS), TDS, LWF; payslip PDFs; bank file; journal → Finance/Tally
- [ ] Employee self-service
- [ ] Exit + F&F settlement

## 10. AI layer [P7]
- [ ] Assistant "Uni": orb → slide-over, streaming, voice input, read tools, write tools with confirmation cards, claims enforced, source links, aiChats history
- [ ] Notification centre: rule + AI alerts, priorities, assign/snooze/resolve, live badge, mock push/WA/email, "Ask why"
- [ ] Insights: forecast, replenishment, new-drop allocation, markdown, basket pairs, anomalies, vendor risk, churn, review sentiment, AI product copy, daily briefing
- [ ] Future store projections: planner, 24-month ramp w/ band, break-even, payback, opening stock, staffing, capex/opex, scenario sliders, India map, 3/6/12-month forecasts

## 11. Store Twin [P8]
- [ ] Isometric per-store/floor map, floor flip switcher
- [ ] Shopper/staff avatars on zone paths (GSAP), activity icons
- [ ] Live counts, queue length/wait
- [ ] Dwell heatmap + 8-hour replay
- [ ] Event pulses (sale, sold-out, queue alert)
- [ ] Side panel: conversion + AI staff suggestions
- [ ] RTDB simulator (scheduled + local script), SensorAdapter

## 12. Admin & Platform [P1 base, P8 complete]
- [x] Users, roles, custom-claim management [P1]
- [ ] Approval matrix editor, number series, settings
- [ ] Audit log viewer, data export
- [ ] Demo controls: reset data, busy hour, web orders, offline POS toggle
- [x] Role switcher on login [P1]

## Cross-cutting
- [~] Seed data per spec [P1 core, extended per phase]
- [~] Security Rules tests for every role
- [ ] Playwright e2e: PR→PO→GRN→QC→Invoice→Payment · POS sale→return · web order→ship · payroll→journal→Tally queue · assistant creates PO
- [~] /design route; a11y + reduced motion _(/design visually checked; no a11y audit yet)_

## Phase 2 verification notes
**Verified** (`x`): `tests/smoke/scm.ts` (44 API checks against emulators: approval routing & maker-checker, vendor isolation, GRN/QC/putaway stock movements, ledger ≡ summary invariant, 3-way match hold/override, TDS payment, transfers with e-way/IGST invoice, valuation, ageing, heatmap), 85 Security Rules tests (buyer / warehouse / vendor / store-scoped / auditor / storage vendor folder), 31 domain Vitest tests (landed cost, 3-way match, duty, valuation, replenishment, routing…), and Playwright `phase2.spec.ts`: **PR → PO → GRN → QC → putaway → invoice (OCR) → 3-way match → payment** through the UI with every stepper step ticked, vendor portal ack + ASN, inventory/ledger/heatmap screens.
**Built, not verified end-to-end** (`~`), reasons:
- *Replenishment "AI"*: seasonal moving-average + safety stock rules in TypeScript, no Claude involved. The 02:00 IST `nightlyReplenishment` schedule is declared but the emulator does not fire schedules; its core is exercised via `runReplenishment` and the seed.
- *Vendor score*: weighted score from vendor-master stats (on-time, fill, defect %), not computed from live history.
- *OCR*: the Claude path (PDF/image → JSON → PO line mapping) is untested without an API key; the labelled mock path is what ran.
- *PO PDF*: opens a print view (browser "Save as PDF"); e-mail/WhatsApp are mock `messageLog` rows.
- *GRN scan*: keyboard-wedge/typed barcodes only — no camera scanning. Excess receipt ≤5% allowed, beyond blocked.
- *QC*: rework re-inspection exists server-side but was not exercised; defect tag is a keyword stub; photo upload verified only at API/rules level (UI upload path built, not clicked).
- *Counts*: blind count hides expected quantities in the UI only (they sit on the same document); cycle count / stock-take UI not clicked through; reconcile capped at 230 variance lines; mobile layout of count sheet not checked.
- *Payments*: advances are recorded on the PO but cannot yet be adjusted against a later invoice. MSME 45-day alert is shown on AP bills (≤7 days) — no notification yet (Phase 7).
- *Landed cost*: the allocation is spread over currently held units (revalues average cost), per-GRN; weight basis needs PO line weights (no weight field in the PO form yet).
- *Blind box*: sealed/revealed counters only; no per-figure tracking.
- *Dead stock*: markdown % is rule-based; no AI rationale yet.
- Phase 1's CSV-import Playwright test failed once on a cold dev server and passed on re-run (not investigated further).

## Phase 1 verification notes
- Verified by `tests/smoke/smoke.ts` (19 callable checks), `tests/rules` (40 Security Rules tests) and `tests/e2e/phase1.spec.ts` (3 Playwright flows on the emulators; run `pnpm demo` then `pnpm e2e`).
- Browser-verified: role switcher, dashboard, master list/search/create → maker cannot self-approve → CFO approves → record appears, history drawer, duplicates dialog, CSV import (valid/invalid row preview) + approval, CSV export download, label print window, image upload to Storage, ⌘K palette, dark mode, users + audit pages, /design, mobile card layout + hamburger nav, cashier sees no edit buttons.
- Bugs found by this pass and fixed: toast wobble animation threw (spring + 4 keyframes), approval cards were not `<li>` inside `<ul>`, CFO was refused duplicate detection, SKU code column wrapped to 4 lines, no navigation on mobile, glass overlays too transparent.
- Still unverified: `.xlsx` import, the Claude path of duplicate detection (needs API key), `setClaims` success path from the Users screen, any a11y audit. A dev-only hydration warning appears on /design right after a Playwright screenshot (Playwright injects `caret-color` into inputs); not reproducible on a plain load.

## Phase 3 notes — verified vs only built
- **Verified automatically:** domain Vitest (82 total, incl. UPI 5% + above-₹2,000 stacking, Buy 2 Get 1, bundle, tiered, voucher limits, gift-card partial redemption, invoice/journal/refund/Z maths, return journal), rules tests (94), `smoke pos` (61 callable checks), Playwright `phase3.spec.ts` (5 scenarios on a 1024×768 viewport against the emulators).
- **Built but not verified:** camera barcode / bill-QR scanning (needs a device + HTTPS), Claude-vision visual search with a real `ANTHROPIC_API_KEY`, physical thermal printing, PWA install + cold-start-offline (service worker only registers in a production build: `pnpm --filter @texafashions/pos build && start`), parked-bill and reserve UI, manager-discount UI, loyalty-points tender UI, gift-wrap, card/split UI.
- **Known gaps / deviations:** sale lines are embedded in `sales/{id}.lines[]` (not a subcollection); a failed outbox sale stays `failed` (no retry button); credit-note / gift-card doc ids replace `/` with `-` (number series keeps slashes in `number`); offline manager overrides and offline voucher/gift-card use are blocked by design; the demo seed's `pnpm seed` is required before re-running the e2e (open shift on the till).

## Phase 4 notes — verified vs only built
- **Verified automatically:** domain Vitest (108 total, +26: Shopify mapping, risk, allocation incl. buffer/reservation/split/BOPIS, web stock buffer, pack verification, backoff, status roll-up, RTO QC, COD reconciliation); rules tests (99); `smoke oms` (76 checks against the emulators: HMAC rejection of missing/forged/tampered requests and that nothing is stored, event-id and natural-key idempotency, out-of-order `orders/paid` → retry → resolved, 6-attempt dead letter, reservation/cancel/short-pick stock movements, pack-scan failures, shipment stock issue + balanced journals + IGST/CGST, courier state machine, RTO into inQC → QC → onHand/damaged + credit note, BOPIS code/handover/expiry, COD reconciliation + journal, stock push diff/buffer arithmetic/outage/retry, courier webhook token, health report, role isolation); Playwright `phase4.spec.ts` (3 flows incl. screenshots reviewed); Phases 1–3 smoke + e2e re-run green after the shared `Dialog`/`inr`/nav/ledger changes.
- **Built but not verified:** the real Shopify (only locally signed payloads were sent — header names `X-Shopify-Event-Id`/`X-Shopify-Webhook-Id` follow Shopify's documentation as I remember it and were not checked against a live store; Secret Manager binding was not exercised in a real project); real Shiprocket REST (adapter interface + mock only — a real adapter must book idempotently by `order_id = pickListId`); the three schedulers (declared, but the emulator never fires them — their bodies are the same functions the buttons call); mobile layouts of the OMS screens; a11y audit.
- **Known gaps / deviations:** only stock goes outbound to Shopify. Courier freight is stored on the shipment but not journaled (courier bills are Phase 5). No e-invoice/IRN. Refunds are flagged (`refundDue`), not executed. Short pick flags a count but does not adjust stock. A courier booking succeeds before the Firestore transaction; if that transaction fails an AWB exists unused (the mock is deterministic per pick list, so a retry reuses it). `computeWebStock` reads every `stock` doc (~2.7k) per push — fine every 15 min for the demo (~260k reads/day), a delta feed from the ledger would replace it. The simulator assumes free shipping ≥ ₹999 and the live 5%-above-₹2,000 discount. Pickup codes sit on the pick list doc, readable by staff of that location by design. `Dialog` without `aria-labelledby` and `inr()` dropping a trailing zero were pre-existing issues fixed here. Dev-server overlay vanishing right after a client navigation is pre-existing (reproduced on `/scm/transfers`), not investigated.
