import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

// Exercises real Keycloak browser authentication end to end — the standard
// flow/PKCE redirect against the actual `mcdr` realm, not a mocked guard.
// Requires the full stack: `docker compose up --build -d`. Run with
// `npx playwright test -c playwright.docker.config.ts`.

const API = 'http://localhost:3000/api/v1';
const OWNER = { username: 'owner@example.test', password: 'OwnerPassword123!' };
const BACKOFFICE = { username: 'backoffice@example.test', password: 'BackofficePassword123!' };
const PDF_FIXTURE = path.join(__dirname, 'fixtures', 'minutes.pdf');

test.beforeAll(async () => {
  const reachable = await fetch(`${API}/health`)
    .then((response) => response.ok)
    .catch(() => false);
  test.skip(
    !reachable,
    `Backend is not reachable at ${API} — run "docker compose up --build -d" first.`,
  );
});

async function loginViaKeycloak(
  page: Page,
  portalPath: string,
  creds: { username: string; password: string },
) {
  await page.goto(portalPath, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/realms\/mcdr\/protocol\/openid-connect\/auth/);
  await page.locator('#username').fill(creds.username);
  await page.locator('#password').fill(creds.password);
  await page.locator('#kc-login').click();
  await expect(page.getByText('Connected securely.')).toBeVisible({ timeout: 15_000 });
}

test.describe('real Keycloak authentication', () => {
  test('owner logs in through the browser, reaches the workspace, and survives a reload', async ({
    page,
  }) => {
    await loginViaKeycloak(page, '/owner', OWNER);
    await expect(page.getByRole('heading', { name: 'Owner workspace' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();

    // Regression guard: a previously-fixed bug bounced an authenticated session
    // back through the Keycloak login page on every reload instead of resuming
    // silently via check-sso. A reload must stay on /owner, never redirect out.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Connected securely.')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/owner/);
  });

  test('backoffice logs in through the browser and reaches the review desk', async ({ page }) => {
    await loginViaKeycloak(page, '/backoffice', BACKOFFICE);
    await expect(page.getByRole('heading', { name: 'Review desk' })).toBeVisible();
  });

  test('wrong password is rejected by Keycloak and the app stays signed out', async ({ page }) => {
    await page.goto('/owner', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/realms\/mcdr\/protocol\/openid-connect\/auth/);
    await page.locator('#username').fill(OWNER.username);
    await page.locator('#password').fill('WrongPassword!');
    await page.locator('#kc-login').click();
    await expect(page.getByText('Invalid username or password.')).toBeVisible();
    // Still on Keycloak (login-actions/authenticate after a failed attempt,
    // not the original /auth URL) — never bounced back into the app.
    await expect(page).toHaveURL(/localhost:8080\/realms\/mcdr\//);
  });

  test('an owner token cannot perform backoffice actions (role guard, not a redirect loop)', async ({
    page,
  }) => {
    await loginViaKeycloak(page, '/backoffice', OWNER);
    await page.getByRole('button', { name: 'Refresh workspace' }).click();
    await expect(page.getByText('Could not load requests.')).toBeVisible();
    // Confirms the server-side role guard rejected the call — the page must
    // stay put, not bounce back into a login redirect loop.
    await expect(page.getByRole('heading', { name: 'Review desk' })).toBeVisible();
    await expect(page).toHaveURL(/\/backoffice/);
  });

  test('a backoffice token cannot perform owner actions', async ({ page }) => {
    await loginViaKeycloak(page, '/owner', BACKOFFICE);
    await page.getByLabel('Commercial Registration Number').fill('CRN-DEMO-001');
    await page.getByRole('button', { name: 'Check status' }).click();
    await expect(page.getByText('Eligibility lookup failed.')).toBeVisible();
  });
});

test.describe('end-to-end settlement workflow with real auth', () => {
  test('owner submits, backoffice reviews and settles, owner pays', async ({ browser }) => {
    const ownerContext = await browser.newContext();
    const backofficeContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const backofficePage = await backofficeContext.newPage();

    await test.step('owner checks CRN eligibility', async () => {
      await loginViaKeycloak(ownerPage, '/owner', OWNER);
      await ownerPage.getByLabel('Commercial Registration Number').fill('CRN-DEMO-001');
      await ownerPage.getByRole('button', { name: 'Check status' }).click();
      await expect(ownerPage.getByText('Settlement is required.')).toBeVisible();
    });

    await test.step('owner uploads an attachment and submits a request', async () => {
      await ownerPage.locator('#meetingAt-0').fill('2020-01-01T10:00');
      await ownerPage.locator('#capital-0').fill('100000');
      await ownerPage.locator('#attachment-0').setInputFiles(PDF_FIXTURE);
      await expect(ownerPage.getByText('Attachment scanned and approved.')).toBeVisible({
        timeout: 15_000,
      });
      await ownerPage.getByRole('button', { name: 'Submit request' }).click();
      // The success message is immediately followed by an auto-refresh that
      // overwrites it ("Live data refreshed."), so assert the end state (the
      // row landing in the list as UNDER REVIEW) instead of the transient text.
      await expect(ownerPage.locator('.row').first()).toContainText('UNDER REVIEW', {
        timeout: 15_000,
      });
    });

    await test.step('backoffice opens the queue and sets a fee', async () => {
      await loginViaKeycloak(backofficePage, '/backoffice', BACKOFFICE);
      await backofficePage.getByRole('button', { name: 'Refresh workspace' }).click();
      await backofficePage.locator('.row').first().getByRole('button', { name: 'Open' }).click();
      await backofficePage.locator('#fee').fill('250');
      await backofficePage.getByRole('button', { name: 'Save fees' }).click();
      await expect(backofficePage.getByText('Fees saved.')).toBeVisible();
    });

    await test.step('backoffice approves the request', async () => {
      await backofficePage.getByRole('button', { name: 'Approve' }).click();
      // Same transient-message-vs-auto-refresh race as submit: assert the row's
      // end state, not the toast that the immediately-following refresh overwrites.
      await backofficePage.getByRole('button', { name: 'Refresh workspace' }).click();
      await expect(backofficePage.locator('.row').first()).toContainText('AWAITING PAYMENT', {
        timeout: 15_000,
      });
    });

    await test.step('owner pays the awaiting-payment request', async () => {
      await ownerPage.getByRole('button', { name: 'Refresh workspace' }).click();
      await expect(ownerPage.locator('.row').first()).toContainText('AWAITING PAYMENT');
      await ownerPage.locator('.row').first().getByRole('button', { name: 'Pay' }).click();
      await ownerPage.getByRole('button', { name: 'Refresh workspace' }).click();
      await expect(ownerPage.locator('.row').first()).toContainText('PAID', { timeout: 15_000 });
    });

    await test.step('backoffice uploads the settlement document, closing the meeting out', async () => {
      await backofficePage.getByRole('button', { name: 'Refresh workspace' }).click();
      await backofficePage.locator('.row').first().getByRole('button', { name: 'Open' }).click();
      await backofficePage.locator('input[type="file"]').first().setInputFiles(PDF_FIXTURE);
      await expect(backofficePage.getByText('Settlement document uploaded.')).toBeVisible({
        timeout: 15_000,
      });
    });

    await ownerContext.close();
    await backofficeContext.close();
  });
});
