import { test, expect, type Page } from '@playwright/test';

/** Phase 3 — POS PWA on a 1024 px tablet. Needs `pnpm demo` running (POS on :3101). Serial: one shift, many scenarios. */
const POS = 'http://localhost:3101';
const SHOTS = process.env.SHOTS_DIR ?? 'shots';
test.use({ baseURL: POS, viewport: { width: 1024, height: 768 }, hasTouch: true });
test.describe.configure({ mode: 'serial' });

const errors: string[] = [];
let page: Page;
const state: { fourItemSeconds?: number; offlineProvisional?: string } = {};

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, baseURL: POS });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${page.url()} :: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|net::ERR|Could not reach Cloud Firestore|WebChannel|offline/i.test(m.text())) errors.push(`${page.url()} :: ${m.text().slice(0, 200)}`); });
});
test.afterAll(() => { console.log('CONSOLE ERRORS:\n' + (errors.join('\n') || 'none')); });

const tiles = () => page.locator('[data-testid^="sku-"]');
async function addItems(n: number, from = 0) {
  await expect(tiles().first()).toBeVisible({ timeout: 20000 });
  for (let i = 0; i < n; i++) { await tiles().nth(from + i).click(); await expect(page.getByTestId('cart-count')).toHaveText(String(i + 1)); }
}
async function newSale() { await page.getByTestId('new-sale').click(); await expect(page.getByTestId('sale-done')).toBeHidden(); }
const money = (s: string) => Number(s.replace(/[₹,\s]/g, ''));

test('PIN login → open shift', async () => {
  await page.goto('/login');
  await page.getByTestId('store-PUN-PMC').click();
  await page.getByTestId('staff-CSH01').click();
  await expect(page.getByText('Enter your PIN')).toBeVisible();
  await page.waitForTimeout(500);                                   // let the keypad mount its key listener
  await page.keyboard.type('1234', { delay: 40 });
  await page.waitForURL(/\/shift$/, { timeout: 20000 });
  await page.screenshot({ path: `${SHOTS}/30-pos-shift.png` });
  await page.getByTestId('till-PUN-PMC-T1').click();
  await page.getByTestId('float-input').fill('2000');
  await page.getByTestId('open-shift').click();
  await page.waitForURL(/\/sell$/, { timeout: 20000 });
  await expect(page.getByTestId('sell-screen')).toBeVisible();
});

test('4-item UPI sale under 45 s with 5% UPI offer, QR on customer display', async () => {
  // customer display in a second tab of the same context (BroadcastChannel)
  const display = await page.context().newPage();
  await display.goto('/customer-display');
  await page.bringToFront();
  const t0 = Date.now();
  await addItems(4);
  await page.screenshot({ path: `${SHOTS}/31-pos-sell.png` });
  const before = money(await page.getByTestId('cart-total').innerText());
  await page.getByTestId('pay-btn').click();
  await page.getByTestId('tender-upi').click();
  await expect(page.getByTestId('upi-panel')).toBeVisible();
  await expect(display.getByTestId('display-amount')).toBeVisible({ timeout: 5000 });
  await display.screenshot({ path: `${SHOTS}/32-customer-display-upi.png` });
  await page.getByTestId('upi-simulate').click();                    // mock auto-confirm would also fire after ~4 s
  await expect(page.getByTestId('sale-done')).toBeVisible({ timeout: 20000 });
  state.fourItemSeconds = (Date.now() - t0) / 1000;
  const paid = money(await page.getByTestId('done-total').innerText());
  expect(paid).toBeLessThan(before);                                // UPI 5% applied
  await expect(page.getByTestId('done-invoice')).toHaveText(/^INV\/PUN-PMC\/\d\d-\d\d\/\d{5}$/);
  await page.screenshot({ path: `${SHOTS}/33-pos-done.png` });
  console.log(`4-item UPI sale took ${state.fourItemSeconds}s (target < 45)`);
  expect(state.fourItemSeconds).toBeLessThan(45);
  await expect(display.getByText('Thank you!')).toBeVisible();
  await display.close();
  await page.getByTestId('ebill-mobile').fill('9876543210');
  await page.getByTestId('ebill-send').click();
  await expect(page.getByTestId('ebill-bubble')).toBeVisible();
  await newSale();
});

test('cash sale with change, then voucher + gift card partial redemption', async () => {
  await addItems(2, 5);
  await page.getByTestId('pay-btn').click();
  await page.getByTestId('tender-cash').click();
  await page.getByTestId('cash-exact').click();
  await expect(page.getByTestId('sale-done')).toBeVisible({ timeout: 20000 });
  await newSale();

  await addItems(3, 8);
  await page.getByTestId('voucher-input').fill('WEL-DEMO1');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Voucher WEL-DEMO1', { exact: true })).toBeVisible();
  await page.getByTestId('pay-btn').click();
  await page.getByTestId('tender-gc').click();
  await page.getByTestId('instrument-code').fill('GC-DEMO-0002');
  await page.getByTestId('instrument-lookup').click();
  await expect(page.getByTestId('instrument-found')).toBeVisible();
  await page.getByTestId('instrument-apply').click();
  await expect(page.getByTestId('payment-row').first()).toContainText('GC');
  await page.getByTestId('tender-cash').click();
  await page.getByTestId('cash-exact').click();
  await expect(page.getByTestId('sale-done')).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: `${SHOTS}/34-pos-split.png` });
  await newSale();
});

test('offline mode: cash sale gets a provisional receipt, syncs when back online', async () => {
  await page.getByTestId('offline-toggle').click();
  await expect(page.getByTestId('net-status')).toContainText(/Offline/);
  await addItems(2, 12);
  await page.getByTestId('pay-btn').click();
  await page.getByTestId('tender-upi').click();                      // blocked offline
  await expect(page.getByTestId('upi-panel')).toBeHidden();
  await page.getByTestId('tender-cash').click();
  await page.getByTestId('cash-exact').click();
  await expect(page.getByTestId('sale-done')).toBeVisible({ timeout: 20000 });
  const prov = await page.getByTestId('done-invoice').innerText();
  expect(prov).toMatch(/^PRV\//); state.offlineProvisional = prov;
  await expect(page.getByTestId('receipt').getByText('PROVISIONAL RECEIPT')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/35-pos-offline-receipt.png` });
  await newSale();
  await expect(page.getByTestId('outbox-pill')).toBeVisible();
  // closing the shift is blocked while sales are unsynced
  await page.goto('/z-report');
  await expect(page.getByTestId('z-blocked')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/36-pos-z-blocked.png` });
  await page.goto('/sell');
  await page.getByTestId('offline-toggle').click();                  // back online → Firestore flushes the outbox → trigger finalises
  await page.goto('/history');
  await expect(page.getByTestId('bill-row').filter({ hasText: /INV\/PUN-PMC/ }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('outbox-list')).toBeHidden({ timeout: 30000 });
  await page.screenshot({ path: `${SHOTS}/37-pos-history-synced.png` });
});

test('return → credit note → exchange, then Z-report closes the shift', async () => {
  await page.goto('/returns');
  await page.getByTestId('recent-bill').first().click();
  await page.getByTestId('ret-plus').first().click();
  await page.getByTestId('ret-reason').first().selectOption({ index: 1 });
  await page.getByTestId('refund-CN').click();
  await page.screenshot({ path: `${SHOTS}/38-pos-return.png` });
  const submit = page.getByTestId('return-submit');
  if (/Manager/.test(await submit.innerText())) {
    await submit.click();
    await expect(page.getByTestId('mgr-pin-ok')).toBeVisible();
    await page.waitForTimeout(500);
    await page.keyboard.type('4321', { delay: 40 });
    await page.getByTestId('mgr-pin-ok').click();
  } else await submit.click();
  await expect(page.getByTestId('return-done')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('cn-id')).toContainText(/CN-/);
  await page.getByTestId('exchange-go').click();
  await page.waitForURL(/\/sell$/);
  await addItems(1, 20);
  await page.getByTestId('pay-btn').click();
  await page.getByTestId('tender-cn').click();
  await page.getByTestId('instrument-lookup').click();
  await expect(page.getByTestId('instrument-found')).toBeVisible();
  await page.getByTestId('instrument-apply').click();
  const due = money(await page.getByTestId('tender-due').innerText());
  if (due > 0) { await page.getByTestId('tender-cash').click(); await page.getByTestId('cash-exact').click(); }
  await expect(page.getByTestId('sale-done')).toBeVisible({ timeout: 20000 });
  await newSale();

  await page.goto('/z-report');
  for (const [d, n] of Object.entries({ 500: 10, 100: 10, 50: 4, 20: 5, 10: 5 })) await page.getByTestId(`denom-${d}`).fill(String(n));
  await page.screenshot({ path: `${SHOTS}/39-pos-z-report.png` });
  const close = page.getByTestId('close-shift');
  await close.click();
  if (await page.getByTestId('mgr-pin-ok').isVisible({ timeout: 1500 }).catch(() => false)) { await page.waitForTimeout(500); await page.keyboard.type('4321', { delay: 40 }); await page.getByTestId('mgr-pin-ok').click(); }
  await expect(page.getByTestId('z-receipt')).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: `${SHOTS}/40-pos-z-closed.png` });
});
