/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e helper (Playwright is not a repo dependency) */
// QA helpers for AC-107 / AC-92 Amended / AC-108: an in-page, frame-accurate recorder installed before any page script.
import { createRequire } from 'node:module';
export const { test, expect, chromium } = Object.assign({}, createRequire(import.meta.url)('/opt/node22/lib/node_modules/playwright/test'), { chromium: createRequire(import.meta.url)('/opt/node22/lib/node_modules/playwright').chromium });

export const URL_ = process.env.QA_URL!;
export const DIR = '.wrangler/qa-52x';

// Recorder: arm() before the click; the capture-phase click listener stamps t0; a rAF loop records, per frame, the pressed state,
// the usable state, row snapshots (order/height/chip), progress text, KPI text, CLS entries, and every Bandeja-data fetch response.
export const RECORDER = `(() => {
  const q = (window.__qa = { armed: false, t0: null, label: null, busy: null, usable: null, snaps: [], cls: [], fetches: [], doorText: [], runPosts: [], watch: false });
  const epoch = () => performance.timeOrigin + performance.now();
  q.arm = (watch) => { q.vtStart = null; q.vtEnd = null; q.vtProps = {}; q.vtDur = 0; q.armed = true; q.watch = !!watch; q.t0 = null; q.busy = null; q.usable = null; q.snaps = []; q.doorText = []; };
  document.addEventListener('click', (e) => {
    if (!q.armed) return; const b = e.target.closest && e.target.closest('button'); if (!b) return;
    q.armed = false; q.t0 = performance.now(); q.t0e = epoch(); q.label = b.textContent; q.btn = b; loop();
  }, true);
  try { new PerformanceObserver((l) => { for (const en of l.getEntries()) q.cls.push({ t: en.startTime + performance.timeOrigin, v: en.value, recent: en.hadRecentInput }); }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input.url; const method = (init && init.method) || (input && input.method) || 'GET';
    const tReq = epoch();
    const res = await origFetch.apply(this, arguments);
    const tRes = epoch();
    try {
      if (/\\/api\\/invoices\\/run/.test(url) && method === 'POST') {
        let auth = ''; const h = (init && init.headers) || {}; auth = (h.Authorization || h.authorization || (h.get && h.get('authorization')) || '');
        let sub = ''; try { sub = JSON.parse(atob(auth.split(' ')[1].split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub; } catch (e) {}
        res.clone().json().then((b) => q.runPosts.push({ tReq, tRes, sub, body: b })).catch(() => q.runPosts.push({ tReq, tRes, sub, body: null }));
      }
      if (/\\/api\\/screen\\/inbox/.test(url)) res.clone().json().then((b) => {
        const m = {}; for (const i of b.invoices || []) m[i.id] = [i.outcome || null, i.expected_outcome || null, i.decision_id || null];
        q.fetches.push({ kind: 'screen', tReq, tRes, decided: m });
      }).catch(() => {});
    } catch (e) {}
    return res;
  };
  const rowsSnap = () => [...document.querySelectorAll('table.inbox-list tbody tr')].map((tr) => {
    const r = tr.getBoundingClientRect(); const chip = tr.querySelector('.chip'); const a = tr.querySelector('a.dash-headline');
    return [tr.getAttribute('data-id'), chip ? chip.textContent.trim() : '?', Math.round(r.height * 10) / 10, a ? a.textContent.trim() : ''];
  });
  const grab = (re) => { for (const el of document.querySelectorAll('main p, main div, main span')) { if (el.children.length === 0 || el.tagName === 'P') { const t = el.textContent; if (re.test(t) && t.length < 300) return t.trim(); } } return null; };
  let last = '';
  function loop() {
    const now = performance.now(); const dt = now - q.t0;
    if (q.busy === null) {
      const b = document.querySelector('button[aria-busy="true"][disabled]');
      if (b) q.busy = { ms: dt, text: b.textContent.trim() };
    }
    let moving = false; try { const an = (document.getAnimations ? document.getAnimations() : []).filter((a) => a.effect && a.effect.pseudoElement && a.effect.pseudoElement.indexOf('::view-transition') === 0); moving = an.some((a) => a.playState === 'running'); try { moving = moving || document.documentElement.matches(':active-view-transition'); } catch (e) {}
      if (moving) { if (q.vtStart == null) q.vtStart = dt; q.vtEnd = dt; q.vtProps = q.vtProps || {}; for (const a of an) { try { for (const k of a.effect.getKeyframes()) for (const p of Object.keys(k)) if (!['offset','computedOffset','easing','composite'].includes(p)) q.vtProps[p] = 1; q.vtDur = Math.max(q.vtDur || 0, a.effect.getTiming().duration); } catch (e) {} } } } catch (e) {}
    if (q.usable === null && location.pathname === '/' && !moving) {
      const h1 = document.querySelector('h1'); const rows = [...document.querySelectorAll('table.inbox-list tbody tr[data-id]')].filter((r) => !/^s\\d+$/.test(r.getAttribute('data-id')));
      const skel = document.querySelectorAll('main .skeleton').length;
      const nf = [...document.querySelectorAll('button, a')].find((x) => ['Nueva factura','New invoice'].includes(x.textContent.trim()));
      if (h1 && /Bandeja|Inbox/.test(h1.textContent) && rows.length > 0 && skel === 0 && nf && !nf.disabled && nf.getAttribute('aria-disabled') !== 'true') {
        const res = performance.getEntriesByType('resource').filter((e) => /\\/api\\/|\\/auth\\/v1\\//.test(e.name) && performance.timeOrigin + e.startTime >= q.t0e - 5).map((e) => ({ n: new URL(e.name).pathname, start: Math.round(performance.timeOrigin + e.startTime - q.t0e), end: Math.round(performance.timeOrigin + e.responseEnd - q.t0e), dur: Math.round(e.duration), ttfb: Math.round(e.responseStart - e.requestStart), st: (e.serverTiming || []).map((x) => x.name + '=' + Math.round(x.duration)).join(','), bytes: e.encodedBodySize, dec: e.decodedBodySize }));
        q.usable = { ms: dt, rows: rows.length, path: location.pathname, res };
      }
    }
    if (q.usable === null && location.pathname !== '/' && q.doorText.length < 400) {
      const t = document.body.innerText; const m = t.match(/(Decidiendo|Deciding)[^\\n]{0,40}?\\d+ (de|of) (\\d+|…)/); if (m && q.doorText.length < 3) q.doorText.push({ ms: Math.round(dt), m: m[0] });
    }
    if (q.watch && q.usable) {
      const rows = rowsSnap(); const prog = grab(/Decidiendo tus facturas pendientes|Deciding your pending invoices/); const summ = grab(/\\d+ \\S+ · \\d+ \\S+ · \\d+ \\S+/);
      const kpis = [...document.querySelectorAll('main section, main div')].filter((e) => /Por pagar hoy|Esperando tu aprobaci|Frenadas este mes|Autonom|To pay today|Awaiting your approval|Stopped this month|Autonomy/.test(e.textContent) && e.textContent.length < 120).map((e) => e.textContent.trim().replace(/\\s+/g, ' ')).slice(0, 8);
      const actN = [...document.querySelectorAll('.activity li, .activity article')].length; const actT = (document.querySelector('.activity') || {}).innerText || ''; const sig = JSON.stringify([rows, prog, summ, kpis, actN, actT.length]);
      if (sig !== last) { last = sig; q.snaps.push({ te: epoch(), ms: dt, rows, prog, summ, kpis, emptyNs: [...document.body.innerText.matchAll(/(?:todavía está decidiendo|is still deciding) (\\d+) (?:facturas|invoices)/g)].map((m) => +m[1]), act: [...document.querySelectorAll('.activity li, .activity article')].length, actText: (document.querySelector('.activity') || {}).innerText ? document.querySelector('.activity').innerText.replace(/\\s+/g, ' ').slice(0, 160) : null }); }
    }
    if (dt < (q.watch ? 70000 : 12000)) requestAnimationFrame(loop);
  }
})();`;

export async function newPage(browser: any, opts: any = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  await ctx.addInitScript(RECORDER);
  const page = await ctx.newPage();
  const net: any[] = [];
  page.on('response', async (r: any) => { if (/\/api\/|supabase\.co/.test(r.url()) && r.status() >= 400) console.log(`  !! ${r.status()} ${r.request().method()} ${new globalThis.URL(r.url()).pathname} ${(await r.text().catch(() => '')).slice(0, 160)}`); });
  page.on('requestfailed', (r: any) => console.log(`  !! requestfailed ${r.url().slice(0, 90)} ${r.failure()?.errorText}`));
  page.on('requestfinished', async (r: any) => {
    const u = r.url(); if (!/\/api\/|supabase\.co\/(auth|rest)/.test(u)) return;
    const t = r.timing(); const res = await r.response().catch(() => null);
    net.push({ at: Date.now(), method: r.method(), path: new globalThis.URL(u).pathname + (new globalThis.URL(u).search || '').slice(0, 30), status: res?.status(), dur: Math.round(t.responseEnd), wait: Math.round(t.responseStart - t.requestStart) });
  });
  return { ctx, page, net };
}
export const q = (page: any) => page.evaluate(() => { const x = (window as any).__qa; return { label: x.label, t0e: x.t0e, busy: x.busy, usable: x.usable, doorText: x.doorText, cls: x.cls, snaps: x.snaps, fetches: x.fetches, runPosts: x.runPosts, vt: { start: x.vtStart, end: x.vtEnd, props: Object.keys(x.vtProps || {}), dur: x.vtDur } }; });
export const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

export async function adminOtp(email: string): Promise<string> {
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) });
  return (await r.json()).email_otp;
}
