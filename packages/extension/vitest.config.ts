import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    name: 'extension',
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    mockReset: true,
    restoreMocks: true,
  },
});
