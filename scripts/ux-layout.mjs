/* global document, getComputedStyle, innerHeight */ // Node module + code that runs in the page
// D45 layout rows of the D38 gate (AC-112..AC-116, AC-91 Clarified, R-167..R-172): 1.band, 1.cap, 1.fill, 1.measure, 1.centred,
// 1.grid, 1.hero, 4.tourcover and 6.cards. The page functions return raw boxes; the judges in Node decide.

// R-167: the band screens (and their designed states) and M, the band's maximum.
export const BAND = ['demo', 'inbox', 'trial', 'detail-pagar', 'detail-frenar', 'detail-escalar', 'detail-unread', 'policy', 'beneficiaries', 'beneficiary', 'period'];
export const GRID = ['inbox', 'detail-pagar', 'detail-frenar', 'detail-escalar', 'detail-unread', 'period', 'beneficiary', 'policy']; // AC-113
export const bandMax = (id) => (id === 'demo' ? 1280 : 1440);
export const pad = (w) => (w < 768 ? 24 : w < 1280 ? 32 : 48);
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
const R = (id, status, value, measured) => ({ id, status, value, measured });
const P = (id, bad, value, measured) => R(id, bad ? 'fail' : 'pass', value, measured);
const box = (r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height });

// ---- In the page (serialised: self-contained) ----
export function layoutMeasure() {
  const W = document.documentElement.clientWidth;
  const rect = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  const shown = (e) => e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
  const fixed = (e) => getComputedStyle(e).position === 'fixed';
  const label = (e) => `${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).join('.') : ''}`;
  const out = { W, ih: innerHeight };
  const band = document.querySelector('[data-band]');
  if (band) {
    const cs = getComputedStyle(band), r = rect(band);
    const pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight);
    out.band = { x: r.left + pl, width: r.width - pl - pr };
    // 1.cap: band, blocks and their ancestors up to body, any max-width in px.
    const caps = new Map();
    const capOf = (e) => { for (let p = e; p && p !== document.documentElement; p = p.parentElement) { const m = getComputedStyle(p).maxWidth; if (m.endsWith('px')) caps.set(p, parseFloat(m)); } };
    capOf(band);
    band.querySelectorAll('[data-block]').forEach(capOf);
    out.caps = [...caps].map(([e, px]) => ({ n: label(e), px }));
    // 1.fill: the top-level blocks; an unmarked child is allowed only as a wrapper whose visible children are blocks (or wrappers).
    const blocks = [], unmarked = [];
    const walk = (e, top) => {
      for (const c of e.children) {
        if (!shown(c) || fixed(c)) continue;
        if (c.hasAttribute('data-block')) { blocks.push({ n: label(c), ...rect(c) }); continue; }
        const kids = [...c.children].filter((k) => shown(k) && !fixed(k));
        if (kids.length) walk(c, false);
        else unmarked.push(label(c) + (top ? '' : ' (in a wrapper)'));
      }
    };
    walk(band, true);
    out.blocks = blocks;
    out.unmarked = unmarked;
    // 1.measure: p, li, dd with more than 120 characters (the innermost ones) against 70ch of their own font.
    const ctx = document.createElement('canvas').getContext('2d');
    out.prose = [...band.querySelectorAll('p, li, dd')].filter((e) => shown(e) && !e.querySelector('p, li, dd') && e.textContent.trim().length > 120).map((e) => {
      const cs = getComputedStyle(e);
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      return { n: label(e), width: e.getBoundingClientRect().width, max: 70 * ctx.measureText('0').width + 2 };
    });
    // 1.band, top bar: the logo's left edge and the last control's right edge.
    const bar = document.querySelector('.topbar') ?? band;
    const logo = bar.querySelector('[data-logo], .logo');
    const controls = [...(bar === band ? band.querySelectorAll('[data-topbar] button, [data-topbar] a') : bar.querySelectorAll('button, a, select'))].filter(shown);
    out.bar = { logo: logo ? rect(logo).left : null, end: controls.length ? Math.max(...controls.map((c) => rect(c).right)) : null };
    // 1.hero (/demo): the video box, the h1 and the doors.
    const video = band.querySelector('[data-hero-video]');
    const doors = [...band.querySelectorAll('[data-door]')].filter(shown);
    const h1 = band.querySelector('h1');
    out.hero = video && { video: rect(video), h1: h1 && rect(h1), doors: doors.map(rect) };
  }
  // 1.centred: the union of the bordered or backgrounded boxes in main.
  const main = document.querySelector('main');
  if (main) {
    const painted = [...main.querySelectorAll('*')].filter((e) => {
      if (!shown(e)) return false;
      const cs = getComputedStyle(e);
      const bg = cs.backgroundColor.match(/[\d.]+/g);
      return (bg && (bg.length < 4 || +bg[3] > 0)) || cs.backgroundImage !== 'none' || ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none');
    }).map(rect);
    out.painted = painted.length ? { left: Math.min(...painted.map((r) => r.left)), right: Math.max(...painted.map((r) => r.right)) } : null;
  }
  // 6.cards: the step-card grids.
  const grids = new Map();
  for (const c of document.querySelectorAll('[data-step-card]')) if (shown(c)) grids.set(c.parentElement, [...(grids.get(c.parentElement) ?? []), c]);
  out.grids = [...grids].map(([g, cards]) => ({
    n: label(g), width: g.getBoundingClientRect().width,
    cards: cards.map((c) => ({ ...rect(c), title: rect(c.querySelector('[data-step-title]') ?? c).top })),
  }));
  return out;
}

// ---- In Node ----
export function judgeLayout(m, { id, width }) {
  const rs = [];
  const base = id.replace(/-(empty|error|offline|fx-empty|fx-error|state-.*)$/, '');
  if (BAND.includes(base)) {
    const M = bandMax(base), Pw = pad(m.W), want = Math.min(M, m.W - 2 * Pw);
    if (!m.band) {
      for (const k of ['1.band', '1.cap', '1.fill', '1.measure']) rs.push(R(k, 'fail', 1, 'no [data-band] on this screen'));
    } else {
      const b = m.band, left = b.x, right = m.W - (b.x + b.width);
      const barOk = m.bar.logo !== null && m.bar.end !== null && near(m.bar.logo, b.x) && near(m.bar.end, b.x + b.width);
      const ok = near(b.width, want) && near(left, right) && barOk;
      rs.push(P('1.band', !ok, Math.round(Math.abs(b.width - want) + Math.abs(left - right)), `band x ${Math.round(b.x)} width ${Math.round(b.width)} (want ${want}, margins ${Math.round(left)}/${Math.round(right)}); top bar logo ${m.bar.logo === null ? 'missing' : Math.round(m.bar.logo)}, end ${m.bar.end === null ? 'missing' : Math.round(m.bar.end)}`));
      const caps = m.caps.filter((c) => c.px < M);
      rs.push(P('1.cap', caps.length > 0, caps.length, `${caps.length} max-width under ${M} px${caps.length ? ': ' + caps.slice(0, 4).map((c) => `${c.n} ${c.px}px`).join('; ') : ''}`));
      const rows = rowsOf(m.blocks);
      const short = rows.filter((r) => !near(Math.min(...r.map((x) => x.left)), b.x) || !near(Math.max(...r.map((x) => x.right)), b.x + b.width));
      const bad = short.length + m.unmarked.length;
      rs.push(P('1.fill', bad > 0, bad, `${m.blocks.length} blocks in ${rows.length} rows; ${short.length} rows short of the band${short.length ? ': ' + short.slice(0, 3).map((r) => r.map((x) => `${x.n} ${Math.round(x.left)}-${Math.round(x.right)}`).join(' + ')).join('; ') : ''}; ${m.unmarked.length} unmarked children${m.unmarked.length ? ': ' + m.unmarked.slice(0, 3).join('; ') : ''}`));
      const wide = m.prose.filter((p) => p.width > p.max);
      rs.push(P('1.measure', wide.length > 0, wide.length, `${wide.length} of ${m.prose.length} long texts wider than 70ch${wide.length ? ': ' + wide.slice(0, 3).map((p) => `${p.n} ${Math.round(p.width)} > ${Math.round(p.max)}`).join('; ') : ''}`));
      if (GRID.includes(base) && !id.endsWith('-empty')) {
        const most = Math.max(0, ...rows.map((r) => r.length));
        rs.push(width >= 1440 ? P('1.grid', most < 2, most, `at most ${most} blocks in one row`) : R('1.grid', 'na', most, 'checked at 1440 and 1920'));
      }
      if (base === 'demo') rs.push(hero(m, width));
    }
  } else rs.push(width < 1024 ? R('1.centred', 'na', 0, 'checked at 1024, 1440 and 1920') : !m.painted ? R('1.centred', 'na', 0, 'no main element or nothing painted in it') : (() => {
    const l = m.painted.left, r = m.W - m.painted.right;
    return P('1.centred', !near(l, r), Math.round(Math.abs(l - r)), `painted boxes ${Math.round(m.painted.left)}-${Math.round(m.painted.right)}, margins ${Math.round(l)}/${Math.round(r)}`);
  })());
  rs.push(cards(m));
  return rs;
}

// Two blocks share a row when their vertical ranges overlap by more than half of the shorter one.
export function rowsOf(blocks) {
  const rows = [];
  for (const b of [...blocks].sort((a, c) => a.top - c.top)) {
    const row = rows.find((r) => r.some((x) => Math.min(x.bottom, b.bottom) - Math.max(x.top, b.top) > Math.min(x.height, b.height) / 2));
    if (row) row.push(b); else rows.push([b]);
  }
  return rows;
}

function hero(m, width) {
  const h = m.hero;
  if (!h) return R('1.hero', 'fail', 1, 'no [data-hero-video] in the band');
  const v = h.video, why = [];
  if (!near(v.height, (v.width * 9) / 16)) why.push(`box ${Math.round(v.width)}x${Math.round(v.height)} is not 16:9`);
  if (width >= 1024) {
    const edge = Math.max(h.h1?.right ?? 0, ...h.doors.map((d) => d.right));
    if (v.left < edge + 24) why.push(`video left ${Math.round(v.left)} < h1/doors right ${Math.round(edge)} + 24`);
    if (!h.h1 || Math.min(v.bottom, h.h1.bottom) <= Math.max(v.top, h.h1.top)) why.push('video and h1 do not overlap vertically');
    if (v.width < 0.45 * m.band.width) why.push(`video ${Math.round(v.width)} < 45% of the band`);
    const limit = width >= 1440 ? v.bottom : v.top + v.height / 2;
    if (v.top < 0 || limit > m.ih) why.push(`video ${Math.round(v.top)}-${Math.round(v.bottom)} not in the first ${m.ih} px`);
  } else {
    const after = Math.max(0, ...h.doors.map((d) => d.bottom));
    if (v.top < after) why.push(`video top ${Math.round(v.top)} above the doors' bottom ${Math.round(after)}`);
    if (!near(v.width, m.band.width)) why.push(`video ${Math.round(v.width)} does not span the band ${Math.round(m.band.width)}`);
  }
  return P('1.hero', why.length > 0, why.length, why.length ? why.join('; ') : `video ${Math.round(v.left)},${Math.round(v.top)} ${Math.round(v.width)}x${Math.round(v.height)}; h1 ${h.h1 ? `${Math.round(h.h1.left)}-${Math.round(h.h1.right)}` : 'none'}`);
}

function cards(m) {
  if (!m.grids.length) return R('6.cards', 'na', 0, 'no step cards on this screen');
  const why = [];
  for (const g of m.grids) {
    if (g.cards.length < 2) continue; // a single-step helper
    const rows = rowsOf(g.cards);
    const want = Math.min(g.width >= 600 ? 3 : 1, g.cards.length);
    if (rows[0].length !== want) why.push(`${g.n} ${Math.round(g.width)} px wide: ${rows.map((r) => r.length).join(' + ')} per row, want ${want}`);
    for (const r of rows) {
      if (r.some((c) => !near(c.width, r[0].width, 1) || !near(c.height, r[0].height, 1))) why.push(`${g.n}: cards of one row differ in size`);
      if (r.some((c) => !near(c.title, r[0].title, 1))) why.push(`${g.n}: titles not level`);
    }
  }
  const n = m.grids.reduce((s, g) => s + g.cards.length, 0);
  return P('6.cards', why.length > 0, why.length, why.length ? why.join('; ') : `${n} cards in ${m.grids.length} grids, ${m.grids.map((g) => `${rowsOf(g.cards)[0].length} per row at ${Math.round(g.width)} px`).join(', ')}`);
}

// ---- 4.tourcover (AC-115): the card C never covers the highlighted element T ----
export function tourMeasure() {
  const c = document.querySelector('.tour-card');
  const spot = document.querySelector('.tour-spotlight');
  if (!c || !spot) return null;
  const sel = document.querySelector('[data-tour-step]')?.getAttribute('data-tour-step');
  const t = sel && document.querySelector(`[data-tour="${sel}"]`);
  if (!t) return null;
  const r = (e) => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
  // A target inside its own scroller (a table row on a phone) is measured by the part the scroller shows.
  const T = r(t);
  for (let p = t.parentElement; p && p !== document.body; p = p.parentElement) {
    if (getComputedStyle(p).overflowX === 'visible') continue;
    const c = r(p);
    T.left = Math.max(T.left, c.left); T.right = Math.min(T.right, c.right); T.width = Math.max(0, T.right - T.left);
  }
  const head = t.matches('h1,h2,h3') ? t : t.querySelector('h1,h2,h3');
  const bar = document.querySelector('.topbar');
  return { step: sel, T, C: r(c), head: head && r(head), vw: document.documentElement.clientWidth, vh: innerHeight, top: bar ? bar.getBoundingClientRect().bottom : 0 };
}

const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
export function judgeTour(t) {
  if (!t) return R('4.tourcover', 'fail', 1, 'no tour card or no highlighted element');
  const { T, C, vw, vh, top } = t;
  // T fits beside C: above or below it in the room under the top bar, or left or right of it.
  const fits = T.height <= Math.max(C.top - top, vh - C.bottom) || T.width <= Math.max(C.left, vw - C.right);
  const area = inter(T, C);
  if (fits) {
    const inside = T.top >= 0 && T.left >= 0 && T.bottom <= vh && T.right <= vw;
    return P('4.tourcover', area > 0 || !inside, Math.round(area), `${t.step}: fits; intersection ${Math.round(area)} px²${inside ? '' : ', not wholly in the viewport'}`);
  }
  const vis = { left: Math.max(T.left, 0), right: Math.min(T.right, vw), top: Math.max(T.top, top), bottom: Math.min(T.bottom, vh) };
  const visArea = Math.max(0, vis.right - vis.left) * Math.max(0, vis.bottom - vis.top);
  const share = visArea ? inter(vis, C) / visArea : 1;
  const headHit = t.head ? inter(t.head, C) : 0;
  const headShown = t.head && t.head.top >= top - 1 && t.head.bottom <= vh;
  return P('4.tourcover', headHit > 0 || !headShown || share > 0.5, Math.round(share * 100), `${t.step}: large; covers ${Math.round(share * 100)}% of its visible area, heading ${!t.head ? 'missing' : headHit ? 'covered' : headShown ? 'clear' : 'off screen'}`);
}

export { box };
