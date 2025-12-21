import { test, expect, selectors } from './fixtures';

test.describe('Connections (Settings)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator(selectors.tabs.settings).click();
    await page.waitForTimeout(500);
  });

  test('should display connections page', async ({ page }) => {
    // Check for settings/connections content
    await expect(
      page.locator('text=Connections, text=Settings, h2:has-text("Connection")').first()
    ).toBeVisible();
  });

  test('should show saved connections list', async ({ page }) => {
    // Wait for connections to load
    await page.waitForTimeout(1000);

    // Either shows connections or "no connections" message
    const hasConnections = await page.locator('.connection-item, [class*="connection"]').count() > 0;
    const hasEmptyState = await page.locator('text=/no.*connection/i').count() > 0;

    expect(hasConnections || hasEmptyState).toBeTruthy();
  });

  test('should have add connection button', async ({ page }) => {
    const addButton = page.locator('button:has-text("Add"), button:has-text("New"), button:has-text("Create")').first();
    await expect(addButton).toBeVisible();
  });
});
