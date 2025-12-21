import { test, expect, selectors } from './fixtures';

test.describe('Schedules', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator(selectors.tabs.schedules).click();
    await page.waitForTimeout(500);
  });

  test('should display schedules page', async ({ page }) => {
    // Check for schedules content
    await expect(
      page.locator('text=Schedules, h2:has-text("Schedule"), [class*="schedule"]').first()
    ).toBeVisible();
  });

  test('should have create schedule button', async ({ page }) => {
    const createButton = page.locator(
      'button:has-text("Create"), button:has-text("Add"), button:has-text("New")'
    ).first();

    await expect(createButton).toBeVisible();
  });

  test('should show schedule list or empty state', async ({ page }) => {
    // Wait for schedules to load
    await page.waitForTimeout(1000);

    // Either shows schedule list or empty state
    const hasSchedules = await page.locator(
      '[class*="schedule-item"], [class*="schedule-row"], table tbody tr'
    ).count() > 0;
    const hasEmptyState = await page.locator('text=/no.*schedules/i').count() > 0;

    expect(hasSchedules || hasEmptyState).toBeTruthy();
  });
});
