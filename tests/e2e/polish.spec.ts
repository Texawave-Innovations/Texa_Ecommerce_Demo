import { test, expect, type Page } from '@playwright/test';

/** S10 visual QA: 12 main screens at 1440 and 768 (light), 1440 dark, role landings and demo controls. Needs `pnpm demo` + `pnpm twin:sim`. */
const OUT = process.env.SHOTS_DIR ?? 'shots/polish';
const SCREENS: [string, string][] = [
  ['login', '/login'], ['dashboard', '/dashboard'], ['master-skus', '/master/skus'], ['scm', '/scm'], ['inventory', '/inventory'], ['oms', '/oms'],
  ['finance', '/finance'], ['recon', '/finance/recon'], ['hr', '/hr'], ['projections', '/projections'], ['twin', '/twin'], ['demo-controls', '/admin/demo'],
];
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
}

test('login shows 6 featured roles with mascot avatars', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /Super Admin|CFO|Merchandiser|Warehouse|Store Manager|HR Manager/ })).toHaveCount(6);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/login-1440.png`, fullPage: true });
});

for (const [label, url] of [['CFO', /\/finance$/], ['Merchandiser', /\/scm$/], ['Warehouse', /\/inventory$/], ['Store Manager', /\/oms$/], ['HR Manager', /\/hr$/], ['Super Admin', /\/dashboard$/]] as [string, RegExp][]) {
  test(`role landing: ${label}`, async ({ page }) => {
    await login(page, label);
    await page.waitForURL(url, { timeout: 25000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/landing-${label.replace(/\W/g, '').toLowerCase()}-1440.png` });
  });
}

test('12 screens × 1440 / 768 light, 1440 dark', async ({ page }) => {
  test.setTimeout(600_000);
  await login(page, 'Super Admin');
  await page.waitForURL(/\/dashboard$/, { timeout: 25000 });
  const shoot = async (name: string, url: string, w: number, tag: string) => {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(url);
    await page.waitForTimeout(url === '/twin' ? 5000 : 2800);
    await page.screenshot({ path: `${OUT}/${name}-${w}${tag}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) errors.push(`${url} @${w}${tag}: horizontal overflow ${overflow}px`);
  };
  for (const w of [1440, 768]) for (const [n, u] of SCREENS.slice(1)) await shoot(n, u, w, '');
  await page.evaluate(() => localStorage.setItem('uni-theme', 'dark'));
  for (const [n, u] of SCREENS.slice(1)) await shoot(n, u, 1440, '-dark');
  await page.evaluate(() => localStorage.setItem('uni-theme', 'light'));
});

test('demo controls: critical alert → bell → Ask why; web orders; busy hour', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, 'Super Admin');
  await page.waitForURL(/\/dashboard$/, { timeout: 25000 });
  await page.goto('/admin/demo');
  await page.waitForTimeout(1500);
  const toast = (re: RegExp) => page.locator('[role=status]').getByText(re).first();
  await page.getByRole('button', { name: 'Trigger alert' }).click();
  await expect(toast(/Critical alert sent/)).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Create 5 orders' }).click();
  await expect(toast(/5 Shopify web orders/)).toBeVisible({ timeout: 40000 });
  await page.getByRole('button', { name: 'Start busy hour' }).click();
  await expect(toast(/10 POS sales posted/)).toBeVisible({ timeout: 90000 });
  await page.screenshot({ path: `${OUT}/demo-controls-after.png` });
});
