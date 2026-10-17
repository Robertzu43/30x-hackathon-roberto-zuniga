/* global Buffer, document */
// The perf harness's own checks (AC-97): median, p95, gzip sum, the critical path and the table, on fixtures. No browser, no network.
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { coloOf, criticalApis, gzSum, isHit, judge, median, missRow, navRows, p95, portalRows, PRIMARY, renderPerf, ROW0, usable } from './perf.mjs';
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
