import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', timeout: 90_000, workers: 1, reporter: 'list',
  use: { baseURL: 'http://localhost:3100', viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
});
