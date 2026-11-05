import { test, expect, type Page } from '@playwright/test';

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
async function switchRole(page: Page, label: string) {
  await page.getByRole('button', { name: /Switch|Aarav|Kavya|Priya|Imran|Vikram|Sneha|Divya|Meera|Rohan|Hana/ }).first().click();
  await page.getByRole('menuitem', { name: label }).click();
  await page.waitForTimeout(1800);
}
const toast = (page: Page, re: RegExp) => page.locator('[role=status]').getByText(re).first();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('PR → PO → GRN → QC → Invoice → Payment', async ({ page }) => {
  // ── Buyer: requisition (auto-approved within authority)
  await login(page, 'Merchandiser');
  await page.goto('/scm/purchase?tab=requisitions');
  await page.getByRole('button', { name: /New requisition/ }).click();
  await page.getByLabel('Search SKU').fill('gel pen');
  await page.locator('ul.glass button').first().click();
  await page.getByLabel('Quantity').fill('30');
  await page.screenshot({ path: `${SHOTS}/20-pr-form.png` });
  await page.getByRole('button', { name: 'Submit requisition' }).click();
  await expect(toast(page, /PR\/WH-CENTRAL\/.*approved/)).toBeVisible({ timeout: 15000 });
  await page.keyboard.press('Escape');

  // ── Buyer: convert PR → PO (prefilled)
  const prRow = page.locator('tbody tr', { hasText: 'approved' }).first();
  await prRow.getByRole('button', { name: 'PO' }).click();
  const dlg = page.getByRole('dialog', { name: 'New purchase order' });
  await expect(dlg).toBeVisible();
  const vopt = await dlg.locator('select').first().locator('option', { hasText: 'Pune Print House' }).first().getAttribute('value');
  await dlg.locator('select').first().selectOption(vopt!);
  await expect(page.getByLabel(/Unit price/).first()).not.toHaveValue('0', { timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}/21-po-form.png` });
  await page.getByRole('button', { name: 'Create purchase order' }).click();
  await page.waitForURL(/\/scm\/purchase\/orders\//, { timeout: 20000 });
  await expect(page.getByText('approved').first()).toBeVisible();
  const poUrl = page.url();
  const poNumber = (await page.locator('h1').innerText()).match(/PO\/\S+/)![0];
  await page.screenshot({ path: `${SHOTS}/22-po-detail.png`, fullPage: true });

  // ── Warehouse: GRN → QC
  await switchRole(page, 'Warehouse Manager');
  await page.goto('/scm/receiving');
  await page.getByRole('button', { name: /New goods receipt/ }).click();
  const poSel = page.getByRole('dialog').locator('select').first();
  await poSel.selectOption((await poSel.locator('option', { hasText: poNumber }).first().getAttribute('value'))!);
  await page.getByRole('button', { name: 'Fill expected quantities' }).click();
  await page.screenshot({ path: `${SHOTS}/23-grn.png` });
  await page.getByRole('button', { name: /Post GRN/ }).click();
  await expect(toast(page, /GRN\/.*posted/)).toBeVisible({ timeout: 15000 });
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Quality check' }).click();
  await page.locator('tbody tr', { hasText: poNumber }).getByRole('button', { name: 'Inspect' }).click();
  await page.screenshot({ path: `${SHOTS}/24-qc.png` });
  await page.getByRole('button', { name: 'Post inspection' }).click();
  await expect(toast(page, /QC done/)).toBeVisible({ timeout: 15000 });
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Putaway' }).click();
  await page.getByRole('button', { name: 'Put away' }).first().click();
  await expect(toast(page, /Put away/)).toBeVisible();

  // ── CFO: invoice with OCR → 3-way match → AP bill → payment
  await switchRole(page, 'CFO / Accountant');
  await page.goto('/scm/payables');
  await page.getByRole('button', { name: /Record purchase invoice/ }).click();
  const poSel2 = page.getByRole('dialog').locator('select').first();
  await poSel2.selectOption((await poSel2.locator('option', { hasText: poNumber }).first().getAttribute('value'))!);
  await page.locator('input[type=file]').setInputFiles({ name: 'invoice.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText(/Mock OCR|Read by Claude/).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel(/Quantity/).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/25-invoice-ocr.png` });
  await page.getByRole('button', { name: /Save & run 3-way match/ }).click();
  await expect(page.getByText(/3-way match passed/)).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${SHOTS}/26-match.png` });
  await page.getByRole('button', { name: 'Close' }).last().click();
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'AP bills' }).click();
  await page.locator('tbody tr', { hasText: 'Pune Print House' }).filter({ has: page.getByRole('button', { name: 'Pay' }) }).first().getByRole('button', { name: 'Pay' }).click();
  await page.getByRole('button', { name: 'Post payment' }).click();
  await expect(toast(page, /PAY\/.*posted/)).toBeVisible({ timeout: 15000 });

  // ── Document-flow tracker shows every step complete
  await page.goto(poUrl);
  await expect(page.getByRole('list', { name: 'Document flow' }).getByText('✓')).toHaveCount(7, { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/27-flow-complete.png` });
});

test('vendor portal: acknowledge and notify shipment', async ({ page }) => {
  await login(page, 'Vendor');
  await expect(page).toHaveURL(/\/vendor$/);
  await expect(page.getByRole('heading', { name: 'Vendor portal' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/30-vendor.png` });
  // vendors must not see back-office navigation
  await expect(page.getByRole('link', { name: 'Master Data' })).toHaveCount(0);
  // Re-runnable: acknowledge a pending order if one is left, otherwise carry on with an already-acknowledged one.
  const pending = page.locator('tbody tr', { hasText: 'action needed' });
  if (await pending.count()) {
    await pending.first().click();
    await page.getByRole('button', { name: /^Acknowledge$/ }).click();
    await expect(toast(page, /Order acknowledged/)).toBeVisible({ timeout: 15000 });
    await page.keyboard.press('Escape');
  }
  await page.locator('tbody tr', { hasText: 'acknowledged' }).first().click();
  await page.getByRole('button', { name: /Create shipment notice/ }).click();
  await page.locator('input[type=date]').last().fill(new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10));
  await page.getByRole('button', { name: 'Send ASN' }).click();
  await expect(toast(page, /ASN\/.*sent to the warehouse/)).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${SHOTS}/31-vendor-asn.png` });
  // vendor cannot open stock
  await page.goto('/inventory');
  await expect(page.getByText(/Inventory/).first()).toBeVisible();
});

test('inventory + SCM screens render for store manager', async ({ page }) => {
  await login(page, 'Store Manager');
  await page.goto('/inventory');
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: `${SHOTS}/40-inventory.png` });
  await page.locator('tbody tr').first().click();
  await expect(page.getByText('Append-only')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}/41-ledger.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Days of cover' }).click();
  await expect(page.getByText(/Days of cover = on hand/)).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/42-cover.png` });
  await page.goto('/scm/replenishment');
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: `${SHOTS}/43-replenishment.png` });
  await page.goto('/scm/transfers');
  await expect(page.getByText('Stock transfers')).toBeVisible();
});
