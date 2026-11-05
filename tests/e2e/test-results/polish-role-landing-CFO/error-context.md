# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: polish.spec.ts >> role landing: CFO
- Location: polish.spec.ts:31:3

# Error details

```
TimeoutError: page.waitForURL: Timeout 25000ms exceeded.
=========================== logs ===========================
waiting for navigation until "load"
============================================================
```

# Test source

```ts
  1  | import { test, expect, type Page } from '@playwright/test';
  2  | 
  3  | /** S10 visual QA: 12 main screens at 1440 and 768 (light), 1440 dark, role landings and demo controls. Needs `pnpm demo` + `pnpm twin:sim`. */
  4  | const OUT = process.env.SHOTS_DIR ?? 'shots/polish';
  5  | const SCREENS: [string, string][] = [
  6  |   ['login', '/login'], ['dashboard', '/dashboard'], ['master-skus', '/master/skus'], ['scm', '/scm'], ['inventory', '/inventory'], ['oms', '/oms'],
  7  |   ['finance', '/finance'], ['recon', '/finance/recon'], ['hr', '/hr'], ['projections', '/projections'], ['twin', '/twin'], ['demo-controls', '/admin/demo'],
  8  | ];
  9  | const errors: string[] = [];
  10 | test.beforeEach(({ page }) => {
  11 |   page.on('pageerror', (e) => errors.push(`${page.url()} :: ${e.message}`));
  12 |   page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`${page.url()} :: ${m.text().slice(0, 200)}`); });
  13 | });
  14 | test.afterAll(() => { console.log('CONSOLE ERRORS:\n' + (errors.join('\n') || 'none')); });
  15 | 
  16 | async function login(page: Page, label: string) {
  17 |   await page.goto('/login');
  18 |   const more = page.getByRole('button', { name: /^More roles/ });
  19 |   if (await more.count()) await more.click();
  20 |   await page.getByRole('button', { name: new RegExp(label) }).click();
  21 | }
  22 | 
  23 | test('login shows 6 featured roles with mascot avatars', async ({ page }) => {
  24 |   await page.goto('/login');
  25 |   await expect(page.getByRole('button', { name: /Super Admin|CFO|Merchandiser|Warehouse|Store Manager|HR Manager/ })).toHaveCount(6);
  26 |   await page.waitForTimeout(800);
  27 |   await page.screenshot({ path: `${OUT}/login-1440.png`, fullPage: true });
  28 | });
  29 | 
  30 | for (const [label, url] of [['CFO', /\/finance$/], ['Merchandiser', /\/scm$/], ['Warehouse', /\/inventory$/], ['Store Manager', /\/oms$/], ['HR Manager', /\/hr$/], ['Super Admin', /\/dashboard$/]] as [string, RegExp][]) {
  31 |   test(`role landing: ${label}`, async ({ page }) => {
  32 |     await login(page, label);
> 33 |     await page.waitForURL(url, { timeout: 25000 });
     |                ^ TimeoutError: page.waitForURL: Timeout 25000ms exceeded.
  34 |     await page.waitForTimeout(2500);
  35 |     await page.screenshot({ path: `${OUT}/landing-${label.replace(/\W/g, '').toLowerCase()}-1440.png` });
  36 |   });
  37 | }
  38 | 
  39 | test('12 screens × 1440 / 768 light, 1440 dark', async ({ page }) => {
  40 |   test.setTimeout(600_000);
  41 |   await login(page, 'Super Admin');
  42 |   await page.waitForURL(/\/dashboard$/, { timeout: 25000 });
  43 |   const shoot = async (name: string, url: string, w: number, tag: string) => {
  44 |     await page.setViewportSize({ width: w, height: 900 });
  45 |     await page.goto(url);
  46 |     await page.waitForTimeout(url === '/twin' ? 5000 : 2800);
  47 |     await page.screenshot({ path: `${OUT}/${name}-${w}${tag}.png`, fullPage: true });
  48 |     const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  49 |     if (overflow > 1) errors.push(`${url} @${w}${tag}: horizontal overflow ${overflow}px`);
  50 |   };
  51 |   for (const w of [1440, 768]) for (const [n, u] of SCREENS.slice(1)) await shoot(n, u, w, '');
  52 |   await page.evaluate(() => localStorage.setItem('uni-theme', 'dark'));
  53 |   for (const [n, u] of SCREENS.slice(1)) await shoot(n, u, 1440, '-dark');
  54 |   await page.evaluate(() => localStorage.setItem('uni-theme', 'light'));
  55 | });
  56 | 
  57 | test('demo controls: critical alert → bell → Ask why; web orders; busy hour', async ({ page }) => {
  58 |   test.setTimeout(180_000);
  59 |   await login(page, 'Super Admin');
  60 |   await page.waitForURL(/\/dashboard$/, { timeout: 25000 });
  61 |   await page.goto('/admin/demo');
  62 |   await page.waitForTimeout(1500);
  63 |   const toast = (re: RegExp) => page.locator('[role=status]').getByText(re).first();
  64 |   await page.getByRole('button', { name: 'Trigger alert' }).click();
  65 |   await expect(toast(/Critical alert sent/)).toBeVisible({ timeout: 20000 });
  66 |   await page.getByRole('button', { name: 'Create 5 orders' }).click();
  67 |   await expect(toast(/5 Shopify web orders/)).toBeVisible({ timeout: 40000 });
  68 |   await page.getByRole('button', { name: 'Start busy hour' }).click();
  69 |   await expect(toast(/10 POS sales posted/)).toBeVisible({ timeout: 90000 });
  70 |   await page.screenshot({ path: `${OUT}/demo-controls-after.png` });
  71 | });
  72 | 
```