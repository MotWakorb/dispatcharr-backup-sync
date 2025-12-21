import { test, expect, selectors, waitForJobCompletion } from './fixtures';

test.describe('Backup and Restore Workflow', () => {
  test.describe('Backup (Export)', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await page.locator(selectors.tabs.backup).click();
      await page.waitForTimeout(500);
    });

    test('should display backup options', async ({ page }) => {
      // Check for backup/export content
      await expect(
        page.locator('text=Backup, text=Export, h2:has-text("Backup"), h2:has-text("Export")').first()
      ).toBeVisible();
    });

    test('should show connection selection', async ({ page }) => {
      // There should be some form of connection/source selection
      const selectionElement = page.locator(
        'select, [class*="select"], [class*="dropdown"], input[type="radio"]'
      ).first();

      await expect(selectionElement).toBeVisible();
    });

    test('should have backup/export button', async ({ page }) => {
      const backupButton = page.locator(
        'button:has-text("Backup"), button:has-text("Export"), button:has-text("Start")'
      ).first();

      await expect(backupButton).toBeVisible();
    });

    test('should show options for backup', async ({ page }) => {
      // Look for checkboxes or options
      const options = page.locator(
        'input[type="checkbox"], [class*="option"], [class*="toggle"]'
      );

      // There should be at least some options available
      const count = await options.count();
      expect(count).toBeGreaterThan(0);
    });
  });

  test.describe('Restore (Import)', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await page.locator(selectors.tabs.restore).click();
      await page.waitForTimeout(500);
    });

    test('should display restore options', async ({ page }) => {
      // Check for restore/import content
      await expect(
        page.locator('text=Restore, text=Import, h2:has-text("Restore"), h2:has-text("Import")').first()
      ).toBeVisible();
    });

    test('should have file upload area', async ({ page }) => {
      // Look for file input or drop zone
      const uploadArea = page.locator(
        'input[type="file"], [class*="upload"], [class*="drop"], [class*="dropzone"]'
      ).first();

      await expect(uploadArea).toBeVisible();
    });

    test('should show restore button after file selection', async ({ page }) => {
      // The restore button might be disabled until a file is selected
      const restoreButton = page.locator(
        'button:has-text("Restore"), button:has-text("Import"), button:has-text("Start")'
      ).first();

      await expect(restoreButton).toBeVisible();
    });
  });
});
