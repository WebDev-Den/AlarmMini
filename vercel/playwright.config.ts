import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 2,
  timeout: 45000,
  use: {
    baseURL: process.env.TEST_BASE_URL || 'http://127.0.0.1:3000',
    channel: process.env.CI ? 'chromium' : 'msedge',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
