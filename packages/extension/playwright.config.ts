import { defineConfig } from '@playwright/test';

// Run `npm run build` first: the tests load the built extension from .output/chrome-mv3.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
});
