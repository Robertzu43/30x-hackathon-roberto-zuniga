/* global URL, document */
// The tour rows of the gate (AC-117 4.target 4.spot 4.textcut 4.dim 4.cover 4.keys, AC-121 2.kpistate, AC-122 1.band at 2560):
// a fixture page per row that fails exactly that row, and the same page fixed that passes every row.
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bandExpect, judgeBand, judgeDim, judgeKeys, judgeKpi, judgeTour, kpiState, measureKeys, tourRows, WHAT_TOUR } from './ux-tour.mjs';
import { launch } from './ux-gate.mjs';

// ---- fixture: a tiny tour with the DOM contract the gate reads: .topbar, #opener, [data-tour-dim], [data-tour-hole], .tour-card (h2 = heading) ----
// The text column sits left (x 24..444), the target alone at x 700..900, and #below is a paragraph right under the target.
const tourPage = (v) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>t</title><style>
  *{box-sizing:border-box} body{margin:0;background:#fbfbfa;color:#111111;font:16px/24px sans-serif;height:2400px}
  .topbar{position:sticky;top:0;height:56px;z-index:1001;background:#ffffff;padding:8px 16px;border-bottom:1px solid #eaeaea}
  .col{position:absolute;left:24px;top:80px;width:420px} .col p{margin:0 0 12px}
  #t{position:absolute;left:700px;top:${v === 'offview' ? 1500 : 200}px;width:200px;height:80px;border:1px solid #eaeaea}
  #below{position:absolute;left:700px;margin:0;top:${v === 'textcut' ? 284 : 310}px}
  .tour{position:fixed;inset:0;z-index:1000}
  .tour-card{position:fixed;width:400px;background:#ffffff;border:1px solid #eaeaea;padding:16px} .tour-card p{margin:0}
</style></head><body>
<header class="topbar"><button id="opener" type="button">Ver tutorial</button></header>
<div class="col"><h1>Bandeja</h1><p>Facturas del mes con su estado, sus fechas y los avisos de cada proveedor.</p><p>Una segunda línea de texto para que haya contenido bajo la barra.</p></div>
<div id="t">Facturas</div><p id="below">Texto bajo el objetivo</p>
<button id="other" type="button" style="position:absolute;left:24px;top:400px">Otro botón</button>
<script>
const v = ${JSON.stringify(v)}, PAD = 10, STEPS = 7;
let step = 0, root = null;
const $ = (s) => document.querySelector(s);
const el = (tag, css, attrs = {}) => Object.assign(Object.assign(document.createElement(tag), attrs), { style: css });
function draw() {
  root?.remove();
  const T = $('#t').getBoundingClientRect(), W = innerWidth, H = innerHeight;
  const h = v === 'hole600' ? { left: 500, top: 140, width: 600, height: 400 } : { left: T.left - PAD, top: T.top - PAD, width: T.width + 2 * PAD, height: T.height + 2 * PAD };
  const x1 = h.left, y1 = h.top, x2 = h.left + h.width, y2 = h.top + h.height;
  const poly = [[0, 0], [W, 0], [W, H], [0, H], [0, 0], [x1, y1], [x1, y2], [x2, y2], [x2, y1], [x1, y1]].map(([x, y]) => x + 'px ' + y + 'px').join(',');
  root = el('div', '', { className: 'tour' });
  const dim = () => el('div', 'position:fixed;inset:0;clip-path:polygon(evenodd,' + poly + ');background:' + (v === 'dim-uneven' ? 'linear-gradient(90deg,rgba(0,0,0,.6) 50%,rgba(0,0,0,.3) 50%)' : 'rgba(0,0,0,.6)'));
  const d1 = dim(); d1.setAttribute('data-tour-dim', ''); root.append(d1);
  if (v === 'dim2') { const d2 = dim(); d2.setAttribute('data-tour-dim', ''); root.append(d2); }
  const hole = el('div', 'position:fixed;border-radius:12px;pointer-events:auto;left:' + x1 + 'px;top:' + y1 + 'px;width:' + h.width + 'px;height:' + h.height + 'px'); hole.setAttribute('data-tour-hole', ''); root.append(hole);
  const card = el('section', 'visibility:hidden', { className: 'tour-card' });
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-label', 'Tutorial');
  card.innerHTML = '<header><p>Paso ' + (step + 1) + ' de ' + STEPS + '</p><h2 tabindex="-1">Título ' + (step + 1) + '</h2></header><div><p>Cuerpo del paso.</p></div><div><button type="button">Saltar</button> <button type="button">Atrás</button> <button type="button">Siguiente</button></div>';
  root.append(card); document.body.append(root);
  const ch = card.offsetHeight;
  const left = v === 'cover' || v === 'cover-pad' ? T.left : Math.min(Math.max(x1 + (x2 - x1 - 400) / 2, 0), W - 400);
  const top = v === 'cover' ? T.top : v === 'cover-pad' ? T.top + T.height + 3 : v === 'cover-out' ? H - 40 : Math.min(y2 + 8, H - ch);
  card.style.cssText = 'left:' + left + 'px;top:' + top + 'px';
  card.querySelector('h2').focus();
}
const finish = () => { root.remove(); root = null; $('#opener').focus(); };
$('#opener').onclick = () => { step = 0; draw(); };
addEventListener('keydown', (e) => {
  if (!root) return;
  if (e.key === 'Escape') return finish();
  if (e.key === 'ArrowRight') return step === STEPS - 1 ? finish() : (step++, draw());
  if (e.key === 'ArrowLeft') return step > 0 && (step--, draw());
  if (e.key !== 'Tab' || v === 'keys') return;
  const f = [...root.querySelectorAll('button')], a = document.activeElement, h2 = root.querySelector('h2');
  if (!e.shiftKey && a === f.at(-1)) { e.preventDefault(); f[0].focus(); }
  else if (e.shiftKey && (a === f[0] || a === h2)) { e.preventDefault(); f.at(-1).focus(); }
});
</script></body></html>`;

// ---- fixture: four KPI tiles that show «Decidiendo… n de 12» for 1.5 s, then the figures. #run is the progress line. ----
const kpiPage = (v) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>k</title><style>
  body{margin:0;font:16px/24px sans-serif} .chart-kpi{display:inline-block;width:200px;min-height:96px;vertical-align:top} b{display:block}
</style></head><body><p id="run" role="status">Decidiendo tus facturas pendientes…</p><div id="tiles"></div><script>
const v = ${JSON.stringify(v)}, labels = ['Por pagar hoy', 'Esperando tu aprobación', 'Frenadas este mes', 'Autonomía'], figures = ['USD 4.200', '3', '2', '71 %'];
const tiles = document.getElementById('tiles');
const draw = (busy, n) => { tiles.innerHTML = labels.map((l, i) => {
  const text = busy ? ((v === 'kpi' && i === 3) ? '21 %' : 'Decidiendo… ' + n + ' de 12') : figures[i];
  const h = busy && v === 'kpi-height' && i === 0 ? 'height:60px;min-height:0' : '';
  return '<div class="chart-kpi" role="group" aria-label="' + l + ': ' + text + '" style="' + h + '"><span>' + l + '</span><b class="chart-kpi-value">' + text + '</b>' + (busy ? '' : '<span class="chart-kpi-hint">hoy</span>') + '</div>'; }).join(''); };
let n = 0; draw(true, 0);
const timer = setInterval(() => { n++; if (n > 10) { clearInterval(timer); document.getElementById('run').remove(); return draw(false); } draw(true, n); }, 150);
</script></body></html>`;

let server, base, browser;
beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const html = u.pathname === '/t' ? tourPage(u.searchParams.get('v')) : u.pathname === '/k' ? kpiPage(u.searchParams.get('v')) : null;
    if (html === null) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'text/html' }).end(html);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await launch();
}, 30_000);
afterAll(async () => {
  await browser?.close();
  server?.close();
});

const open = (page) => async () => { await page.click('#opener'); await page.waitForSelector('.tour-card'); };
const withPage = async (path, fn, o = {}) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: o.dpr ?? 1 });
  try {
    const page = await context.newPage();
    await page.goto(base + path);
    return await fn(page);
  } finally {
    await context.close();
  }
};
const tour = (v, o) => withPage(`/t?v=${v}`, async (page) => { await open(page)(); return tourRows(page, { target: '#t' }); }, o);
const keys = (v) => withPage(`/t?v=${v}`, async (page) => judgeKeys(await measureKeys(page, { open: open(page), opener: '#opener', steps: 7 }), 7));
const kpi = (v, lang = 'es') => withPage(`/k?v=${v}`, (page) => kpiState(page, { isDone: (p) => p.evaluate(() => !document.getElementById('run')), lang }));
const failing = (rows) => rows.filter((r) => r.status === 'fail').map((r) => r.id);

describe('the fixed fixture passes every tour row (AC-117)', () => {
  it('4.target 4.spot 4.textcut 4.dim 4.cover pass, p and the gap are printed', async () => {
    const rows = await tour('ok');
    expect(rows.map((r) => r.id)).toEqual(['4.target', '4.spot', '4.textcut', '4.dim', '4.cover']);
    expect(failing(rows)).toEqual([]);
    expect(rows.every((r) => r.status === 'pass')).toBe(true);
    expect(rows.find((r) => r.id === '4.spot').measured).toMatch(/p 10/);
    expect(rows.find((r) => r.id === '4.cover').measured).toMatch(/intersection 0 px.*gap 8 px/);
  });
  it('passes at device scale 2 too (the phone widths), pixels read at 2x', async () => {
    expect(failing(await tour('ok', { dpr: 2 }))).toEqual([]);
  });
  it('4.keys passes', async () => {
    const row = await keys('ok');
    expect(row).toMatchObject({ id: '4.keys', status: 'pass', value: 0 });
  });
});

describe('one failing fixture per tour row (AC-117)', () => {
  it('4.target: a target scrolled out of view', async () => {
    const rows = await tour('offview');
    expect(failing(rows)).toEqual(['4.target']);
    expect(rows.find((r) => r.id === '4.target').measured).toMatch(/outside the viewport/);
  });
  it('4.spot: a fixed 600 x 400 hole around a 200 x 80 target', async () => {
    expect(failing(await tour('hole600'))).toEqual(['4.spot']);
  });
  it('4.textcut: a hole whose edge crosses a paragraph', async () => {
    const rows = await tour('textcut');
    expect(failing(rows)).toEqual(['4.textcut']);
    expect(rows.find((r) => r.id === '4.textcut').value).toBe(1);
  });
  it('4.dim: two dim layers', async () => {
    const rows = await tour('dim2');
    expect(failing(rows)).toEqual(['4.dim']);
    expect(rows.find((r) => r.id === '4.dim').measured).toMatch(/2 dim layers/);
  });
  it('4.dim: one layer whose colour differs from one side of the hole to the other', async () => {
    const rows = await tour('dim-uneven');
    expect(failing(rows)).toEqual(['4.dim']);
    expect(rows.find((r) => r.id === '4.dim').measured).toMatch(/colour/);
  });
  it('4.cover: a card over its target also fails 4.target', async () => {
    const rows = await tour('cover');
    expect(failing(rows).sort()).toEqual(['4.cover', '4.target']);
    expect(rows.find((r) => r.id === '4.cover').value).toBeGreaterThan(0);
  });
  it('4.cover: a card that touches the lit padding but not the target', async () => {
    expect(failing(await tour('cover-pad'))).toEqual(['4.cover']);
  });
  it('4.cover: a card hanging out of the viewport', async () => {
    const rows = await tour('cover-out');
    expect(failing(rows)).toEqual(['4.cover']);
    expect(rows.find((r) => r.id === '4.cover').measured).toMatch(/outside the viewport/);
  });
  it('4.keys: focus escapes the card (no focus trap)', async () => {
    const row = await keys('keys');
    expect(row.status).toBe('fail');
    expect(row.measured).toMatch(/Tab left the card/);
  });
});

describe('the judges alone (AC-117)', () => {
  const T = { left: 700, top: 200, width: 200, height: 80 };
  const M = (o = {}) => ({
    vp: { width: 1440, height: 900 }, topBar: 56, target: T, hole: { left: 690, top: 190, width: 220, height: 100 }, radius: 12,
    card: { left: 600, top: 298, width: 400, height: 150 }, lines: [], dimCount: 1, extraDims: 0, probes: [], ...o,
  });
  const st = (m, id) => judgeTour(m).find((r) => r.id === id);
  it('passes a clean measurement', () => expect(judgeTour(M()).map((r) => r.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass']));
  it('4.target: under the top bar fails', () => expect(st(M({ target: { ...T, top: 30 }, hole: { left: 690, top: 20, width: 220, height: 100 } }), '4.target').status).toBe('fail'));
  it('4.spot: p of 7 and 13 pass (8 and 12, ± 1), 6 and 14 fail', () => {
    const grow = (p) => ({ left: T.left - p, top: T.top - p, width: T.width + 2 * p, height: T.height + 2 * p });
    for (const p of [7, 13]) expect(st(M({ hole: grow(p) }), '4.spot').status).toBe('pass');
    for (const p of [6, 14]) expect(st(M({ hole: grow(p) }), '4.spot').status).toBe('fail');
  });
  it('4.spot: unequal padding fails, and a sharp corner fails (radius 8 to 16)', () => {
    expect(st(M({ hole: { left: 692, top: 190, width: 208 + 18, height: 100 } }), '4.spot').status).toBe('fail');
    expect(st(M({ radius: 0 }), '4.spot').status).toBe('fail');
    expect(st(M({ radius: 20 }), '4.spot').status).toBe('fail');
  });
  it('4.spot: a side clamped to the viewport edge is allowed to be short', () => {
    const t = { left: 4, top: 200, width: 200, height: 80 };
    expect(st(M({ target: t, hole: { left: 0, top: 190, width: 214, height: 100 } }), '4.spot').status).toBe('pass');
  });
  it('4.textcut: lines are clipped to the viewport first', () => {
    const h = { left: 690, top: 190, width: 220, height: 100 };
    expect(st(M({ lines: [{ left: 0, top: 880, width: 100, height: 40 }] }), '4.textcut').status).toBe('pass'); // outside the hole
    expect(st(M({ lines: [{ left: 800, top: 250, width: 300, height: 24 }] }), '4.textcut').status).toBe('fail');
    expect(h.left).toBe(690);
  });
  it('4.dim: a fixed full-viewport layer that is not the dim fails', () => expect(st(M({ extraDims: 1 }), '4.dim').status).toBe('fail'));
  it('4.dim: no dim layer fails', () => expect(judgeDim(M({ dimCount: 0 })).status).toBe('fail'));
  it('4.dim: same page colour must dim to the same colour, ± 3 per channel', () => {
    const p = (dim) => ({ x: 0, y: 0, clean: [251, 251, 250], dim });
    expect(judgeDim(M({ probes: [p([100, 100, 100]), p([103, 98, 100])] })).status).toBe('pass');
    expect(judgeDim(M({ probes: [p([100, 100, 100]), p([104, 100, 100])] })).status).toBe('fail');
  });
  it('4.dim: a different page colour may dim differently', () => {
    expect(judgeDim(M({ probes: [{ x: 0, y: 0, clean: [251, 251, 250], dim: [100, 100, 100] }, { x: 9, y: 9, clean: [255, 255, 255], dim: [120, 120, 120] }] })).status).toBe('pass');
  });
  it('4.cover: a gap of 7 px fails and 8 px passes', () => {
    expect(st(M({ card: { left: 600, top: 297, width: 400, height: 150 } }), '4.cover').status).toBe('fail');
    expect(st(M({ card: { left: 600, top: 298, width: 400, height: 150 } }), '4.cover').status).toBe('pass');
  });
  it('4.cover: a card under the top bar fails', () => expect(st(M({ card: { left: 600, top: 20, width: 400, height: 150 }, hole: { left: 690, top: 290, width: 220, height: 100 }, target: { ...T, top: 300 } }), '4.cover').status).toBe('fail'));
  it('4.keys: each failure is named', () => {
    const ok = { firstFocusOnHeading: true, leftOnFirstMoved: false, escaped: [], advanced: 6, focusedOnHeading: 6, backWorks: true, lastCloses: true, escapeCloses: true, escapeFocus: true, underDim: [] };
    expect(judgeKeys(ok, 7).status).toBe('pass');
    const msg = (o) => judgeKeys({ ...ok, ...o }, 7).measured;
    expect(msg({ leftOnFirstMoved: true })).toMatch(/← on step 1/);
    expect(msg({ advanced: 5 })).toMatch(/→ advanced 5 of 6/);
    expect(msg({ focusedOnHeading: 4 })).toMatch(/heading had focus on 4 of 6/);
    expect(msg({ backWorks: false })).toMatch(/← did not go back/);
    expect(msg({ lastCloses: false })).toMatch(/→ on step 7 did not close/);
    expect(msg({ escapeCloses: false })).toMatch(/Escape did not close/);
    expect(msg({ escapeFocus: false })).toMatch(/focus did not return/);
    expect(msg({ underDim: ['centre'] })).toMatch(/clickable under the dim: centre/);
  });
});

describe('2.kpistate (AC-121)', () => {
  it('passes while the tiles read «Decidiendo… n de m», then show figures, with the same heights', async () => {
    const row = await kpi('ok');
    expect(row, row.measured).toMatchObject({ id: '2.kpistate', status: 'pass', value: 0 });
  });
  it('fails when a tile shows a percentage during the run', async () => {
    const row = await kpi('kpi');
    expect(row.status).toBe('fail');
    expect(row.measured).toMatch(/21 %/);
  });
  it('fails when a tile changes height during the run', async () => {
    const row = await kpi('kpi-height');
    expect(row.status).toBe('fail');
    expect(row.measured).toMatch(/height/);
  });
  const tile = (value, o = {}) => ({ value, hint: false, aria: `X: ${value}`, height: 96, ...o });
  const four = (value, o) => [0, 1, 2, 3].map(() => tile(value, o));
  const busy = four('Decidiendo… 15 de 29');
  const done = four('USD 4.200');
  it('judges the Spanish and English wording', () => {
    expect(judgeKpi({ during: [busy], after: done }, 'es').status).toBe('pass');
    expect(judgeKpi({ during: [four('Deciding… 15 of 29')], after: done }, 'en').status).toBe('pass');
    expect(judgeKpi({ during: [four('Deciding… 15 of 29')], after: done }, 'es').status).toBe('fail');
  });
  it('fails on a hint, an amount, a wrong aria-label, a missing tile, tiles that disagree, or no sample during the run', () => {
    const bad = (during, after = done) => judgeKpi({ during, after }, 'es');
    expect(bad([four('Decidiendo… 15 de 29', { hint: true })]).measured).toMatch(/hint/);
    expect(bad([four('USD 4.200')]).measured).toMatch(/USD 4.200/);
    expect(bad([four('Decidiendo… 15 de 29', { aria: 'X: otra cosa' })]).measured).toMatch(/aria/);
    expect(bad([busy.slice(0, 3)]).measured).toMatch(/3 tiles/);
    expect(bad([[...busy.slice(0, 3), tile('Decidiendo… 14 de 29')]]).measured).toMatch(/disagree/);
    expect(bad([]).measured).toMatch(/no sample during the run/);
  });
  it('fails when «Decidiendo» is still there after the run', () => {
    expect(judgeKpi({ during: [busy], after: busy }, 'es').measured).toMatch(/after the run/);
  });
  it('fails when a height moves by more than 1 px between before, during and after', () => {
    const h = (px) => four('Decidiendo… 15 de 29', { height: px });
    expect(judgeKpi({ before: four('USD 1', { height: 96 }), during: [h(97)], after: four('USD 2', { height: 96 }) }, 'es').status).toBe('pass');
    expect(judgeKpi({ before: four('USD 1', { height: 96 }), during: [h(98)], after: four('USD 2', { height: 96 }) }, 'es').measured).toMatch(/height/);
  });
});

describe('1.band at 2560 (AC-122)', () => {
  it('expects the table of AC-112 and AC-122', () => {
    const rows = [[360, 312, 24, 312, 24], [390, 342, 24, 342, 24], [768, 704, 32, 704, 32], [1024, 960, 32, 960, 32], [1440, 1344, 48, 1280, 80], [1920, 1440, 240, 1280, 320], [2560, 1440, 560, 1280, 640]];
    for (const [w, bw, bm, dw, dm] of rows) {
      expect(bandExpect(w, 'inbox')).toEqual({ width: bw, margin: bm });
      expect(bandExpect(w, 'demo')).toEqual({ width: dw, margin: dm });
    }
  });
  it('passes the expected band and fails one 40 px narrower or off-centre', () => {
    expect(judgeBand({ left: 560, width: 1440, right: 560 }, 2560, 'inbox').status).toBe('pass');
    expect(judgeBand({ left: 640, width: 1280, right: 640 }, 2560, 'demo').status).toBe('pass');
    expect(judgeBand({ left: 580, width: 1400, right: 580 }, 2560, 'inbox').status).toBe('fail');
    expect(judgeBand({ left: 500, width: 1440, right: 620 }, 2560, 'inbox').status).toBe('fail');
    expect(judgeBand({ left: 560, width: 1440, right: 560 }, 2560, 'inbox').measured).toMatch(/x 560.*width 1440/);
  });
});

describe('the registry', () => {
  it('has a label for every row of this file', () => {
    expect(Object.keys(WHAT_TOUR)).toEqual(['4.target', '4.spot', '4.textcut', '4.dim', '4.cover', '4.keys', '2.kpistate']);
  });
});
