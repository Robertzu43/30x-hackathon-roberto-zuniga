/* eslint-disable @typescript-eslint/no-explicit-any -- QA probe (Playwright is not a repo dependency) */
import { createRequire } from 'node:module';
const { test } = createRequire(import.meta.url)('/opt/node22/lib/node_modules/playwright/test');
const URL = process.env.QA_URL!;
test.skip(process.env.QA_LIVE !== '1', 'set QA_LIVE=1');
test('probe: text on screen 300 ms after click, first visit (delayed API) vs second visit (delayed API)', async ({ browser }: any) => {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`${URL}/demo`);
  await page.getByRole('button', { name: 'Entrar como Andina Labs' }).click();
  const d = page.getByRole('dialog'); await d.waitFor({ timeout: 20000 }); await d.getByRole('button', { name: 'Saltar' }).click();
  await page.locator('.inbox-list li').first().waitFor();
  await page.route('**/api/screen/**', async (route: any) => { await new Promise((r) => setTimeout(r, 3000)); await route.continue(); });
  for (const [n, re] of [['Periodo', /^Periodo$/], ['Política', /^Política$/]] as const) {
    for (const visit of [1, 2]) {
      await page.getByRole('link', { name: re }).first().click();
      await page.waitForTimeout(400);
      const txt = (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 260);
      const sk = await page.locator('[class*=skeleton], [aria-busy=true]').count();
      console.log(`PROBE ${n} visit${visit} @400ms: skeletons=${sk} text="${txt}"`);
      await page.waitForTimeout(3500);
      await page.getByRole('link', { name: 'Bandeja' }).first().click();
      await page.waitForTimeout(3500);
    }
  }
});
