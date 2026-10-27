import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { seedGuestSession, withTestDb } from '../helpers/database';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

test('server-rendered dates hydrate without browser errors', async ({ page }) => {
  await withTestDb(async db => {
    const guest = await seedGuestSession('group-1', db);
    await page.context().addCookies([{ name: 'wedding_guest', value: guest.cookie, url: 'http://127.0.0.1:3200' }]);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/invitation');
    await page.getByRole('link', { name: /skip opening/i }).click();
    await expect(page.locator('[data-event-id]')).toHaveCount(8);
    await page.getByRole('button', { name: 'हिन्दी', exact: true }).click();
    await page.reload();
    await page.getByRole('link', { name: 'खुलने का एनीमेशन छोड़ें' }).click();
    expect(errors).toEqual([]);
  });
});

test('responsive bilingual invitation keeps all authorized content and navigation accessible', async ({ page }) => {
  test.setTimeout(120_000);
  await withTestDb(async db => {
    const guest = await seedGuestSession('group-1', db);
    await page.context().addCookies([{ name: 'wedding_guest', value: guest.cookie, url: 'http://127.0.0.1:3200' }]);
    await page.goto('/invitation');
    await page.getByRole('link', { name: /skip opening/i }).click();
    await expect(page.locator('[data-event-id]')).toHaveCount(8);
    await expect(page.getByTestId('story-copy')).toHaveText("A sample story awaiting the family's approved private content.");
    await expect(page.getByTestId('families-copy')).toContainText('Sample families');
    await expect(page.getByTestId('wedding-date')).toHaveText(/12.*14 February 2030/);
    await expect(page.getByRole('link', { name: 'Call', exact: true })).toHaveAttribute('href', 'tel:+12025550123');
    await expect(page.getByRole('link', { name: 'WhatsApp', exact: true })).toHaveAttribute('href', 'https://wa.me/12025550123');
    await expect(page.getByRole('link', { name: 'Open map', exact: true })).toHaveAttribute('href', 'https://example.com/sample-venue');
    await expect(page.getByRole('link', { name: 'Send your response' })).toHaveAttribute('href', '/rsvp');
    await expect(page.locator('audio')).toHaveCount(0);
    await expect(page.getByText('Draft sample description awaiting approval.')).toHaveCount(0);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const locale of ['en', 'hi']) {
        await page.getByRole('button', { name: locale === 'en' ? 'English' : 'हिन्दी', exact: true }).click();
        for (const section of ['welcome', 'families', 'story', 'celebrations', 'venue']) {
          await page.locator(`nav[aria-label] a[href="#${section}"]`).click();
          await expect(page.locator(`#${section}`)).toBeInViewport();
        }
        for (const link of await page.locator('[data-day-navigation] a').all()) { await link.click(); }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
    await page.getByRole('link', { name: 'खुलने का एनीमेशन छोड़ें' }).click();
    await page.getByRole('button', { name: 'फिर से खोलें' }).click();
    await page.getByRole('button', { name: 'निमंत्रण खोलें' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('opening-scene')).toHaveCount(0, { timeout: 3200 });
  });
});

test('reduced motion and failed artwork cannot block group-filtered content', async ({ page }) => {
  await withTestDb(async db => {
    const guest = await seedGuestSession('group-2', db);
    await page.context().addCookies([{ name: 'wedding_guest', value: guest.cookie, url: 'http://127.0.0.1:3200' }]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/art/**', route => route.abort());
    await page.goto('/invitation');
    await expect(page.getByRole('button', { name: 'Open invitation' })).toHaveCount(0);
    await expect(page.locator('[data-event-id]')).toHaveCount(6);
    const html = await (await page.request.get('/invitation')).text();
    expect(html).not.toContain('mehendi'); expect(html).not.toContain('closing-dinner');
    await page.getByRole('button', { name: 'Replay opening' }).click();
    await expect(page.getByRole('button', { name: 'Open invitation' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Call', exact: true })).toBeEnabled();
  });
});
