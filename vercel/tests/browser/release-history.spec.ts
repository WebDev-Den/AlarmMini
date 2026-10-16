import { test, expect } from '@playwright/test';

test('shows current changes and historical notes in Ukrainian and English', async ({ page }) => {
  await page.route('**/api/releases', route => route.fulfill({ json: [{
    id: 16, tag_name: 'v2.1.6', name: 'AlarmMini v2.1.6', published_at: '2026-10-16T12:00:00Z',
    body: 'Release notes', assets: [], draft: false, prerelease: false,
  }] }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Що нового у v2.1.6' })).toBeVisible();
  await expect(page.locator('.release-notes')).toContainText('Tryvoha.online');
  await page.locator('.release-history > summary').click();
  await page.locator('.release-entry').filter({ hasText: 'v2.1.5' }).locator('summary').click();
  await expect(page.locator('.release-entry[open]')).toContainText('часового поясу');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('heading', { name: "What's new in v2.1.6" })).toBeVisible();
  await expect(page.locator('.release-entry[open]')).toContainText('Time-zone search');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
