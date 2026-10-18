/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA AC-98 Clarified (R-141): in-app navigation to a screen shows exactly one data request and no session request. First visit of each screen after «Entrar como Andina Labs»,
// fresh context each round, a normal click (the pointer hovers first) and a click event dispatched with no hover. QA_URL + QA_LIVE=1. No user is created.
import { test, expect, newPage, URL_ } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'set QA_LIVE=1');
test.setTimeout(240000);
const N = Number(process.env.QA_RUNS || 3);
for (const mode of ['pointer click', 'dispatched click (no hover)']) test(`AC-98 first in-app visit, ${mode} x${N}`, async ({ browser }: any) => {
  const tally: Record<string, number[]> = { Periodo: [], Beneficiarios: [], 'Política': [] };
  for (let i = 0; i < N; i++) {
    const { ctx, page } = await newPage(browser); const log: string[] = [];
    page.on('request', (r: any) => { const u = new globalThis.URL(r.url()); if (/^\/api\//.test(u.pathname)) log.push(`${r.method()} ${u.pathname}`); });
    await page.goto(`${URL_}/demo`); await page.getByRole('button', { name: 'Entrar como Andina Labs' }).click();
    const d = page.getByRole('dialog'); await d.waitFor({ timeout: 20000 }); await d.getByRole('button', { name: 'Saltar' }).click(); await page.locator('.inbox-list tbody tr').first().waitFor(); await page.waitForTimeout(2500);
    for (const [n, re, h] of [['Periodo', /^Periodo$/, /Periodo/], ['Beneficiarios', /Beneficiarios/, /Beneficiarios/], ['Política', /^Política$/, /Pol/]] as [string, RegExp, RegExp][]) {
      log.length = 0; const l = page.getByRole('link', { name: re }).first();
      if (mode.startsWith('pointer')) await l.click(); else await l.dispatchEvent('click');
      await expect(page.locator('h1')).toContainText(h); await page.waitForTimeout(2500);
      const data = log.filter((x) => /\/api\/screen\//.test(x)); tally[n].push(data.length); const other = log.filter((x) => !/\/api\/screen\//.test(x));
      console.log(`  [${mode}] round ${i + 1} ${n}: data requests ${data.length} ${JSON.stringify(data)}; other /api: ${JSON.stringify(other)}`);
      await page.getByRole('link', { name: 'Bandeja' }).first().click(); await page.locator('.inbox-list tbody tr').first().waitFor(); await page.waitForTimeout(1500);
    }
    await ctx.close();
  }
  console.log(`SUMMARY [${mode}] data requests per first visit: ${JSON.stringify(tally)}`);
});
