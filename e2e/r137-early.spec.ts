/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA R-137 / AC-94, stricter than r137-race: open the second tab on /policy at the earliest instant the sign-in has answered (before Bandeja is on screen), 0/150/400 ms after the sign-in response.
// Password door (x5 per delay) and demo door (x3 per delay). The new tab must show Política, never Bandeja, never /login. QA_URL + QA_LIVE=1. No trial user is created.
import fs from 'node:fs';
import { test, expect, newPage, URL_, DIR } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'set QA_LIVE=1');
test.setTimeout(400000);
const pw = JSON.parse(fs.readFileSync(`${DIR}/users-pw-short.json`, 'utf8'))[0];
test('R-137 new tab /policy at the earliest instant after sign-in', async ({ browser }: any) => {
  let fails = 0, n = 0;
  for (const [door, reps] of [['password', 5], ['demo', 3]] as [string, number][]) for (const delay of [0, 150, 400]) for (let i = 0; i < reps; i++) {
    const { ctx, page } = await newPage(browser); await page.goto(`${URL_}/${door === 'demo' ? 'demo' : 'login'}`);
    if (door === 'password') { await page.getByRole('button', { name: 'Entrar con contraseña' }).click(); await page.getByLabel('Correo').fill(pw.email); await page.getByLabel('Contraseña').fill(pw.password); }
    const signed = page.waitForResponse((r: any) => /auth\/v1\/token/.test(r.url()), { timeout: 20000 });
    await page.getByRole('button', { name: door === 'demo' ? 'Entrar como Andina Labs' : 'Entrar', exact: true }).click(); await signed; if (delay) await page.waitForTimeout(delay);
    const p2 = await ctx.newPage(); const urls: string[] = []; p2.on('framenavigated', (f: any) => { if (f === p2.mainFrame()) urls.push(new globalThis.URL(f.url()).pathname); });
    await p2.goto(`${URL_}/policy`); await p2.waitForTimeout(3500); const path = new globalThis.URL(p2.url()).pathname; const h1 = await p2.locator('h1').first().innerText().catch(() => '(none)');
    const ok = path === '/policy' && /Pol[ií]tica/i.test(h1) && !urls.some((u) => u !== '/policy'); n++; if (!ok) fails++;
    console.log(`${door} +${delay}ms #${i + 1}: ${ok ? 'PASS' : 'FAIL'} final ${path} h1 "${h1}" navigations ${JSON.stringify(urls)}`); await ctx.close();
  }
  console.log(`R-137 EARLY SUMMARY: ${n} attempts, ${fails} failures`); expect(fails).toBe(0);
});
