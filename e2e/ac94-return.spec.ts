/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA AC-94 (+R-137, R-119): a persistent Chromium profile (not private). Trial -> add one invoice through REST (fields set, no model read) -> close the browser -> reopen /demo
// and /login («Volver a mi empresa de prueba», same user id, same company, the extra invoice), reopen on /policy and deep links, then the leaving warning (Cancelar, Escape, Salir de todos modos).
// QA_URL + QA_LIVE=1. One anonymous trial user (never deleted).
import fs from 'node:fs';
import { test, expect, chromium, URL_, DIR } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'creates real users: set QA_LIVE=1');
test.setTimeout(240000);
const PROFILE = `${DIR}/profile94`;
const sess = (page: any) => page.evaluate(() => { const k = Object.keys(localStorage).find((x) => /auth-token/.test(x)); const s = k && JSON.parse(localStorage.getItem(k)!); return s && { sub: s.user?.id, anon: s.user?.is_anonymous, token: s.access_token, key: k }; });
const bar = async (p: any) => (await p.locator('header').first().innerText()).replace(/\s+/g, ' ');
test('AC-94 persistent profile: restart, return door, deep links, leaving warning', async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  let ctx = await chromium.launchPersistentContext(PROFILE, { viewport: { width: 1440, height: 900 } });
  let page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(`${URL_}/login`);
  const primary0 = await page.getByRole('button', { name: /Probar con mi propia empresa|Volver a mi empresa de prueba/ }).allInnerTexts();
  console.log('fresh profile /login primary:', JSON.stringify(primary0));
  await page.getByRole('button', { name: 'Probar con mi propia empresa' }).click();
  await expect(page.locator('h1', { hasText: 'Bandeja' })).toBeVisible({ timeout: 20000 }); await page.keyboard.press('Escape');
  await page.waitForFunction(() => /Empresa de prueba \d+/.test(document.querySelector('header')!.innerText), null, { timeout: 15000 });
  const s0 = await sess(page); const bar0 = await bar(page); const company = bar0.match(/Empresa de prueba \d+/)![0];
  console.log('trial landing top bar:', bar0, '| anonymous:', s0.anon);
  expect(/null|undefined/.test(bar0)).toBe(false);
  // one invoice by REST with fields copied from an existing row (AC-96's route; no model read)
  const rest = async (method: string, path: string, body?: any) => page.evaluate(async ([m, p, b, tok, base, anon]: any) => { const r = await fetch(`${base}/rest/v1/${p}`, { method: m, headers: { apikey: anon, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.text() }; }, [method, path, body, s0.token, process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY]);
  const sel = await rest('GET', 'invoices?select=company_id,fields,source&limit=1'); const row = JSON.parse(sel.body)[0];
  const ins = await rest('POST', 'invoices', { company_id: row.company_id, source: 'chat', raw_text: 'qa-94-marker', fields: row.fields });
  console.log('REST insert of the marker invoice with the trial JWT ->', ins.status);
  const rows0 = 'n/a (29 DATASET.md rows + the marker = 30 expected)'; await page.waitForTimeout(1500);
  // R-137 variants, right after landing in the same profile
  await ctx.close();
  ctx = await chromium.launchPersistentContext(PROFILE, { viewport: { width: 1440, height: 900 } }); page = ctx.pages()[0] || (await ctx.newPage());
  // browser restart straight onto /policy
  const nav: string[] = []; page.on('framenavigated', (f: any) => { if (f === page.mainFrame()) nav.push(new globalThis.URL(f.url()).pathname); });
  await page.goto(`${URL_}/policy`); await page.waitForTimeout(3000);
  console.log('after browser restart, open /policy -> final path', new globalThis.URL(page.url()).pathname, '| h1:', await page.locator('h1').first().innerText(), '| navigations:', JSON.stringify(nav), '| top bar:', await bar(page));
  for (const p of ['/period', '/beneficiaries']) { const t = await ctx.newPage(); const n: string[] = []; t.on('framenavigated', (f: any) => { if (f === t.mainFrame()) n.push(new globalThis.URL(f.url()).pathname); }); await t.goto(`${URL_}${p}`); await t.waitForTimeout(2500); console.log(`new tab ${p} -> ${new globalThis.URL(t.url()).pathname} h1 "${await t.locator('h1').first().innerText()}" navigations ${JSON.stringify(n)}`); await t.close(); }
  const sRe = await sess(page); console.log('same user id after restart:', sRe.sub === s0.sub, '| anonymous:', sRe.anon);
  // door pages while an anonymous session exists
  for (const path of ['/demo', '/login']) {
    await page.goto(`${URL_}${path}`); const names = await page.getByRole('button').allInnerTexts();
    console.log(`${path} buttons:`, JSON.stringify(names.map((x: string) => x.trim()).filter(Boolean)));
    const back = page.getByRole('button', { name: 'Volver a mi empresa de prueba' }); await expect(back).toBeVisible();
    await back.click(); await expect(page.locator('h1', { hasText: 'Bandeja' })).toBeVisible({ timeout: 20000 }); await page.waitForTimeout(1500);
    const b = await bar(page); const rows = await page.locator('table.inbox-list tbody tr[data-id]').count(); const s = await sess(page);
    console.log(`${path} -> Volver: same user ${s.sub === s0.sub}; top bar "${b}"; has company ${b.includes(company)}; "Acceso sin guardar" ${b.includes('Acceso sin guardar')}; "Guardar mi acceso" ${/Guardar mi acceso/.test(b)}; null/undefined ${/null|undefined/.test(b)}; rows ${rows} (before ${rows0}); marker invoice present via REST: ${JSON.parse((await page.evaluate(async ([tok, base, anon]: any) => (await fetch(`${base}/rest/v1/invoices?select=id&raw_text=eq.qa-94-marker`, { headers: { apikey: anon, Authorization: `Bearer ${tok}` } })).text(), [s.token, process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY])) as string).length}`);
    await page.keyboard.press('Escape');
  }
  // leaving warnings
  const warn = page.getByText(/Si sales sin guardar tu acceso, no podrás volver a/);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click(); await page.waitForTimeout(600);
  console.log('Cerrar sesión -> warning:', JSON.stringify(await warn.allInnerTexts()), '| buttons:', JSON.stringify((await page.getByRole('button').allInnerTexts()).map((x: string) => x.trim()).filter((x: string) => /Guardar mi acceso|Salir de todos modos|Cancelar/.test(x))));
  await page.getByRole('button', { name: 'Cancelar' }).click(); await page.waitForTimeout(400); console.log('Cancelar keeps session:', (await warn.count()) === 0, new globalThis.URL(page.url()).pathname, !!(await sess(page)));
  await page.getByRole('button', { name: 'Cerrar sesión' }).click(); await page.waitForTimeout(500); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  console.log('Escape keeps session:', (await warn.count()) === 0, new globalThis.URL(page.url()).pathname, !!(await sess(page)));
  await page.goto(`${URL_}/demo`); await page.getByRole('button', { name: 'Entrar como Andina Labs' }).click(); await page.waitForTimeout(800);
  console.log('/demo with anonymous session: «Entrar como Andina Labs» -> warning:', (await warn.count()) > 0, '| session still anonymous:', (await sess(page))?.anon);
  await page.getByRole('button', { name: 'Cancelar' }).click().catch(() => {});
  await page.goto(`${URL_}/policy`); await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click(); await page.waitForTimeout(500); await page.getByRole('button', { name: 'Salir de todos modos' }).click(); await page.waitForTimeout(2000);
  console.log('Salir de todos modos -> path', new globalThis.URL(page.url()).pathname, '| session left:', !(await sess(page)));
  // no stored session: deep link goes to /login
  await page.goto(`${URL_}/policy`); await page.waitForTimeout(2500); console.log('no session, /policy ->', new globalThis.URL(page.url()).pathname);
  await ctx.close();
});
