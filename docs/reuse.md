# Reuse inventory (Phases 1–4)

What already exists — check here before building a new component, hook, or repository method.

## `packages/ui` — "Texa Soft" design system
- `Button`, `Input`, `Select`, `Textarea`, `Field` — form primitives.
- `Card`, `Badge`, `Skeleton` — layout/status primitives.
- `Dialog`, `SlideOver` — modal and side-panel overlays (Dialog has `aria-labelledby` wired).
- `Tabs` — tabbed sections.
- `Kpi`, `CountUp` — KPI stat tiles with animated numbers (dashboards).
- `FlowStepper` — animated document-flow stepper (used by PO/RFQ detail, OMS order tracking).
- `StaggerGrid` — staggered entrance grid for cards/lists.
- `toast`, `Toaster` — toast notifications.
- `MotionRoot` — Framer Motion wrapper respecting `prefers-reduced-motion`.
- `Bear`, `Bunny`, `Capybara`, `Mascot`, `EmptyState`, `MascotLoader` — mascot illustrations + empty/loading states.
- `AIOrb` — floating orb that opens the Uni chat.
- `cn()` — className merge helper.

## `packages/data` — repository interfaces (consume via TanStack Query, never Firebase directly)
- `AuthRepo` — sign in, session, custom claims.
- `MasterRepo` — generic CRUD/list/import/export/history for any of the 43 masters (`ListMastersOptions` for filters/search).
- `AdminRepo` — users, audit log (`AdminUser`).
- `ScmRepo` — generic list/get/subscribe for SCM docs + typed `command(name, input)` driven by `COMMAND_SCHEMAS` (`ScmQuery`). Covers PR/RFQ/PO/ASN/GRN/QC/payables/transfers — don't add a new repo method, add a command schema.
- `PosRepo` — offline-first reads (`TillRow`, `ParkedBill`, `VoucherRow`, `StockMap`, `ReservationRow`), `enqueueOutbox`, `setNetwork`.
- `AiRepo` — Uni streaming chat (`chat(history, chatId, onEvent)`, NDJSON events typed as `UniEvent` in `packages/types/src/ai.ts`) + `listChats()`.
- `DataContext` — the context object wiring all repos; `createFirebaseContext` (real) / `createRestContext` (placeholder for the NestJS migration).

## `apps/web` reusable screens/components
- `Shell.tsx` — app shell: sidebar, ⌘K, store switcher, bell, theme, AI orb placeholder. Every authenticated route renders inside it.
- `MasterForm.tsx` — registry-driven form for any master (field defs → inputs + zod).
- `ImportDialog.tsx` — upload → validate preview → commit wizard (reused by any bulk import).
- `HistoryDrawer.tsx` — version/audit history drawer (reused across masters and operational docs).
- `components/scm/*` — purchase, receiving, payables, transfers, vendor, kit screens — patterns to copy for Finance/HR module list+detail pages.
- `components/oms/*` — home, fulfilment, returns, sync, `shared.tsx` (shared OMS pieces: status badges, pick-list cards) — reference for building Phase 5/6 detail pages.
- `UniChat.tsx` — Uni slide-over: streaming bubbles, table/chart/confirm cards (`UniCard`), starters, Web Speech input, chat history. New tool = add to `functions/src/ai/uni.ts` `TOOLS`; new card kind = extend `UniCard`.
- `useScope()` hook — scopes Firestore queries to the caller's `storeIds`/`locationId`; required for any store-scoped list query or Security Rules reject it.

## `packages/domain` — pure business logic (no Firebase, Vitest-tested)
See each module's flow doc (`docs/flows/01..12-*.md`, "Inventory" section) for the full function list per phase — e.g. `pos.ts`/`promotions.ts`/`instruments.ts`/`invoice.ts` (Phase 3), `oms.ts` (Phase 4), landed-cost/3-way-match/WAC/ABC (Phase 2). Reuse these functions from new Cloud Functions rather than re-deriving business rules.
- `recon.ts` — generic reconciliation matcher (`match(source, target, rules)`: exact ref+amount, amount+date window, many-to-one) + `RECON_TYPES` config for all 9 recon types. Add a new recon type by adding a config object, not new matching code — see `docs/flows/08-finance.md`.

## `apps/web/src/components/finance/recon.tsx`
`Gauge` — animated SVG arc match-rate gauge (inline, no charting lib). Reuse for any other "live percentage" tile before building a new one.

## Mock adapters (use these, never a real integration, per DEMO DEPTH)
`MockPaymentGateway` (pos.ts), `MockShiprocket` (`functions/src/adapters/courier.ts`), `ShopifyAdmin` mock store (`functions/src/shopify/adapter.ts`), mock WhatsApp e-bill adapter, and the Gst/BankStatement/Sensor adapter slots reserved for Phases 5/8.

## Phase 7 (notifications + insights)
- `packages/domain/alerts.ts` + `forecast.ts` — add an alert by adding a rule to `evaluateAlerts` (+ its snapshot field); reuse `forecastByWeekday`/`daysOfCover` for any SKU × store demand question.
- `apps/web/src/components/notifications.tsx` — `useInbox()`, `BellButton`, `NotificationCentre`, `BriefingCard`. `UniChat` accepts a `seed` to open with a pre-filled question.
- `AiRepo` — `subscribeInbox`, `inboxAction`, `runAlertsNow`, `dailyBriefing`.

## Phase 7 (store projections)
- `packages/domain/projection.ts` — `projectScenarios`, `buildBenchmark`, `forecastStoreSales`. `apps/web/src/components/projections.tsx` has inline-SVG `SalesChart` (area + band) and `IndiaMap` (lat/lng → 300×320 box) to reuse for other charts/maps.

## Phase 8 (Store Twin)
- `packages/domain/src/twin.ts` — simulator (`stepSim`), `queueStats`, `zoneCounts`, `accumulateDwell`, `staffSuggestion`; add a nudge by adding a rule to `staffSuggestion`.
- `TwinRepo` (`packages/data/src/twin.ts`) — `subscribePeople`, `subscribeMeta`, `subscribeNewSales`.
- `apps/web/src/components/twin.tsx` — `IsoFloor` (`iso()` projection, zone tiles, `Walker` GSAP avatar, `Ripple`) reusable for any zone-polygon floor view.
- `apps/web/src/lib/landing.ts` — `landingFor(role)`, `FEATURED_ROLES`, `ROLE_MASCOT`/`ROLE_TINT` (login avatars + per-role landing). `AdminRepo.demoControl(action)` for demo buttons; add an action to `DEMO_ACTIONS` + `functions/src/demo.ts`.
