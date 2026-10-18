/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA AC-92 Amended / AC-107 / R-145 / AC-42 Clarified: the trial door, then the pass on Bandeja. QA_URL + QA_LIVE=1. One anonymous trial user per test (never deleted).
import fs from 'node:fs';
import { test, expect, newPage, q, URL_, DIR } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'creates real trial users: set QA_LIVE=1');
test.setTimeout(150000);
const lang = process.env.QA_LANG || 'es';
const vp = process.env.QA_VP === '390' ? { width: 390, height: 844 } : { width: 1440, height: 900 };

async function runTrial(browser: any, interact: boolean) {
  const { ctx, page, net } = await newPage(browser, { viewport: vp, locale: lang === 'en' ? 'en-US' : 'es-CO' });
  await page.goto(`${URL_}/login`);
  if (lang === 'en') await page.getByRole('button', { name: 'English' }).first().click();
  const b = page.getByRole('button', { name: lang === 'en' ? 'Try it with my own company' : 'Probar con mi propia empresa' });
  await expect(b).toBeEnabled(); await page.waitForTimeout(500);
  await page.evaluate(() => (window as any).__qa.arm(true));
  await b.click();
  await page.waitForFunction(() => (window as any).__qa.usable !== null, null, { timeout: 20000 });
  const tour: any[] = [];
  if (interact) {
    const dlg = page.getByRole('dialog');
    await dlg.waitFor({ timeout: 10000 });
    tour.push({ step: await dlg.locator('header p').first().innerText(), t: Date.now() });
    await page.waitForTimeout(600);
    for (let i = 0; i < 3; i++) { await dlg.getByRole('button', { name: /Siguiente|Next/ }).click(); await page.waitForTimeout(400); }
    tour.push({ step: await dlg.locator('header p').first().innerText(), title: await dlg.locator('header h2').innerText() });
    // sample spotlight vs first row while the pass runs
    for (let i = 0; i < 40; i++) {
      const m = await page.evaluate(() => {
        const sp = document.querySelector('.tour-spotlight') as HTMLElement | null; const tr = document.querySelector('table.inbox-list tbody tr') as HTMLElement | null;
        const r = tr?.getBoundingClientRect(); const done = !!document.querySelector('table.inbox-list tbody tr[data-id]:not([data-id^="s"])') && !document.querySelector('.chip-pending') && !/Decidiendo|Deciding/.test(document.body.innerText);
        return { sp: sp ? [sp.style.top, sp.style.left, sp.style.width, sp.style.height] : null, row: r ? [Math.round(r.top * 10) / 10, Math.round(r.left * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10] : null, prog: (document.body.innerText.match(/(Decidiendo|Deciding)[^\n]*/) || [null])[0], done, at: performance.now() };
      });
      tour.push(m); if (m.done) break; await page.waitForTimeout(1000);
    }
  }
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const done = await page.evaluate(() => !!document.querySelector('table.inbox-list tbody tr[data-id]:not([data-id^="s"])') && !document.querySelector('.chip-pending') && !/Decidiendo|Deciding/.test(document.body.innerText));
    if (done) break; await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1500);
  const r = await q(page);
  const html = await page.evaluate(() => (document.querySelector('.activity-box') as HTMLElement | null)?.outerHTML.slice(0, 3000));
  return { ctx, page, net, r, tour, html };
}

test(`AC-92 pass (no interaction) ${lang} ${vp.width}`, async ({ browser }: any) => {
  const { ctx, page, r, html } = await runTrial(browser, false);
  const t0e = r.t0e; const usableE = t0e + r.usable.ms;
  const snaps = r.snaps as any[]; const fetches = r.fetches as any[];
  console.log(`landing (usable) at ${Math.round(r.usable.ms)} ms; snapshots=${snaps.length}; screen refreshes=${fetches.length}; run POSTs=${r.runPosts.length}`);
  console.log('run POST timings (ms from click):', r.runPosts.map((p: any) => `${Math.round(p.tReq - t0e)}->${Math.round(p.tRes - t0e)} ${JSON.stringify({ P: p.body?.PAGAR, F: p.body?.FRENAR, E: p.body?.ESCALAR, err: p.body?.errors, rem: p.body?.remaining })}`).join(' | '));
  console.log('screen fetch timings (ms from click):', fetches.map((f: any) => `${Math.round(f.tReq - t0e)}->${Math.round(f.tRes - t0e)} decided=${Object.values(f.decided).filter((v: any) => v[0]).length}`).join(' | '));
  const PEND = lang === 'en' ? 'Pending' : 'Pendiente'; const first = snaps[0];
  const lastF0 = fetches[fetches.length - 1]; const finalRows0 = snaps[snaps.length - 1].rows; const chipMap: Record<string, string> = {}; for (const [id, chip] of finalRows0) chipMap[chip] = lastF0.decided[id]?.[1]; console.log('chip text -> expected outcome map:', JSON.stringify(chipMap));
  const chips0 = first.rows.map((x: any) => x[1]);
  console.log('first snapshot at', Math.round(first.ms), 'ms: rows', first.rows.length, 'chips', JSON.stringify(chips0.reduce((a: any, c: string) => ((a[c] = (a[c] || 0) + 1), a), {})), 'progress:', first.prog);
  // progress texts over time
  const progSeq: string[] = []; for (const s of snaps) { const p = s.prog && s.prog.replace(/\s+/g, ' '); if (p && progSeq[progSeq.length - 1] !== `${Math.round(s.ms)}: ${p}`) { if (!progSeq.length || progSeq[progSeq.length - 1].split(': ').slice(1).join(': ') !== p) progSeq.push(`${Math.round(s.ms)}ms: ${p}`); } }
  console.log('PROGRESS line over time:\n  ' + progSeq.join('\n  '));
  const lastSumm = snaps.map((s) => s.summ).filter(Boolean).pop(); console.log('final summary line:', lastSumm);
  // R-122: every non-Pendiente chip was in a stored response received before the snapshot
  let viol = 0, checked = 0; const viols: string[] = [];
  for (const s of snaps) for (const [id, chip] of s.rows) {
    if (chip === PEND || chip === '?') continue; checked++;
    const ok = fetches.some((f: any) => f.tRes <= s.te + 5 && f.decided[id] && f.decided[id][0] === chipMap[chip]);
    if (!ok) { viol++; if (viols.length < 5) viols.push(`${id} ${chip} at ${Math.round(s.ms)}ms`); }
  }
  console.log(`R-122 check: ${checked} (snapshot,row) chip observations of a decided outcome; ${viol} with no earlier server response holding that outcome`, viols);
  // order and height stability
  const ids0 = first.rows.map((x: any) => x[0]).join(','); let orderChanges = 0; const hs: Record<string, number[]> = {};
  for (const s of snaps) { if (s.rows.map((x: any) => x[0]).join(',') !== ids0) orderChanges++; for (const [id, , h] of s.rows) (hs[id] ||= []).push(h); }
  const maxDelta = Math.max(...Object.values(hs).map((a) => Math.max(...a) - Math.min(...a)));
  console.log(`row order changes across ${snaps.length} snapshots: ${orderChanges}; max height delta of any row: ${maxDelta}px; row count first/last: ${first.rows.length}/${snaps[snaps.length - 1].rows.length}`);
  // all decided
  const allDone = snaps.find((s) => s.rows.length && s.rows.every((x: any) => x[1] !== PEND));
  console.log('all rows decided at (ms from click):', allDone ? Math.round(allDone.ms) : 'NEVER within 90 s');
  const lastF = fetches[fetches.length - 1]; const finalRows = snaps[snaps.length - 1].rows; let mism = 0;
  for (const [id, chip] of finalRows) { const e = lastF.decided[id]?.[1]; if (e !== chipMap[chip] || lastF.decided[id]?.[0] !== e) mism++; }
  console.log(`final chips vs expected_outcome (from the screen payload, QA-only read): ${finalRows.length - mism}/${finalRows.length} match`);
  // empty-state text and its n
  const withN = snaps.filter((s) => s.emptyNs.length); console.log('empty-state «todavía está decidiendo n facturas» seen in', withN.length, 'snapshots; first n values:', JSON.stringify(withN.slice(0, 6).map((s) => [Math.round(s.ms), s.emptyNs, s.rows.filter((x: any) => x[1] === PEND).length])), 'last:', JSON.stringify(withN.slice(-1).map((s) => [Math.round(s.ms), s.emptyNs])));
  const wrongN = withN.filter((s) => s.emptyNs.some((n: number) => n !== s.rows.filter((x: any) => x[1] === PEND).length)).length; console.log('snapshots where n != pending chips count:', wrongN);
  // KPI trajectory
  console.log('KPI snapshots (every ~6th):', JSON.stringify(snaps.filter((_, i) => i % 6 === 0).map((s) => [Math.round(s.ms), s.kpis.join(' / ')])).slice(0, 1500));
  // Activity panel
  const actSeq = snaps.map((s) => [Math.round(s.ms), s.act]).filter((x, i, a) => i === 0 || a[i - 1][1] !== x[1]);
  console.log('activity items over time [ms, count]:', JSON.stringify(actSeq));
  console.log('activity panel text sample:', snaps.map((s) => s.actText).filter(Boolean).pop());
  // CLS
  const cls = (r.cls as any[]).filter((c) => !c.recent);
  const sinceLanding = cls.filter((c) => c.t >= usableE - 1).reduce((a, c) => a + c.v, 0);
  const sinceClick = cls.filter((c) => c.t >= t0e).reduce((a, c) => a + c.v, 0);
  console.log(`CLS since click: ${sinceClick.toFixed(4)}; since landing: ${sinceLanding.toFixed(4)}; shifts: ${JSON.stringify(cls.filter((c) => c.t >= t0e).map((c) => [Math.round(c.t - t0e), +c.v.toFixed(4)]))}`);
  fs.writeFileSync(`${DIR}/activity.html`, html || '');
  await page.screenshot({ path: `${DIR}/pass-end-${lang}-${vp.width}.png`, fullPage: false });
  // Periodo after the pass
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await page.getByRole('link', { name: /Periodo|Period/ }).first().click();
  await page.waitForTimeout(2500);
  console.log('Periodo text after pass:', (await page.locator('main').innerText()).split('\n').filter((l: string) => /Violacion|violation/i.test(l)).join(' | '));
  await ctx.close();
});

test(`AC-42 tour during the pass ${lang} ${vp.width}`, async ({ browser }: any) => {
  const { ctx, r, tour } = await runTrial(browser, true);
  console.log('tour step at landing:', JSON.stringify(tour[0]), ' dialog visible after usable; landing at', Math.round(r.usable.ms), 'ms');
  console.log('tour after 3x Siguiente:', JSON.stringify(tour[1]));
  const samples = tour.slice(2); const sp = new Set(samples.map((s: any) => JSON.stringify(s.sp))); const rows = new Set(samples.map((s: any) => JSON.stringify(s.row)));
  console.log(`samples=${samples.length}; distinct spotlight rects=${sp.size}; distinct first-row rects=${rows.size}`);
  console.log('first/last sample:', JSON.stringify(samples[0]), JSON.stringify(samples[samples.length - 1]));
  console.log('progress during samples:', JSON.stringify([...new Set(samples.map((s: any) => s.prog))]));
  console.log('screen refreshes during run:', r.fetches.length);
  await ctx.close();
});
