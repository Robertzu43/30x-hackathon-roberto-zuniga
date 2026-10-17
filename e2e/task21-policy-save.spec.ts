/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file (Playwright is not a repo dependency; env-driven) */
// QA Task 21 (AC-30 Clarified): saving Política in the deployed (old) screen with no pinned rates. Needs QA_URL and QA_SESSION_FILE.
import { createRequire } from 'node:module';
const { test } = createRequire(import.meta.url)('/opt/node22/lib/node_modules/playwright/test');
import fs from 'node:fs';

const URL = process.env.QA_URL!;
const sess = fs.readFileSync(process.env.QA_SESSION_FILE!, 'utf8');
const REF = process.env.SUPABASE_PROJECT_REF!;

test('save with empty rate rows', async ({ context, page }) => {
  await context.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, sess]);
  const seen: string[] = [];
  page.on('response', async (r: any) => { if (r.url().includes('/api/policy') && r.request().method() === 'PUT') seen.push(`${r.status()} req=${r.request().postData()} res=${(await r.text()).slice(0, 300)}`); });
  await page.goto(`${URL}/policy`);
  await page.getByText('Saltar').click({ timeout: 4000 }).catch(() => {});
  await page.getByRole('button', { name: /Guardar como versión/ }).click();
  await page.waitForTimeout(3000);
  console.log('PUT:', seen.join('\n'));
  console.log((await page.locator('body').innerText()).match(/Versión \d+ guardada\.?|[^\n]*error[^\n]*|[^\n]*inválid[^\n]*/gi)?.join(' | '));
  await page.screenshot({ path: '.wrangler/qa-21/pw/policy-saved.png', fullPage: true });
});
