/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA R-137 / AC-94: open a new tab on /policy the instant after landing (h1 Bandeja visible); it must stay on Política (never redirect to «/»), and never to /login.
// Doors: password (x6), demo (x3), trial (x2). QA_URL + QA_LIVE=1. Trial users are never deleted.
import fs from 'node:fs';
import { test, expect, newPage, URL_, DIR } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'creates real users: set QA_LIVE=1');
test.setTimeout(240000);
const pw = JSON.parse(fs.readFileSync(`${DIR}/users-pw-short.json`, 'utf8'))[0];
const plan: [string, number][] = [['password', Number(process.env.QA_N_PW || 6)], ['demo', Number(process.env.QA_N_DEMO || 3)], ['trial', Number(process.env.QA_N_TRIAL || 2)]];
test('R-137 new tab on /policy right after landing stays on Política', async ({ browser }: any) => {
  const results: string[] = []; let fails = 0;
  for (const [door, n] of plan) for (let i = 0; i < n; i++) {
    const { ctx, page } = await newPage(browser); await page.goto(`${URL_}/${door === 'password' ? 'login' : door === 'demo' ? 'demo' : 'login'}`);
    if (door === 'password') { await page.getByRole('button', { name: 'Entrar con contraseña' }).click(); await page.getByLabel('Correo').fill(pw.email); await page.getByLabel('Contraseña').fill(pw.password); await page.getByRole('button', { name: 'Entrar', exact: true }).click(); }
    else if (door === 'demo') await page.getByRole('button', { name: 'Entrar como Andina Labs' }).click();
    else await page.getByRole('button', { name: 'Probar con mi propia empresa' }).click();
    await page.waitForFunction(() => location.pathname === '/' && /Bandeja/.test(document.querySelector('h1')?.textContent || ''), null, { timeout: 20000 });
    const p2 = await ctx.newPage(); const urls: string[] = []; p2.on('framenavigated', (f: any) => { if (f === p2.mainFrame()) urls.push(new globalThis.URL(f.url()).pathname); });
    await p2.goto(`${URL_}/policy`); await p2.waitForTimeout(3500);
    const path = new globalThis.URL(p2.url()).pathname; const h1 = await p2.locator('h1').first().innerText().catch(() => '(none)');
    const ok = path === '/policy' && /Pol[ií]tica/i.test(h1) && !urls.some((u) => u !== '/policy'); if (!ok) fails++;
    results.push(`${door}#${i + 1}: ${ok ? 'PASS' : 'FAIL'} final ${path} h1 "${h1}" navigations ${JSON.stringify(urls)}`); console.log(results[results.length - 1]);
    await ctx.close();
  }
  console.log(`R-137 SUMMARY: ${results.length} attempts, ${fails} failures`); expect(fails).toBe(0);
});
