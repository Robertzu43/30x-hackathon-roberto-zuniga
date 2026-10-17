// QA Task 21 (AC-75 / AC-44): Periodo on the deployed URL shows Violaciones 0. Needs QA_URL and QA_SESSION_FILE.
import { createRequire } from 'node:module';
const { test, expect } = createRequire(import.meta.url)('/opt/node22/lib/node_modules/playwright/test');
import fs from 'node:fs';

const URL = process.env.QA_URL!;
const sess = fs.readFileSync(process.env.QA_SESSION_FILE!, 'utf8');
const REF = process.env.SUPABASE_PROJECT_REF!;

test('Periodo shows Violaciones 0', async ({ context, page }) => {
  await context.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, sess]);
  await page.goto(`${URL}/period`);
  await page.getByText('Saltar').click({ timeout: 4000 }).catch(() => {});
  await expect(page.locator('body')).toContainText(/Violaciones\s*0/);
  await page.screenshot({ path: '.wrangler/qa-21/pw/periodo.png', fullPage: true });
  console.log((await page.locator('body').innerText()).slice(0, 1200));
});
