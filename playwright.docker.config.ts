import { defineConfig, devices } from '@playwright/test';

// Runs the browser suite against the already-running `docker compose` stack
// (web, api, Keycloak, MySQL, MinIO, ClamAV on their compose-published ports)
// instead of Playwright's own Next.js dev server — used for the real-Keycloak
// tests, which need the full backend, not just the frontend shell.
export default defineConfig({
  testDir: './test/browser',
  testMatch: /keycloak-auth\.spec\.ts/,
  globalSetup: './test/browser/docker-global-setup.ts',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:3001', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
