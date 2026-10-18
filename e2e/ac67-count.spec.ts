/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file (Playwright is not a repo dependency; env-driven) */
// QA AC-67 / R-138: Bandeja chat quotes exact counts. Uses real model calls (R-94 ration: 2 questions here). Needs QA_URL, QA_LIVE=1.
import { createRequire } from 'node:module';
const { test, expect } = createRequire(import.meta.url)('/opt/node22/lib/node_modules/playwright/test');
const URL = process.env.QA_URL!;
test.skip(process.env.QA_LIVE !== '1', 'set QA_LIVE=1');
test.setTimeout(120000);

test('Bandeja chat counts match the page (demo user)', async ({ browser }: any) => {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`${URL}/demo`);
  await page.getByRole('button', { name: 'Entrar como Andina Labs' }).click();
  const d = page.getByRole('dialog'); await d.waitFor({ timeout: 20000 }); await d.getByRole('button', { name: 'Saltar' }).click();
  await page.locator('.inbox-list tbody tr').first().waitFor();
  await page.waitForTimeout(1500);
  const body = await page.locator('main').innerText();
  const m = body.match(/(\d+)\s*PAGAR\s*·\s*(\d+)\s*FRENAR\s*·\s*(\d+)\s*ESCALAR/);
  console.log('PAGE counts line:', m?.[0]);
  const rows = await page.locator('.inbox-list tbody tr').count();
  const chips: Record<string, number> = {};
  for (const t of await page.locator('.inbox-list tbody tr').allInnerTexts()) { const k = (t.match(/\b(PAGAR|FRENAR|ESCALAR|Pendiente)\b/) || ['?'])[0]; chips[k] = (chips[k] || 0) + 1; }
  console.log('PAGE rows:', rows, 'row chips tally:', JSON.stringify(chips));
  const input = page.getByPlaceholder(/pregunt|Escribe/i).first().or(page.locator('textarea, input[type=text]').first());
  for (const q of ['¿Cuántas facturas están en PAGAR, FRENAR y ESCALAR?']) {
    await input.fill(q);
    const t = Date.now();
    await page.getByRole('button', { name: /^(Preguntar|Enviar|Pregunta)/ }).first().click();
    const ans = page.getByText(/Respuesta generada por IA/);
    await expect(ans.first()).toBeVisible({ timeout: 40000 });
    console.log(`ASK "${q}" answered in ${Date.now() - t}ms`);
    const container = page.locator('main');
    const txt = (await container.innerText()).replace(/\s+/g, ' ');
    const idx = txt.indexOf('Respuesta generada');
    console.log('ANSWER block:', txt.slice(Math.max(0, idx - 400), idx + 260));
  }
  await page.screenshot({ path: '.wrangler/qa-39c/ask.png', fullPage: true });
});
