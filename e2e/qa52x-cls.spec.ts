/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA AC-107 / AC-99 Clarified R-145 / AC-92: layout shifts from the click to the end of the first-login pass, with the shifting elements named. One fresh Admin-API user per run
// (qa-r202610162341-52x-cls<rand>@example.com, no mail, never deleted) signs in through the password door, so the pass runs exactly as for a trial user.
// QA_URL + QA_LIVE=1. QA_VP=390|1440, QA_RUNS, QA_DOOR=password|trial (trial creates anonymous users: counts against AC-96's 30 sign-ins per hour).
import { test, expect, newPage, q, URL_ } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'creates real users: set QA_LIVE=1');
test.setTimeout(300000);
const vp = process.env.QA_VP === '390' ? { width: 390, height: 844 } : { width: 1440, height: 900 };
const RUNS = Number(process.env.QA_RUNS || 3); const door = process.env.QA_DOOR || 'password';
const SRC = `(() => { const s = (window.__sh = []); new PerformanceObserver((l) => { for (const en of l.getEntries()) s.push({ t: en.startTime + performance.timeOrigin, v: en.value, recent: en.hadRecentInput, src: (en.sources || []).map((x) => { const n = x.node; return (n && n.nodeType === 1 ? n.tagName + (n.id ? '#' + n.id : '') + '.' + String(n.className).slice(0, 36) : String(n && n.nodeName)) + ' ' + JSON.stringify([x.previousRect.y, x.previousRect.height, x.currentRect.y, x.currentRect.height].map((z) => Math.round(z))); }) }); }).observe({ type: 'layout-shift', buffered: true }); })();`;
async function mkUser() {
  const email = `qa-r202610162341-52x-cls${Math.random().toString(36).slice(2, 9)}@example.com`; const password = 'Qa-' + Math.random().toString(36).slice(2, 10) + 'Z9x';
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
  if (!r.ok) throw new Error('admin create ' + r.status); return { email, password };
}
test(`CLS click->end of pass, ${door}, ${vp.width}px x${RUNS}`, async ({ browser }: any) => {
  const totals: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const { ctx, page } = await newPage(browser, { viewport: vp }); await ctx.addInitScript(SRC);
    await page.goto(`${URL_}/login`);
    if (door === 'password') { const u = await mkUser(); await page.getByRole('button', { name: 'Entrar con contraseña' }).click(); await page.getByLabel('Correo').fill(u.email); await page.getByLabel('Contraseña').fill(u.password); await page.waitForTimeout(500); await page.evaluate(() => (window as any).__qa.arm(false)); await page.getByRole('button', { name: 'Entrar', exact: true }).click(); }
    else { const b = page.getByRole('button', { name: 'Probar con mi propia empresa' }); await expect(b).toBeEnabled(); await page.waitForTimeout(500); await page.evaluate(() => (window as any).__qa.arm(false)); await b.click(); }
    await page.waitForFunction(() => (window as any).__qa.usable !== null, null, { timeout: 20000 });
    await page.waitForFunction(() => !!document.querySelector('table.inbox-list tbody tr[data-id]') && !document.querySelector('.chip-pending') && !/Decidiendo|Deciding/.test(document.body.innerText), null, { timeout: 100000 });
    await page.waitForTimeout(1500);
    const r = await q(page); const sh: any[] = await page.evaluate(() => (window as any).__sh);
    const mine = sh.filter((s) => !s.recent && s.t >= r.t0e); const total = mine.reduce((a, s) => a + s.v, 0); totals.push(+total.toFixed(4));
    console.log(`CLS ${door} ${vp.width}px run ${i + 1}: usable ${Math.round(r.usable.ms)} ms; CLS click->end of pass ${total.toFixed(4)}; shifts: ${JSON.stringify(mine.map((s) => [Math.round(s.t - r.t0e), +s.v.toFixed(4), s.src]))}`);
    if (door === 'trial' && i === 0) { const tok = await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => /auth-token/.test(x))!; return JSON.parse(localStorage.getItem(k)!).access_token; }); const rr = await fetch(`${URL_}/api/demo/reset`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` } }); console.log('AC-93 POST /api/demo/reset with a trial JWT ->', rr.status, (await rr.text()).slice(0, 120)); }
    await ctx.close();
  }
  console.log(`CLS SUMMARY ${door} ${vp.width}px: ${JSON.stringify(totals)}; runs over 0.01: ${totals.filter((x) => x > 0.01).length}/${totals.length}`);
});
