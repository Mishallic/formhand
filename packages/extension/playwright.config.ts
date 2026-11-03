import { defineConfig } from '@playwright/test';

// Build first: the chromium tests load .output/chrome-mv3, the firefox tests .output/firefox-mv2.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', testIgnore: 'firefox/**' },
    // A real Firefox driven through geckodriver; see e2e/firefox/fixtures.ts.
    { name: 'firefox', testDir: './e2e/firefox' },
  ],
});
