/* global process, console, fetch, Buffer, URL, setTimeout, SVGElement, addEventListener, document, window, performance, getComputedStyle, innerWidth, innerHeight, NodeFilter, PerformanceObserver, sessionStorage, localStorage, axe */ // Node script + code that runs in the page
// The D38 UX gate (AC-91). Usage:
//   node scripts/ux-gate.mjs --base <url> [--screens inbox,policy|all] [--only 6.palette] [--palette]
//                            [--mutate] [--route id=/path] [--approve-token t] [--status-token t]
// Needs Playwright (local node_modules, else the global one) and Chromium (/opt/pw-browsers/chromium, or GATE_CHROMIUM).
// Writes docs/ux/<screen>-<width>-<lang>.png and docs/ux/gate-<experience>.md; exits 1 when any item failed.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// ---- The approved look: web/styles.css at 6d34830 (R-93.5). The test compares these with that commit. ----
export const PALETTE = ['#000000', '#111111', '#333333', '#346538', '#787774', '#9f2f2d', '#eaeaea', '#edf3ec', '#f1efe9', '#fbfbfa', '#fdebec', '#ffffff'];
export const FONTS = [
  "'SF Pro Display', 'Geist Sans', 'Helvetica Neue', system-ui, sans-serif",
  "'Newsreader', 'Instrument Serif', 'Playfair Display', Georgia, serif",
  "'Geist Mono', 'SF Mono', 'JetBrains Mono', ui-monospace, monospace",
];
export const WIDTHS = [360, 390, 768, 1024, 1440];
const LANGS = ['es', 'en'];
const HEIGHT = { 360: 800, 390: 844, 768: 1024, 1024: 768, 1440: 900 };
const CHROMIUM = process.env.GATE_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DEMO = { email: 'demo@andina-labs.example', password: 'andina-demo-2026' }; // public by design (D8, AC-46); email is read from /api/config

// ---- Screens (AC-91 lists them). `path` may be a function of the run's variables; `states` get empty, error and offline cells. ----
const STATES = ['empty', 'error', 'offline'];
const EMPTY_BODY = { '/api/period': { budget_usd: null, balance_usd: null, paid_usd: 0, committed_usd: 0, available_usd: null, count_by_outcome: { PAGAR: 0, FRENAR: 0, ESCALAR: 0 }, by_beneficiary: [], autonomy: { n: 0, m: 0 }, autonomy_pct: null, violations: 0, explained_pct: 0 }, '/api/agent/last-run': null };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const newInvoice = (i, text) => async (page) => {
  await page.locator('[data-tour="new-invoice"]').click();
  await page.locator('[role="tab"]').nth(i).click();
  if (text) await page.locator('form.new-invoice textarea').fill('Factura AS-0087 de Ana Souza, 10.000,00 BRL');
  else await page.locator('form.new-invoice input[type="file"]').setInputFiles({ name: 'factura.png', mimeType: 'image/png', buffer: PNG });
};
const sendPortal = async (page, o) => {
  if (!o.mutate) return 'na: portal-reply sends a real message (one AI read); pass --mutate';
  await page.locator('textarea, input[type="text"]').first().fill('Factura AS-0087 de Ana Souza, 10.000,00 BRL');
  await page.locator('button[type="submit"], button.primary').first().click();
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500);
};
export const SCREENS = [
  { id: 'login', exp: 'finance', path: '/login', auth: false, fill: { '#login-email': 'gate@example.test' } },
  { id: 'tour', exp: 'finance', path: '/', tour: true, primary: '.tour-card button.primary' },
  { id: 'inbox', exp: 'finance', path: '/', states: STATES },
  { id: 'new-invoice-file', base: 'new-invoice', exp: 'finance', path: '/', primary: 'form.new-invoice button.primary', prepare: newInvoice(0, false) },
  { id: 'new-invoice-email', base: 'new-invoice', exp: 'finance', path: '/', primary: 'form.new-invoice button.primary', prepare: newInvoice(1, true) },
  { id: 'new-invoice-chat', base: 'new-invoice', exp: 'finance', path: '/', primary: 'form.new-invoice button.primary', prepare: newInvoice(2, true) },
  { id: 'detail-pagar', exp: 'finance', path: (v) => `/invoices/${v.invoice('PAGAR')}` },
  { id: 'detail-frenar', exp: 'finance', path: (v) => `/invoices/${v.invoice('FRENAR')}` },
  { id: 'detail-escalar', exp: 'finance', path: (v) => `/invoices/${v.invoice('ESCALAR')}` },
  { id: 'detail-unread', exp: 'finance', path: (v) => `/invoices/${v.invoice(null)}` }, // assumption: "unread" = an invoice the agent has not decided yet
  { id: 'ask', exp: 'finance', path: '/ask' }, // Task 24 owns the route; override with --route ask=/path
  { id: 'policy', exp: 'finance', path: '/policy' },
  { id: 'beneficiaries', exp: 'finance', path: '/beneficiaries', states: STATES },
  { id: 'period', exp: 'finance', path: '/period', states: STATES },
  { id: 'approve', exp: 'finance', path: (v) => `/approve/${v.approveToken ?? 'invalid'}`, auth: false },
  { id: 'demo', exp: 'finance', path: '/demo', auth: false },
  { id: 'portal', exp: 'vendor', path: '/andina-labs', auth: false, states: STATES, primary: 'button[type="submit"], button.primary' },
  { id: 'portal-reply', exp: 'vendor', path: '/andina-labs', auth: false, prepare: sendPortal, primary: 'button[type="submit"], button.primary' },
  { id: 'portal-error', exp: 'vendor', path: '/no-such-portal-gate', auth: false },
  { id: 'status', exp: 'vendor', path: (v) => `/estado/${v.statusToken}`, auth: false, states: STATES, needs: 'statusToken' },
  { id: 'status-invalid', exp: 'vendor', path: '/estado/token-invalido-gate', auth: false },
];

// ---- Playwright and Chromium ----
export async function launch() {
  const { chromium } = await import('playwright').catch(() => createRequire(join(execSync('npm root -g').toString().trim(), '_'))('playwright'));
  return chromium.launch({ executablePath: existsSync(CHROMIUM) ? CHROMIUM : undefined, args: ['--no-sandbox'] });
}

// ---- In the page: raw measurements only, judged in Node. Self-contained (it is serialised). ----
function measure(o) {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE']);
  const visible = (el) => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const els = [...document.querySelectorAll('body, body *')].filter((el) => !SKIP.has(el.tagName) && visible(el));
  const live = new Set(els);
  const name = (el) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '';
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls} "${(el.innerText ?? '').trim().slice(0, 24)}"`;
  };
  const hasText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const clippedBy = (el) => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) if (getComputedStyle(p).overflowX !== 'visible') return p;
    return null;
  };
  const sample = (list) => ({ count: list.length, sample: list.slice(0, 5) });
  const iw = innerWidth;
  const out = { scroll: { sw: document.documentElement.scrollWidth, iw } };

  out.offscreen = sample(els.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && (r.right > iw + 1 || r.left < -1) && !clippedBy(el); }).map(name));
  out.clipped = sample(els.filter((el) => {
    if (!hasText(el)) return false;
    const cs = getComputedStyle(el);
    const hid = (v) => v === 'hidden' || v === 'clip';
    return (hid(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) || (hid(cs.overflowY) && el.scrollHeight > el.clientHeight + 1);
  }).map(name));

  const runs = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || !live.has(el) || !n.textContent.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    if (rects.length) runs.push({ el, text: n.textContent.trim().replace(/\s+/g, ' '), rects, modal: !!el.closest('[aria-modal="true"],[role="dialog"]') });
  }
  const overlaps = [];
  for (let i = 0; i < runs.length; i++)
    for (let j = i + 1; j < runs.length; j++) {
      const a = runs[i], b = runs[j];
      if (a.modal !== b.modal) continue; // a dialog sits over the page by design
      const hit = a.rects.some((r) => b.rects.some((s) => {
        const ix = Math.min(r.right, s.right) - Math.max(r.left, s.left), iy = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
        return ix > 1 && iy > 1 && (ix * iy) / Math.min(r.width * r.height, s.width * s.height) > 0.25;
      }));
      if (hit) overlaps.push(`"${a.text.slice(0, 20)}" over "${b.text.slice(0, 20)}"`);
    }
  out.overlaps = sample(overlaps);
  out.texts = runs.map((r) => r.text);
  out.attrs = els.flatMap((el) => ['placeholder', 'aria-label', 'title', 'alt'].map((a) => el.getAttribute(a)).filter(Boolean));

  out.tables = sample(o.width > 768 ? [] : els.filter((t) => {
    if (t.tagName !== 'TABLE') return false;
    const r = t.getBoundingClientRect();
    if (r.right <= iw + 1) return false;
    for (let p = t.parentElement; p && p !== document.body; p = p.parentElement)
      if (/auto|scroll/.test(getComputedStyle(p).overflowX) && p.getBoundingClientRect().right <= iw + 1) return false;
    return true;
  }).map(name));

  const INTERACTIVE = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="switch"],[role="menuitem"],[tabindex]:not([tabindex="-1"])';
  const touch = els.filter((el) => el.matches(INTERACTIVE) && el.getBoundingClientRect().width > 1).map((el) => { const r = el.getBoundingClientRect(); return { n: name(el), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; });
  out.targets = { total: touch.length, small: touch.filter((t) => t.w < 43.99 || t.h < 43.99) };
  const fields = els.filter((el) => el.matches('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="file"]),select,textarea'));
  out.inputs = { total: fields.length, small: fields.filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16).map((el) => ({ n: name(el), px: parseFloat(getComputedStyle(el).fontSize) })) };
  out.unlabeled = sample(els.filter((el) => el.matches('input:not([type="hidden"]):not([type="submit"]):not([type="button"]),select,textarea') && !(el.labels?.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'))).map(name));
  out.lang = document.documentElement.lang;

  const colors = {}, fonts = {};
  const note = (map, k, el) => {
    const e = (map[k] ??= { n: 0, at: [] });
    e.n++;
    if (e.at.length < 3) e.at.push(name(el));
  };
  for (const el of els) {
    const cs = getComputedStyle(el);
    const textual = hasText(el) || el.matches('input,select,textarea,button');
    if (textual) { note(colors, cs.color, el); note(fonts, cs.fontFamily, el); }
    note(colors, cs.backgroundColor, el);
    for (const s of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none') note(colors, cs[`border${s}Color`], el);
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) note(colors, cs.outlineColor, el);
    if (el instanceof SVGElement) for (const k of ['fill', 'stroke']) if (cs[k] !== 'none' && cs[k].startsWith('rgb')) note(colors, cs[k], el);
  }
  out.colors = Object.entries(colors).map(([c, v]) => ({ c, ...v }));
  out.fonts = Object.entries(fonts).map(([f, v]) => ({ f, ...v }));

  out.logo = els.some((el) => el.matches('[data-logo],[aria-label*="logo" i],img[alt*="logo" i],img[src*="logo" i],.logo'));
  out.images = els.filter((el) => el.tagName === 'IMG').map((el) => ({ src: (el.currentSrc || el.src).slice(0, 60), svg: /\.svg(\?|$)|^data:image\/svg/.test(el.currentSrc || el.src), natural: el.naturalWidth, shown: el.getBoundingClientRect().width }));
  out.primaryCount = els.filter((el) => el.matches('.primary,[data-primary]')).length;

  // A designed state marks its message (role alert or status, or class error, empty, state); its container holds the next step.
  const msg = els.find((el) => el.matches('[role="alert"],[role="status"],.error,.empty,.state,[data-state]') && !el.closest('[aria-busy="true"]'));
  const root = msg && msg.parentElement && !msg.parentElement.matches('main,body') ? msg.parentElement : msg;
  out.message = root ? { text: root.innerText.trim().slice(0, 300), next: els.filter((el) => root.contains(el) && !el.closest('header,nav,.lang,.lang-switch') && el.matches('button,a[href],[role="button"]')).length } : { text: '', next: 0 };

  const pr = els.find((el) => el.matches(o.primary));
  if (pr) {
    pr.setAttribute('data-gate-primary', '');
    const form = pr.closest('form') ?? pr;
    form.scrollIntoView({ block: 'end' });
    const r = pr.getBoundingClientRect();
    let sticky = false;
    for (let p = pr; p; p = p.parentElement) if (/fixed|sticky/.test(getComputedStyle(p).position)) sticky = true;
    out.primary = { top: Math.round(r.top), height: Math.round(r.height), ih: innerHeight, sticky, n: name(pr) };
    window.scrollTo(0, 0);
  }
  return out;
}

// ---- Judging ----
const DEV = [/\bnull\b/, /\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /^[a-z]+(\.[a-z_]+)+$/, /\b(?:HTTP|status|error|código|code)\W{0,3}[1-5]\d\d\b/i, /^[1-5]\d\d$/, /\bERR_[A-Z_]+\b/, /\bPGRST\d+\b/, /\bFailed to fetch\b/i, /\bTypeError\b/];
const LOCALE = {
  es: [/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/, /(?<![\d.,])\d+\.\d{2}(?![\d.,])/, /\b(?:January|February|March|April|June|July|August|September|October|November|December)\b/, /\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.? \d/],
  en: [/\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b/, /(?<![\d.,])\d+,\d{2}(?![\d.,])/, /\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i, /\b\d{1,2} (?:ene|abr|ago|dic)\b/],
};
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/;
const NEXT_STEP = /reintent|recarg|vuelve|int[eé]ntalo|intenta|usa |sube|crea|agrega|a[ñn]ade|revisa|comprueba|conecta|retry|reload|try again|go back|check|use |upload|add |create|connect|refresh/i;
const hex = (c) => {
  const m = c.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/);
  return m && (m[4] === undefined || +m[4] > 0) ? '#' + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('') : null;
};
const norm = (s) => s.replace(/["']/g, '').replace(/\s+/g, ' ').toLowerCase();
const foreign = new Map();
function foreignPatterns(dicts, lang) {
  const k = `${lang}:${Object.keys(dicts.es).length}`;
  if (!foreign.has(k)) {
    const other = lang === 'es' ? 'en' : 'es';
    foreign.set(k, Object.entries(dicts[other]).filter(([key, v]) => v.replace(/\{\w+\}/g, '').trim().length >= 4 && v !== dicts[lang][key]).map(([key, v]) => ({
      key, re: new RegExp('^' + v.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\w+\}/g, '.+?') + '$'),
    })));
  }
  return foreign.get(k);
}

const R = (id, status, value, measured) => ({ id, status, value, measured });
const P = (id, bad, value, measured) => R(id, bad ? 'fail' : 'pass', value, measured);
const list = (l) => l.sample.join('; ');

function judge(m, c) {
  const rs = [];
  const { width, lang } = c;
  rs.push(P('1.scroll', m.scroll.sw > m.scroll.iw, Math.max(0, m.scroll.sw - m.scroll.iw), `scrollWidth ${m.scroll.sw} vs innerWidth ${m.scroll.iw}`));
  rs.push(P('1.offscreen', m.offscreen.count > 0, m.offscreen.count, `${m.offscreen.count} elements outside the viewport${m.offscreen.count ? ': ' + list(m.offscreen) : ''}`));
  rs.push(P('1.clip', m.clipped.count > 0, m.clipped.count, `${m.clipped.count} clipped text elements${m.clipped.count ? ': ' + list(m.clipped) : ''}`));
  rs.push(P('1.overlap', m.overlaps.count > 0, m.overlaps.count, `${m.overlaps.count} overlapping text boxes${m.overlaps.count ? ': ' + list(m.overlaps) : ''}`));
  rs.push(width > 768 ? R('1.tables', 'na', 0, 'only checked at 768 px and below') : P('1.tables', m.tables.count > 0, m.tables.count, `${m.tables.count} wide tables without their own scroll${m.tables.count ? ': ' + list(m.tables) : ''}`));
  if (width <= 390) {
    const t = m.targets.small;
    rs.push(P('2.targets', t.length > 0, t.length, `${t.length} of ${m.targets.total} targets under 44 x 44${t.length ? ': ' + t.slice(0, 5).map((x) => `${x.n} ${x.w}x${x.h}`).join('; ') : ''}`));
    const i = m.inputs.small;
    rs.push(P('2.inputs', i.length > 0, i.length, `${i.length} of ${m.inputs.total} inputs under 16 px${i.length ? ': ' + i.map((x) => `${x.n} ${x.px}px`).join('; ') : ''}`));
    if (!m.primary) rs.push(R('2.primary', 'na', 0, 'no primary action on this screen'));
    else {
      const low = m.primary.sticky || m.primary.top >= 0.4 * m.primary.ih;
      rs.push(P('2.primary', !low, low ? 0 : Math.round(0.4 * m.primary.ih - m.primary.top), `primary top ${m.primary.top} px of ${m.primary.ih} (lower 60% starts at ${Math.round(0.4 * m.primary.ih)})${m.primary.sticky ? ', sticky' : ''}`));
    }
  }
  rs.push(P('3.labels', m.unlabeled.count > 0, m.unlabeled.count, `${m.unlabeled.count} inputs without a label${m.unlabeled.count ? ': ' + list(m.unlabeled) : ''}`));
  rs.push(P('3.lang', m.lang !== lang, m.lang === lang ? 0 : 1, `html lang "${m.lang}", chosen "${lang}"`));

  const text = m.texts, words = [];
  for (const s of [...text, ...m.attrs]) if (DEV.some((re) => re.test(s))) words.push(s.slice(0, 40));
  rs.push(P('5.words', words.length > 0, words.length, `${words.length} developer words in visible text${words.length ? ': ' + words.slice(0, 5).join('; ') : ''}`));
  if (!c.dicts) rs.push(R('5.mixed', 'na', 0, 'no UI dictionaries loaded'));
  else {
    const hits = foreignPatterns(c.dicts, lang), mixed = [...new Set(text)].map((s) => hits.find((h) => h.re.test(s)) && s).filter(Boolean);
    rs.push(P('5.mixed', mixed.length > 0, mixed.length, `${mixed.length} strings from the ${lang === 'es' ? 'English' : 'Spanish'} dictionary${mixed.length ? ': ' + mixed.slice(0, 5).join('; ') : ''}`));
  }
  const loc = text.filter((s) => [...LOCALE[lang], ISO_DATE].some((re) => re.test(s)));
  rs.push(P('5.locale', loc.length > 0, loc.length, `${loc.length} numbers or dates not in ${lang === 'es' ? 'es-CO' : 'en-US'}${loc.length ? ': ' + loc.slice(0, 5).join('; ') : ''}`));

  const offPalette = m.colors.filter((x) => hex(x.c) && !PALETTE.includes(hex(x.c)));
  rs.push(P('6.palette', offPalette.length > 0, offPalette.length, `${offPalette.length} colours outside the palette${offPalette.length ? ': ' + offPalette.slice(0, 4).map((x) => `${hex(x.c)} x${x.n} at ${x.at[0]}`).join('; ') : ''}`));
  const offFont = m.fonts.filter((x) => !FONTS.some((f) => norm(f) === norm(x.f)));
  rs.push(P('6.fonts', offFont.length > 0, offFont.length, `${offFont.length} font stacks outside the three approved${offFont.length ? ': ' + offFont.slice(0, 3).map((x) => `${x.f.slice(0, 30)} at ${x.at[0]}`).join('; ') : ''}`));
  rs.push(P('6.logo', !m.logo, m.logo ? 0 : 1, m.logo ? 'logo present' : 'no [data-logo], logo-labelled element or logo image'));
  const soft = m.images.filter((i) => !i.svg && i.natural < 2 * i.shown - 0.5);
  rs.push(P('6.images', soft.length > 0, soft.length, `${soft.length} of ${m.images.length} images neither SVG nor 2x${soft.length ? ': ' + soft.map((i) => `${i.src} ${i.natural}px shown at ${Math.round(i.shown)}`).join('; ') : ''}`));
  rs.push(R('6.primary_count', 'info', m.primaryCount, `${m.primaryCount} primary buttons visible (judged by the UX reviewer)`));
  return rs;
}

// ---- One cell: a fresh context for one screen (or state) at one width and language ----
const JOBS = 2; // parallel browser contexts
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wanted = (only, id) => !only || only.some((p) => id.startsWith(p));
const isLocal = (base) => /^https?:\/\/(127\.0\.0\.1|localhost)[:/]?/.test(base);

function installRoutes(page, base, { state, guard, delayGets, gate }) {
  const origin = new URL(base).origin;
  return page.route('**/*', async (route) => {
    const req = route.request();
    const data = ['fetch', 'xhr'].includes(req.resourceType()) && req.url().startsWith(origin);
    const path = new URL(req.url()).pathname;
    const config = path === '/api/config';
    if (state === 'offline' && data && !config) { await gate.release; return route.continue(); }
    if (data && !config && state === 'error') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"gate"}' });
    if (data && !config && state === 'empty' && req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(path in EMPTY_BODY ? EMPTY_BODY[path] : []) });
    if (guard && req.method() !== 'GET' && req.method() !== 'OPTIONS') {
      const held = sleep(600).then(() => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })).catch(() => {}); // answered here, never sent to the origin
      gate.held.push(held);
      return held;
    }
    if (delayGets && data && !config && req.method() === 'GET') await sleep(delayGets);
    return route.fallback();
  });
}

const INIT = ({ lang, session, tour }) => {
  window.__gate = { cls: 0, long: 0 };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__gate.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__gate.long = Math.max(window.__gate.long, e.duration); }).observe({ type: 'longtask', buffered: true });
  localStorage.setItem('lang', lang);
  sessionStorage.setItem('lang', lang);
  if (session) localStorage.setItem(session.key, session.value);
  if (tour) sessionStorage.setItem('demo-tour', '1');
};

let axeSource;
const axeJs = () => (axeSource ??= readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));

export async function runCell(browser, job) {
  const { base, screen, state, width, lang, kind, opts = {} } = job;
  const label = screen.id + (state ? '-' + state : '');
  const rows = [];
  const add = (r) => wanted(opts.only, r.id) && rows.push({ screen: label, width, lang, ...r });
  const context = await browser.newContext({
    viewport: { width, height: HEIGHT[width] ?? 800 },
    deviceScaleFactor: width <= 390 ? 2 : 1,
    hasTouch: width <= 390,
    locale: lang === 'es' ? 'es-CO' : 'en-US',
  });
  let release;
  const gate = { release: new Promise((r) => (release = r)), held: [] };
  try {
    const page = await context.newPage();
    const logs = [];
    page.on('console', (msg) => ['error', 'warning'].includes(msg.type()) && logs.push(`${msg.type()}: ${msg.text().slice(0, 120)}`));
    page.on('pageerror', (e) => logs.push(`pageerror: ${String(e.message).slice(0, 120)}`));
    await page.addInitScript(INIT, { lang, session: screen.auth === false ? null : opts.session, tour: !!screen.tour });
    const guard = kind === 'dynamic' && !opts.mutate;
    await installRoutes(page, base, { state, guard, delayGets: kind === 'loading' ? 1500 : 0, gate });

    const path = typeof screen.path === 'function' ? screen.path(opts.vars) : screen.path;
    const primarySel = screen.primary ?? 'button.primary';
    const url = base + path;
    const nav = await page.goto(url, { waitUntil: kind === 'loading' ? 'domcontentloaded' : state === 'offline' ? 'load' : 'domcontentloaded', timeout: 30_000 }).catch((e) => e);
    if (nav instanceof Error) {
      add(R('0.reach', 'fail', 1, `cannot open ${url}: ${nav.message.split('\n')[0]}`));
      return rows;
    }
    if (kind === 'loading') {
      await sleep(400);
      const s = await page.evaluate(() => {
        const root = document.querySelector('main') ?? document.body;
        const visible = (e) => e.checkVisibility();
        return { text: root.innerText.trim(), skeleton: [...document.querySelectorAll('[aria-busy="true"],progress,[role="progressbar"],[role="status"],.skeleton,[data-skeleton]')].some(visible) };
      });
      add(P('4.loading', !s.text && !s.skeleton, s.text || s.skeleton ? 0 : 1, s.text ? `shows "${s.text.slice(0, 40)}" while loading` : s.skeleton ? 'skeleton or progress while loading' : 'blank screen while the data loads'));
      return rows;
    }

    // First usable view: heading and primary action visible and enabled, from navigation start (item 7).
    const usable = await page.waitForFunction(({ sel }) => {
      const h = document.querySelector('h1');
      const p = document.querySelector(sel);
      const ok = (e) => e && e.checkVisibility() && !e.disabled;
      return h && h.textContent.trim() && h.checkVisibility() && (!p || ok(p)) ? performance.now() : false;
    }, { sel: primarySel }, { timeout: 15_000, polling: 'raf' }).then((h) => h.jsonValue()).catch(() => null);
    if (state === 'offline') { await context.setOffline(true); release(); }
    else release();
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await sleep(state ? 1200 : 800);

    const reached = new URL(page.url()).pathname;
    const want = path.split('?')[0];
    add(P('0.reach', reached !== want, reached !== want ? 1 : 0, reached === want ? `opened ${want}` : `asked for ${want}, got ${reached}`));
    if (!state) {
      const g = await page.evaluate(() => window.__gate);
      const enforce = opts.speed || !isLocal(base); // opts.speed: the fixture tests run on a local URL; no CLI flag
      add(!enforce ? R('7.usable', 'na', usable ?? 0, `${usable === null ? 'not usable' : Math.round(usable) + ' ms'} (enforced on the deployed URL)`)
        : P('7.usable', usable === null || usable > 2000, usable ?? 99_999, usable === null ? 'heading and primary action never became usable' : `usable at ${Math.round(usable)} ms (limit 2000)`));
      add(P('7.longtask', g.long > 300, Math.round(g.long), `longest task ${Math.round(g.long)} ms (limit 300)`));
      add(P('4.cls', g.cls > 0.01, +g.cls.toFixed(4), `CLS ${g.cls.toFixed(4)} (limit 0.01)`));
    }
    if (screen.prepare) {
      const skip = await screen.prepare(page, opts);
      if (typeof skip === 'string' && skip.startsWith('na')) return [...rows, { screen: label, width, lang, ...R('0.reach', 'na', 0, skip) }];
      await sleep(500);
    }
    for (const [sel, v] of Object.entries(screen.fill ?? {})) await page.locator(sel).first().fill(v).catch(() => {});

    if (kind === 'dynamic') {
      await dynamic(page, primarySel, add);
      return rows;
    }

    const m = await page.evaluate(measure, { width, primary: primarySel });
    judge(m, { width, lang, dicts: opts.dicts }).forEach(add);
    if (state) {
      const t = m.message.text, ok = t.length >= 10 && (m.message.next > 0 || NEXT_STEP.test(t));
      add(P('4.state', !ok, ok ? 0 : 1, ok ? `${state}: "${t.slice(0, 50)}", ${m.message.next} next-step controls` : `${state}: ${t ? `"${t.slice(0, 50)}"` : 'nothing shown'} and ${m.message.next} next-step controls`));
    } else add(P('6.console', logs.length > 0, logs.length, `${logs.length} console errors or warnings${logs.length ? ': ' + logs.slice(0, 3).join('; ') : ''}`));
    if (wanted(opts.only, '3.axe') || wanted(opts.only, '3.contrast')) {
      await page.addScriptTag({ content: axeJs() });
      const v = await page.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'] })).violations.map((x) => ({ id: x.id, impact: x.impact, nodes: x.nodes.length, at: x.nodes[0]?.target.join(' ') })));
      const hard = v.filter((x) => ['serious', 'critical'].includes(x.impact)), contrast = v.filter((x) => x.id === 'color-contrast');
      add(P('3.axe', hard.length > 0, hard.length, `${hard.length} serious or critical axe violations${hard.length ? ': ' + hard.map((x) => `${x.id} (${x.impact}, ${x.nodes}) ${x.at}`).slice(0, 3).join('; ') : ''}`));
      add(P('3.contrast', contrast.length > 0, contrast.length, `${contrast.length} contrast violations${contrast.length ? ': ' + contrast[0].at : ''}`));
    }
    if (opts.shots !== false && !opts.only) {
      const dir = opts.shotDir ?? join(ROOT, 'docs/ux');
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: join(dir, `${label}-${width}-${lang}.png`), fullPage: true });
    }
    return rows;
  } catch (e) {
    add(R('0.run', 'fail', 1, `the cell crashed: ${String(e.message).split('\n')[0]}`));
    return rows;
  } finally {
    await Promise.all(gate.held); // no held write may outlive the context: closing it would release it to the origin
    await context.close();
  }
}

// Keyboard path to the primary action (focus ring, Enter), then the response within 100 ms (items 3 and 4).
async function dynamic(page, primarySel, add) {
  const marked = await page.evaluate((sel) => {
    const p = [...document.querySelectorAll(sel)].find((e) => e.checkVisibility() && !e.disabled);
    p?.setAttribute('data-gate-primary', '');
    return !!p;
  }, primarySel);
  if (!marked) {
    for (const id of ['3.focus', '3.enter', '4.busy']) add(R(id, 'na', 0, 'no enabled primary action on this screen'));
    return;
  }
  await page.evaluate(() => document.activeElement?.blur());
  let reached = false;
  for (let i = 0; i < 100 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.hasAttribute('data-gate-primary'));
  }
  if (!reached) {
    add(R('3.focus', 'fail', 1, 'the primary action cannot be reached with Tab'));
    return add(R('3.enter', 'fail', 1, 'the primary action cannot be reached with Tab'));
  }
  const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { outline: `${cs.outlineStyle} ${cs.outlineWidth}`, ok: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none' }; });
  add(P('3.focus', !ring.ok, ring.ok ? 0 : 1, `focus indicator: outline ${ring.outline}`));
  await page.evaluate(() => {
    window.__act = { clicks: 0, busy: null };
    const isBusy = () => {
      const p = document.querySelector('[data-gate-primary]');
      return !!(p && (p.disabled || p.getAttribute('aria-busy') === 'true')) || [...document.querySelectorAll('[aria-busy="true"],progress,[role="progressbar"]')].some((e) => e.checkVisibility());
    };
    addEventListener('click', () => {
      const t0 = performance.now();
      window.__act.clicks++;
      const poll = () => {
        const dt = performance.now() - t0;
        if (isBusy()) window.__act.busy ??= dt;
        else if (dt < 150) setTimeout(poll, 0);
      };
      poll();
    }, true);
  });
  await page.keyboard.press('Enter'); // Enter on a button is a click event: one activation answers both questions
  await sleep(250);
  const a = await page.evaluate(() => window.__act);
  add(P('3.enter', a.clicks === 0, a.clicks ? 0 : 1, a.clicks ? 'Enter activated the primary action' : 'Enter did not activate the primary action'));
  const ms = a.busy === null ? 99_999 : Math.round(a.busy);
  add(P('4.busy', a.clicks === 0 || a.busy === null || a.busy > 100, ms, a.clicks === 0 ? 'no activation to measure' : a.busy === null ? 'no disabled, aria-busy or progress state within 150 ms' : `busy after ${ms} ms (limit 100)`));
}

// ---- Report ----
const order = (id) => id.split('.').map((x) => x.padStart(3, '0')).join('.');
export function aggregate(rows) {
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.screen}\u0000${r.id}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()].map((g) => {
    const failing = g.filter((r) => r.status === 'fail');
    const pool = failing.length ? failing : g;
    const worst = pool.reduce((a, b) => (b.value > a.value ? b : a));
    const status = failing.length ? 'fail' : g.some((r) => r.status === 'pass') ? 'pass' : g[0].status;
    return { screen: g[0].screen, id: g[0].id, status, value: worst.value, measured: `${worst.measured} @${worst.width}/${worst.lang}`, cells: g.length, failing: failing.length };
  }).sort((a, b) => order(a.id).localeCompare(order(b.id)));
}
const WHAT = { '0.reach': 'screen opens', '1.scroll': 'no horizontal scroll', '1.offscreen': 'nothing off-screen', '1.clip': 'no clipped text', '1.overlap': 'no overlapping text', '1.tables': 'tables reflow or scroll', '2.targets': '44 px targets', '2.inputs': '16 px inputs', '2.primary': 'primary action in the lower 60%', '3.axe': 'axe: 0 serious or critical', '3.contrast': 'contrast AA', '3.focus': 'visible focus ring', '3.enter': 'Enter activates', '3.labels': 'inputs have labels', '3.lang': 'lang follows the language', '4.busy': 'busy within 100 ms', '4.loading': 'no blank while loading', '4.cls': 'CLS 0.01 or less', '4.state': 'designed state with next step', '5.words': 'no developer words', '5.mixed': 'one language per screen', '5.locale': 'numbers and dates in locale', '6.palette': 'approved palette', '6.fonts': 'approved fonts', '6.logo': 'logo present', '6.console': 'no console errors', '6.images': 'SVG or 2x images', '6.primary_count': 'one primary button (reviewer)', '7.usable': 'usable in under 2 s', '7.longtask': 'no task over 300 ms' };
const word = { pass: 'PASS', fail: 'FAIL', info: 'INFO', na: 'N/A' };
const section = (screen, rows, base) => [
  `## ${screen}`, '', `Measured on ${base} at ${new Date().toISOString().slice(0, 16)}Z.`, '',
  '| Item | Result | Measured (worst cell) | Cells failing | Check |', '|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.id} | ${word[r.status]} | ${r.measured.replace(/\|/g, '/')} | ${r.failing}/${r.cells} | ${WHAT[r.id] ?? ''} |`), '',
].join('\n');
const assemble = (exp, blocks) => {
  const failed = Object.values(blocks).join('\n').match(/^\| \S+ \| FAIL \|/gm)?.length ?? 0;
  return `# UX gate: ${exp}\n\nFAILED ITEMS: ${failed}\n\nGenerated by \`npm run ux:gate\` (scripts/ux-gate.mjs). Screenshots are next to this file.\n\n${Object.values(blocks).join('\n')}`;
};
export const renderGate = (exp, sections, base) => assemble(exp, Object.fromEntries(Object.entries(sections).map(([s, rows]) => [s, section(s, rows, base)])));
export function writeGate(file, exp, sections, base) {
  const blocks = {};
  if (existsSync(file)) for (const b of readFileSync(file, 'utf8').split(/^(?=## )/m).slice(1)) blocks[b.match(/^## (\S+)/)[1]] = b;
  for (const [s, rows] of Object.entries(sections)) blocks[s] = section(s, rows, base);
  const rank = (s) => SCREENS.findIndex((x) => s === x.id || s.startsWith(x.id + '-'));
  const sorted = Object.fromEntries(Object.entries(blocks).sort(([a], [b]) => rank(a) - rank(b)));
  writeFileSync(file, assemble(exp, sorted));
}

// ---- Run ----
async function loadDicts() {
  try {
    const dir = join(ROOT, 'src/i18n');
    const [es, en] = await Promise.all(['es', 'en'].map((l) => import(pathToFileURL(join(dir, `${l}.ts`)).href).then((m) => m.default)));
    const dicts = { es: { ...es }, en: { ...en } };
    for (const f of readdirSync(join(dir, 'features')).filter((x) => x.endsWith('.ts'))) {
      const m = await import(pathToFileURL(join(dir, 'features', f)).href);
      Object.assign(dicts.es, m.es);
      Object.assign(dicts.en, m.en);
    }
    return dicts;
  } catch (e) {
    console.warn(`ux-gate: UI dictionaries not loaded (${e.message}); 5.mixed will be N/A`);
    return null;
  }
}

async function demoSession(base) {
  const cfg = await (await fetch(`${base}/api/config`)).json();
  const r = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: cfg.supabaseAnonKey, 'content-type': 'application/json' }, body: JSON.stringify({ email: cfg.demo_email, password: DEMO.password }),
  });
  if (!r.ok) throw new Error(`demo sign-in failed: ${r.status}`);
  return { key: `sb-${new URL(cfg.supabaseUrl).hostname.split('.')[0]}-auth-token`, value: JSON.stringify(await r.json()) };
}

function args(argv) {
  const a = { route: {}, bool: new Set() };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    if (['palette', 'mutate'].includes(k)) a.bool.add(k);
    else if (k === 'route') { const [id, p] = argv[++i].split('='); a.route[id] = p; } else a[k] = argv[++i];
  }
  return a;
}

export async function main(argv) {
  const a = args(argv);
  const base = (a.base ?? process.env.GATE_BASE ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
  const want = !a.screens || a.screens === 'all' ? null : a.screens.split(',');
  const only = a.bool.has('palette') ? ['6.palette'] : a.only?.split(',');
  const picked = SCREENS.filter((s) => !want || want.includes(s.id) || want.includes(s.base));
  if (!picked.length) throw new Error(`no screen matches ${a.screens}; known: ${SCREENS.map((s) => s.id).join(', ')}`);

  const vars = { approveToken: a['approve-token'], statusToken: a['status-token'], invoice: () => 'missing' };
  if (picked.some((s) => typeof s.path === 'function' && s.id.startsWith('detail'))) {
    const ov = await fetch(`${base}/api/demo/overview`).then((r) => r.json()).catch(() => ({ invoices: [] }));
    vars.invoice = (outcome) => ov.invoices?.find((i) => i.outcome === outcome)?.id ?? 'missing';
  }
  const session = picked.some((s) => s.auth !== false && s.exp === 'finance') ? await demoSession(base).catch((e) => { console.error(`ux-gate: ${e.message}`); return null; }) : null;
  const dicts = await loadDicts();
  const opts = { only, dicts, session, vars, mutate: a.bool.has('mutate'), shots: true };

  const cells = [];
  for (const s of picked.map((x) => ({ ...x, path: a.route[x.id] ?? x.path }))) {
    if (s.needs && !vars[s.needs]) { console.log(`ux-gate: ${s.id} skipped (needs --${s.needs.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())})`); continue; }
    const set = [null, ...(s.states ?? [])];
    for (const state of set) for (const lang of LANGS) for (const width of WIDTHS) cells.push({ screen: s, state, width, lang, kind: 'static' });
    for (const lang of LANGS) for (const kind of ['dynamic', 'loading']) if (!only || only.some((p) => (kind === 'dynamic' ? /^(3\.focus|3\.enter|4\.busy)/ : /^4\.loading/).test(p))) cells.push({ screen: s, state: null, width: 390, lang, kind });
  }
  const browser = await launch();
  const rows = [];
  let next = 0;
  const worker = async () => {
    for (let c = cells[next++]; c; c = cells[next++]) {
      const r = await runCell(browser, { ...c, base, opts });
      rows.push(...r);
      console.log(`${c.screen.id}${c.state ? '-' + c.state : ''} ${c.width}/${c.lang} ${c.kind}: ${r.filter((x) => x.status === 'fail').length} failed`);
    }
  };
  await Promise.all(Array.from({ length: JOBS }, worker));
  await browser.close();

  const agg = aggregate(rows);
  let failed = 0;
  for (const exp of new Set(picked.map((s) => s.exp))) {
    const sections = {};
    for (const r of agg) if (picked.find((s) => s.exp === exp && (r.screen === s.id || s.states?.some((st) => r.screen === `${s.id}-${st}`)))) (sections[r.screen] ??= []).push(r);
    if (!only) {
      mkdirSync(join(ROOT, 'docs/ux'), { recursive: true });
      writeGate(join(ROOT, 'docs/ux', `gate-${exp}.md`), exp, sections, base);
    }
    for (const rs of Object.values(sections)) for (const r of rs) if (r.status === 'fail') { failed++; console.log(`FAIL ${r.screen} ${r.id}: ${r.measured}`); }
  }
  console.log(failed ? `UX GATE FAILED: ${failed} items` : 'UX GATE PASSED');
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main(process.argv.slice(2)));
