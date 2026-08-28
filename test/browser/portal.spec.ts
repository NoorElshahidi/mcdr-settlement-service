import { expect, test } from '@playwright/test';

test.describe('portal entry points', () => {
  test('home page exposes both role portals', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Owner portal' })).toHaveAttribute(
      'href',
      '/owner',
    );
    await expect(page.getByRole('link', { name: 'Backoffice portal' })).toHaveAttribute(
      'href',
      '/backoffice',
    );
  });

  test('owner and backoffice pages show their protected workspace shell', async ({ page }) => {
    await page.goto('/owner', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Owner workspace' })).toBeVisible({
      timeout: 15_000,
    });

    // Use an independent page so Keycloak's client initialization on the owner
    // portal cannot interfere with the separate backoffice entry point.
    const backofficePage = await page.context().newPage();
    await backofficePage.goto('/backoffice', { waitUntil: 'domcontentloaded' });
    await expect(backofficePage.getByRole('heading', { name: 'Review desk' })).toBeVisible({
      timeout: 15_000,
    });
    await backofficePage.close();
  });
});
