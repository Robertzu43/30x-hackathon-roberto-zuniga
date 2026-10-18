/* global process, console, fetch, Buffer, URL, setTimeout, SVGElement, addEventListener, document, window, performance, getComputedStyle, innerWidth, innerHeight, NodeFilter, PerformanceObserver, requestAnimationFrame, location, sessionStorage, localStorage, axe */ // Node script + code that runs in the page
// The D38 UX gate (AC-91). Usage:
//   node scripts/ux-gate.mjs --base <url> [--screens inbox,policy|all] [--only 6.palette] [--palette]
//                            [--mutate] [--route id=/path] [--approve-token t] [--status-token t]
//   --slow with --screens entry: R-176's slow-data mode (/api/company held 1.500 ms, /api/screen/inbox 800 ms; 3 runs per door, es)
// Needs Playwright (local node_modules, else the global one) and Chromium (/opt/pw-browsers/chromium, or GATE_CHROMIUM).
// Writes docs/ux/<screen>-<width>-<lang>.png and docs/ux/gate-<experience>.md; exits 1 when any item failed.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// ---- The approved look: web/styles.css at 6d34830 (R-93.5) with R-99 (#787774 -> #6d6c69) and R-100 (#956400 on #fbf3db). The test checks that commit plus exactly these. ----
export const PALETTE = ['#000000', '#111111', '#333333', '#346538', '#6d6c69', '#956400', '#9f2f2d', '#eaeaea', '#edf3ec', '#f1efe9', '#fbf3db', '#fbfbfa', '#fdebec', '#ffffff'];
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
const SERVER_PAGE = 'servidor: sin petición que fallar'; // the real failure page is the server's designed 503, covered by status-invalid
const FX_STATES = ['fx-empty', 'fx-error']; // policy: only GET /api/fx is forced; the rest of the screen loads normally (AC-73)
// "Unread": the agent has not decided the invoice, or the reader could not read it. The demo may have none: then the screen is N/A, not a failure.
export const unreadId = (invoices) => invoices?.find((i) => i.outcome == null || i.fields?.read_error)?.id;
export const EMPTY_BODY = { '/api/period': { budget_usd: null, balance_usd: null, paid_usd: 0, committed_usd: 0, available_usd: null, count_by_outcome: { PAGAR: 0, FRENAR: 0, ESCALAR: 0 }, by_beneficiary: [], autonomy: { n: 0, m: 0 }, autonomy_pct: null, violations: 0, explained_pct: 0 }, '/api/agent/last-run': null, '/api/screen/beneficiaries': { beneficiaries: [] }, '/api/screen/period': { period: { budget_usd: null, balance_usd: null, paid_usd: 0, committed_usd: 0, available_usd: null, count_by_outcome: { PAGAR: 0, FRENAR: 0, ESCALAR: 0 }, by_beneficiary: [], autonomy: { n: 0, m: 0 }, autonomy_pct: null, violations: 0, explained_pct: 0 } } };
// R-165: an empty state is the screen's REAL response, patched (as beneficiary-empty does), never a body the screen cannot read.
export const EMPTY_PATCH = { '/api/screen/inbox': (j) => ({ ...j, invoices: [] }) };
const ERROR_PAGE = /No pude abrir esta pantalla|I could not open this screen/; // the app's generic error page (app.chunk_error): never an empty state
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
// Typed into composers: vendor data, but in the tab's language so it cannot trip 5.mixed or 5.locale (Task 32b).
export const MSG = { es: 'Factura AS-0087 de Ana Souza, 10.000,00 BRL', en: 'Invoice AS-0087 from Ana Souza, 10,000.00 BRL' };
const newInvoice = (i, text) => async (page, o) => {
  await page.locator('[data-tour="new-invoice"]').click();
  await page.locator('[role="tab"]').nth(i).click();
  if (text) await page.locator('form.new-invoice textarea').fill(MSG[o.lang]);
  else await page.locator('form.new-invoice input[type="file"]').setInputFiles({ name: 'Factura AS-0087.png', mimeType: 'image/png', buffer: PNG });
};
// Types the harness message and sends it; the gate answers the POST itself (REPLY, below), so no invoice is read and none is created (AC-85).
const sendPortal = async (page, o) => {
  await page.locator('textarea, input[type="text"]').first().fill(MSG[o.lang]);
  await page.locator('button[type="submit"], button.primary').first().click();
  await page.locator('a[href*="/estado/"]').first().waitFor({ timeout: 10_000 }); // the reply bubble with its status link
};
// The portal Worker's answer to a send ({ ok, reply, status_path }), recorded: the reply shows payee, number and amount as the vendor sees them.
const REPLY = { ok: true, status_path: '/estado/gate-reply-token', reply: {
  es: ['Esto leí en tu factura:', 'Beneficiario: Ana Souza', 'Monto y moneda: 10.000 BRL', 'Número: AS-0941', 'Estado: en revisión'],
  en: ['This is what I read on your invoice:', 'Payee: Ana Souza', 'Amount and currency: 10,000 BRL', 'Number: AS-0941', 'Status: under review'] } };
const clickButton = (name) => async (page) => { await page.getByRole('button', { name }).first().click(); };
export const SCREENS = [
  { id: 'login', exp: 'finance', path: '/login', auth: false, intro: true, fill: { '#login-email': 'gate@example.test' } },
  { id: 'tour', exp: 'finance', path: '/', tour: true, primary: '.tour-card button.primary' },
  { id: 'inbox', exp: 'finance', path: '/', states: STATES },
  { id: 'new-invoice-file', base: 'new-invoice', exp: 'finance', path: '/', primary: 'form.new-invoice button.primary', prepare: newInvoice(0, false) },
  { id: 'new-invoice-email', base: 'new-invoice', exp: 'finance', path: '/', primary: 'form.new-invoice button.primary', prepare: newInvoice(1, true) },
  { id: 'new-invoice-chat', base: 'new-invoice', exp: 'finance', path: '/', primary: 'form.new-invoice button.primary', prepare: newInvoice(2, true) },
  { id: 'detail-pagar', exp: 'finance', path: (v) => `/invoices/${v.invoice('PAGAR')}` },
  { id: 'detail-frenar', exp: 'finance', path: (v) => `/invoices/${v.invoice('FRENAR')}` },
  { id: 'detail-escalar', exp: 'finance', path: (v) => `/invoices/${v.invoice('ESCALAR')}` },
  { id: 'detail-unread', exp: 'finance', path: (v) => `/invoices/${v.unread}`, needs: 'unread', na: 'the demo has no undecided or unreadable invoice' },
  { id: 'ask', exp: 'finance', path: '/' }, // the ask box lives on Bandeja
  { id: 'policy', exp: 'finance', path: '/policy', states: FX_STATES },
  { id: 'beneficiaries', exp: 'finance', path: '/beneficiaries', states: STATES },
  { id: 'period', exp: 'finance', path: '/period', states: STATES },
  { id: 'approve', exp: 'finance', path: (v) => `/approve/${v.approveToken ?? 'invalid'}`, auth: false },
  { id: 'demo', exp: 'finance', path: '/demo', auth: false, intro: true }, // intro: checked after the wordmark intro ends, then once more with reduced motion (D42, AC-108)
  { id: 'portal', exp: 'vendor', path: '/andina-labs', auth: false, states: STATES, primary: 'button[type="submit"], button.primary', compose: 'textarea', send: true, na: { empty: 'sin estado vacío por diseño' } }, // compose: typed before 4.busy, an empty send takes the error path; send: error and offline type a message and send it
  { id: 'portal-reply', exp: 'vendor', path: '/andina-labs', auth: false, prepare: sendPortal, compose: 'textarea', fake: { post: REPLY }, primary: 'button[type="submit"], button.primary' }, // fake.post: every send is answered by the gate; compose: the dynamic pass types before its click
  { id: 'portal-error', exp: 'vendor', path: '/no-such-portal-gate', auth: false, notFound: true }, // designed 404 (R-103)
  { id: 'status', exp: 'vendor', path: (v) => `/estado/${v.statusToken}`, auth: false, states: STATES, needs: 'statusToken', na: { empty: SERVER_PAGE, error: SERVER_PAGE } }, // server-rendered; offline is the page's own notice
  { id: 'status-invalid', exp: 'vendor', path: '/estado/token-invalido-gate', auth: false, notFound: true },
  // D39-D41 (AC-91 Clarified). `session: 'trial'` screens share the run's one anonymous user. The prepare selectors follow AC-94/AC-95's copy; adjust with --route if Task 40/41 names differ.
  { id: 'trial', exp: 'finance', path: '/', session: 'trial', pass: true }, // pass: screenshot at landing, CLS read when the first-login pass ends (R-143)
  { id: 'login-password', exp: 'finance', path: '/login', auth: false, prepare: clickButton(/contraseña|password/i), fill: { '#login-email': 'gate@example.test', '#login-password': 'gate-password' } }, // filled: an empty form stops at the browser's own check, with no busy state
  { id: 'save-access', exp: 'finance', path: '/', session: 'trial', prepare: clickButton(/guardar mi acceso|save my access/i), primary: '.save-access button.primary', fill: { '#save-email': 'gate@example.test', '#save-password': 'gate-password' } }, // without --mutate the save request is held and never sent
  { id: 'leave-trial', exp: 'finance', path: '/', session: 'trial', prepare: clickButton(/cerrar sesión|sign out/i) },
  { id: 'beneficiary', exp: 'finance', path: (v) => `/beneficiaries/${v.beneficiary}`, needs: 'beneficiary', na: 'the demo has no beneficiary' },
  // D42 (AC-109): the hand-over from /login (password door, the public demo user) and from /demo into Bandeja. N/A until the transition exists.
  { id: 'entry', exp: 'finance', path: '/login', auth: false, entry: true, doors: {
    login: { path: '/login', go: async (page, o) => { // slow data: a fresh user of its own company, whose name arrives late (R-176); else the demo user
      const u = o.opts.slow ? await o.opts.vars.pwUser() : { email: o.opts.vars.demoEmail, password: DEMO.password };
      await clickButton(/contraseña|password/i)(page); await page.locator('#login-email').fill(u.email); await page.locator('#login-password').fill(u.password); return page.locator('form:has(#login-password) button[type="submit"]'); } },
    demo: { path: '/demo', go: async (page) => page.getByRole('button', { name: /entrar como andina labs|sign in as andina labs/i }) },
    trial: { path: '/login', go: async (page) => page.getByRole('button', { name: /probar con mi propia empresa|try it with my own company/i }) }, // a new anonymous trial company each run
  } },
  { id: 'beneficiary-empty', base: 'beneficiary', exp: 'finance', path: (v) => `/beneficiaries/${v.beneficiary}`, needs: 'beneficiary', na: 'the demo has no beneficiary', fake: { path: '/api/screen/beneficiary/', patch: (j) => ({ ...j, totals: { paid_month_usd: 0, paid_total_usd: 0, invoices: 0 }, history: [], last: [] }) } }, // the real profile with no payments
];

// The label of one cell's rows, screenshots and table section. A state label must never equal a screen id (portal + error vs the portal-error 404 screen).
export const cellLabel = (screen, state) => {
  const label = screen.id + (state ? '-' + state : '');
  return state && SCREENS.some((s) => s.id === label) ? `${screen.id}-state-${state}` : label;
};

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
  const srOnly = (el) => { // the standard sr-only pattern (1px box, clipped) is hidden on purpose, not clipped text
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return cs.position === 'absolute' && r.width <= 1 && r.height <= 1 && (cs.clip !== 'auto' || cs.clipPath !== 'none');
  };
  const inSrOnly = (el) => { for (let p = el; p; p = p.parentElement) if (srOnly(p)) return true; return false; }; // hidden cells of an sr-only table
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
    if (srOnly(el)) return false;
    return (hid(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) || (hid(cs.overflowY) && el.scrollHeight > el.clientHeight + 1);
  }).map(name));

  const runs = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || !live.has(el) || inSrOnly(el) || !n.textContent.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    if (rects.length) runs.push({ el, text: n.textContent.trim().replace(/\s+/g, ' '), rects, modal: !!el.closest('[aria-modal="true"],[role="dialog"]'), user: !!el.closest('[data-user]') });
  }
  // R-114: x is hidden under an opaque sticky or fixed layer when all four hold: (a) the layer is sticky or fixed and a background
  // from x's element up to the layer is opaque; (b) y is not in the layer; (c) every intersection lies in the layer's box; (d) at its centre the layer is what the page shows.
  const opaque = (el) => { const m = getComputedStyle(el).backgroundColor.match(/^rgba?\((.*)\)$/); const v = m && m[1].split(/[,/ ]+/).filter(Boolean); return !!v && (v.length < 4 || +v[3] === 1); };
  const hidden = (x, y, hits) => {
    for (let l = x.el; l && l !== document.body && l !== document.documentElement; l = l.parentElement) {
      if (!/^(?:sticky|fixed)$/.test(getComputedStyle(l).position) || l.contains(y.el)) continue;
      let solid = false;
      for (let p = x.el; ; p = p.parentElement) { solid ||= opaque(p); if (p === l) break; }
      const box = l.getBoundingClientRect();
      if (solid && hits.every((h) => h.left >= box.left - 0.5 && h.right <= box.right + 0.5 && h.top >= box.top - 0.5 && h.bottom <= box.bottom + 0.5 && l.contains(document.elementFromPoint((h.left + h.right) / 2, (h.top + h.bottom) / 2)))) return true;
    }
    return false;
  };
  const overlaps = [], occluded = [];
  for (let i = 0; i < runs.length; i++)
    for (let j = i + 1; j < runs.length; j++) {
      const a = runs[i], b = runs[j];
      if (a.modal !== b.modal) continue; // a dialog sits over the page by design
      const hits = a.rects.flatMap((r) => b.rects.map((s) => {
        const ix = Math.min(r.right, s.right) - Math.max(r.left, s.left), iy = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
        return ix > 1 && iy > 1 && (ix * iy) / Math.min(r.width * r.height, s.width * s.height) > 0.25 ? { left: Math.max(r.left, s.left), right: Math.min(r.right, s.right), top: Math.max(r.top, s.top), bottom: Math.min(r.bottom, s.bottom) } : null;
      })).filter(Boolean);
      if (!hits.length) continue;
      (hidden(a, b, hits) || hidden(b, a, hits) ? occluded : overlaps).push(`"${a.text.slice(0, 20)}" over "${b.text.slice(0, 20)}"`);
    }
  // R-165: a text run whose right edge passes the edge of its nearest ancestor with a border or a background is clipped or painted over, even without overflow:hidden.
  // An ancestor that scrolls its own content (overflow-x auto or scroll) between the run and that card keeps the text reachable.
  const card = (el) => {
    for (let p = el; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/auto|scroll/.test(cs.overflowX)) return null;
      if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none')) return p;
    }
    return null;
  };
  out.edge = sample(runs.flatMap((r) => { const c = card(r.el), box = c?.getBoundingClientRect(); return box && r.rects.some((x) => x.right > box.right + 1) ? [`"${r.text.slice(0, 24)}" past ${name(c)}`] : []; }));
  out.overlaps = sample(overlaps);
  out.occluded = sample(occluded);
  out.texts = runs.map((r) => r.text);
  out.mine = runs.filter((r) => !r.user).map((r) => r.text); // R-131: the text nodes 5.mixed and 5.locale measure
  out.users = runs.filter((r) => r.user).map((r) => r.text);
  out.marked = els.filter((el) => el.matches('[data-user]')).map((el) => ({ text: el.textContent.trim().replace(/\s+/g, ' '), inside: el.querySelector('button,a,input,select,textarea,label,h1,h2,h3,h4,h5,h6')?.tagName.toLowerCase() ?? null }));
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

  out.main = (document.querySelector('main') ?? document.body).innerText.trim().slice(0, 300);

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
// Codes count only as HTTP error codes: after "error"/"HTTP", or alone on a line when it is a real error status. A bare "160" is an amount.
const DEV = [/\bnull\b/, /\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /^[a-z]+(\.[a-z_]+)+$/, /\b(?:HTTP|status|error|código|code)\W{0,3}[45]\d\d\b/i, /^(?:400|401|403|404|405|408|409|422|429|500|502|503|504)$/, /\bat (?:[\w$.<>]+ \([^)]*:\d+:\d+\)|https?:\/\/\S+:\d+:\d+)/, /\bERR_[A-Z_]+\b/, /\bPGRST\d+\b/, /\bFailed to fetch\b/i, /\bTypeError\b/];
const LOCALE = {
  es: [/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/, /(?<![\d.,])\d+\.\d{2}(?![\d.,])/, /\b(?:January|February|March|April|June|July|August|September|October|November|December)\b/, /\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.? \d/],
  en: [/\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b/, /(?<![\d.,])\d+,\d{2}(?![\d.,])/, /\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i, /\b\d{1,2} (?:ene|abr|ago|dic)\b/],
};
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/;
const NEXT_STEP = /reintent|recarg|vuelve|int[eé]ntalo|intenta|usa |sube|crea|agrega|a[ñn]ade|revisa|comprueba|conecta|p[ií]dele|retry|reload|try again|go back|check|use |upload|add |create|connect|refresh|\bask\b/i;
const TOUR_BUSY = 'el paso cambia al instante, sin petición (R-161)'; // the tour steps in place: no request, so no busy state to wait for
const BY_DESIGN = 'sin acción por diseño (R-103)'; // the two designed 404 pages have no action on purpose
const EXCLUDED_LAYER = 'excluded: occluded by sticky/fixed layer'; // R-114
const EXCLUDED_LINK = 'excluded: expected 404 (invalid link)'; // R-112
const EXCLUDED_404 = 'excluded: expected 404 (AC-83/AC-84)';
const hex = (c) => {
  const m = c.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/);
  return m && (m[4] === undefined || +m[4] > 0) ? '#' + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('') : null;
};
const norm = (s) => s.replace(/["']/g, '').replace(/\s+/g, ' ').toLowerCase();
// R-113: a text is flagged only when the other language's dictionary holds it and this language's own dictionary does not.
// Compared trimmed, whitespace collapsed, case ignored; {placeholders} match any text.
const tidy = (v) => v.replace(/\s+/g, ' ').trim().toLowerCase();
const index = new WeakMap();
const holds = (dict) => {
  if (!index.has(dict)) {
    const exact = new Set(), pats = [];
    for (const v of Object.values(dict)) {
      if (!v.replace(/\{\w+\}/g, '').trim()) continue; // a bare placeholder says nothing about a language
      if (/\{\w+\}/.test(v)) pats.push(new RegExp('^' + tidy(v).replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\w+\}/g, '.+?') + '$'));
      else exact.add(tidy(v));
    }
    index.set(dict, (s) => exact.has(s) || pats.some((re) => re.test(s)));
  }
  return index.get(dict);
};

// R-112: the approve screen opened with an invalid or expired token. Returns the console line to exclude, or null when any condition fails:
// a «Failed to load resource» error for /api/approve/<the page's own token>, observed as 404, with the designed heading and a next step.
const DESIGNED = 'No puedo mostrar este pago';
async function invalidLink(page, screen, logs, responses, { dicts, lang }) {
  if (screen.id !== 'approve') return null;
  const api = `/api/approve/${new URL(page.url()).pathname.split('/')[2]}`;
  const line = logs.findIndex((l) => l.failedLoad && l.text.startsWith('error:') && new URL(l.failedLoad).pathname === api);
  if (line < 0 || !responses.some((r) => r.url === logs[line].failedLoad && r.status === 404)) return null;
  const want = lang === 'es' ? DESIGNED : dicts?.en?.[Object.keys(dicts?.es ?? {}).find((k) => dicts.es[k] === DESIGNED)]; // the en heading is the en entry of the same key
  if (!want) return null;
  const p = await page.evaluate(() => {
    const main = document.querySelector('main') ?? document.body;
    return { heads: [...document.querySelectorAll('h1,h2')].filter((h) => h.checkVisibility()).map((h) => h.textContent), text: main.innerText, controls: [...main.querySelectorAll('button,a[href],[role="button"]')].filter((e) => e.checkVisibility() && !e.closest('header,nav,.lang,.lang-switch')).length };
  });
  return p.heads.some((h) => tidy(h) === tidy(want)) && (p.controls > 0 || NEXT_STEP.test(p.text)) ? { line, controls: p.controls } : null;
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
  rs.push(P('1.edge', m.edge.count > 0, m.edge.count, `${m.edge.count} text runs past the edge of their card${m.edge.count ? ': ' + list(m.edge) : ''}`));
  rs.push(P('1.overlap', m.overlaps.count > 0, m.overlaps.count, `${m.overlaps.count} overlapping text boxes${m.overlaps.count ? ': ' + list(m.overlaps) : ''}${m.occluded.sample.map((p) => `; ${EXCLUDED_LAYER} (${p})`).join('')}`));
  rs.push(width > 768 ? R('1.tables', 'na', 0, 'only checked at 768 px and below') : P('1.tables', m.tables.count > 0, m.tables.count, `${m.tables.count} wide tables without their own scroll${m.tables.count ? ': ' + list(m.tables) : ''}`));
  if (width <= 390) {
    const t = m.targets.small;
    rs.push(P('2.targets', t.length > 0, t.length, `${t.length} of ${m.targets.total} targets under 44 x 44${t.length ? ': ' + t.slice(0, 5).map((x) => `${x.n} ${x.w}x${x.h}`).join('; ') : ''}`));
    const i = m.inputs.small;
    rs.push(P('2.inputs', i.length > 0, i.length, `${i.length} of ${m.inputs.total} inputs under 16 px${i.length ? ': ' + i.map((x) => `${x.n} ${x.px}px`).join('; ') : ''}`));
    if (c.notFound) rs.push(R('2.primary', 'na', 0, BY_DESIGN));
    else if (!m.primary) rs.push(R('2.primary', 'na', 0, 'no primary action on this screen'));
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
  const users = m.users.map((u) => u.slice(0, 60)), skipped = `; excluded: ${users.length} user-data nodes`; // R-131
  const seen = (r) => ({ ...r, users, measured: r.measured + skipped });
  if (!c.dicts) rs.push(seen(R('5.mixed', 'na', 0, 'no UI dictionaries loaded')));
  else {
    const other = holds(c.dicts[lang === 'es' ? 'en' : 'es']), own = holds(c.dicts[lang]);
    const mixed = [...new Set(m.mine)].filter((s) => other(tidy(s)) && !own(tidy(s)));
    rs.push(seen(P('5.mixed', mixed.length > 0, mixed.length, `${mixed.length} strings from the ${lang === 'es' ? 'English' : 'Spanish'} dictionary${mixed.length ? ': ' + mixed.slice(0, 5).join('; ') : ''}`)));
  }
  const loc = m.mine.filter((s) => [...LOCALE[lang], ISO_DATE].some((re) => re.test(s)));
  rs.push(seen(P('5.locale', loc.length > 0, loc.length, `${loc.length} numbers or dates not in ${lang === 'es' ? 'es-CO' : 'en-US'}${loc.length ? ': ' + loc.slice(0, 5).join('; ') : ''}`)));
  // R-131: the marker is for user data only. Literal comparison with the placeholder-free dictionary values, never by pattern.
  const literal = new Set(Object.values(c.dicts ?? {}).flatMap((d) => Object.values(d)).filter((v) => !/\{\w+\}/.test(v)).map(tidy));
  const misuse = m.marked.flatMap((x) => (x.inside ? [`«${x.text.slice(0, 40)}» holds a <${x.inside}>`] : tidy(x.text) && literal.has(tidy(x.text)) ? [`«${x.text.slice(0, 40)}» is a dictionary string`] : []));
  rs.push(P('5.marker', misuse.length > 0, misuse.length, `${misuse.length} of ${m.marked.length} data-user elements misused${misuse.length ? ': ' + misuse.slice(0, 5).join('; ') : ''}`));

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
// D42: the logo's intro runs once per tab; the screenshot and axe wait until no animation is running on it, 1.5 s at most (AC-91 Clarified).
export const logoSettled = (page) => page.waitForFunction(() => { const h = document.querySelector('h1'); return !h || !document.getAnimations().some((a) => a.playState === 'running' && h.contains(a.effect?.target)); }, null, { timeout: 1500 }).catch(() => {});
// First paint of the logo, recorded in the page: with reduced motion nothing runs on it and every part is at rest (opacity 1, no transform).
function logoWatch() {
  const tick = () => {
    const h = document.querySelector('h1');
    if (!h) return requestAnimationFrame(tick);
    const off = [h, ...h.querySelectorAll('*')].filter((e) => { const cs = getComputedStyle(e); return cs.opacity !== '1' || !['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(cs.transform); }).length;
    window.__logo = { running: document.getAnimations().filter((a) => a.playState === 'running' && h.contains(a.effect?.target)).length, off };
  };
  requestAnimationFrame(tick);
}
// The pass is over when Bandeja has rows and none is «Pendiente» (a skeleton row counts as pending until the data arrives).
const passEnded = () => document.querySelectorAll('#invoices tbody tr').length > 0 && !document.querySelector('#invoices tbody .chip-pending');
// Entry (AC-109): recorded from the click. Layout shifts within 500 ms of an input are excused by the browser, so they are collected raw and summed here.
export const entryCls = (shifts, t0) => shifts.filter((x) => x.t >= t0).reduce((n, x) => n + x.v, 0);
// R-176: the entry cells. Normal: every door at 390 and 1440, in es and en. Slow data (--slow): the doors in es, 3 runs each.
export const entryCells = (screen, slow) => Object.keys(screen.doors).flatMap((door) => (slow ? [1, 2, 3] : [0]).flatMap((run) =>
  (slow ? ['es'] : LANGS).flatMap((lang) => [390, 1440].map((width) => ({ screen, state: null, width, lang, kind: 'entry', door, run })))));
const SLOW = { '/api/company': 1500, '/api/screen/inbox': 800 }; // ms each response is held (R-176)
function entryWatch() {
  const e = (window.__e = { t0: null, shifts: [], seen: false, vt: null });
  addEventListener('click', (ev) => { e.t0 = ev.timeStamp; }, true);
  const name = (n) => !n ? '?' : n.nodeType !== 1 ? `#text in ${name(n.parentElement)}` : `${n.tagName.toLowerCase()}${typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\s+/).join('.') : ''}`;
  const box = (r) => `${Math.round(r.y)}+${Math.round(r.height)}`;
  new PerformanceObserver((l) => { for (const x of l.getEntries()) e.shifts.push({ t: x.startTime, v: x.value, src: (x.sources ?? []).map((s) => `${name(s.node)} y ${box(s.previousRect)} -> ${box(s.currentRect)}`) }); }).observe({ type: 'layout-shift' });
  const start = document.startViewTransition?.bind(document);
  if (start) document.startViewTransition = (...a) => { e.vt = start(...a); e.seen = true; return e.vt; };
  const watch = () => { // a transition done with CSS on the page's own elements counts too
    if (e.t0 !== null) for (const a of document.getAnimations()) if (a.effect?.pseudoElement?.startsWith('::view-transition') || a.effect?.target?.closest?.('.login,.demo')) e.seen = true;
    requestAnimationFrame(watch);
  };
  watch();
}
const isLocal = (base) => /^https?:\/\/(127\.0\.0\.1|localhost)[:/]?/.test(base);

function installRoutes(page, base, { state, guard, delayGets, gate, fake }) {
  const origin = new URL(base).origin;
  const patched = async (route, patch) => {
    try { return await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(patch(await (await route.fetch()).json())) }); }
    catch { return route.abort().catch(() => {}); } // the context closed (or the origin dropped) while the request was in flight: nothing left to answer
  };
  return page.route('**/*', async (route) => {
    const req = route.request();
    const data = ['fetch', 'xhr'].includes(req.resourceType()) && req.url().startsWith(origin);
    const path = new URL(req.url()).pathname;
    const config = path === '/api/config';
    if (state === 'offline' && data && !config) { await gate.release; return route.continue(); }
    if (data && path === '/api/fx' && req.method() === 'GET' && state === 'fx-empty') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"provider":"gate","rates":[]}' });
    if (data && path === '/api/fx' && req.method() === 'GET' && state === 'fx-error') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"gate"}' });
    if (data && !config && state === 'error') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"gate"}' });
    if (data && state === 'empty' && req.method() === 'GET' && path in EMPTY_PATCH) return patched(route, EMPTY_PATCH[path]);
    if (data && !config && state === 'empty' && req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(path in EMPTY_BODY ? EMPTY_BODY[path] : []) });
    if (fake?.post && data && req.method() === 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fake.post) });
    if (fake?.path && data && req.method() === 'GET' && path.startsWith(fake.path)) return patched(route, fake.patch);
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
  localStorage.setItem('portal.lang', lang);
  sessionStorage.setItem('lang', lang);
  if (session) localStorage.setItem(session.key, session.value);
  if (tour) sessionStorage.setItem('demo-tour', '1');
};

let axeSource;
const axeJs = () => (axeSource ??= readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));

export async function runCell(browser, job) {
  if (job.kind === 'entry') return runEntry(browser, job);
  const { base, screen, state, width, lang, kind, opts = {} } = job;
  const label = cellLabel(screen, state);
  const rows = [];
  const add = (r) => wanted(opts.only, r.id) && rows.push({ screen: label, width, lang, ...r });
  if (state && screen.na?.[state]) return add(R('4.state', 'na', 0, screen.na[state])), rows; // a designed state this screen has no way to reach
  const context = await browser.newContext({
    viewport: { width, height: HEIGHT[width] ?? 800 },
    deviceScaleFactor: width <= 390 ? 2 : 1,
    hasTouch: width <= 390,
    locale: lang === 'es' ? 'es-CO' : 'en-US',
    ...(kind === 'reduced' && { reducedMotion: 'reduce' }),
  });
  let release;
  const gate = { release: new Promise((r) => (release = r)), held: [] };
  try {
    const page = await context.newPage();
    const logs = [], responses = [];
    page.on('response', (r) => responses.push({ url: r.url(), status: r.status() }));
    page.on('console', (msg) => ['error', 'warning'].includes(msg.type()) && logs.push({ text: `${msg.type()}: ${msg.text().slice(0, 120)}${msg.text().startsWith('Failed to load resource') ? ` <${msg.location().url}>` : ''}`, failedLoad: msg.text().startsWith('Failed to load resource') ? msg.location().url : null }));
    page.on('pageerror', (e) => logs.push({ text: `pageerror: ${String(e.message).slice(0, 120)}` }));
    await page.addInitScript(INIT, { lang, session: screen.auth === false ? null : screen.session === 'trial' ? opts.trialSession : opts.session, tour: !!screen.tour });
    if (kind === 'reduced') await page.addInitScript(logoWatch);
    const guard = kind === 'dynamic' && !opts.mutate;
    await installRoutes(page, base, { state, guard, delayGets: kind === 'loading' ? 1500 : 0, gate, fake: screen.fake });

    const path = typeof screen.path === 'function' ? screen.path(opts.vars) : screen.path;
    const primarySel = screen.notFound ? ':not(*)' : screen.primary ?? 'button.primary';
    const url = base + path + (screen.exp === 'vendor' ? `${path.includes('?') ? '&' : '?'}lang=${lang}` : ''); // the portal never reads the browser language (R-101)
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

    if (kind === 'reduced') { // the second pass of login and demo (D42): the logo is final at first paint
      const s = await page.waitForFunction(() => window.__logo ?? false, null, { timeout: 10_000, polling: 'raf' }).then((h) => h.jsonValue()).catch(() => null);
      add(P('6.reduced', !s || s.running > 0 || s.off > 0, s ? s.running + s.off : 1, !s ? 'no logo heading at first paint' : `${s.running} logo animations running and ${s.off} parts not at rest at first paint`));
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
    if (screen.intro) await logoSettled(page);
    const shoot = async () => {
      if (opts.shots === false || opts.only) return;
      const dir = opts.shotDir ?? join(ROOT, 'docs/ux');
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: join(dir, `${label}-${width}-${lang}.png`), fullPage: true });
    };
    if (screen.pass) await shoot(); // landing, tour step 1 on screen; the pass is still running
    let passNote = '';
    if (screen.pass && !state) {
      passNote = await page.waitForFunction(passEnded, null, { timeout: 45_000 }).then(() => '', () => ', the pass had not ended after 45 s');
      await sleep(300); // layout-shift entries are delivered asynchronously
    }

    const reached = new URL(page.url()).pathname;
    const want = path.split('?')[0];
    add(P('0.reach', reached !== want, reached !== want ? 1 : 0, reached === want ? `opened ${want}` : `asked for ${want}, got ${reached}`));
    const invalid = state ? null : await invalidLink(page, screen, logs, responses, { dicts: opts.dicts, lang });
    const noAction = screen.notFound || (invalid && !invalid.controls); // R-103: a page with no control by design
    if (!state) {
      const g = await page.evaluate(() => window.__gate);
      const enforce = opts.speed || !isLocal(base); // opts.speed: the fixture tests run on a local URL; no CLI flag
      const part = noAction ? `; primary action: ${BY_DESIGN}` : '';
      add(!enforce ? R('7.usable', 'na', usable ?? 0, `${usable === null ? 'not usable' : Math.round(usable) + ' ms'} (enforced on the deployed URL)${part}`)
        : P('7.usable', usable === null || usable > 2000, usable ?? 99_999, usable === null ? `heading${noAction ? '' : ' and primary action'} never became usable` : `usable at ${Math.round(usable)} ms (limit 2000)${part}`));
      add(P('7.longtask', g.long > 300, Math.round(g.long), `longest task ${Math.round(g.long)} ms (limit 300)`));
      add(P('4.cls', g.cls > 0.01, +g.cls.toFixed(4), `CLS ${g.cls.toFixed(4)} (limit 0.01)${screen.pass ? ` from landing to the end of the pass${passNote}` : ''}`));
    }
    if (screen.prepare) {
      const skip = await screen.prepare(page, { ...opts, lang });
      if (typeof skip === 'string' && skip.startsWith('na')) return [...rows, { screen: label, width, lang, skipped: true, ...R('0.reach', 'na', 0, skip) }]; // skipped: the table shows N/A, not the PASS taken before prepare
      await sleep(500);
    }
    for (const [sel, v] of Object.entries(screen.fill ?? {})) await page.locator(sel).first().fill(v).catch(() => {});
    if (state && screen.send) { // the portal has no request on load: its error and offline states appear when a message is sent (answered 500, or sent offline)
      await page.locator(screen.compose).first().fill(MSG[lang]);
      await page.locator(primarySel).first().click();
      await sleep(800);
    }

    if (kind === 'dynamic') {
      await dynamic(page, screen, primarySel, add, noAction, lang);
      return rows;
    }

    const m = await page.evaluate(measure, { width, primary: primarySel });
    judge(m, { width, lang, dicts: opts.dicts, notFound: noAction }).forEach(add);
    if (state || screen.notFound) {
      // A designed 404 page needs no control: its sentence is the next step.
      const t = screen.notFound ? m.message.text || m.main : m.message.text, ok = t.length >= 10 && ((!screen.notFound && m.message.next > 0) || NEXT_STEP.test(t));
      const what = state ?? '404';
      if (state === 'empty' && ERROR_PAGE.test(`${m.message.text} ${m.main}`)) add(R('4.state', 'fail', 1, `empty: the generic error page is showing, not an empty state: "${t.slice(0, 50)}"`));
      else add(P('4.state', !ok, ok ? 0 : 1, ok ? `${what}: "${t.slice(0, 50)}", ${m.message.next} next-step controls` : `${what}: ${t ? `"${t.slice(0, 50)}"` : 'nothing shown'} and ${m.message.next} next-step controls`));
    }
    if (!state) {
      // Exactly one line may be excluded: R-103, the browser's own 404 for the main document of a designed 404 page; R-112, the expected 404 of an invalid approval link.
      const skip = screen.notFound && nav?.status() === 404 ? logs.findIndex((l) => l.failedLoad === nav.url()) : invalid?.line ?? -1;
      const left = logs.filter((_, i) => i !== skip).map((l) => l.text);
      add(P('6.console', left.length > 0, left.length, `${left.length} console errors or warnings${left.length ? ': ' + left.slice(0, 3).join('; ') : ''}${skip >= 0 ? `; ${invalid ? EXCLUDED_LINK : EXCLUDED_404}` : ''}`));
    }
    if (wanted(opts.only, '3.axe') || wanted(opts.only, '3.contrast')) {
      await page.evaluate(axeJs()); // not addScriptTag: a script-src CSP refuses it (the portal's does); evaluate is not subject to the page's CSP
      const v = await page.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'] })).violations.map((x) => ({ id: x.id, impact: x.impact, nodes: x.nodes.length, at: x.nodes[0]?.target.join(' ') })));
      const hard = v.filter((x) => ['serious', 'critical'].includes(x.impact)), contrast = v.filter((x) => x.id === 'color-contrast');
      add(P('3.axe', hard.length > 0, hard.length, `${hard.length} serious or critical axe violations${hard.length ? ': ' + hard.map((x) => `${x.id} (${x.impact}, ${x.nodes}) ${x.at}`).slice(0, 3).join('; ') : ''}`));
      add(P('3.contrast', contrast.length > 0, contrast.length, `${contrast.length} contrast violations${contrast.length ? ': ' + contrast[0].at : ''}`));
    }
    if (!screen.pass) await shoot();
    return rows;
  } catch (e) {
    add(R('0.run', 'fail', 1, `the cell crashed: ${String(e.message).split('\n')[0]}`));
    return rows;
  } finally {
    await Promise.all(gate.held); // no held write may outlive the context: closing it would release it to the origin
    await context.close();
  }
}

// AC-109: the hand-over from a door into Bandeja, checked for CLS from the click to the end of the transition (item 4) and for console lines (item 6).
// N/A while the app starts no transition (neither a View Transition nor an animation on the login or demo page).
async function runEntry(browser, { base, screen, door, width, lang, run, opts = {} }) {
  const rows = [];
  const add = (r) => wanted(opts.only, r.id) && rows.push({ screen: opts.slow ? `${screen.id}-slow` : screen.id, width, lang, ...r });
  const context = await browser.newContext({ viewport: { width, height: HEIGHT[width] ?? 800 }, deviceScaleFactor: width <= 390 ? 2 : 1, hasTouch: width <= 390, locale: lang === 'es' ? 'es-CO' : 'en-US' });
  try {
    const page = await context.newPage();
    const logs = [];
    page.on('console', (m) => ['error', 'warning'].includes(m.type()) && logs.push(`${m.type()}: ${m.text().slice(0, 120)}`));
    page.on('pageerror', (e) => logs.push(`pageerror: ${String(e.message).slice(0, 120)}`));
    await page.addInitScript(INIT, { lang, session: null, tour: false });
    const held = []; // slow data: each held response, so the reading waits until the late data is on screen
    if (opts.slow) await page.route((u) => new URL(u).pathname in SLOW, async (route) => {
      const p = sleep(SLOW[new URL(route.request().url()).pathname]).then(() => route.fallback()).catch(() => {});
      held.push(p);
      return p;
    });
    const { path, go } = screen.doors[door];
    await page.goto(base + path, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForSelector('h1', { timeout: 15_000 });
    await logoSettled(page);
    const click = await go(page, { lang, opts });
    logs.length = 0; // item 6 counts from the click
    await page.evaluate(entryWatch);
    await click.click();
    await page.waitForFunction(() => location.pathname === '/', null, { timeout: 15_000, polling: 'raf' });
    await page.evaluate(() => window.__e.vt?.finished.catch(() => {})); // the end of the transition
    await sleep(150);
    let until = 'the end of the transition';
    if (opts.slow) { // R-176: on until the held data has arrived and painted, and for a door with a pass until it ends (AC-107)
      await sleep(SLOW['/api/company'] + 200); // the company name is asked for after landing
      await Promise.all(held);
      await sleep(500);
      until = 'the late data';
      if (door !== 'demo' && await page.$('#invoices') && await page.waitForFunction(passEnded, null, { timeout: 60_000, polling: 500 }).then(() => true, () => false)) until = 'the end of the pass'; // a new user's first login has a pass; the demo user never does
      await sleep(300);
    }
    const e = await page.evaluate(() => ({ t0: window.__e.t0, shifts: window.__e.shifts, seen: window.__e.seen }));
    if (!e.seen) return ['4.cls', '6.console'].forEach((id) => add(R(id, 'na', 0, `${door} door: the entry transition (AC-109) does not exist yet`))), rows;
    const cls = entryCls(e.shifts, e.t0);
    const mode = opts.slow ? ` (slow data: /api/company +${SLOW['/api/company']} ms, /api/screen/inbox +${SLOW['/api/screen/inbox']} ms; run ${run})` : '';
    const why = cls > 0.01 ? `; moved: ${[...new Set(e.shifts.filter((x) => x.t >= e.t0).flatMap((x) => x.src))].slice(0, 4).join('; ')}` : '';
    add(P('4.cls', cls > 0.01, +cls.toFixed(4), `${door} door${mode}: CLS ${cls.toFixed(4)} from the click to ${until} (limit 0.01)${why}`));
    add(P('6.console', logs.length > 0, logs.length, `${door} door: ${logs.length} console errors or warnings from the click${logs.length ? ': ' + logs.slice(0, 3).join('; ') : ''}`));
    return rows;
  } catch (e) {
    add(R('0.run', 'fail', 1, `${door} door: the cell crashed: ${String(e.message).split('\n')[0]}`));
    return rows;
  } finally {
    await context.close();
  }
}

// Keyboard path to the primary action (focus ring, Enter), then the response within 100 ms (items 3 and 4).
async function dynamic(page, screen, primarySel, add, noAction, lang) {
  if (noAction) return ['3.focus', '3.enter', '4.busy'].forEach((id) => add(R(id, 'na', 0, BY_DESIGN)));
  if (screen.compose) await page.locator(screen.compose).first().fill(MSG[lang]); // a send with nothing typed takes the error path and shows no busy state
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
  await page.evaluate((tour) => {
    window.__act = { clicks: 0, busy: null };
    const step = () => document.querySelector('.tour-card header p')?.textContent ?? null; // R-161: the tour's «n de 7» counter; null once the tour has closed
    const step0 = step();
    const isBusy = () => {
      if (tour) return step() !== step0; // here "busy" means the step changed
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
  }, !!screen.tour);
  await page.keyboard.press('Enter'); // Enter on a button is a click event: one activation answers both questions
  await sleep(250);
  const a = await page.evaluate(() => window.__act);
  add(P('3.enter', a.clicks === 0, a.clicks ? 0 : 1, a.clicks ? 'Enter activated the primary action' : 'Enter did not activate the primary action'));
  const ms = a.busy === null ? 99_999 : Math.round(a.busy);
  if (screen.tour) return add(!a.clicks || (a.busy !== null && a.busy <= 100) ? R('4.busy', 'na', 0, a.clicks ? TOUR_BUSY : 'no activation to measure') : R('4.busy', 'fail', ms, `the «n de 7» counter and the tour's closing did not change within 100 ms of the click on «Siguiente»${a.busy === null ? '' : ` (${ms} ms)`}`));
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
    const skipped = failing.length ? undefined : g.find((r) => r.skipped);
    const pool = failing.length ? failing : g;
    const shown = (r) => r.users?.length ?? +r.measured.includes('excluded:');
    const worst = skipped ?? pool.reduce((a, b) => (b.value > a.value || (b.value === a.value && shown(b) > shown(a)) ? b : a)); // a tie keeps the row that printed the most exclusions
    const users = {}; // R-131: per language, the biggest count and every distinct text excluded
    for (const r of g) if (r.users) { const u = (users[r.lang] ??= { n: 0, texts: new Set() }); u.n = Math.max(u.n, r.users.length); r.users.forEach((t) => u.texts.add(t)); }
    const status = failing.length ? 'fail' : skipped ? 'na' : g.some((r) => r.status === 'pass') ? 'pass' : g[0].status;
    return { screen: g[0].screen, id: g[0].id, status, value: worst.value, measured: `${worst.measured} @${worst.width}/${worst.lang}`, cells: g.length, failing: failing.length, ...(Object.keys(users).length && { users }) };
  }).sort((a, b) => order(a.id).localeCompare(order(b.id)));
}
const WHAT = { '0.reach': 'screen opens', '1.scroll': 'no horizontal scroll', '1.offscreen': 'nothing off-screen', '1.clip': 'no clipped text', '1.edge': 'text inside its card', '1.overlap': 'no overlapping text', '1.tables': 'tables reflow or scroll', '2.targets': '44 px targets', '2.inputs': '16 px inputs', '2.primary': 'primary action in the lower 60%', '3.axe': 'axe: 0 serious or critical', '3.contrast': 'contrast AA', '3.focus': 'visible focus ring', '3.enter': 'Enter activates', '3.labels': 'inputs have labels', '3.lang': 'lang follows the language', '4.busy': 'busy within 100 ms', '4.loading': 'no blank while loading', '4.cls': 'CLS 0.01 or less', '4.state': 'designed state with next step', '5.words': 'no developer words', '5.mixed': 'one language per screen', '5.locale': 'numbers and dates in locale', '5.marker': 'data-user used for user data only', '6.palette': 'approved palette', '6.fonts': 'approved fonts', '6.logo': 'logo present', '6.reduced': 'logo at rest at first paint (reduced motion)', '6.console': 'no console errors', '6.images': 'SVG or 2x images', '6.primary_count': 'one primary button (reviewer)', '7.usable': 'usable in under 2 s', '7.longtask': 'no task over 300 ms' };
const word = { pass: 'PASS', fail: 'FAIL', info: 'INFO', na: 'N/A' };
// R-131: every text 5.mixed and 5.locale skipped, for the UX reviewer. Any listed product copy is a blocking finding.
const excludedList = (users = {}) => LANGS.filter((l) => users[l]?.n).length
  ? ['User data excluded from 5.mixed and 5.locale (data-user). The UX reviewer reads this list.', '', ...LANGS.filter((l) => users[l]?.n).flatMap((l) => [`- ${l}: excluded: ${users[l].n} user-data nodes`, ...[...users[l].texts].map((t) => `  - ${t}`)]), '']
  : [];
const section = (screen, rows, base) => [
  `## ${screen}`, '', `Measured on ${base} at ${new Date().toISOString().slice(0, 16)}Z.`, '',
  '| Item | Result | Measured (worst cell) | Cells failing | Check |', '|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.id} | ${word[r.status]} | ${r.measured.replace(/\|/g, '/')} | ${r.failing}/${r.cells} | ${WHAT[r.id] ?? ''} |`), '',
  ...excludedList(rows.find((r) => Object.keys(r.users ?? {}).length)?.users),
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

export async function demoSession(base) {
  const cfg = await (await fetch(`${base}/api/config`)).json();
  const r = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: cfg.supabaseAnonKey, 'content-type': 'application/json' }, body: JSON.stringify({ email: cfg.demo_email, password: DEMO.password }),
  });
  if (!r.ok) throw new Error(`demo sign-in failed: ${r.status}`);
  return { key: `sb-${new URL(cfg.supabaseUrl).hostname.split('.')[0]}-auth-token`, value: JSON.stringify(await r.json()) };
}

// An anonymous Supabase user (AC-92): one per run, never deleted (AC-07). Only runs that pick a `session: 'trial'` screen create it.
export async function trialSession(base) {
  const cfg = await (await fetch(`${base}/api/config`)).json();
  const r = await fetch(`${cfg.supabaseUrl}/auth/v1/signup`, { method: 'POST', headers: { apikey: cfg.supabaseAnonKey, 'content-type': 'application/json' }, body: '{"data":{}}' });
  if (!r.ok) throw new Error(`anonymous sign-in failed: ${r.status}`);
  return { key: `sb-${new URL(cfg.supabaseUrl).hostname.split('.')[0]}-auth-token`, value: JSON.stringify(await r.json()) };
}

// R-176: a confirmed password user made with the Admin API (QA's way; nothing is ever deleted). Needs SUPABASE_SERVICE_ROLE_KEY.
// A new company takes its name from the email's local part: this one is longer than the top bar's name slot on purpose.
// The tour is marked seen: its overlay scrolls the page, and scroll anchoring would hide a shift under the top bar.
export async function adminUser(supabaseUrl, key) {
  const rnd = () => Math.random().toString(36).slice(2, 10);
  const u = { email: `gate-r176-${rnd()}-cuentas-por-pagar@example.com`, password: `Gate-${rnd()}9z` };
  const r = await fetch(`${supabaseUrl}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...u, email_confirm: true, user_metadata: { tour_seen: true } }) });
  if (!r.ok) throw new Error(`admin user failed: ${r.status}`);
  return u;
}

function args(argv) {
  const a = { route: {}, bool: new Set() };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    if (['palette', 'mutate', 'slow'].includes(k)) a.bool.add(k);
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
  const rows = [];
  if (picked.some((s) => typeof s.path === 'function' && s.id.startsWith('detail'))) {
    const ov = await fetch(`${base}/api/demo/overview`).then((r) => r.json()).catch(() => ({ invoices: [] }));
    vars.invoice = (outcome) => ov.invoices?.find((i) => i.outcome === outcome)?.id ?? 'missing';
    vars.unread = unreadId(ov.invoices);
  }
  const session = picked.some((s) => s.auth !== false && s.exp === 'finance') ? await demoSession(base).catch((e) => { console.error(`ux-gate: ${e.message}`); return null; }) : null;
  const trialSess = picked.some((s) => s.session === 'trial') ? await trialSession(base).catch((e) => { console.error(`ux-gate: ${e.message}`); return null; }) : null;
  if (picked.some((s) => s.needs === 'beneficiary') && session) {
    const list = await fetch(`${base}/api/beneficiaries`, { headers: { authorization: `Bearer ${JSON.parse(session.value).access_token}` } }).then((r) => r.json()).catch(() => []);
    vars.beneficiary = Array.isArray(list) ? list[0]?.id : undefined;
  }
  if (picked.some((s) => s.entry)) {
    const cfg = await fetch(`${base}/api/config`).then((r) => r.json()).catch(() => ({}));
    vars.demoEmail = cfg.demo_email;
    if (a.bool.has('slow') && !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('--slow: the password door needs SUPABASE_SERVICE_ROLE_KEY for its Admin-API users');
    vars.pwUser = () => adminUser(cfg.supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  const dicts = await loadDicts();
  const opts = { only, dicts, session, trialSession: trialSess, vars, mutate: a.bool.has('mutate'), slow: a.bool.has('slow'), shots: true };

  const cells = [];
  for (const s of picked.map((x) => ({ ...x, path: a.route[x.id] ?? x.path }))) {
    if (s.needs && !vars[s.needs]) {
      if (s.na) { console.log(`ux-gate: ${s.id} N/A (${s.na})`); rows.push({ screen: s.id, width: 390, lang: 'es', ...R('0.reach', 'na', 0, s.na) }); } else console.log(`ux-gate: ${s.id} skipped (needs --${s.needs.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())})`);
      continue;
    }
    if (s.entry) { cells.push(...entryCells(s, a.bool.has('slow'))); continue; }
    const set = [null, ...(s.states ?? [])];
    for (const state of set) for (const lang of LANGS) for (const width of WIDTHS) cells.push({ screen: s, state, width, lang, kind: 'static' });
    for (const lang of LANGS) for (const kind of ['dynamic', 'loading', ...(s.intro ? ['reduced'] : [])]) if (!only || only.some((p) => (kind === 'dynamic' ? /^(3\.focus|3\.enter|4\.busy)/ : kind === 'reduced' ? /^6\.reduced/ : /^4\.loading/).test(p))) cells.push({ screen: s, state: null, width: 390, lang, kind });
  }
  const browser = await launch();
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
    for (const r of agg) if (picked.find((s) => s.exp === exp && (r.screen === s.id || s.states?.some((st) => r.screen === cellLabel(s, st))))) (sections[r.screen] ??= []).push(r);
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
