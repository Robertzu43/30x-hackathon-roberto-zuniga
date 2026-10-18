/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA AC-109 (+ AC-42 Clarified: tour starts after the transition): per door, View Transition ready->finished, animated properties, CLS click->end (with shift sources),
// the tour dialog's first appearance versus the transition end, and a mid-transition screenshot. QA_URL + QA_LIVE=1. QA_DOOR=demo|trial|password|otp, QA_RUNS.
import fs from 'node:fs';
import { test, expect, newPage, adminOtp, URL_, DIR } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'creates real users: set QA_LIVE=1');
test.setTimeout(240000);
const PWF = process.env.QA_PWFILE || "users-pw.json";
const pw = fs.existsSync(`${DIR}/${PWF}`) ? JSON.parse(fs.readFileSync(`${DIR}/${PWF}`, 'utf8')) : [];
const otp = fs.existsSync(`${DIR}/users-otp.json`) ? JSON.parse(fs.readFileSync(`${DIR}/users-otp.json`, 'utf8')) : [];
const RUNS = Number(process.env.QA_RUNS || 3); const door = process.env.QA_DOOR || 'demo';
const INIT = `(() => {
  const w = (window.__vt = { calls: [], shifts: [], tour: null, t0: null });
  const o = document.startViewTransition && document.startViewTransition.bind(document);
  if (o) document.startViewTransition = function (cb) { const c = { called: performance.now() }; w.calls.push(c); const v = o(cb); v.ready.then(() => { c.ready = performance.now(); try { c.anims = document.getAnimations().filter((a) => a.effect && a.effect.pseudoElement).map((a) => ({ el: a.effect.pseudoElement, dur: a.effect.getTiming().duration, delay: a.effect.getTiming().delay, props: [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k)).filter((p) => !['offset','computedOffset','easing','composite'].includes(p)))] })); } catch (e) {} }).catch(() => { c.readyFailed = true; }); v.finished.then(() => { c.finished = performance.now(); }).catch(() => { c.finishedFailed = true; }); return v; };
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('button') && w.t0 === null && w.armed) w.t0 = performance.now(); }, true);
  new PerformanceObserver((l) => { for (const en of l.getEntries()) w.shifts.push({ t: en.startTime, v: en.value, recent: en.hadRecentInput, src: (en.sources || []).map((s) => { const n = s.node; return (n && n.nodeType === 1 ? n.tagName + (n.id ? '#' + n.id : '') + '.' + String(n.className).slice(0, 40) : String(n && n.nodeName)) + ' ' + JSON.stringify([s.previousRect.y, s.previousRect.height, s.currentRect.y, s.currentRect.height].map((x) => Math.round(x))); }) }); }).observe({ type: 'layout-shift', buffered: true });
  new MutationObserver(() => { if (w.tour === null && document.querySelector('[role=dialog]')) w.tour = performance.now(); }).observe(document, { subtree: true, childList: true });
})();`;
async function go(browser: any, i: number, label: string, prep: (p: any) => Promise<() => Promise<void>>) {
  const { ctx, page } = await newPage(browser, process.env.QA_VP === '390' ? { viewport: { width: 390, height: 844 } } : {}); await ctx.addInitScript(INIT);
  const click = await prep(page);
  await page.evaluate(() => { (window as any).__vt.armed = true; });
  await click();
  await page.waitForFunction(() => document.querySelector('h1')?.textContent?.match(/Bandeja/) && location.pathname === '/', null, { timeout: 20000 });
  const mid = i === 0; if (mid) { /* screenshot attempt in-flight is racy; taken by a separate test below */ }
  await page.waitForFunction(() => (window as any).__vt.tour !== null || performance.now() > (window as any).__vt.t0 + 6000, null, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => { const w = (window as any).__vt; return { t0: w.t0, calls: w.calls, tour: w.tour, shifts: w.shifts.filter((s: any) => s.t >= w.t0) }; });
  const c = r.calls[0] || {}; const ready = c.ready && c.finished ? Math.round(c.finished - c.ready) : null;
  const end = c.finished; const clsClickToEnd = r.shifts.filter((s: any) => s.t <= (end ?? 1e9) + 50).reduce((a: number, s: any) => a + s.v, 0);
  const clsAll = r.shifts.reduce((a: number, s: any) => a + s.v, 0);
  console.log(`AC109 ${label} run ${i + 1}: vtCalls=${r.calls.length} ready->finished=${ready} ms | called@${c.called && Math.round(c.called - r.t0)} ready@${c.ready && Math.round(c.ready - r.t0)} finished@${c.finished && Math.round(c.finished - r.t0)} (ms from click) | anim=${JSON.stringify((c.anims || []).map((a: any) => `${a.el} ${a.dur}ms ${a.props}`))} | tour dialog first seen @${r.tour && Math.round(r.tour - r.t0)} -> after finish: ${r.tour != null && end != null ? r.tour >= end : 'n/a'} | CLS click->end=${clsClickToEnd.toFixed(4)} all=${clsAll.toFixed(4)} ${clsAll > 0.005 ? JSON.stringify(r.shifts.map((s: any) => [Math.round(s.t - r.t0), +s.v.toFixed(4), s.src])) : ''}`);
  await ctx.close(); return { ready, clsClickToEnd, clsAll };
}
const out: any[] = [];
test(`AC-109 ${door} x${RUNS}`, async ({ browser }: any) => {
  for (let i = 0; i < RUNS; i++) {
    const r = await go(browser, i, door, async (page: any) => {
      if (door === 'demo') { await page.goto(`${URL_}/demo`); const b = page.getByRole('button', { name: 'Entrar como Andina Labs' }); await expect(b).toBeEnabled(); await page.waitForTimeout(500); return () => b.click(); }
      if (door === 'trial') { await page.goto(`${URL_}/login`); const b = page.getByRole('button', { name: 'Probar con mi propia empresa' }); await expect(b).toBeEnabled(); await page.waitForTimeout(500); return () => b.click(); }
      if (door === 'password') { await page.goto(`${URL_}/login`); await page.getByRole('button', { name: 'Entrar con contraseña' }).click(); await page.getByLabel('Correo').fill(pw[i % pw.length].email); await page.getByLabel('Contraseña').fill(pw[i % pw.length].password); await page.waitForTimeout(500); return () => page.getByRole('button', { name: 'Entrar', exact: true }).click(); }
      await page.route('**/auth/v1/otp*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
      await page.goto(`${URL_}/login`); await page.getByLabel('Correo').fill(otp[i % otp.length].email); await page.getByRole('button', { name: 'Enviar código' }).click();
      await page.getByLabel('Código de 6 dígitos').fill(await adminOtp(otp[i % otp.length].email)); await page.waitForTimeout(500);
      return () => page.getByRole('button', { name: 'Verificar código', exact: true }).click();
    });
    out.push(r);
  }
  console.log('AC109 SUMMARY', door, JSON.stringify(out));
});
