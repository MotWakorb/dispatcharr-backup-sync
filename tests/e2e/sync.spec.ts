import { test, expect, selectors } from './fixtures';

test.describe('Sync Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Sync is the default tab, but click anyway to ensure it's active
    await page.locator(selectors.tabs.sync).click();
    await page.waitForTimeout(500);
  });

  test('should display sync page', async ({ page }) => {
    // Check that sync content is visible
    await expect(
      page.locator('text=Sync, h2:has-text("Sync"), [class*="sync"]').first()
    ).toBeVisible();
  });

  test('should show source and target connection areas', async ({ page }) => {
    // Sync typically has source and target/destination selections
    const areas = page.locator(
      'text=Source, text=Target, text=Destination, text=From, text=To, [class*="source"], [class*="target"]'
    );

    const count = await areas.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('should have sync button', async ({ page }) => {
    const syncButton = page.locator(
      'button:has-text("Sync"), button:has-text("Start Sync"), button:has-text("Begin")'
    ).first();

    await expect(syncButton).toBeVisible();
  });

  test('should show sync options', async ({ page }) => {
    // Look for sync configuration options
    const options = page.locator(
      'input[type="checkbox"], [class*="option"], select, [class*="toggle"]'
    );

    const count = await options.count();
    expect(count).toBeGreaterThan(0);
  });
});
