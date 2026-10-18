/* global Buffer, document */
// The perf harness's own checks (AC-97): median, p95, gzip sum, the critical path and the table, on fixtures. No browser, no network.
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { admin, allDecided, coloOf, criticalApis, entryExtra, entryReady, entryRows, entryTimes, gzSum, isHit, judge, median, missRow, navRows, otpGuard, p95, portalRows, PRIMARY, renderPerf, ROW0, serverTiming, usable } from './perf.mjs';
import { SCREENS } from './ux-gate.mjs';

describe('statistics', () => {
  it('median picks the middle of three, whatever the order', () => expect(median([900, 100, 400])).toBe(400));
  it('median averages the two middle values of an even list', () => expect(median([1, 2, 3, 4])).toBe(2.5));
  it('p95 of 20 samples is the 19th smallest (nearest rank)', () => expect(p95(Array.from({ length: 20 }, (_, i) => 20 - i))).toBe(19));
  it('p95 of one sample is that sample', () => expect(p95([7])).toBe(7));
  it('gzSum adds the gzipped size of every body', () => {
    const body = Buffer.alloc(10_000, 'a');
    expect(gzSum([body, body])).toBe(2 * gzSum([body]));
    expect(gzSum([body])).toBeGreaterThan(0);
    expect(gzSum([body])).toBeLessThan(100);
  });
});

describe('verdict', () => {
  it('is PASS strictly under the target and FAIL at or over it', () => {
    expect(judge(1999, 2000)).toBe('PASS');
    expect(judge(2000, 2000)).toBe('FAIL');
  });
  it('counts the target itself as a pass when the rule is "within"', () => expect(judge(100, 100, true)).toBe('PASS'));
  it('is FAIL when nothing was measured', () => expect(judge(null, 2000)).toBe('FAIL'));
});

describe('critical path', () => {
  const origin = 'https://app.test';
  const reqs = [
    { method: 'GET', url: `${origin}/api/demo/overview`, headers: { a: 1 } },
    { method: 'GET', url: `${origin}/api/demo/overview`, headers: { a: 1 } },
    { method: 'GET', url: `${origin}/assets/index.js`, headers: {} },
    { method: 'POST', url: `${origin}/api/invoices`, headers: {} },
    { method: 'GET', url: 'https://other.test/api/x', headers: {} },
    { method: 'GET', url: `${origin}/api/period`, headers: {} },
  ];
  it('keeps each same-origin GET /api/ once and drops writes, assets and other origins', () =>
    expect(criticalApis(reqs, origin).map((r) => r.url)).toEqual([`${origin}/api/demo/overview`, `${origin}/api/period`]));
});

describe('the table', () => {
  const rows = [
    { screen: 'inbox', metric: 'First load, median of 3', value: 1200, unit: 'ms', target: 2000 },
    { screen: '/api/demo/overview', metric: 'API p95 of 20', value: 2270, unit: 'ms', target: 600 },
  ];
  const md = renderPerf({ when: '2026-10-17T20:00:00.000Z', base: 'https://x.test', colo: 'IAD', country: 'US', rows });
  it('names the UTC date-time, the base URL, the colo and the egress country', () => {
    expect(md).toContain('2026-10-17 20:00 UTC');
    expect(md).toContain('https://x.test');
    expect(md).toContain('IAD');
    expect(md).toContain('US');
  });
  it('gives each number its target and PASS or FAIL', () => {
    expect(md).toMatch(/\| inbox \| First load, median of 3 \| 1200 ms \| under 2000 ms \| PASS \|/);
    expect(md).toMatch(/\| \/api\/demo\/overview \| API p95 of 20 \| 2270 ms \| under 600 ms \| FAIL \|/);
  });
  it('keeps the 17:40Z baseline as row 0', () => {
    expect(ROW0).toMatch(/2\.27 s/);
    expect(ROW0).toMatch(/626 KB/);
    expect(md).toContain(ROW0);
  });
  it('reports a missing measurement as N/A with its reason, never as a pass', () => {
    const na = renderPerf({ when: '2026-10-17T20:00:00.000Z', base: 'https://x.test', colo: '?', country: '?', rows: [{ screen: 'status', metric: 'First load, median of 3', na: 'needs --status-token', target: 2000, unit: 'ms' }] });
    expect(na).toMatch(/\| status \| First load, median of 3 \| N\/A \(needs --status-token\) \| under 2000 ms \| N\/A \|/);
  });
  it('a screen that never became usable is a FAIL row, not a blank', () => {
    const md2 = renderPerf({ when: '2026-10-17T20:00:00.000Z', base: 'https://x.test', colo: '?', country: '?', rows: [{ screen: 'inbox', metric: 'First load, median of 3', value: null, why: 'not usable in 15 s', unit: 'ms', target: 2000 }] });
    expect(md2).toMatch(/\| inbox \| First load, median of 3 \| not measured \(not usable in 15 s\) \| under 2000 ms \| FAIL \|/);
    expect(md2).toContain('FAILED ROWS: 1');
  });
  it('reads the colo from cf-ray', () => expect(coloOf('a4c132c7bc8c2ff2-IAD')).toBe('IAD'));
});

describe('gate screens added by D40 and D41', () => {
  it.each(['trial', 'login-password', 'save-access', 'leave-trial', 'beneficiary', 'beneficiary-empty'])('%s is a finance screen', (id) =>
    expect(SCREENS.find((s) => s.id === id)?.exp).toBe('finance'));
  it('the trial screens share the one anonymous session of the run', () =>
    expect(SCREENS.filter((s) => ['trial', 'save-access', 'leave-trial'].includes(s.id)).every((s) => s.session === 'trial')).toBe(true));
});

describe('unmeasured is never green (AC-97)', () => {
  const screen = { id: 'period' };
  const fixture = (rows) => renderPerf({ when: '2026-10-17T20:00:00.000Z', base: 'https://x.test', colo: '?', country: '?', rows });
  it('a navigation error becomes a FAIL row carrying the error message', () => {
    const md = fixture(navRows(screen, [{ head: 50, data: 400 }, { error: 'Timeout 15000ms exceeded' }, { head: 60, data: 500 }]));
    expect(md).toMatch(/\| period \| In-app navigation \| not measured \(Timeout 15000ms exceeded\) \| within 100 ms \| FAIL \|/);
    expect(md).toContain('FAILED ROWS: 1');
  });
  it('a link that is truly absent stays N/A, distinct from the FAIL', () => {
    const md = fixture(navRows(screen, [null, null, null]));
    expect(md).toMatch(/N\/A \(link not found on the origin screen\)/);
    expect(md).toContain('FAILED ROWS: 0');
  });
  it('three good runs give the heading and data rows', () =>
    expect(navRows(screen, [{ head: 50, data: 400 }, { head: 60, data: 500 }, { head: 70, data: 600 }]).map((r) => r.value)).toEqual([60, 500]));
  it('a missing portal base is an explicit FAIL row, not an omission', () => {
    const md = fixture(portalRows(false));
    expect(md).toContain('facturas Worker not measured (pass --portal)');
    expect(md).toContain('FAILED ROWS: 1');
  });
  it('a known portal base adds no row', () => expect(portalRows(true)).toEqual([]));
});

describe('demo overview, cache miss (AC-97 Clarified, R-140)', () => {
  const sample = (ms, cache) => ({ ms, headers: cache ? { 'cf-cache-status': cache } : {} });
  const run = (queue) => { const waits = []; const once = async () => queue.shift(); return missRow({ once, wait: async () => waits.push(1) }).then((row) => ({ row, waits: waits.length })); };
  it('is the median of 3 samples, waiting before each one', async () => {
    const { row, waits } = await run([sample(2400, 'MISS'), sample(900, 'EXPIRED'), sample(1700, 'MISS')]);
    expect(row.value).toBe(1700);
    expect(waits).toBe(3);
  });
  it('rejects a HIT sample, waits again and takes a fresh one', async () => {
    const { row, waits } = await run([sample(40, 'HIT'), sample(2400), sample(2000), sample(1800)]);
    expect(row.value).toBe(2000);
    expect(waits).toBe(4);
  });
  it('a cache that never expires is not measured, with the reason', async () => {
    const { row } = await run(Array.from({ length: 9 }, () => sample(40, 'HIT')));
    expect(row.value).toBeNull();
    expect(row.why).toMatch(/HIT/);
  });
  it('recognises a HIT by cf-cache-status, whatever the case', () => {
    expect(isHit({ 'cf-cache-status': 'hit' })).toBe(true);
    expect(isHit({ 'cf-cache-status': 'MISS' })).toBe(false);
    expect(isHit({})).toBe(false);
  });
  it('is INFO in the table, never a FAIL, even above the 600 ms target or not measured', () => {
    const rows = [
      { screen: 'inbox', metric: 'First load, median of 3', value: 1200, unit: 'ms', target: 2000 },
      { screen: 'demo overview (cache miss)', metric: 'Median of 3 uncached requests', value: 2270, unit: 'ms', info: true },
      { screen: 'demo overview (cache miss)', metric: 'again', value: null, why: 'cache never expired', unit: 'ms', info: true },
    ];
    const md = renderPerf({ when: '2026-10-17T20:00:00.000Z', base: 'https://x.test', colo: '?', country: '?', rows });
    expect(md).toMatch(/\| demo overview \(cache miss\) \| Median of 3 uncached requests \| 2270 ms \| not graded \| INFO \|/);
    expect(md).toMatch(/\| again \| not measured \(cache never expired\) \| not graded \| INFO \|/);
    expect(md).toContain('FAILED ROWS: 0');
  });
});

describe('login readiness (AC-97 Clarified, AC-91 item 7)', () => {
  // The login markup: the heading is the logo image (AC-80), the door is the one primary action (TrialButton).
  const dom = (html) => { const w = new JSDOM(html).window; w.Element.prototype.checkVisibility = () => true; globalThis.document = w.document; }; // the page function reads the global document
  const page = (button) => dom(`<h1><img alt="Thesaurus" src="/x.svg"></h1>${button}`);
  const door = (attrs = '') => `<button type="button" class="primary" ${attrs}>Probar con mi propia empresa</button><button type="submit">Enviar código</button>`;
  it('the primary selector finds the door and nothing else', () => {
    page(door());
    expect([...document.querySelectorAll(PRIMARY)].map((b) => b.textContent)).toEqual(['Probar con mi propia empresa']);
  });
  it('is usable when the logo heading and the enabled door show', () => {
    page(door());
    expect(usable({ sel: PRIMARY, need: true })).toBeGreaterThan(0);
  });
  it('is not usable while the door is disabled or missing', () => {
    page(door('disabled'));
    expect(usable({ sel: PRIMARY, need: true })).toBe(false);
    page('<button type="submit">Enviar código</button>');
    expect(usable({ sel: PRIMARY, need: true })).toBe(false);
  });
  it('is not usable without a heading name', () => {
    dom(`<h1></h1>${door()}`);
    expect(usable({ sel: PRIMARY, need: true })).toBe(false);
  });
});

describe('entry: the end of the interval, t1 (AC-97 target 5, R-146)', () => {
  const ROW = (chip = 'chip-PAGAR') => `<tr data-tour="invoice-row"><td><span class="chip ${chip}">x</span></td></tr>`;
  const bandeja = ({ rows = ROW(), table = null, nueva = '', run = '', path = '/', skeleton = false } = {}) => { // Inbox.tsx wraps the whole table section in div.skeleton while loading
    const sec = `<section id="invoices">${table ?? `<table class="inbox-list"><tbody>${rows}</tbody></table>`}</section>`;
    const w = new JSDOM(`<h1>Bandeja</h1><button data-tour="new-invoice" ${nueva}>Nueva factura</button><button data-tour="run-agent" ${run}>Ejecutar agente</button>
      ${skeleton ? `<div class="skeleton" aria-hidden="true">${sec}</div>` : sec}`, { url: `https://x.test${path}` }).window;
    w.Element.prototype.checkVisibility = () => true;
    globalThis.document = w.document;
    globalThis.location = w.location;
    return w;
  };
  it('is usable when Bandeja is at / with its heading, rows from data and an enabled Nueva factura', () => {
    bandeja();
    expect(entryReady()).toBeGreaterThan(0);
  });
  it('a busy Ejecutar agente counts as usable (the first-login pass is running)', () => {
    bandeja({ run: 'disabled aria-busy="true"' });
    expect(entryReady()).toBeGreaterThan(0);
  });
  it('a skeleton table does not count', () => {
    bandeja({ rows: ROW('chip-pending'), skeleton: true });
    expect(entryReady()).toBe(false);
  });
  it('the designed empty state counts as a rendered table', () => {
    bandeja({ table: '<p class="muted">Todavía no hay facturas.</p>' });
    expect(entryReady()).toBeGreaterThan(0);
  });
  it('is not usable on /login, whatever it shows, nor while Nueva factura is disabled', () => {
    bandeja({ path: '/login' });
    expect(entryReady()).toBe(false);
    bandeja({ nueva: 'disabled' });
    expect(entryReady()).toBe(false);
  });
  it('is not usable while an entry transition is running, and is when it has ended', () => {
    const w = bandeja();
    w.document.getAnimations = () => [{ playState: 'running', effect: { pseudoElement: '::view-transition-group(root)' } }];
    expect(entryReady()).toBe(false);
    w.document.getAnimations = () => [{ playState: 'running', effect: { pseudoElement: null } }]; // a skeleton shimmer is not the transition
    expect(entryReady()).toBeGreaterThan(0);
  });
  it('all decided needs rows and no Pendiente chip', () => {
    bandeja({ rows: ROW() + ROW('chip-ESCALAR') });
    expect(allDecided()).toBeGreaterThan(0);
    bandeja({ rows: ROW() + ROW('chip-pending') });
    expect(allDecided()).toBe(false);
    bandeja({ rows: '' });
    expect(allDecided()).toBe(false);
  });
});

describe('entry rows (AC-97 targets 5 and 6, R-146)', () => {
  const ok = (ms, pending = 0, decided = null) => ({ ms, pending, decided, info: {} }); // a real sample always has info (entryTimes)
  const otp = 'qa-perf-otp@example.com';
  it('is the median of 3 under 2000 ms, and names the QA user and the kind of sample', () => {
    const [r] = entryRows('entry otp', otp, [ok(1800, 11), ok(900), ok(1500)]);
    expect(r).toMatchObject({ screen: 'entry otp', value: 1500, unit: 'ms', target: 2000 });
    expect(r.metric).toContain(otp);
    expect(r.metric).toContain('1 first login with pending invoices, 2 returning');
    expect(judge(r.value, r.target, r.within)).toBe('PASS');
  });
  it('2000 ms is a FAIL', () => expect(judge(...(([r]) => [r.value, r.target, r.within])(entryRows('entry demo', 'shared demo user', [ok(2000), ok(2000), ok(2000)])))).toBe('FAIL'));
  it('a sample that never became usable makes the row a FAIL carrying the reason', () => {
    const md = renderPerf({ when: '2026-10-17T20:00:00.000Z', base: 'https://x.test', colo: '?', country: '?', rows: entryRows('entry password', 'qa-perf-password@example.com', [ok(900), { error: 'not usable in 15 s' }, ok(950)]) });
    expect(md).toMatch(/\| entry password \| .* \| not measured \(not usable in 15 s\) \| under 2000 ms \| FAIL \|/);
  });
  it('the trial adds the 30 s row: median of 3 until every row is decided, at most 30000 ms', () => {
    const rows = entryRows('entry trial', 'a new anonymous user per sample', [ok(900, 11, 18_000), ok(1000, 11, 30_000), ok(1100, 11, 25_000)]);
    expect(rows.map((r) => r.screen)).toEqual(['entry trial', 'entry trial (all decided)']);
    expect(rows[1]).toMatchObject({ value: 25_000, target: 30_000, within: true });
    expect(judge(rows[1].value, rows[1].target, rows[1].within)).toBe('PASS');
    const slow = entryRows('entry trial', 'u', [ok(900, 11, 31_000), ok(900, 11, 31_000), ok(900, 11, 20_000)])[1];
    expect(judge(slow.value, slow.target, slow.within)).toBe('FAIL');
  });
  it('a pass that never finishes is a FAIL on the 30 s row, not a blank', () => {
    const rows = entryRows('entry trial', 'u', [ok(900, 11, null), ok(900, 11, 20_000), ok(900, 11, 20_000)]);
    expect(rows[1].value).toBeNull();
    expect(rows[1].why).toMatch(/decided/);
  });
});

describe('entry INFO columns (R-150)', () => {
  const ok = (ms, info) => ({ ms, pending: 0, decided: null, info });
  const info = (signin, gap, req, server, bytes) => ({ signin, gap, req, server, bytes });
  it('reads app;dur from Server-Timing, among other metrics, and is null without it', () => {
    expect(serverTiming('app;dur=412.5')).toBe(412.5);
    expect(serverTiming('cdn-cache;desc=HIT, app;desc="x";dur=30')).toBe(30);
    expect(serverTiming('db;dur=9')).toBeNull();
    expect(serverTiming(undefined)).toBeNull();
  });
  it('sign-in is click to its response, the gap runs to the inbox request start, the request is start to end', () => {
    const t = entryTimes({ t0: 1000, signin: { startTime: 1010, responseEnd: 1400 }, inbox: { startTime: 1415, responseEnd: 2100, decodedBodySize: 51_000 }, header: 'app;dur=450' });
    expect(t).toEqual({ signin: 400, gap: 15, req: 685, server: 450, bytes: 51_000 });
  });
  it('a missing request or header gives null, never a number', () => {
    expect(entryTimes({ t0: 0, signin: null, inbox: null, header: undefined })).toEqual({ signin: null, gap: null, req: null, server: null, bytes: null });
  });
  it('prints the median of each column, n/a for the server time when no sample had the header, and the baseline', () => {
    const x = entryExtra([info(400, 10, 600, null, 51_000), info(300, 30, 700, null, 51_000), info(500, 20, 650, null, 50_000)], 80);
    expect(x).toBe('INFO: sign-in 400 ms; gap 20 ms; inbox request 650 ms; server n/a; 51000 bytes; /api/health baseline 80 ms');
    expect(entryExtra([info(1, 1, 1, 450, 1)], 80)).toContain('server 450 ms');
  });
  it('the entry row carries the INFO text in its Value cell and is still graded on its own number', () => {
    const [r] = entryRows('entry demo', 'shared demo user', [ok(1800, info(400, 10, 600, 450, 51_000)), ok(900, info(300, 10, 500, 450, 51_000)), ok(1500, info(350, 10, 550, 450, 51_000))], 80);
    const md = renderPerf({ when: '2026-10-17T20:00:00.000Z', base: 'https://x.test', colo: '?', country: '?', rows: [r] });
    expect(md).toMatch(/\| entry demo \| .* \| 1500 ms \(INFO: sign-in 350 ms; .*baseline 80 ms\) \| under 2000 ms \| PASS \|/);
    expect(md).toContain('FAILED ROWS: 0');
  });
  it('INFO text never turns a FAIL into a pass or a pass into a FAIL, and the failed count only counts the graded number', () => {
    const slow = entryRows('entry demo', 'u', [ok(2500, info(9, 9, 9, null, 9)), ok(2600, info(9, 9, 9, null, 9)), ok(2700, info(9, 9, 9, null, 9))], 80);
    const md = renderPerf({ when: '2026-10-17T20:00:00.000Z', base: 'https://x.test', colo: '?', country: '?', rows: slow });
    expect(md).toContain('FAILED ROWS: 1');
  });
  it('an error row carries no INFO text, and the 30 s trial row does not either', () => {
    expect(entryRows('entry otp', 'u', [ok(900, info(1, 1, 1, 1, 1)), { error: 'not usable in 15 s' }, ok(950, info(1, 1, 1, 1, 1))], 80)[0].extra).toBeUndefined();
    const rows = entryRows('entry trial', 'u', [ok(900, info(1, 1, 1, 1, 1)), ok(900, info(1, 1, 1, 1, 1)), ok(900, info(1, 1, 1, 1, 1))], 80);
    expect(rows[0].extra).toMatch(/^INFO:/);
    expect(rows[1].extra).toBeUndefined();
  });
});

describe('entry otp set-up (R-146)', () => {
  const route = (method) => { const calls = []; return { calls, request: () => ({ method: () => method }), fulfill: async (o) => calls.push(['fulfill', o]), continue: async () => calls.push(['continue']), fallback: async () => calls.push(['fallback']), fetch: async () => calls.push(['fetch']) }; };
  it('answers the browser\'s send-code POST itself, with a 200, and never lets it go upstream', async () => {
    const r = route('POST');
    await otpGuard(r);
    expect(r.calls.map((c) => c[0])).toEqual(['fulfill']);
    expect(r.calls[0][1].status).toBe(200);
  });
  it('answers the CORS preflight too', async () => {
    const r = route('OPTIONS');
    await otpGuard(r);
    expect(r.calls.map((c) => c[0])).toEqual(['fulfill']);
  });
});

describe('the Admin API helper (R-146)', () => {
  const KEY = 'sb_secret_THE-SERVICE-KEY';
  const fake = (replies) => { const calls = []; const f = async (url, init) => { calls.push({ url, method: init.method, body: init.body }); const [status, json] = replies.shift(); return { status, ok: status < 400, json: async () => json }; }; return { calls, f }; };
  it('takes the code from generate_link and never deletes anything', async () => {
    const { calls, f } = fake([[200, { email_otp: '123456', id: 'u1' }]]);
    expect(await admin('https://s.test', KEY, f).code('qa-perf-otp@example.com')).toBe('123456');
    expect(calls[0].url).toBe('https://s.test/auth/v1/admin/generate_link');
    expect(calls.every((c) => c.method !== 'DELETE')).toBe(true);
  });
  it('creates a missing QA user; an existing one (422) is left alone', async () => {
    const created = fake([[200, { id: 'u1' }]]);
    await admin('https://s.test', KEY, created.f).ensure('qa-perf-otp@example.com');
    expect(created.calls).toHaveLength(1);
    expect(created.calls[0]).toMatchObject({ url: 'https://s.test/auth/v1/admin/users', method: 'POST' });
    const exists = fake([[422, { error_code: 'email_exists' }]]);
    await admin('https://s.test', KEY, exists.f).ensure('qa-perf-otp@example.com');
    expect(exists.calls).toHaveLength(1);
  });
  it('sets the password through the user id, and only ever uses POST and PUT', async () => {
    const { calls, f } = fake([[422, {}], [200, { email_otp: '1', id: 'u2' }], [200, {}]]);
    await admin('https://s.test', KEY, f).ensure('qa-perf-password@example.com', 'random-pass');
    expect(calls.map((c) => `${c.method} ${c.url.split('/admin/')[1]}`)).toEqual(['POST users', 'POST generate_link', 'PUT users/u2']);
  });
  it('never puts the service-role key in an error message', async () => {
    const { f } = fake([[500, {}]]);
    const err = await admin('https://s.test', KEY, f).code('x@example.com').catch((e) => e);
    expect(err.message).toMatch(/HTTP 500/);
    expect(err.message).not.toContain(KEY);
  });
});
