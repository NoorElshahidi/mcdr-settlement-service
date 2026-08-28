import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  fullyParallel: true,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:3001', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm --workspace @mcdr/web run dev',
    url: 'http://localhost:3001',
    // A clean server per run prevents a stale Next dev process from being
    // reused after a previous test run or interrupted local download.
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
