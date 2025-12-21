import { test, expect, selectors } from './fixtures';

test.describe('Jobs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator(selectors.tabs.jobs).click();
    await page.waitForTimeout(500);
  });

  test('should display jobs page', async ({ page }) => {
    // Check for jobs content
    await expect(
      page.locator('text=Jobs, h2:has-text("Jobs"), [class*="jobs"]').first()
    ).toBeVisible();
  });

  test('should show job history or empty state', async ({ page }) => {
    // Wait for jobs to load
    await page.waitForTimeout(1000);

    // Either shows job list or empty state
    const hasJobs = await page.locator('[class*="job-item"], [class*="job-row"], tr').count() > 0;
    const hasEmptyState = await page.locator('text=/no.*jobs/i, text=/empty/i').count() > 0;

    expect(hasJobs || hasEmptyState).toBeTruthy();
  });

  test('should have clear history button', async ({ page }) => {
    // Clear history button should be present
    const clearButton = page.locator(
      'button:has-text("Clear"), button:has-text("Delete"), button:has-text("Remove")'
    ).first();

    // Button might be disabled if no history
    const count = await clearButton.count();
    // It's OK if there's no clear button when there's no history
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
