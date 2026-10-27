import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { seedGuestSession, withTestDb } from '../helpers/database';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const origin = 'http://127.0.0.1:3200';
const proof = process.env.WEDDING_UI_PROOF_DIR ?? 'test-results/ui-polish-proof';
const scene = (page: Page) => page.getByTestId('opening-scene');
const skip = (page: Page) => page.getByRole('link', { name: /Skip opening animation|खुलने का एनीमेशन छोड़ें/ });
async function dimensions(page: Page) { return page.evaluate(() => ({ height: document.documentElement.scrollHeight, y: scrollY, locked: document.body.style.overflow })); }

test('opening real motion, interruption, locale, resize and five fresh replays', async ({ page }) => {
  test.setTimeout(90_000);
  await withTestDb(async db => {
    const guest = await seedGuestSession('group-1', db);
    await page.context().addCookies([{ name: 'wedding_guest', value: guest.cookie, url: origin }]);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/invitation');
    await expect(scene(page)).toHaveAttribute('data-phase', 'closed');
    await expect(page.locator('main').locator('..')).toHaveAttribute('inert', '');
    await page.getByRole('button', { name: 'Open invitation', exact: true }).focus();
    const start = Date.now(); await page.keyboard.press('Enter');
    await expect(scene(page)).toHaveAttribute('data-phase', 'opening');
    await page.evaluate(() => { (window as unknown as { savedScene: Element | null }).savedScene = document.querySelector('[data-testid="opening-scene"]'); });
    await page.getByRole('button', { name: 'हिन्दी', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { savedScene: Element | null }).savedScene === document.querySelector('[data-testid="opening-scene"]'))).toBe(true);
    const before = await dimensions(page);
    await expect(scene(page)).toHaveCount(0, { timeout: 3200 });
    expect(Date.now() - start).toBeLessThan(3200);
    expect(await dimensions(page)).toMatchObject({ height: before.height, y: 0, locked: '' });
    await expect(page.locator('h1')).toBeFocused();
    await expect(page.getByTestId('wedding-date')).toBeInViewport();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    for (let i = 0; i < 5; i++) {
      await page.getByRole('button', { name: 'Replay opening' }).click();
      await expect(scene(page)).toHaveAttribute('data-phase', 'closed');
      expect((await dimensions(page)).y).toBe(0);
      await page.keyboard.press(i % 2 ? 'Space' : 'Enter');
      await expect(scene(page)).toHaveAttribute('data-phase', 'opening');
      if (i === 0) {
        // The keyboard skip must cancel an already running sequence immediately.
        await skip(page).focus();
        const duration = await page.evaluate(() => {
          const start = performance.now();
          return new Promise<number>(resolve => {
            const observer = new MutationObserver(() => { if (!document.querySelector('[data-testid="opening-scene"]')) { observer.disconnect(); resolve(performance.now() - start); } });
            observer.observe(document.body, { childList: true, subtree: true });
            (document.activeElement as HTMLElement).click();
          });
        });
        expect(duration).toBeLessThanOrEqual(100);
      } else if (i === 1) {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await expect(scene(page)).toHaveCount(0);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
      } else if (i === 2) {
        await page.setViewportSize({ width: 410, height: 844 });
      } else if (i === 3) {
        await page.getByRole('link', { name: 'Skip to invitation' }).focus();
        await page.keyboard.press('Enter');
      }
      await expect(scene(page)).toHaveCount(0, { timeout: 3200 });
      expect((await dimensions(page)).locked).toBe('');
      await expect(page.locator('h1')).toBeFocused();
    }
    await page.route('**/art/**', route => route.abort());
    await page.reload();
    await skip(page).click();
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Call', exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
  });
});

test('opening native skip works without JavaScript', async ({ browser }) => {
  await withTestDb(async db => {
    const guest = await seedGuestSession('group-1', db);
    const context = await browser.newContext({ javaScriptEnabled: false });
    await context.addCookies([{ name: 'wedding_guest', value: guest.cookie, url: origin }]);
    const page = await context.newPage();
    await page.goto(`${origin}/invitation`);
    await skip(page).click();
    await expect(page).toHaveURL(/opened=1#welcome/);
    await expect(scene(page)).toHaveCount(0);
    await expect(page.locator('h1')).toBeVisible();
    await context.close();
  });
});

test('opening integrated synthetic scene proof at phone and desktop', async ({ browser }, info) => {
  test.setTimeout(120_000);
  await withTestDb(async db => {
    // Synthetic shareable proof stays in the guarded test DB and protected route.
    await db`update wedding.website_content set couple=jsonb_set(couple,'{displayName}', '{"en":"Mira & Arjun","hi":"मीरा और अर्जुन"}'), welcome='{"en":"With love, we look forward to celebrating together.","hi":"आपके साथ इस खुशी को बाँटने की प्रतीक्षा है।"}'`;
    const guest = await seedGuestSession('group-1', db);
    const results = [];
    for (const width of [390, 1440]) {
      const height = width === 390 ? 844 : 1000;
      for (const speed of [1]) {
        const dir = `${proof}/${info.project.name}/${width}/${speed === 1 ? 'normal' : 'quarter'}`;
        await mkdir(dir, { recursive: true });
        const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'no-preference', recordVideo: { dir, size: { width, height } } });
        await context.addCookies([{ name: 'wedding_guest', value: guest.cookie, url: origin }]);
        const page = await context.newPage();
        await page.goto(`${origin}/invitation`);
        await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>('[data-testid="opening-scene"] img'), image => image.decode().catch(() => {}))); });
        await expect(scene(page)).toHaveAttribute('data-phase', 'closed');
        await page.screenshot({ path: `${dir}/closed.png` });
        const before = await dimensions(page);
        await page.getByRole('button', { name: 'Open invitation', exact: true }).click();
        // Sample rendered boxes and transforms throughout this actual run.
        await page.evaluate(() => {
          const evidence = { poses: [] as Record<string, unknown>[], frameTimes: [] as number[] };
          (window as unknown as { openingEvidence: typeof evidence }).openingEvidence = evidence;
          const started = performance.now(); let last = started; let sampled = -100;
          function frame(now: number) {
            if (!document.querySelector('[data-testid="opening-scene"]')) return;
            evidence.frameTimes.push(now - last); last = now;
            if (now - started - sampled >= 90) {
              sampled = now - started;
              evidence.poses.push({ elapsed: sampled, ...Object.fromEntries(['camera','letter','fold','envelope-body','cover-print'].map(key => {
                const el = document.querySelector(`[data-${key}]`)!; const style = getComputedStyle(el);
                return [key, { transform: style.transform, opacity: Number(style.opacity), rect: el.getBoundingClientRect().toJSON() }];
              })) });
            }
            requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        });
        await page.waitForTimeout(1250);
        await expect(scene(page)).toHaveCount(1);
        await page.screenshot({ path: `${dir}/midpoint.png` });
        await expect(scene(page)).toHaveCount(0, { timeout: 12_000 });
        await page.waitForTimeout(550);
        const evidence = await page.evaluate(() => (window as unknown as { openingEvidence: { poses: Array<{ elapsed: number; [key: string]: unknown }>; frameTimes: number[] } }).openingEvidence);
        await writeFile(`${dir}/poses.json`, JSON.stringify(evidence, null, 2));
        // Visible cover print clears before the flap can sweep into its region.
        for (const pose of evidence.poses) {
          const print = pose['cover-print'] as { opacity: number; rect: { bottom: number } };
          const fold = pose.fold as { rect: { top: number } };
          if (print.opacity > .05) expect(fold.rect.top).toBeGreaterThan(print.rect.bottom);
        }
        const filled = evidence.poses.find(pose => pose.elapsed >= 2280);
        expect(filled).toBeDefined();
        const filledLetter = filled!.letter as { rect: { top: number; left: number; right: number; bottom: number } };
        expect(filledLetter.rect.left).toBeLessThanOrEqual(0);
        expect(filledLetter.rect.top).toBeLessThanOrEqual(0);
        expect(filledLetter.rect.right).toBeGreaterThanOrEqual(width);
        expect(filledLetter.rect.bottom).toBeGreaterThanOrEqual(height);
        await page.screenshot({ path: `${dir}/settled.png` });
        await expect(page.locator('h1')).toHaveText('Mira & Arjun');
        await expect(page.getByTestId('wedding-date')).toBeInViewport();
        const after = await dimensions(page);
        expect(after).toMatchObject({ y: before.y, height: before.height, locked: '' });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        results.push({ width, height, speed, before, after, browser: browser.version(), engine: info.project.name });
        await context.close();
      }
    }
    await writeFile(`${proof}/${info.project.name}/measurements.json`, JSON.stringify(results, null, 2));
  });
});

test('opening responsive closed layout fits short screens and wrapped names', async ({ page }, info) => {
  test.setTimeout(90_000);
  await withTestDb(async db => {
    await db`update wedding.website_content set couple=jsonb_set(couple,'{displayName,en}', '"Alexandra Rose & Christopher James"')`;
    const guest = await seedGuestSession('group-1', db);
    await page.context().addCookies([{ name: 'wedding_guest', value: guest.cookie, url: origin }]);
    const dir = `${proof}/${info.project.name}/responsive`;
    await mkdir(dir, { recursive: true });
    const evidence = [];
    for (const [width, height] of [[1512, 744], [1440, 720], [320, 844], [390, 844], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await page.goto('/invitation');
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      await expect(scene(page)).toHaveAttribute('data-phase', 'closed');
      const boxes = await page.evaluate(() => {
        const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON();
        return { print: rect('[data-cover-print]'), sprig: rect('[data-still-life]'), envelope: rect('[data-envelope]'), label: rect('[data-open-label]'), skip: rect('[data-testid="opening-scene"] a'), open: rect('[data-testid="opening-scene"] button') };
      });
      expect(boxes.label.bottom).toBeLessThanOrEqual(boxes.skip.top - 8);
      expect(boxes.open.height).toBeGreaterThanOrEqual(44);
      expect(boxes.skip.height).toBeGreaterThanOrEqual(44);
      expect(boxes.label.bottom).toBeLessThanOrEqual(height);
      expect(boxes.envelope.left).toBeGreaterThanOrEqual(0);
      expect(boxes.envelope.right).toBeLessThanOrEqual(width);
      if (height <= 550 && width >= 600) expect(boxes.print.right).toBeLessThan(boxes.envelope.left);
      else {
        expect(boxes.print.bottom + 16).toBeLessThanOrEqual(boxes.envelope.top);
        expect(boxes.sprig.top).toBeGreaterThanOrEqual(boxes.print.bottom);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${dir}/closed-${width}x${height}-long-names.png` });
      evidence.push({ width, height, boxes });
      // Each actual fitted layout also supplies the camera geometry on activation.
      await page.getByRole('button', { name: 'Open invitation', exact: true }).click();
      await expect(scene(page)).toHaveCount(0, { timeout: 3200 });
      await expect(page.locator('h1')).toBeFocused();
    }
    await writeFile(`${dir}/geometry.json`, JSON.stringify(evidence, null, 2));
  });
});
