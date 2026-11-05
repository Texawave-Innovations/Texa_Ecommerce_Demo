import { test, expect, type Page } from '@playwright/test';

/** Phase 4 UI flow on the emulators: simulate web order → pick → pack scan → ship → track → sync health → retry → COD remittance. Needs `pnpm demo` and a fresh `pnpm seed` (the COD test consumes the seeded delivered COD parcels). */
const SHOTS = process.env.SHOTS_DIR ?? 'shots';
const errors: string[] = [];
test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => errors.push(`${page.url()} :: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`${page.url()} :: ${m.text().slice(0, 200)}`); });
});
test.afterAll(() => { console.log('CONSOLE ERRORS:\n' + (errors.join('\n') || 'none')); });

async function login(page: Page, label: string) {
  await page.goto('/login');
  const more = page.getByRole('button', { name: /^More roles/ });
  if (await more.count()) await more.click();
  await page.getByRole('button', { name: new RegExp(label) }).click();
  await page.waitForURL(/\/(dashboard|vendor|finance|hr|scm|inventory|oms)$/, { timeout: 20000 });
}
/** Dev server re-renders the page shortly after a client navigation and drops freshly opened overlays; give it a moment before interacting. */
const settle = (page: Page) => page.waitForTimeout(1200);
/** Retries the click until the dialog opens (the first click can land before React has hydrated). */
async function openSimulator(page: Page) {
  await settle(page);
  await expect(async () => {
    await page.getByRole('button', { name: 'Simulate web order' }).click();
    await expect(page.getByRole('dialog', { name: 'Simulate a web order' })).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15000 });
}
const toast = (page: Page, re: RegExp) => page.locator('[role=status]').getByText(re).first();

test('web order → pick → pack scan → shipment → tracking → sync health', async ({ page }) => {
  await login(page, 'Warehouse Manager');
  await page.getByRole('link', { name: /E-commerce/ }).click();
  await expect(page.getByRole('heading', { name: 'E-commerce / OMS' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/40-oms-orders.png` });

  // Simulate a prepaid web order through the real ingest path
  await openSimulator(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(toast(page, /#SIM\d+ → allocated/)).toBeVisible({ timeout: 20000 });
  const orderName = ((await toast(page, /#SIM\d+/).textContent()) ?? '').match(/#SIM\d+/)![0];
  const row = page.locator('tbody tr', { hasText: orderName });
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.click();
  await expect(page.getByText(/Allocated \(single\)/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/41-oms-order-detail.png` });
  await page.keyboard.press('Escape');

  // Pick
  await page.goto('/oms/fulfilment'); await settle(page);
  const pick = page.locator('tbody tr', { hasText: orderName });
  await pick.getByRole('button', { name: 'Pick' }).click();
  await page.screenshot({ path: `${SHOTS}/42-oms-pick.png` });
  await page.getByRole('button', { name: 'Confirm pick' }).click();
  await expect(toast(page, /Picked/)).toBeVisible({ timeout: 15000 });

  // Pack: a wrong scan is rejected with a reason, the demo "scan everything" passes
  await page.getByRole('tab', { name: /To pack/ }).click();
  await page.locator('tbody tr', { hasText: orderName }).getByRole('button', { name: /Pack & scan/ }).click();
  await page.getByLabel('Scan barcode').fill('NOT-A-BARCODE');
  await page.getByLabel('Scan barcode').press('Enter');
  await page.getByRole('button', { name: 'Verify & pack' }).click();
  await expect(page.locator('p[role=alert]')).toContainText(/Pack check failed/);
  await page.screenshot({ path: `${SHOTS}/43-oms-pack-error.png` });
  await page.getByRole('button', { name: 'clear' }).click();
  await page.getByRole('button', { name: 'demo: scan everything' }).click();
  await page.getByRole('button', { name: 'Verify & pack' }).click();
  await expect(toast(page, /Packed/)).toBeVisible({ timeout: 15000 });

  // Ship (mock Shiprocket) and track
  await page.getByRole('tab', { name: /To ship/ }).click();
  await page.locator('tbody tr', { hasText: orderName }).getByRole('button', { name: 'Create shipment' }).click();
  await expect(toast(page, /AWB SR\d{11}/)).toBeVisible({ timeout: 20000 });
  await page.getByRole('tab', { name: /With courier/ }).click();
  await page.locator('tbody tr', { hasText: orderName }).getByRole('button', { name: 'Track' }).click();
  await page.getByRole('button', { name: 'Picked up' }).click();
  await expect(page.getByText(/picked up/i).first()).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}/44-oms-track.png` });
  await page.keyboard.press('Escape');

  // Sync-health dashboard
  await page.goto('/oms/sync'); await settle(page);
  await expect(page.getByText(/Healthy|Needs attention|Action required/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Stock → Shopify')).toBeVisible();
  await page.getByRole('button', { name: 'Push now' }).click();
  await expect(toast(page, /Pushed \d+ SKU/)).toBeVisible({ timeout: 30000 });

  // Poison event → retry queue → retry
  await openSimulator(page);
  await page.getByLabel('Scenario').selectOption('bad_sku');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(toast(page, /failed/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/unknown SKU/i).first()).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}/45-oms-sync-health.png`, fullPage: true });
  await page.getByRole('button', { name: 'Retry', exact: true }).first().click();
  await expect(toast(page, /Retry → /)).toBeVisible({ timeout: 15000 });
});

test('RTO and COD remittance screens (CFO)', async ({ page }) => {
  await login(page, 'CFO');
  await page.goto('/oms/returns'); await settle(page);
  await expect(page.getByRole('heading', { name: 'Returns & COD' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/46-oms-rto.png` });
  await page.getByRole('tab', { name: 'COD remittance' }).click();
  await expect(page.getByText('Cash held by couriers')).toBeVisible();
  await page.getByRole('button', { name: 'Simulate courier remittance' }).click();
  await expect(toast(page, /Remittance .* issue/)).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: `${SHOTS}/47-oms-cod.png`, fullPage: true });
  await page.locator('tbody tr').first().click();
  await expect(page.getByText(/unknown awb/i).first()).toBeVisible();
});

test('store manager sees fulfilment only (no customer PII)', async ({ page }) => {
  await login(page, 'Store Manager');
  await page.goto('/oms');
  await expect(page.getByText(/Your store’s web work lives under Fulfilment/)).toBeVisible();
  await page.goto('/oms/fulfilment');
  await expect(page.getByRole('heading', { name: 'Fulfilment' })).toBeVisible();
});
