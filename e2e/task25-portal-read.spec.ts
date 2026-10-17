/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file (Playwright is not a repo dependency; env-driven) */
// QA Task 25 (AC-83, AC-84, AC-90): the single timed portal read on a phone, es.
// LIVE: this sends one real message and costs one AI read (R-94). It is skipped unless QA_LIVE=1.
// Needs QA_URL (portal slug URL), QA_FILE, and optionally QA_OUT (default .wrangler/qa-out, gitignored).
import { createRequire } from 'node:module';
const { test, expect } = createRequire(import.meta.url)('/opt/node22/lib/node_modules/playwright/test');
import fs from 'node:fs';

const URL = process.env.QA_URL!;
const FILE = process.env.QA_FILE!;
const OUT = process.env.QA_OUT ?? '.wrangler/qa-out';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
test.skip(process.env.QA_LIVE !== '1', 'live portal read: set QA_LIVE=1');

test('portal phone run: open -> reply under 60 s', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  await page.goto(URL);
  await expect(page.locator('h1')).toBeVisible();
  const tOpen = Date.now() - t0;
  await page.screenshot({ path: `${OUT}/portal-es-open.png` });
  // geometry
  const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
  const attach = await box('button.attach'), send = await box('button.primary'), ta = await box('textarea');
  const fs16 = await page.locator('textarea').evaluate((e: any) => getComputedStyle(e).fontSize);
  console.log('GEOM', JSON.stringify({ attach, send, ta, fontSize: fs16, viewportH: 844 }));
  await page.locator('input[type=file]').setInputFiles(FILE);
  await page.screenshot({ path: `${OUT}/portal-es-file.png` });
  const tClick = Date.now();
  await page.locator('button.primary').click();
  await page.getByText('Recibido; estoy leyendo tu factura…').waitFor({ timeout: 3000 });
  console.log('RECEIVED_BUBBLE_MS', Date.now() - tClick);
  await page.screenshot({ path: `${OUT}/portal-es-pending.png` });
  await page.locator('a[href*="/estado/"]').waitFor({ timeout: 90000 });
  const tEnd = Date.now();
  console.log('OPEN_TO_REPLY_MS', tEnd - t0, 'OPEN_MS', tOpen, 'CLICK_TO_REPLY_MS', tEnd - tClick);
  const href = await page.locator('a[href*="/estado/"]').first().getAttribute('href');
  fs.writeFileSync(`${OUT}/status-link.txt`, href!);
  console.log('REPLY_TEXT_ES', JSON.stringify(await page.locator('ol.log').innerText()));
  await page.screenshot({ path: `${OUT}/portal-es-reply.png` });
  await page.getByRole('button', { name: 'EN' }).click();
  console.log('REPLY_TEXT_EN', JSON.stringify(await page.locator('ol.log').innerText()));
  await page.screenshot({ path: `${OUT}/portal-en-reply.png` });
});
