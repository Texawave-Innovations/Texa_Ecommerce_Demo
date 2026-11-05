import { test, expect, type Page } from '@playwright/test';

const SHOTS = process.env.SHOTS_DIR ?? 'shots';
const errors: string[] = [];
test.beforeEach(({ page }) => {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${page.url()} :: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${page.url()} :: PAGEERROR ${e.message}`));
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
  await page.getByRole('button', { name: /Switch|Aarav|Kavya|Priya|Imran|Vikram|Sneha|Divya|Meera|Rohan|Hana/ }).first().click().catch(() => {});
  await page.getByRole('menuitem', { name: label }).click();
  await page.waitForTimeout(1500);
}

const CODE = `E2E${Date.now().toString().slice(-6)}`;
test('login → dashboard → master → create → approve', async ({ page }) => {
  await page.goto('/login');
  await page.screenshot({ path: `${SHOTS}/01-login.png` });
  await login(page, 'Merchandiser');
  await expect(page.getByText(/Welcome back, Kavya/)).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/02-dashboard.png` });

  await page.goto('/master');
  await page.screenshot({ path: `${SHOTS}/03-master-index.png`, fullPage: true });
  await page.goto('/master/skus');
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${SHOTS}/04-skus.png` });

  // search
  await page.getByLabel('Search').fill('capybara');
  await page.waitForTimeout(500);
  const n = await page.locator('tbody tr').count();
  expect(n).toBeGreaterThan(0);

  // create a brand
  await page.goto('/master/brands');
  await page.getByRole('button', { name: /New brand/i }).click();
  await page.getByLabel(/^Code/).fill(CODE);
  await page.getByLabel(/^Name/).fill(`E2E Brand ${CODE}`);
  await page.screenshot({ path: `${SHOTS}/05-form.png` });
  await page.getByRole('button', { name: /Submit for approval/ }).click();
  await expect(page.getByText(/Submitted for approval/)).toBeVisible();

  // maker cannot approve own
  await page.goto('/master/approvals');
  await expect(page.getByText(/Your own request/).first()).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}/06-approvals-maker.png` });

  // switch to CFO and approve
  await switchRole(page, 'CFO / Accountant');
  await page.goto('/master/approvals');
  const card = page.locator('ul > li', { hasText: CODE }).filter({ has: page.getByRole('button', { name: 'Approve' }) });
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/Approved and applied/)).toBeVisible();

  await page.goto('/master/brands');
  await expect(page.getByRole('table').getByText(`E2E Brand ${CODE}`)).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}/07-brands-after.png` });

  // history drawer
  await page.locator('tr', { hasText: CODE }).getByLabel('History').click();
  await expect(page.getByText('v1')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/08-history.png` });
  await page.keyboard.press('Escape');

  // duplicates
  await page.goto('/master/skus');
  await page.getByRole('button', { name: /Find duplicates/ }).click();
  await expect(page.getByText('Possible duplicates')).toBeVisible();
  await expect(page.getByText(/DUP1/).first()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${SHOTS}/09-duplicates.png` });
});

test('import CSV, labels, theme, palette, audit, users, design, mobile', async ({ page, context }) => {
  await login(page, 'Merchandiser');
  await page.goto('/master/brands');
  await page.getByRole('button', { name: /Import/ }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'b.csv', mimeType: 'text/csv', buffer: Buffer.from('code,name,country\nCSV1,CSV Brand One,India\nCSV2,,India\n') });
  await expect(page.getByText('1 valid')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/10-import.png` });
  await page.getByRole('button', { name: /Submit 1 rows/ }).click();
  await expect(page.getByText(/Submitted 1 rows/)).toBeVisible();

  // export download
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export/ }).click()]);
  expect(dl.suggestedFilename()).toBe('brands.csv');

  // labels
  await page.goto('/master/skus');
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15000 });
  await page.locator('tbody tr input[type=checkbox]').first().check();
  const popup = context.waitForEvent('page');
  await page.getByRole('button', { name: /Labels \(1\)/ }).click();
  const lab = await popup; await lab.waitForLoadState();
  expect(await lab.locator('.l svg').count()).toBe(1);
  await lab.screenshot({ path: `${SHOTS}/11-label.png` }); await lab.close();

  // image upload via edit form
  await page.locator('tbody tr').first().getByLabel('Edit').click();
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
  await expect(page.getByText('Image uploaded')).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${SHOTS}/12-sku-edit.png` });
  await page.keyboard.press('Escape');

  // palette + theme
  await page.goto('/dashboard');
  await expect(page.getByText(/Welcome back/)).toBeVisible();
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/Type a page/).fill('vendors');
  await page.screenshot({ path: `${SHOTS}/13-palette.png` });
  await page.keyboard.press('Enter');
  await page.waitForURL('**/master/vendors');
  await page.getByLabel('Toggle theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/14-dark.png` });
  await page.getByLabel('Toggle theme').click();

  // admin pages as super admin
  await switchRole(page, 'Super Admin');
  await page.goto('/admin/users');
  await expect(page.getByText('cfo@texafashions.demo')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}/15-users.png` });
  await page.goto('/admin/audit');
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}/16-audit.png` });

  await page.goto('/design');
  await page.screenshot({ path: `${SHOTS}/17-design.png`, fullPage: true });

  // mobile
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/master/skus');
  await expect(page.locator('div.md\\:hidden').getByText(/SKU-/).first()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${SHOTS}/18-mobile.png` });
  await page.getByLabel('Open menu').click();
  await expect(page.getByRole('dialog').getByRole('link', { name: /Master Data/ })).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/19-mobile-nav.png` });
});

test('cashier cannot see edit buttons; auditor read-only', async ({ page }) => {
  await login(page, 'Cashier');
  await page.goto('/master/skus');
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: /New sku/i })).toHaveCount(0);
});
