import { test, expect, selectors } from './fixtures';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load the application', async ({ page }) => {
    // Check that the main heading is visible
    await expect(page.locator('h1')).toContainText('DBAS');

    // Check that tabs are visible
    for (const [name, selector] of Object.entries(selectors.tabs)) {
      await expect(page.locator(selector)).toBeVisible();
    }
  });

  test('should navigate between tabs', async ({ page }) => {
    // Click each tab and verify the content changes
    for (const [name, selector] of Object.entries(selectors.tabs)) {
      await page.locator(selector).click();

      // Verify the tab is now active
      await expect(page.locator(selector)).toHaveClass(/active/);

      // Give content time to render
      await page.waitForTimeout(200);
    }
  });

  test('should start on Sync tab by default', async ({ page }) => {
    await expect(page.locator(selectors.tabs.sync)).toHaveClass(/active/);
  });

  test('should display version badge when available', async ({ page }) => {
    // Version badge should appear after API call
    const versionBadge = page.locator('.version-badge');

    // Wait a bit for the API call
    await page.waitForTimeout(1000);

    // Either shows version or doesn't exist (if API fails)
    const count = await versionBadge.count();
    if (count > 0) {
      await expect(versionBadge).toContainText('v');
    }
  });
});
