import { test, expect } from '@playwright/test';
import { seedGuestSession, withTestDb } from '../helpers/database';
import { existsSync } from 'node:fs';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

test('private fragment exchange survives Strict Mode and replaces prior group HTML and history', async ({ page }) => {
  await withTestDb(async db => {
    const one = await seedGuestSession('group-1', db);
    const two = await seedGuestSession('group-2', db);
    const requests: string[] = [];
    const errors: string[] = [];
    page.on('request', request => requests.push(request.url()));
    page.on('console', message => errors.push(message.text()));
    await page.goto('/invitation');
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Private invitation' })).toBeVisible();
    await page.goto(`/invite#${one.code}`);
    await expect(page).toHaveURL('/invitation');
    await expect(page.locator('[data-event-id]')).toHaveCount(8);
    await expect(page.locator('[data-event-id="mehendi"]')).toBeVisible();
    await page.goto(`/invite#${two.code}`);
    await expect(page).toHaveURL('/invitation');
    await expect(page.locator('[data-event-id]')).toHaveCount(6);
    expect(await page.content()).not.toContain('mehendi');
    expect(await page.content()).not.toContain('closing-dinner');
    const html = await (await page.request.get('/invitation')).text();
    expect(html).not.toContain('mehendi'); expect(html).not.toContain('closing-dinner');
    const [bucket] = await db`select count from wedding.abuse_buckets`;
    expect(bucket.count).toBe(2); // An effect replay must not submit a second exchange.
    const cookies = await page.context().cookies();
    const cookie = cookies.find(cookie => cookie.name === 'wedding_guest');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', secure: false });
    for (const code of [one.code, two.code]) {
      expect(requests.every(url => !url.includes(code))).toBe(true);
      expect(errors.join('\n')).not.toContain(code);
    }
    await page.goBack();
    expect(page.url()).not.toContain('#');
    await expect(page.locator('[data-event-id]')).toHaveCount(6);
    expect(await page.content()).not.toContain('mehendi');
    expect(await page.content()).not.toContain('closing-dinner');
    await db`update wedding.guest_sessions set revoked_at=clock_timestamp()`;
    await page.goto('/invitation');
    await expect(page).toHaveURL('/');
  });
});

test('invalid fragment is erased and displays a safe failure without offering group choices', async ({ page }) => {
  await withTestDb(async () => {
    await page.goto('/invite#invalid-code');
    await expect(page).toHaveURL('/invite');
    await expect(page.getByRole('alert').filter({ hasText: 'invitation link' })).toBeVisible();
    await expect(page.getByRole('combobox')).toHaveCount(0);
  });
});

test('Hindi gate and failed link honor a persistent public language choice without private content', async ({ page }) => {
  await page.context().addCookies([{ name: 'locale', value: 'hi', url: 'http://127.0.0.1:3200' }]);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'निजी निमंत्रण' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Private invitation' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Private invitation' })).toBeVisible();
  await page.getByRole('button', { name: 'हिन्दी', exact: true }).click();
  await page.goto('/invite#invalid-code');
  await expect(page).toHaveURL('/invite');
  await expect(page.getByRole('heading', { name: 'निजी निमंत्रण' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('परिवार से नया लिंक माँगें');
  await expect(page.locator('[data-event-id]')).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveCount(0);
  const html = await (await page.request.get('/invite')).text();
  expect(html).not.toContain('Sample celebration');
  expect(html).not.toContain('Sample Couple');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Please ask the family for a current link');
});
