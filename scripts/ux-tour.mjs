/* global document, getComputedStyle, devicePixelRatio, NodeFilter, OffscreenCanvas, createImageBitmap, fetch */ // code that runs in the page is serialised
// The tour's rows for the D38 gate (AC-117 4.target 4.spot 4.textcut 4.dim 4.cover 4.keys, AC-121 2.kpistate, AC-122's 1.band at 2560).
// Raw measurements are taken in the page, every verdict is judged here in Node (like scripts/ux-gate.mjs). Rows are { id, status, value, measured }.
// The DOM contract the tour must keep: `.topbar` (the top bar), `[data-tour-dim]` (the one dim layer), `[data-tour-hole]` (the lit area H),
// `.tour-card` (the card; its `h2` is the heading that takes focus on every step), and everything the tour draws inside `.tour`.
import { cutsText } from '../web/components/spotlight.ts';

export const WHAT_TOUR = {
  '4.target': 'tour target in view, clear of the card', '4.spot': 'lit area hugs the target (8 to 12 px)', '4.textcut': 'lit area cuts no text',
  '4.dim': 'one even dim layer', '4.cover': 'card clear of the lit area, in view', '4.keys': 'Escape, arrows and focus trap', '2.kpistate': 'KPI tiles show the run',
};

const EPS = 0.5; // sub-pixel layout
const right = (r) => r.left + r.width;
const bottom = (r) => r.top + r.height;
const overlap = (a, b) => Math.max(0, Math.min(right(a), right(b)) - Math.max(a.left, b.left)) * Math.max(0, Math.min(bottom(a), bottom(b)) - Math.max(a.top, b.top));
const gap = (a, b) => Math.max(a.left - right(b), b.left - right(a), a.top - bottom(b), b.top - bottom(a)); // negative: they intersect
const inside = (r, vp) => r.left >= -EPS && r.top >= -EPS && right(r) <= vp.width + EPS && bottom(r) <= vp.height + EPS;
const row = (id, problems, value, measured) => ({ id, status: problems.length ? 'fail' : 'pass', value, measured: problems.length ? problems.join('; ') : measured });
const NO_HOLE = (id) => row(id, ['no lit area ([data-tour-hole] is missing)'], 0, '');

// ---- In the page ----
async function measureTour(page, { target }) {
  // The card slides in: wait (1.5 s at most) until nothing of the tour is still animating.
  await page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running' && a.effect?.target?.closest?.('.tour')), null, { timeout: 1500 }).catch(() => {});
  return page.evaluate((sel) => {
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
    const holeEl = document.querySelector('[data-tour-hole]');
    const lines = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el || el.closest('.tour, script, style') || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width && r.height) lines.push({ left: r.left, top: r.top, width: r.width, height: r.height });
    }
    const vp = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    const alpha = (c) => (c.startsWith('rgba') ? +c.split(',')[3].replace(')', '') : c === 'transparent' ? 0 : 1);
    const extraDims = [...document.querySelectorAll('body *')].filter((el) => {
      if (el.hasAttribute('data-tour-dim')) return false;
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      return cs.position === 'fixed' && (alpha(cs.backgroundColor) > 0 || cs.backgroundImage !== 'none') && r.width >= vp.width - 1 && r.height >= vp.height - 1;
    }).length;
    return {
      vp, topBar: document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0, target: rect(document.querySelector(sel)), hole: rect(holeEl),
      radius: holeEl ? parseFloat(getComputedStyle(holeEl).borderTopLeftRadius) : 0, card: rect(document.querySelector('.tour-card')), lines,
      dimCount: document.querySelectorAll('[data-tour-dim]').length, extraDims, probes: [],
    };
  }, target);
}

// Pixels of the page's own screenshot, read through a canvas on a blank tab (no decoder dependency, no CSP in the way). Points are in CSS px.
async function pixels(page, pts) {
  const dpr = await page.evaluate(() => devicePixelRatio);
  const png = (await page.screenshot()).toString('base64');
  const blank = await page.context().newPage();
  try {
    return await blank.evaluate(async ({ png, pts, dpr }) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      return pts.map(([x, y]) => [...ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data.slice(0, 3)]);
    }, { png, pts, dpr });
  } finally {
    await blank.close();
  }
}

// 4.dim's pixels: 6 px outside each edge of H, and the viewport's four corners below the top bar, with the dim and without it.
async function probeDim(page, m) {
  const { vp, topBar, hole: h, card: c } = m;
  const within = (r, x, y, pad) => x >= r.left - pad && x <= right(r) + pad && y >= r.top - pad && y <= bottom(r) + pad;
  const pts = [[h.left + h.width / 2, h.top - 6], [h.left + h.width / 2, bottom(h) + 6], [h.left - 6, h.top + h.height / 2], [right(h) + 6, h.top + h.height / 2],
    [0, topBar + 1], [vp.width - 1, topBar + 1], [0, vp.height - 1], [vp.width - 1, vp.height - 1]]
    .filter(([x, y]) => x >= 0 && y > topBar && x < vp.width && y < vp.height && !(c && within(c, x, y, 2)) && !within(h, x, y, 0));
  const dim = await pixels(page, pts);
  await page.evaluate(() => { const s = document.createElement('style'); s.id = 'gate-nodim'; s.textContent = '[data-tour-dim]{display:none!important}'; document.head.append(s); });
  const clean = await pixels(page, pts);
  await page.evaluate(() => document.getElementById('gate-nodim').remove());
  return pts.map(([x, y], i) => ({ x: Math.round(x), y: Math.round(y), dim: dim[i], clean: clean[i] }));
}

// ---- Judges ----
const judgeTarget = ({ vp, topBar, target, card }) => {
  const p = [];
  if (!target) p.push('no target element');
  else {
    if (!inside(target, vp)) p.push('target outside the viewport');
    if (target.top < topBar - EPS) p.push('target under the top bar');
    if (card && overlap(target, card) > 0) p.push('card over the target');
  }
  return row('4.target', p, p.length, target ? `target ${Math.round(target.left)},${Math.round(target.top)} ${Math.round(target.width)}x${Math.round(target.height)} in view, clear of the card` : '');
};

// p is read from the four sides (a side held back by the viewport edge may be shorter): 8 to 12, ± 1, equal on every side, and a rounded corner of 8 to 16.
const judgeSpot = ({ vp, target: t, hole: h, radius }) => {
  if (!t || !inside(t, vp)) return { id: '4.spot', status: 'na', value: 0, measured: 'target not in view (see 4.target)' };
  if (!h) return NO_HOLE('4.spot');
  const sides = [[t.left - h.left, h.left <= EPS], [right(h) - right(t), right(h) >= vp.width - EPS], [t.top - h.top, h.top <= EPS], [bottom(h) - bottom(t), bottom(h) >= vp.height - EPS]];
  const free = sides.filter(([, clamped]) => !clamped).map(([pad]) => pad);
  const p = [];
  if (sides.some(([pad, clamped]) => pad > 13 || pad < (clamped ? 0 : 7))) p.push('padding outside 8 to 12 px');
  if (free.length && Math.max(...free) - Math.min(...free) > 2) p.push('padding differs between sides');
  if (radius < 8 || radius > 16) p.push('corner radius outside 8 to 16 px');
  const mean = free.length ? Math.round(free.reduce((a, b) => a + b, 0) / free.length) : 0;
  const m = `p ${mean}, radius ${radius} px`;
  return { ...row('4.spot', p, mean, m), measured: p.length ? `${m} (${p.join('; ')})` : m };
};

const judgeText = ({ vp, hole: h, lines }) => {
  if (!h) return NO_HOLE('4.textcut');
  const clipped = lines.map((l) => ({ left: Math.max(0, l.left), top: Math.max(0, l.top), width: Math.min(vp.width, right(l)) - Math.max(0, l.left), height: Math.min(vp.height, bottom(l)) - Math.max(0, l.top) })).filter((l) => l.width > 0 && l.height > 0);
  const cut = clipped.filter((l) => cutsText([l], h));
  return row('4.textcut', cut.length ? [`${cut.length} lines cut, first at ${Math.round(cut[0].left)},${Math.round(cut[0].top)}`] : [], cut.length, '0 lines cut');
};

export function judgeDim({ dimCount, extraDims, probes }) {
  const same = (a, b, tol) => a.every((c, i) => Math.abs(c - b[i]) <= tol);
  const p = [];
  if (dimCount !== 1) p.push(`${dimCount} dim layers`);
  if (extraDims) p.push(`${extraDims} other fixed layers cover the page`);
  const off = probes.flatMap((a, i) => probes.slice(i + 1).filter((b) => same(a.clean, b.clean, 1) && !same(a.dim, b.dim, 3)).map((b) => `(${a.x},${a.y}) and (${b.x},${b.y})`));
  if (off.length) p.push(`dim colour differs over the same background at ${off[0]}`);
  return row('4.dim', p, p.length, `1 layer, ${probes.length} pixels within 3`);
}

const judgeCover = ({ vp, topBar, hole: h, card: c }) => {
  if (!h) return NO_HOLE('4.cover');
  if (!c) return row('4.cover', ['no card'], 0, '');
  const area = Math.round(overlap(c, h)), g = gap(c, h), p = [];
  if (!inside(c, vp)) p.push('card outside the viewport');
  if (c.top < topBar - EPS) p.push('card under the top bar');
  if (area > 0) p.push(`card over the lit area (intersection ${area} px²)`);
  else if (g < 7.99) p.push(`gap ${Math.round(g)} px, less than 8`);
  return row('4.cover', p, area, `intersection ${area} px², gap ${Math.round(g)} px`);
};

export const judgeTour = (m) => [judgeTarget(m), judgeSpot(m), judgeText(m), judgeDim(m), judgeCover(m)];

/** The five rows of one shown step. The tour must be open on that step; `target` is that step's anchor selector. */
export async function tourRows(page, { target }) {
  const m = await measureTour(page, { target });
  if (m.hole) m.probes = await probeDim(page, m);
  return judgeTour(m);
}

// ---- 4.keys ----
/** Drives the keys. `open()` opens the tour on step 1 (a click on «Ver tutorial»); `opener` is that button's selector. */
async function measureKeys(page, { open, opener, steps = 7 }) {
  const heading = () => page.evaluate(() => { const h = document.querySelector('.tour-card h2'); return { text: h?.textContent ?? null, focused: !!h && document.activeElement === h }; });
  const closed = () => page.evaluate(() => !document.querySelector('.tour-card'));
  const press = (k) => page.keyboard.press(k);
  const o = { escaped: [], advanced: 0, focusedOnHeading: 0 };
  await open();
  const first = await heading();
  o.firstFocusOnHeading = first.focused;
  await press('ArrowLeft');
  o.leftOnFirstMoved = (await heading()).text !== first.text;
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 8; i++) {
      await press(key);
      if (!(await page.evaluate(() => !!document.activeElement?.closest('.tour-card')))) { o.escaped.push(key); break; }
    }
  }
  o.underDim = await page.evaluate(() => { // nothing but the tour and the top bar may be reachable by pointer
    const w = document.documentElement.clientWidth, h = document.documentElement.clientHeight, bar = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
    const hole = document.querySelector('[data-tour-hole]')?.getBoundingClientRect();
    const pts = { centre: hole && [hole.left + hole.width / 2, hole.top + hole.height / 2], 'top-left': [1, bar + 1], 'top-right': [w - 2, bar + 1], 'bottom-left': [1, h - 2], 'bottom-right': [w - 2, h - 2] };
    return Object.entries(pts).filter(([, p]) => p && !document.elementFromPoint(...p)?.closest('.tour, .topbar')).map(([k]) => k);
  });
  const seen = [first.text];
  for (let s = 1; s < steps; s++) {
    await press('ArrowRight');
    const h = await heading();
    if (h.text && h.text !== seen.at(-1)) o.advanced++;
    if (h.focused) o.focusedOnHeading++;
    seen.push(h.text);
  }
  await press('ArrowLeft');
  o.backWorks = (await heading()).text === seen[steps - 2];
  await press('ArrowRight');
  await press('ArrowRight'); // → on the last step does what «Terminar» does
  o.lastCloses = await closed();
  await open();
  await press('Escape');
  o.escapeCloses = await closed();
  o.escapeFocus = await page.evaluate((sel) => document.activeElement?.matches(sel) ?? false, opener);
  return o;
}

export function judgeKeys(o, steps = 7) {
  const n = steps - 1, p = [];
  if (!o.firstFocusOnHeading) p.push('step 1: the heading did not take focus');
  if (o.leftOnFirstMoved) p.push('← on step 1 moved the tour');
  if (o.escaped.length) p.push(`${o.escaped.join(' and ')} left the card`);
  if (o.advanced < n) p.push(`→ advanced ${o.advanced} of ${n} steps`);
  if (o.focusedOnHeading < n) p.push(`the heading had focus on ${o.focusedOnHeading} of ${n} steps`);
  if (!o.backWorks) p.push('← did not go back');
  if (!o.lastCloses) p.push(`→ on step ${steps} did not close the tour`);
  if (!o.escapeCloses) p.push('Escape did not close the tour');
  if (!o.escapeFocus) p.push('focus did not return to «Ver tutorial»');
  if (o.underDim.length) p.push(`clickable under the dim: ${o.underDim.join(', ')}`);
  return row('4.keys', p, p.length, 'Escape, arrows and the focus trap work');
}

export { measureKeys, measureTour };

// ---- 2.kpistate (AC-121) ----
const BUSY = { es: /^Decidiendo… \d+ de \d+$/, en: /^Deciding… \d+ of \d+$/ };
const BUSY_ANY = /Decidiendo|Deciding/;

// One evaluate, not $$eval: $$eval finds the tiles first and reads them after, so a re-render in between reads detached tiles (height 0).
export const sampleKpi = (page, sel = '.chart-kpi') => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => ({
  value: e.querySelector('.chart-kpi-value')?.textContent.trim() ?? '', hint: !!e.querySelector('.chart-kpi-hint'), aria: e.getAttribute('aria-label') ?? '', height: e.getBoundingClientRect().height,
})), sel);

/** before: the tiles before the run (optional); during: every sample taken while it ran; after: the tiles once it ended. */
export function judgeKpi({ before, during, after }, lang, tiles = 4) {
  const p = new Set();
  if (!during.length) p.add('no sample during the run');
  for (const s of during) {
    if (s.length !== tiles) p.add(`${s.length} tiles during the run, expected ${tiles}`);
    for (const t of s) {
      if (!BUSY[lang].test(t.value)) p.add(`tile "${t.value}" during the run`);
      if (t.hint) p.add('a hint during the run');
      if (!t.aria.endsWith(`: ${t.value}`)) p.add(`aria-label "${t.aria}" during the run`);
    }
    if (new Set(s.map((t) => t.value)).size > 1) p.add('tiles disagree on n of m');
  }
  if (after.some((t) => BUSY_ANY.test(t.value + t.aria))) p.add('«Decidiendo» still shown after the run');
  const all = [...(before ? [before] : []), ...during, after];
  for (let i = 0; i < tiles; i++) {
    const h = all.map((s) => s[i]?.height).filter((x) => x !== undefined);
    if (h.length && Math.max(...h) - Math.min(...h) > 1) p.add(`tile ${i + 1} height ${Math.round(Math.min(...h))} to ${Math.round(Math.max(...h))} px`);
  }
  return row('2.kpistate', [...p], p.size, `${during.length} samples during the run, heights equal`);
}

/** Samples the tiles until `isDone(page)` says the run ended (the first-login pass or «Ejecutar agente»), then judges. */
export async function kpiState(page, { sel, isDone, lang, timeout = 60_000 }) {
  const samples = [], end = Date.now() + timeout;
  while (Date.now() < end) {
    const s = await sampleKpi(page, sel);
    if (await isDone(page)) break; // asked after the sample: a run still going now was going when the tiles were read
    samples.push(s);
    await page.waitForTimeout(100);
  }
  let after = await sampleKpi(page, sel);
  for (let i = 0; i < 30 && after.some((t) => BUSY_ANY.test(t.value)); i++) { // the figures of the first load after the run's last call
    await page.waitForTimeout(100);
    after = await sampleKpi(page, sel);
  }
  const at = samples.findIndex((s) => s.some((t) => BUSY_ANY.test(t.value)));
  const during = at < 0 ? [] : samples.slice(at);
  return judgeKpi({ before: at > 0 ? samples[at - 1] : undefined, during, after }, lang);
}

// ---- 1.band at 2560 (AC-122; the table of AC-112 for the other widths) ----
/** The band's expected width and each margin: min(M, W - 2P), M = 1440 on a dashboard screen and 1280 on demo; P = 24, 32 or 48. */
export const bandExpect = (W, screen) => {
  const width = Math.min(screen === 'demo' ? 1280 : 1440, W - 2 * (W < 768 ? 24 : W < 1280 ? 32 : 48));
  return { width, margin: (W - width) / 2 };
};

export function judgeBand({ left, width, right: r }, W, screen) {
  const e = bandExpect(W, screen);
  return { id: '1.band', status: Math.abs(width - e.width) > 2 || Math.abs(left - r) > 2 ? 'fail' : 'pass', value: Math.abs(width - e.width), measured: `x ${Math.round(left)}, width ${Math.round(width)} (expected ${e.width})` };
}
