# CLAUDE.md — Texa Fashions OS

AI-integrated omnichannel retail ERP **DEMO** for Texa Fashions (texafashions.in): lifestyle brand in India, Shopify web store + 8 mall stores. Runs entirely on the Firebase Emulator Suite (`pnpm demo`). Code is **migration-ready** for a later PostgreSQL + NestJS backend.

Business context, full data model, and per-module implementation detail (what's built, conventions, gotchas) live in `docs/architecture.md`, `docs/use-cases.md`, `docs/migration.md` and `docs/flows/01..12-*.md` — read the relevant flow doc before touching that module. This file holds only what every task needs.

## DEMO DEPTH (read this before building anything)
- Happy path only. No edge-case hardening beyond what's already in `packages/domain`.
- Use seeded data and the existing MOCK adapters (Payment, Courier, Messaging, Gst, BankStatement, Sensor, Shopify) for every external system — never add a real integration.
- Reuse existing components first: generic list/form/document screens, KPI cards, charts, stepper, toasts, Dialog, design tokens. See `docs/reuse.md` for the inventory. Don't build a new primitive if one already exists.
- No new dependencies unless a prompt names them explicitly.
- No Playwright runs as part of normal task work (only when explicitly asked).
- After each task, run only: typecheck, lint on changed files, and unit tests for the domain files you changed. Don't run the full suite, smoke tests, or e2e unless asked.
- Never ask clarifying questions mid-task — pick the sensible default and state it in your end-of-task summary.

## Modules (12)
1 Master Data · 2 SCM (procure-to-pay) · 3 Inventory · 4 POS (offline PWA) · 5 E-commerce/OMS · 6 Sales & CRM · 7 Discounts & Vouchers engine · 8 Finance + GST + Tally + Reconciliation · 9 HR & Payroll · 10 AI layer (Uni assistant, notifications, insights, store projections) · 11 Store Twin · 12 Admin & Platform.

## Stack (do not substitute without asking)
- Turborepo + pnpm monorepo, TypeScript strict, Node 20.
- `apps/web` Next.js App Router back-office · `apps/pos` Next.js PWA (tablet-first, offline-first) · `apps/tally-agent` Node CLI (polls `tallyQueue`, POSTs XML to TallyPrime `localhost:9000`) · `functions` Firebase Functions 2nd gen (asia-south1).
- `packages/domain` pure TS (no Firebase) · `packages/data` repository interfaces + FirebaseAdapter + placeholder RestAdapter · `packages/types` zod schemas · `packages/ui` "Texa Soft" design system · `scripts/seed`.
- Firebase: Auth (email/pw, phone OTP, POS PIN custom token), Firestore (named DB, asia-south1), Functions, Storage, RTDB (Store Twin presence only), App Hosting, Secret Manager, App Check, Emulator Suite.
- FE: Tailwind, shadcn/ui, Framer Motion, GSAP, Lottie, Recharts/ECharts, TanStack Table+Query, Zustand, react-hook-form+zod, Fuse.js, PixiJS/SVG, jsPDF/pdfmake.
- AI: Anthropic Claude **only from Cloud Functions** (tool use, streaming HTTP function). Forecasting in TS (Holt-Winters / seasonal MA).
- Tests: Vitest (domain), @firebase/rules-unit-testing (rules), Playwright (e2e on emulators).

## Folder structure (target)
```
apps/web  apps/pos  apps/tally-agent
functions/
packages/{domain,data,types,ui}
scripts/seed
docs/{architecture.md,use-cases.md,migration.md,reuse.md,flows/*.md}
firebase.json  firestore.rules  firestore.indexes.json  storage.rules  database.rules.json
```

## Conventions & migration rules (hard rules)
1. **UI never imports Firebase.** UI → TanStack Query → `packages/data` repository interface → FirebaseAdapter. Firebase imports allowed only in `packages/data`, `functions`, `apps/tally-agent`, `scripts/seed`.
2. **Business rules live in `packages/domain`** (pure TS, Vitest-tested), reused by functions now and NestJS later.
3. **Writes that change stock, money or status go through callable functions** running a Firestore transaction. Clients write drafts only. Rules deny client writes to ledgers, stock, invoices, payments, auditLogs.
4. Stock ledger & journals are **append-only**; `/stock/{locationId_skuId}` summary updated in the same transaction.
5. Everything under `/orgs/{orgId}/…` (orgId `texafashions`). Money = integer paise, quantities = integers, dates = UTC Timestamps shown in IST.
6. Sharded counters / hourly rollups for hot counters; transactions < 500 writes; bulk jobs chunked.
7. Number series via `/counters/{docType_store_fy}` in a transaction, e.g. `PO/BLR-FS/26-27/00001`.
8. Dashboards read denormalised read models (`/reports/...`) maintained by triggers.
9. RBAC custom claims `{role, storeIds[], approvalLimitPaise}`; functions re-check permissions. Every mutation writes `/auditLogs` (before/after). Maker-checker via `/approvals`.
10. Integrations are adapters with MOCK impls (Payment, Courier, Messaging, Gst, BankStatement, Sensor). Shopify uses real HMAC-verified webhooks, runnable against a mock store.
11. zod validation on client and in every function. Search: `searchKeywords[]` + Fuse.js.
12. Lint, typecheck, tests must pass at end of every phase; update this file and `docs/use-cases.md`.

## Design tokens — "Texa Soft"
Light: bg `#FFFBF7`, blush `#F7C6D0`, butter `#FCE7A8`, mint `#BFE6D6`, sky `#C7DDF5`, lavender `#D9CCF2`, ink `#2B2633`, accent cherry `#E5486B`. Dark "Texa Night": bg `#1C1824`, card `#262131`.
Fonts: Fredoka (display), Inter w/ tabular nums (UI),. Radius 16–24px, pill buttons, two-layer soft shadows, 8px grid, 24px card padding, glass overlays. Breakpoints 360/768/1024/1440/1920. Respect `prefers-reduced-motion`. Mascots: bear, bunny, capybara (original SVG/Lottie).

## Roles (seeded + demo role switcher)
Super Admin, CFO/Accountant, Merchandiser/Buyer, Warehouse Manager, Store Manager, Cashier, Sales Associate, HR Manager, Vendor (portal), Auditor (read-only).

## Commands
`pnpm dev` / `npm run dev` / `pnpm demo` (build functions → emulators → seed → web :3100 + pos :3101; emulator UI :4000) · `pnpm lint` · `pnpm typecheck` · `pnpm test` (Vitest, no emulator) · `pnpm test:rules` (Security Rules on emulators) · `pnpm --filter @texafashions/smoke-tests smoke|scm|pos|oms` (needs `pnpm demo` running; `oms` = 76 checks) · `pnpm seed` · `pnpm e2e` (Playwright, needs `pnpm demo` running; each run adds test brands to the emulator data — `pnpm seed` does not delete them, restart `pnpm demo` for a clean slate).
Requires Java 21+ for the emulators (`brew install openjdk@21`; `scripts/demo.mjs` finds the Homebrew keg automatically).

## Environment decisions & gotchas
- **Ports:** web 3100 / pos 3101 (3000/3001 were taken on the dev machine). RTDB emulator on 9001 (9000 is TallyPrime's).
- Demo project id `demo-texafashions`; functions region `asia-south1`; functions are bundled with tsup (workspace packages inlined) → run `pnpm --filter @texafashions/functions build` after editing functions or packages (`pnpm demo` does it).
- `@google-cloud/firestore` must be an explicit dep of any package importing `firebase-admin/firestore` (types resolve to `any` otherwise).
- Firestore forbids nested arrays → store polygons as `[{x,y}]`.
- Callable payloads turn `undefined` into `null` → function zod schemas use `.nullish()` for optional fields; use `parseInput()` so bad input is `invalid-argument`, not a 500.
- HR shift master collection is `hrShifts` (POS `shifts` is reserved for cashier shifts).
- Maker ≠ checker is enforced: switch role via the avatar menu to approve your own submissions.
- Claude features need `ANTHROPIC_API_KEY` in `functions/.secret.local`; without it they fall back to deterministic logic.
- Tailwind v4 (CSS `@theme`), Next 16, React 19, zod 4, TanStack Table v8 (v9 is installed by default — pin v8).

## Phase checklist
- [x] **Step 0** — Plan & docs
- [x] **Phase 1** (done 2026-11-04) — Monorepo, Firebase config/emulators, types/data/domain skeletons, base rules, Auth+claims+role switcher, seed, design system + /design, app shell, Master Data complete — `docs/flows/01-master-data.md`
- [x] **Phase 2** (done 2026-11-05) — Inventory + full SCM + vendor portal + transfers + landed cost — `docs/flows/02-scm.md`, `docs/flows/03-inventory.md`
- [x] **Phase 3** (done 2026-11-05) — POS PWA + promotion/voucher/gift-card engine + loyalty — `docs/flows/04-pos.md`, `docs/flows/07-promotions.md`
- [x] **Phase 4** (done 2026-11-05) — Shopify connector + OMS (allocation, pick, pack, mock Shiprocket, BOPIS, RTO→QC, COD remittance) + sync-health dashboard — `docs/flows/05-oms.md`
- [ ] **Phase 5** — Finance + GST + Tally agent + Reconciliation — `docs/flows/08-finance.md`
- [ ] **Phase 6** — HR & Payroll — `docs/flows/09-hr-payroll.md`
- [ ] **Phase 7** — AI assistant, notifications, insights, forecasting, store projections — `docs/flows/10-ai-layer.md`
- [ ] **Phase 8** — Store Twin + simulator, admin/demo controls, perf/a11y, full e2e, deployment + migration docs — `docs/flows/11-store-twin.md`, `docs/flows/12-admin.md`

Workflow: stop after each phase and wait for "next".
