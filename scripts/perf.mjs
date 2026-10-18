/* global process, console, fetch, URL, Buffer, document, location, localStorage, performance, requestAnimationFrame, setTimeout, window, addEventListener */ // Node script + code that runs in the page
// The D40 perf harness (AC-97). Usage:
//   node scripts/perf.mjs --base <url> [--portal <url>] [--status-token t] [--trial]
// The cache-miss row waits 61 s before each of its samples (about 3 minutes). The entry rows (AC-97 targets 5 and 6) sign in for real: 3 demo sign-ins, and with --trial 3 anonymous users (never deleted, AC-96's 30 per hour); the OTP and password rows need SUPABASE_SERVICE_ROLE_KEY in the environment (QA users are created if missing, never deleted, the key is never printed) and else are N/A. A first login runs the agent over the QA user's pending invoices.
// Needs Playwright and Chromium (/opt/pw-browsers/chromium, or GATE_CHROMIUM). Writes docs/perf.md; exits 1 when any row is a FAIL.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { demoSession, launch, trialSession } from './ux-gate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VIEWPORT = { width: 1440, height: 900 };
const RUNS = 3; // median of 3 (targets 1 and 2)
const SAMPLES = 20, WARMUPS = 2; // sequential requests (target 3)
const SAMPLE_WAIT = 61_000; // the demo overview is cached for 60 s (R-122)
const T = { load: 2000, head: 100, data: 1000, api: 600, js: 250, entry: 2000, decided: 30_000 };
const QA = { otp: 'qa-perf-otp@example.com', password: 'qa-perf-password@example.com' };

// ---- Pure helpers (tested on fixtures) ----
export const median = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.ceil(0.95 * xs.length) - 1]; // nearest rank
export const gzSum = (bodies) => bodies.reduce((n, b) => n + gzipSync(b, { level: 9 }).length, 0);
export const judge = (value, target, within = false) => (value != null && (within ? value <= target : value < target) ? 'PASS' : 'FAIL');
export const coloOf = (cfRay) => cfRay?.split('-').pop() ?? '?';
export const criticalApis = (reqs, origin) => {
  const seen = new Set();
  return reqs.filter((r) => r.method === 'GET' && r.url.startsWith(`${origin}/api/`) && !seen.has(r.url) && seen.add(r.url));
};

// Cache-miss row (AC-97 Clarified, R-140): INFO, never graded. The Worker sets no cache header of its own; the edge's `cf-cache-status` (or a positive `age`) marks a HIT.
export const isHit = (h) => /^HIT/i.test(h['cf-cache-status'] ?? '') || Number(h.age) > 0;
export async function missRow({ once, wait, n = 3, tries = 3 }) { // once() -> { ms, headers }; each sample is preceded by a wait, so a HIT is retried after a further wait
  const base = { screen: 'demo overview (cache miss)', metric: 'Median of 3 uncached requests', unit: 'ms', info: true };
  const ms = [];
  for (let i = 0; i < n * tries && ms.length < n; i++) {
    await wait();
    const r = await once();
    if (r.error) return { ...base, value: null, why: r.error };
    if (!isHit(r.headers)) ms.push(r.ms);
  }
  return ms.length < n ? { ...base, value: null, why: `cache header stayed HIT in ${n * tries} samples` } : { ...base, value: Math.round(median(ms)) };
}

// ---- Entry rows (AC-97 targets 5 and 6, R-146): from the click on an entry button to a usable Bandeja ----
// One sample: { ms, pending, decided } (pending: rows still «Pendiente» at landing; decided: click to every row decided, trial only) or { error }.
const kindOf = (ss) => {
  const first = ss.filter((x) => x.pending > 0).length;
  return `${first} first login with pending invoices, ${ss.length - first} returning`;
};
// R-150's INFO columns, never graded. `signin` and `inbox` are Resource Timing entries (the page's own clock, as t0 is); `header` is the Server-Timing value of /api/screen/inbox.
export const serverTiming = (h) => { const m = /(?:^|,)\s*app\s*;(?:[^,]*;)?\s*dur=([\d.]+)/i.exec(h ?? ''); return m ? Number(m[1]) : null; };
export const entryTimes = ({ t0, signin, inbox, header }) => ({
  signin: signin ? signin.responseEnd - t0 : null,
  gap: signin && inbox ? inbox.startTime - signin.responseEnd : null,
  req: inbox ? inbox.responseEnd - inbox.startTime : null,
  server: serverTiming(header),
  bytes: inbox ? inbox.decodedBodySize : null,
});
const col = (infos, k, unit) => { const v = infos.map((i) => i[k]).filter((x) => x != null); return v.length ? `${Math.round(median(v))} ${unit}` : 'n/a'; };
export const entryExtra = (infos, baseline) => `INFO: sign-in ${col(infos, 'signin', 'ms')}; gap ${col(infos, 'gap', 'ms')}; inbox request ${col(infos, 'req', 'ms')}; server ${col(infos, 'server', 'ms')}; ${col(infos, 'bytes', 'bytes')}; /api/health baseline ${baseline} ms`;

export function entryRows(screen, who, samples, baseline) {
  const bad = samples.find((x) => x.error);
  const base = { unit: 'ms', target: T.entry };
  const note = `${who}; ${kindOf(samples.filter((x) => !x.error))}`;
  const rows = [{ ...base, screen, metric: `Click to usable Bandeja, median of 3 (${note})`, value: bad ? null : Math.round(median(samples.map((x) => x.ms))), why: bad?.error, extra: bad ? undefined : entryExtra(samples.map((x) => x.info), baseline) }];
  if (screen === 'entry trial') {
    const none = samples.some((x) => x.decided == null);
    rows.push({ screen: 'entry trial (all decided)', metric: 'Click to every row decided, median of 3', unit: 'ms', target: T.decided, within: true, value: none ? null : Math.round(median(samples.map((x) => x.decided))), why: bad?.error ?? 'a row was still «Pendiente» after the wait: decided' });
  }
  return rows;
}

// The Admin API, for the QA users and the OTP code. `key` is the service-role key: it only goes in headers, never in a message or a log.
export function admin(url, key, f = fetch) {
  const call = async (path, method, body) => {
    const r = await f(`${url}/auth/v1/admin/${path}`, { method, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
  const must = (what, r) => { if (r.status >= 400) throw new Error(`${what}: HTTP ${r.status}`); return r.json; };
  const link = async (email) => { const j = must('generate_link', await call('generate_link', 'POST', { type: 'magiclink', email })); if (!j.email_otp) throw new Error('generate_link: no code in the answer'); return j; };
  return {
    code: async (email) => (await link(email)).email_otp,
    async ensure(email, password) { // 422: the user exists. Nothing here deletes.
      const made = await call('users', 'POST', { email, email_confirm: true });
      if (made.status !== 422) must('create QA user', made);
      if (password) must('set QA password', await call(`users/${(await link(email)).id}`, 'PUT', { password }));
    },
  };
}

// R-146: the browser's send-code request is answered here with a 200 (no mail leaves), so nothing reaches /auth/v1/otp upstream.
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
export const OTP_URL = /\/auth\/v1\/otp(\?|$)/;
export const otpGuard = (route) => route.request().method() === 'OPTIONS'
  ? route.fulfill({ status: 204, headers: CORS })
  : route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{}' });

// The 17:40Z numbers, measured before D40 and kept as the first row for comparison. The size basis (raw or gzip) was not recorded.
export const ROW0 = `## Row 0: baseline at 17:40Z, before D40

| Measure | Value | Target | Result |
|---|---|---|---|
| \`/api/demo/overview\`, one request | 2.27 s | p95 under 600 ms | above target |
| JavaScript, one bundle | 626 KB | gzipped under 250 KB | above target |
`;

const cell = (r) => (r.na ? `N/A (${r.na})` : r.value == null ? `not measured (${r.why})` : `${r.value} ${r.unit}${r.extra ? ` (${r.extra})` : ''}`);
const verdict = (r) => (r.na ? 'N/A' : r.info ? 'INFO' : judge(r.value, r.target, r.within));
export function renderPerf({ when, base, portal, colo, country, rows }) {
  const failed = rows.filter((r) => verdict(r) === 'FAIL').length;
  return `# Performance (AC-97)

${ROW0}
## Latest run

- Measured at ${when.slice(0, 16).replace('T', ' ')} UTC on ${base}${portal ? ` and ${portal}` : ''}.
- Measured from: Cloudflare colo ${colo} (from \`cf-ray\`), egress country ${country} (from \`/cdn-cgi/trace\`). Chromium, ${VIEWPORT.width}x${VIEWPORT.height}, a fresh context and empty cache per first load.
- FAILED ROWS: ${failed}

| Screen | Measure | Value | Target | Result |
|---|---|---|---|---|
${rows.map((r) => `| ${r.screen} | ${r.metric} | ${cell(r)} | ${r.info ? 'not graded' : `${r.within ? 'within' : 'under'} ${r.target} ${r.unit}`} | ${verdict(r)} |`).join('\n')}
`;
}

// An error is a FAIL (value null, why = the message); N/A only when every run succeeded and the link was truly absent.
export function navRows(s, runs) {
  const err = runs.find((r) => r?.error);
  if (err) return [{ screen: s.id, metric: 'In-app navigation', value: null, why: err.error, unit: 'ms', target: T.head, within: true }];
  if (runs.includes(null)) return [{ screen: s.id, metric: 'In-app navigation', na: 'link not found on the origin screen', target: T.head, unit: 'ms' }];
  return [
    { screen: s.id, metric: 'Navigation to heading or skeleton, median of 3', value: Math.round(median(runs.map((n) => n.head))), unit: 'ms', target: T.head, within: true },
    { screen: s.id, metric: 'Navigation to data rendered, median of 3', value: Math.round(median(runs.map((n) => n.data))), unit: 'ms', target: T.data },
  ];
}
export const portalRows = (portalOk) => (portalOk ? [] : [{ screen: 'portal, status', metric: 'First load, median of 3', value: null, why: 'facturas Worker not measured (pass --portal)', unit: 'ms', target: T.load }]);

// ---- Screens ----
export const PRIMARY = 'button.primary'; // the one primary action: «Probar con mi propia empresa» on /login (R-120)
const SUBMIT = 'button[type="submit"], button.primary';
const MAIN = [
  { id: 'login', path: '/login', auth: false, js: true, door: true },
  { id: 'demo', path: '/demo', auth: false, js: true },
  { id: 'inbox', path: '/', from: '/policy', js: true },
  { id: 'detail PAGAR', path: (v) => `/invoices/${v.PAGAR}`, from: '/', link: (v) => `/invoices/${v.PAGAR}`, needs: 'PAGAR' },
  { id: 'detail ESCALAR', path: (v) => `/invoices/${v.ESCALAR}`, from: '/', link: (v) => `/invoices/${v.ESCALAR}`, needs: 'ESCALAR' },
  { id: 'period', path: '/period', from: '/' },
  { id: 'beneficiaries', path: '/beneficiaries', from: '/' },
  { id: 'beneficiary', path: (v) => `/beneficiaries/${v.beneficiary}`, from: '/beneficiaries', link: (v) => `/beneficiaries/${v.beneficiary}`, needs: 'beneficiary', na: 'AC-104 not shipped or no beneficiary' },
  { id: 'policy', path: '/policy', from: '/' },
  { id: 'inbox (trial)', path: '/', trial: true, needs: 'trial', na: 'run with --trial (needs the trial door, AC-92)' },
];
const PORTAL = [
  { id: 'portal', path: '/andina-labs?lang=es', primary: SUBMIT },
  { id: 'status', path: (v) => `/estado/${v.statusToken}`, needs: 'statusToken', na: 'run with --status-token <token>' },
];

// ---- In the page ----
const INIT = ({ session }) => {
  localStorage.setItem('lang', 'es');
  localStorage.setItem('portal.lang', 'es');
  if (session) localStorage.setItem(session.key, session.value);
  window.__p = { pending: 0 };
  const f = window.fetch; // counts the API calls in flight, so "data rendered" means none are pending
  window.fetch = (...a) => { window.__p.pending++; return f(...a).finally(() => window.__p.pending--); };
};
const SIGNIN = /\/auth\/v1\/(token|verify|signup)(\?|$)/, INBOX = /\/api\/screen\/inbox(\?|$)/; // not /auth/v1/otp, the send-code step
const SKELETON = '[aria-busy="true"],progress,[role="progressbar"],.skeleton,[data-skeleton]'; // an empty role="status" is a live region, not a loader
export const usable = ({ sel, need }) => { // AC-91 item 7: the heading and the primary action are visible and enabled (`need`: the action must exist)
  const h = document.querySelector('h1');
  const named = h && (h.textContent.trim() || h.querySelector('img[alt]')?.alt.trim()); // the login heading is the logo image (AC-80): its alt is its name
  const ok = [...document.querySelectorAll(sel)].some((e) => e.checkVisibility() && !e.disabled);
  return named && h.checkVisibility() && (ok || (!need && !document.querySelector(sel))) ? performance.now() : false;
};
// AC-97 target 5's t1: the first frame at which Bandeja is at /, its heading shows, the table is rendered from data (no .skeleton ancestor; a row, or the designed empty state),
// «Nueva factura» is enabled and no entry transition runs. «Ejecutar agente» counts when enabled and also when busy (first-login pass), so it is not tested for enabled.
export const entryReady = () => {
  const vis = (e) => !!e && e.checkVisibility();
  const sec = document.querySelector('#invoices');
  const row = sec?.querySelector('table.inbox-list tbody tr');
  const rendered = sec && !sec.closest('.skeleton') && !row?.closest('.skeleton') && (row || sec.querySelector('p.muted'));
  const nueva = document.querySelector('[data-tour="new-invoice"]');
  let moving = (document.getAnimations?.() ?? []).some((a) => a.playState === 'running' && a.effect?.pseudoElement?.startsWith('::view-transition'));
  try { moving ||= document.documentElement.matches(':active-view-transition'); } catch { /* an older browser has no such selector */ }
  return location.pathname === '/' && vis(document.querySelector('h1')) && rendered && vis(nueva) && !nueva.disabled && vis(document.querySelector('[data-tour="run-agent"]')) && !moving ? performance.now() : false;
};
// AC-97 target 6: every row shows an outcome chip that is not «Pendiente».
export const allDecided = () => {
  const rows = [...document.querySelectorAll('#invoices table.inbox-list tbody tr')];
  return rows.length && rows.every((r) => r.querySelector('.chip:not(.chip-pending)')) ? performance.now() : false;
};
const navigate = ({ href, skeleton }) => new Promise((resolve) => { // click a link; time the heading or skeleton, then the data
  const link = [...document.querySelectorAll(`a[href="${href}"]`)].find((a) => a.checkVisibility());
  if (!link) return resolve(null);
  const before = document.querySelector('h1')?.textContent.trim();
  const path = new URL(href, location.href).pathname;
  const out = { head: null, data: null };
  let calm = 0;
  const t0 = performance.now();
  link.click();
  const tick = () => {
    const t = performance.now() - t0, h = document.querySelector('h1');
    const skel = [...document.querySelectorAll(skeleton)].some((e) => e.checkVisibility());
    const message = [...document.querySelectorAll('[role="status"]')].some((e) => e.checkVisibility() && e.textContent.trim()); // «Cargando…» counts for the heading, not for "data rendered"
    const title = h && h.checkVisibility() && h.textContent.trim();
    if (location.pathname === path) {
      if (out.head == null && ((title && title !== before) || skel || message)) out.head = t;
      calm = title && !skel && window.__p.pending === 0 ? calm + 1 : 0;
      if (out.head != null && calm === 2) return resolve({ head: out.head, data: t });
    }
    if (t > 5000) return resolve({ head: out.head ?? t, data: t });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

// ---- Measuring ----
const journey = (v, s) => (typeof s.path === 'function' ? s.path(v) : s.path);
async function firstLoad(browser, base, screen, session, vars) {
  const context = await browser.newContext({ viewport: VIEWPORT, locale: 'es-CO' });
  try {
    const page = await context.newPage();
    const reqs = [], scripts = [];
    page.on('request', (r) => reqs.push({ method: r.method(), url: r.url(), headers: r.headers() }));
    page.on('response', (r) => r.request().resourceType() === 'script' && scripts.push(r.body().catch(() => Buffer.alloc(0))));
    await page.addInitScript(INIT, { session: screen.auth === false ? null : session });
    await page.goto(base + journey(vars, screen), { waitUntil: 'commit', timeout: 30_000 });
    const t = await page.waitForFunction(usable, { sel: screen.primary ?? PRIMARY, need: !!screen.door }, { timeout: 15_000, polling: 'raf' }).then((h) => h.jsonValue()).catch(() => null);
    const before = scripts.slice(); // the JS fetched up to the moment the screen was usable
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {}); // the API calls of the whole first load are its critical path
    return { t, reqs, bodies: await Promise.all(before) };
  } finally { await context.close(); }
}

async function navTime(browser, base, screen, session, vars) {
  const context = await browser.newContext({ viewport: VIEWPORT, locale: 'es-CO' });
  try {
    const page = await context.newPage();
    await page.addInitScript(INIT, { session });
    await page.goto(base + screen.from, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForFunction(usable, { sel: PRIMARY }, { timeout: 15_000, polling: 'raf' });
    await page.waitForFunction(() => window.__p.pending === 0);
    return await page.evaluate(navigate, { href: screen.link?.(vars) ?? journey(vars, screen), skeleton: SKELETON });
  } finally { await context.close(); }
}

// One entry sample, each in a fresh context. Set-up (page load, typing, the OTP code) is not timed; t0 is the click event's own timeStamp, taken by a capture listener added just before the click.
async function entrySample(browser, base, kind, { cfg, key, password }) {
  const context = await browser.newContext({ viewport: VIEWPORT, locale: 'es-CO' });
  try {
    const page = await context.newPage();
    await page.addInitScript(INIT, { session: null });
    if (kind === 'otp') await context.route(OTP_URL, otpGuard);
    await page.goto(base + (kind === 'trial' || kind === 'demo' ? '/demo' : '/login'), { waitUntil: 'load', timeout: 30_000 });
    await page.waitForFunction(usable, { sel: PRIMARY, need: true }, { timeout: 15_000, polling: 'raf' });
    let click;
    if (kind === 'otp' || kind === 'password') {
      const email = QA[kind];
      if (kind === 'password') {
        await page.getByRole('button', { name: 'Entrar con contraseña' }).click();
        await page.locator('#login-email').fill(email);
        await page.locator('#login-password').fill(password);
        click = page.getByRole('button', { name: 'Entrar', exact: true });
      } else {
        await page.locator('#login-email').fill(email);
        await page.getByRole('button', { name: 'Enviar código' }).click(); // fulfilled by otpGuard
        await page.locator('#login-code').waitFor();
        await page.locator('#login-code').fill(await admin(cfg.supabaseUrl, key).code(email));
        click = page.getByRole('button', { name: 'Entrar', exact: true });
      }
    } else click = page.getByRole('button', { name: kind === 'trial' ? 'Probar con mi propia empresa' : 'Entrar como Andina Labs' });
    await page.evaluate(() => addEventListener('click', (e) => { window.__t0 = e.timeStamp; }, true));
    let header;
    page.on('response', (r) => { if (INBOX.test(r.url())) header = r.headers()['server-timing']; });
    await click.click();
    const t1 = await page.waitForFunction(entryReady, null, { timeout: 15_000, polling: 'raf' }).then((h) => h.jsonValue());
    const { t0, signin, inbox } = await page.evaluate(([si, ib]) => {
      const t0 = window.__t0, res = performance.getEntriesByType('resource').map((e) => e.toJSON());
      return { t0, signin: res.find((e) => new RegExp(si).test(e.name) && e.startTime >= t0), inbox: res.findLast((e) => new RegExp(ib).test(e.name)) };
    }, [SIGNIN.source, INBOX.source]);
    const pending = await page.evaluate(() => document.querySelectorAll('#invoices tbody .chip-pending').length);
    const decided = kind === 'trial' ? await page.waitForFunction(allDecided, null, { timeout: 35_000, polling: 'raf' }).then((h) => h.jsonValue()).catch(() => null) : null;
    return { ms: t1 - t0, pending, decided: decided == null ? null : decided - t0, info: entryTimes({ t0, signin, inbox, header }) };
  } catch (e) { return { error: e.message.split('\n')[0].replace(/^page\.waitForFunction: /, '').replace(/Timeout \d+ms exceeded.*/, 'not usable in 15 s') }; } finally { await context.close(); }
}

async function entryAll(browser, base, { trial, baseline }) {
  const cfg = await (await fetch(`${base}/api/config`)).json();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY, password = randomBytes(18).toString('base64url'); // held in memory only
  const na = (screen, why) => [{ screen, metric: 'Click to usable Bandeja, median of 3', na: why, unit: 'ms', target: T.entry }];
  const run = async (kind) => { const out = []; for (let i = 0; i < RUNS; i++) out.push(await entrySample(browser, base, kind, { cfg, key, password })); return out; };
  const rows = [];
  for (const kind of ['otp', 'password']) {
    if (!key) { rows.push(...na(`entry ${kind}`, 'needs SUPABASE_SERVICE_ROLE_KEY in the environment, for the QA users')); continue; }
    try { await admin(cfg.supabaseUrl, key).ensure(QA[kind], kind === 'password' ? password : undefined); } catch (e) { rows.push(...entryRows(`entry ${kind}`, QA[kind], [{ error: e.message }])); continue; }
    rows.push(...entryRows(`entry ${kind}`, QA[kind], await run(kind), baseline));
  }
  if (trial) rows.push(...entryRows('entry trial', 'a new anonymous user per sample', await run('trial'), baseline));
  else rows.push(...na('entry trial', 'run with --trial (needs the trial door, AC-92)'), ...na('entry trial (all decided)', 'run with --trial (needs the trial door, AC-92)'));
  rows.push(...entryRows('entry demo', 'the shared demo user', await run('demo'), baseline));
  return rows;
}

async function apiP95(url, headers) {
  const keep = Object.fromEntries(Object.entries(headers).filter(([k]) => ['authorization', 'apikey', 'accept'].includes(k)));
  const times = [];
  for (let i = 0; i < WARMUPS + SAMPLES; i++) {
    const t0 = performance.now();
    const r = await fetch(url, { headers: keep });
    await r.arrayBuffer();
    if (!r.ok) return { error: `HTTP ${r.status}` };
    if (i >= WARMUPS) times.push(performance.now() - t0);
  }
  return { value: Math.round(p95(times)) };
}

const loc = async (base) => (await fetch(`${base}/cdn-cgi/trace`).then((r) => r.text()).catch(() => '')).match(/^loc=(\S+)/m)?.[1] ?? '?';

export async function main(argv) {
  const a = Object.fromEntries(argv.filter((x) => x.startsWith('--')).map((x) => [x.slice(2), argv[argv.indexOf(x) + 1]?.startsWith('--') ? true : argv[argv.indexOf(x) + 1] ?? true]));
  const base = (typeof a.base === 'string' ? a.base : '').replace(/\/$/, '');
  if (!base) throw new Error('usage: node scripts/perf.mjs --base <url> [--portal <url>] [--status-token t] [--trial]');
  const portal = (a.portal ?? base.replace('//30x-hackathon.', '//facturas.')).replace(/\/$/, '');
  const portalOk = portal !== base;
  const health = await fetch(`${base}/api/health`); // the warm-up
  const colo = coloOf(health.headers.get('cf-ray')), country = await loc(base);

  const vars = { statusToken: typeof a['status-token'] === 'string' ? a['status-token'] : undefined };
  const ov = await fetch(`${base}/api/demo/overview`).then((r) => r.json());
  for (const o of ['PAGAR', 'ESCALAR']) vars[o] = ov.invoices?.find((i) => i.outcome === o)?.id;
  const session = await demoSession(base);
  const bearer = { authorization: `Bearer ${JSON.parse(session.value).access_token}` };
  const list = await fetch(`${base}/api/beneficiaries`, { headers: bearer }).then((r) => r.json()).catch(() => []);
  vars.beneficiary = Array.isArray(list) ? list[0]?.id : undefined; // AC-104's page; without it the row is N/A
  if (vars.beneficiary && !(await fetch(`${base}/api/screen/beneficiary/${vars.beneficiary}`, { headers: bearer }).then((r) => r.ok).catch(() => false))) vars.beneficiary = undefined;
  const trial = a.trial ? await trialSession(base) : null;
  vars.trial = !!trial;

  const browser = await launch();
  const rows = portalRows(portalOk), apis = new Map(); // url -> { headers, screens }
  const jobs = [...MAIN.map((s) => ({ s, base, session: s.trial ? trial : session })), ...(portalOk ? PORTAL.map((s) => ({ s, base: portal, session: null, portal: true })) : [])];
  for (const { s, base: origin, session: sess, portal: isPortal } of jobs) {
    const skip = s.needs && !vars[s.needs];
    if (skip) { rows.push({ screen: s.id, metric: 'First load, median of 3', na: s.na, target: T.load, unit: 'ms' }); continue; }
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await firstLoad(browser, origin, s, sess, vars));
    const ts = runs.map((r) => r.t);
    rows.push({ screen: s.id, metric: 'First load, median of 3', value: ts.includes(null) ? null : Math.round(median(ts)), why: 'not usable in 15 s', unit: 'ms', target: T.load });
    if (s.js) rows.push({ screen: s.id, metric: 'JS gzipped before usable', value: Math.round(gzSum(runs[0].bodies) / 1000), unit: 'KB', target: T.js });
    const crit = isPortal ? [{ method: 'GET', url: origin + journey(vars, s), headers: {} }] : criticalApis(runs[0].reqs, origin);
    for (const r of crit) apis.set(r.url, { headers: r.headers, screens: [...(apis.get(r.url)?.screens ?? []), s.id] });
    if (s.from && !isPortal) {
      const ns = [];
      for (let i = 0; i < RUNS; i++) ns.push(await navTime(browser, origin, s, sess, vars).catch((e) => ({ error: e.message.split('\n')[0] })));
      rows.push(...navRows(s, ns));
    }
  }
  const rtts = []; // R-150's baseline, measured before the entry rows: the median of 5 /api/health round trips
  for (let i = 0; i < 5; i++) { const t0 = performance.now(); await (await fetch(`${base}/api/health`)).arrayBuffer(); rtts.push(performance.now() - t0); }
  rows.push(...(await entryAll(browser, base, { trial: !!trial, baseline: Math.round(median(rtts)) })));
  await browser.close();
  for (const [url, { headers, screens }] of apis) {
    const r = await apiP95(url, headers);
    const label = url.replace(/^https?:\/\/[^/]+/, '');
    rows.push({ screen: `${label} (${[...new Set(screens)].join(', ')})`, metric: 'API p95 of 20', ...(r.error ? { why: r.error, value: null } : r), unit: 'ms', target: T.api });
  }
  const demoUrl = `${base}/api/demo/overview`; // the first visitor after 60 s idle; INFO, published but not graded
  rows.push(await missRow({
    wait: () => new Promise((r) => setTimeout(r, SAMPLE_WAIT)),
    once: async () => { const t0 = performance.now(), r = await fetch(demoUrl); await r.arrayBuffer(); return r.ok ? { ms: performance.now() - t0, headers: Object.fromEntries(r.headers) } : { error: `HTTP ${r.status}` }; },
  }));
  const md = renderPerf({ when: new Date().toISOString(), base, portal: portalOk ? portal : null, colo, country, rows });
  writeFileSync(join(ROOT, 'docs/perf.md'), md);
  const failed = rows.filter((r) => verdict(r) === 'FAIL').length;
  console.log(md.split('## Latest run')[1]);
  console.log(failed ? `PERF FAILED: ${failed} rows` : 'PERF PASSED');
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main(process.argv.slice(2)));
