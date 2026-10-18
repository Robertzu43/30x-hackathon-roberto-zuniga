/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA AC-44 / AC-103 / AC-104 on the deployed URL as the demo user: Periodo, Beneficiarios and a beneficiary profile load (skeleton fast, data in time), show the figures of
// GET /api/period, never print null/undefined/NaN, and have no console error. Screenshots in .wrangler/qa-52x. QA_URL + QA_LIVE=1 (no user is created; the shared demo user signs in).
import fs from 'node:fs';
import { test, expect, newPage, URL_, DIR } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'set QA_LIVE=1');
test.setTimeout(180000);
for (const vw of [1440, 390]) test(`AC-44/103/104 screens at ${vw}`, async ({ browser }: any) => {
  const { ctx, page } = await newPage(browser, { viewport: { width: vw, height: vw === 390 ? 844 : 900 } }); const errs: string[] = [];
  page.on('console', (m: any) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); }); page.on('pageerror', (e: any) => errs.push('pageerror ' + String(e).slice(0, 160)));
  await page.goto(`${URL_}/demo`); await page.getByRole('button', { name: 'Entrar como Andina Labs' }).click();
  const d = page.getByRole('dialog'); await d.waitFor({ timeout: 20000 }); await d.getByRole('button', { name: 'Saltar' }).click(); await page.locator('.inbox-list tbody tr').first().waitFor();
  const link = (n: RegExp) => page.getByRole('link', { name: n }).first();
  const bad = (t: string) => ({ null: /\bnull\b/.test(t), undefined: /\bundefined\b/.test(t), NaN: /\bNaN\b/.test(t) });
  // Periodo
  const t = Date.now(); await link(/^Periodo$/).click(); await expect(page.locator('h1')).toContainText('Periodo'); const skel = Date.now() - t;
  await expect(page.getByText(/Violaciones/).first()).toBeVisible({ timeout: 15000 }); const data = Date.now() - t; await page.waitForTimeout(1500);
  const txt = (await page.locator('main').innerText()); const flat = txt.replace(/\s+/g, ' ');
  console.log(`[${vw}] Periodo: heading ${skel} ms, data ${data} ms; bad tokens ${JSON.stringify(bad(txt))}`);
  for (const k of ['Presupuesto', 'Saldo', 'Pagado', 'Comprometido', 'Disponible', 'Autonomía', 'Violaciones', 'Decisiones explicadas']) console.log(`   has «${k}»: ${new RegExp(k).test(flat)}`);
  console.log('   figures line:', flat.match(/Autonom[^.]{0,80}/)?.[0], '|', flat.match(/Violaciones\s*\d+/)?.[0], '|', flat.match(/Decisiones explicadas\s*\d+\s*%/)?.[0], '|', flat.match(/Excede el presupuesto por[^.]{0,30}/)?.[0]);
  console.log('   table rows:', await page.locator('main table tbody tr').count(), '| sample rows:', JSON.stringify((await page.locator('main table tbody tr').allInnerTexts()).slice(0, 12).map((x: string) => x.replace(/\s+/g, ' '))));
  console.log('   charts (svg/figure):', await page.locator('main svg').count(), await page.locator('main figure').count(), '| trend msg:', /La tendencia aparece cuando haya decisiones en más de un día/.test(flat));
  fs.writeFileSync(`${DIR}/periodo-${vw}.txt`, flat); await page.screenshot({ path: `${DIR}/periodo-${vw}.png`, fullPage: true });
  // Beneficiarios
  const tB = Date.now(); await link(/Beneficiarios/).click(); await expect(page.locator('h1')).toContainText('Beneficiarios'); await page.waitForTimeout(1500);
  const bt = await page.locator('main').innerText(); console.log(`[${vw}] Beneficiarios in ${Date.now() - tB} ms; bad tokens ${JSON.stringify(bad(bt))}; rows ${await page.locator('main table tbody tr, main li').count()}`);
  // profile of the first beneficiary link, and Forma Studio (4 history points)
  for (const name of ['Forma Studio', 'Nube Sur LLC']) {
    await link(/Beneficiarios/).click(); await page.waitForTimeout(600);
    const l = page.getByRole('link', { name: new RegExp(name) }).first(); const n = await l.count();
    if (!n) { console.log(`[${vw}] no link for ${name} (rows are not links?)`); await page.getByText(name).first().click().catch(() => {}); } else { await l.click(); }
    await page.waitForTimeout(2000); const p = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    console.log(`[${vw}] profile ${name}: url ${new globalThis.URL(page.url()).pathname}; h1 "${await page.locator('h1').first().innerText()}"; bad ${JSON.stringify(bad(p))}; sparkline svg ${await page.locator('main svg').count()}; text: ${p.slice(0, 520)}`);
    await page.screenshot({ path: `${DIR}/benef-${name.split(' ')[0]}-${vw}.png`, fullPage: true });
    const back = page.getByRole('link', { name: /Volver|Beneficiarios/ }).first(); console.log(`   back link present: ${await back.count()}`);
  }
  console.log(`[${vw}] console errors: ${JSON.stringify(errs)}`);
  await ctx.close();
});
