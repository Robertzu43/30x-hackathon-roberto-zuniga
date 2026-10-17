/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file (Playwright is not a repo dependency; env-driven) */
// QA Task 21 (AC-30): what the deployed Política screen shows. Needs QA_URL and QA_SESSION_FILE.
import { createRequire } from 'node:module';
const { test, expect } = createRequire(import.meta.url)('/opt/node22/lib/node_modules/playwright/test');
import fs from 'node:fs';

const URL = process.env.QA_URL!;
const sess = fs.readFileSync(process.env.QA_SESSION_FILE!, 'utf8');
const REF = process.env.SUPABASE_PROJECT_REF!;

test('Política shows a form, not JSON', async ({ context, page }) => {
  await context.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, sess]);
  await page.goto(`${URL}/policy`);
  await page.getByText('Saltar').click({ timeout: 4000 }).catch(() => {});
  await expect(page.getByText('Límite por pago').first()).toBeVisible();
  await page.screenshot({ path: '.wrangler/qa-21/pw/policy.png', fullPage: true });
  console.log((await page.locator('body').innerText()).slice(0, 1800));
});
