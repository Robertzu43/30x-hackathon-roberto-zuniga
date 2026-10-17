/* global URL, setTimeout, console */
// The gate's own checks (AC-91): a fixture page with one known violation per item, driven by ?bad=<check id>.
// The clean page must pass every check; each bad variant must fail exactly the check it names.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aggregate, FONTS, launch, main, PALETTE, renderGate, runCell, SCREENS, unreadId, writeGate } from './ux-gate.mjs';

const DICTS = {
  es: { 'f.title': 'Bandeja', 'f.empty': 'Todavía no hay facturas.', 'f.retry': 'Reintentar', 'f.send': 'Enviar', 'f.save': 'Guardar cambios', 'f.err': 'No pude cargar los datos. Inténtalo de nuevo.' },
  en: { 'f.title': 'Inbox', 'f.empty': 'There are no invoices yet.', 'f.retry': 'Retry', 'f.send': 'Send', 'f.save': 'Save changes', 'f.err': 'I could not load the data. Please try again.' },
};
const SVG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><rect width='8' height='8' fill='%23111111'/></svg>";
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const page = (bad, lang) => {
  const t = DICTS[lang];
  const css = `
  *{box-sizing:border-box}
  body{margin:0;background:#fbfbfa;color:#111111;font:1rem/1.6 ${FONTS[0]}}
  button,input,a{font:inherit}
  header{padding:8px 16px;border-bottom:1px solid #eaeaea;background:#ffffff}
  main{padding:16px}
  #list{min-height:300px}
  .btn,button,a.btn{display:inline-block;min-width:44px;min-height:44px;padding:0 16px;border:1px solid #eaeaea;border-radius:4px;background:#ffffff;color:#111111;cursor:pointer;text-decoration:underline}
  button.primary{background:#111111;color:#ffffff;border-color:#111111}
  button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid #346538;outline-offset:2px}
  input{display:block;width:100%;min-height:44px;font-size:16px;border:1px solid #eaeaea;border-radius:4px;padding:0 12px;margin:4px 0 12px}
  label{font-size:1rem;color:#111111}
  table{border-collapse:collapse} td,th{border:1px solid #eaeaea;padding:4px 8px;text-align:left}
  .err{color:#9f2f2d;background:#fdebec;padding:8px 12px;border-radius:4px;margin:0}
  ${{
    '1.scroll': '.x{width:2000px;height:10px}',
    '1.clip': '.clip{width:50px;overflow:hidden;white-space:nowrap}',
    '1.overlap': '.ov{position:relative;top:-2.6em}',
    '2.targets': '.tiny{width:20px;height:20px;min-height:0;min-width:0;padding:0}',
    '2.inputs': 'input{font-size:12px}',
    '2.primary': '#f{height:1800px} #f .primary{display:block}',
    '3.contrast': '.low{color:#bbbbbb}',
    '3.focus': 'button.primary:focus,button.primary:focus-visible{outline:none;box-shadow:none}',
    '6.palette': '.pal{color:#ff00aa}',
    '6.fonts': '.fnt{font-family:"Comic Sans MS",cursive}',
  }[bad] ?? ''}`;
  const body = `
  <header>${bad === '6.logo' ? '' : '<svg data-logo role="img" aria-label="Logo" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" fill="#111111"/></svg>'}</header>
  <main>
  <h1 id="h">${t['f.title']}</h1>
  <div id="list"></div>
  <p>${lang === 'es' ? '1.234,50 COP' : '1,234.50 COP'}</p>
  <p>160 USD</p><p><span>160</span> USD</p>
  ${bad === '1.scroll' ? '<div class="x"></div>' : ''}
  ${bad === '1.offscreen' ? '<div style="position:absolute;left:150vw;top:0">fuera</div>' : ''}
  ${bad === '1.clip' ? '<div class="clip">Un texto bastante largo que no cabe</div>' : ''}
  ${bad === '1.overlap' ? '<p>Primera línea</p><p class="ov">Segunda línea encima</p>' : ''}
  ${bad === '1.tables' ? '<div><table style="width:900px"><tr><td>a</td><td>b</td></tr></table></div>' : '<div style="overflow-x:auto"><table><tr><th>A</th><td>1</td></tr></table></div>'}
  ${bad === '2.targets' ? '<button class="tiny" type="button" aria-label="x">x</button>' : ''}
  ${bad === '3.axe' ? '<button type="button"></button>' : ''}
  ${bad === '3.contrast' ? '<p class="low">Texto de bajo contraste</p>' : ''}
  ${bad === '5.words' ? '<p>Total: undefined</p>' : ''}
  ${bad === '5.words:404' ? '<p>404</p>' : ''}
  ${bad === '5.words:trace' ? '<p>at render (https://x.test/app.js:10:5)</p>' : ''}
  ${bad === '5.mixed' ? `<p>${DICTS.es['f.save']}</p>` : ''}
  ${bad === '5.locale' ? '<p>Total 1,234.50</p>' : ''}
  ${bad === '6.palette' ? '<p class="pal">Color</p>' : ''}
  ${bad === '6.fonts' ? '<p class="fnt">Fuente</p>' : ''}
  ${bad === '6.images' ? `<img src="${PNG}" width="300" height="100" alt="">` : `<img src="${SVG}" width="8" height="8" alt="">`}
  <form id="f" onsubmit="return false">
    ${bad === '3.labels' ? '<input id="n" type="text">' : '<label for="n">Nombre</label><input id="n" type="text" value="x">'}
    ${bad === '3.enter' ? '<div id="go" class="btn primary" role="button" tabindex="0" style="background:#111111;color:#ffffff">' + t['f.send'] + '</div>' : `<button id="go" class="primary" type="button">${t['f.send']}</button>`}
  </form>
  </main>
  <script>
  const T = ${JSON.stringify(t)}, bad = ${JSON.stringify(bad)};
  const list = document.getElementById('list');
  const show = (rows) => { list.innerHTML = rows.length ? rows.map((r) => '<p>' + r + '</p>').join('') : bad === '4.state' ? '' : '<p role="status">' + T['f.empty'] + '</p><a class="btn" href="#sube">' + T['f.retry'] + '</a>'; };
  const fail = () => { list.innerHTML = bad === '4.state' ? '' : '<p class="err" role="alert">' + T['f.err'] + '</p><button type="button">' + T['f.retry'] + '</button>'; };
  fetch(bad === 'fx' ? '/api/fx' : '/api/data').then((r) => { if (!r.ok) throw new Error('x'); return r.json(); }).then((d) => show(bad === 'fx' ? d.rates.map((x) => x.c) : d), fail);
  document.getElementById('go').addEventListener('click', (e) => {
    if (bad !== '4.busy') { e.currentTarget.disabled = true; e.currentTarget.setAttribute('aria-busy', 'true'); }
    fetch('/api/act', { method: 'POST' });
  });
  if (bad === '4.cls') setTimeout(() => { const d = document.createElement('div'); d.style.height = '120px'; document.querySelector('main').prepend(d); }, 300);
  if (bad === '6.console') console.error('boom');
  if (bad === '7.longtask') setTimeout(() => { const e = Date.now() + 450; while (Date.now() < e); }, 100);
  if (bad === '0.reach') history.replaceState(null, '', '/elsewhere');
  </script>`;
  if (bad === '4.loading') return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><script>fetch('/api/data').then(()=>{document.body.innerHTML=decodeURIComponent("${encodeURIComponent(body.replace(/<script>[\s\S]*<\/script>/, ''))}")})</script></body></html>`;
  const lateHeading = bad === '7.usable' ? body.replace('<h1 id="h">', '<h1 id="h" hidden>') + '<script>setTimeout(()=>document.getElementById("h").hidden=false,2600)</script>' : body;
  return `<!doctype html><html lang="${bad === '3.lang' ? (lang === 'es' ? 'en' : 'es') : lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>f</title><style>${css}</style></head><body>${lateHeading}</body></html>`;
};

let server, base, browser;
const seen = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method !== 'GET') seen.push(`${req.method} ${u.pathname}`);
    if (u.pathname === '/f') return void res.writeHead(200, { 'content-type': 'text/html' }).end(page(u.searchParams.get('bad') ?? '', u.searchParams.get('lang') ?? 'es'));
    if (u.pathname === '/api/demo/overview') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(server.overview ?? { invoices: [] }));
    if (u.pathname === '/api/fx') return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"provider":"gate","rates":[{"c":"USD"}]}');
    if (u.pathname === '/api/data') return void res.writeHead(200, { 'content-type': 'application/json' }).end('["Factura A","Factura B"]');
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await launch();
}, 30_000);
afterAll(async () => {
  await browser?.close();
  server?.close();
});

const cell = (bad, o = {}) =>
  runCell(browser, {
    base, kind: 'static', width: 390, lang: 'es', state: null,
    screen: { id: 'fixture', exp: 'test', path: `/f?bad=${bad}&lang=${o.lang ?? 'es'}`, primary: '#go', states: ['empty', 'error', 'offline'] },
    opts: { dicts: DICTS, speed: true, shots: false },
    ...o,
  });
const status = (rs, id) => rs.find((r) => r.id === id)?.status;
const fails = (rs) => rs.filter((r) => r.status === 'fail').map((r) => r.id);

describe('approved palette and fonts', () => {
  it('match web/styles.css at 6d34830', () => {
    let css;
    try {
      css = execFileSync('git', ['show', '6d34830:web/styles.css'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return; // shallow clone without that commit
    }
    const hex = (c) => c.toLowerCase().replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3');
    const found = new Set([...css.matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map((m) => hex(m[0])).map((c) => (c === '#787774' ? '#6d6c69' : c))); // R-99: the one swap
    found.add('#000000'); // rgba(0, 0, 0, 0.6) tour overlay
    found.add('#956400').add('#fbf3db'); // R-100: the ESCALAR status pair
    expect([...found].sort()).toEqual([...PALETTE].sort());
    for (const f of css.match(/--font-(?:sans|serif|mono): [^;]+/g)) expect(FONTS).toContain(f.split(': ')[1]);
  });

  it('R-99: the old muted grey #787774 is gone from web/, portal/ and src/lib/email.ts', () => {
    let hits;
    try {
      hits = execFileSync('git', ['grep', '-il', '787774', '--', 'web', 'portal', 'src/lib/email.ts'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      hits = e.status === 1 ? '' : String(e); // git grep exits 1 when nothing matches
    }
    expect(hits.trim()).toBe('');
  });
});

describe('clean fixture', () => {
  it.each([[360, 'es'], [1440, 'en']])('passes every check at %i %s', async (width, lang) => {
    const rs = await cell('none', { width, lang });
    expect(fails(rs)).toEqual([]);
    expect(rs.length).toBeGreaterThan(15);
  }, 60_000);
  it('passes the dynamic checks (focus ring, Enter, busy within 100 ms)', async () => {
    const rs = await cell('none', { kind: 'dynamic' });
    expect(fails(rs)).toEqual([]);
    expect(['3.focus', '3.enter', '4.busy'].map((id) => status(rs, id))).toEqual(['pass', 'pass', 'pass']);
  }, 60_000);
  it('never lets a write reach the server without --mutate, even after the cell closes', async () => {
    seen.length = 0;
    await cell('none', { kind: 'dynamic' });
    await new Promise((r) => setTimeout(r, 1500));
    expect(seen).toEqual([]);
  }, 60_000);
  it('lets the write through with --mutate', async () => {
    seen.length = 0;
    await cell('none', { kind: 'dynamic', opts: { dicts: DICTS, speed: true, shots: false, mutate: true } });
    await new Promise((r) => setTimeout(r, 300));
    expect(seen).toEqual(['POST /api/act']);
  }, 60_000);
  it('shows a message while loading', async () => {
    expect(fails(await cell('none', { kind: 'loading' }))).toEqual([]);
  }, 60_000);
  it.each(['empty', 'error', 'offline'])('has a designed %s state with a next step', async (state) => {
    const rs = await cell('none', { state });
    expect(fails(rs)).toEqual([]);
    expect(status(rs, '4.state')).toBe('pass');
  }, 60_000);
});

describe('one known violation per item', () => {
  const stat = ['0.reach', '1.scroll', '1.offscreen', '1.clip', '1.overlap', '1.tables', '2.targets', '2.inputs', '2.primary', '3.axe', '3.contrast', '3.labels', '3.lang', '4.cls', '5.words', '5.mixed', '5.locale', '6.palette', '6.fonts', '6.logo', '6.console', '6.images', '7.usable', '7.longtask'];
  it.each(stat)('%s', async (id) => {
    const lang = id === '5.mixed' ? 'en' : 'es';
    const rs = await cell(id, { lang });
    expect(status(rs, id), JSON.stringify(rs.find((r) => r.id === id))).toBe('fail');
  }, 60_000);
  it.each(['3.focus', '3.enter', '4.busy'])('%s', async (id) => {
    expect(status(await cell(id, { kind: 'dynamic' }), id)).toBe('fail');
  }, 60_000);
  it.each(['5.words:404', '5.words:trace'])('%s', async (bad) => {
    expect(status(await cell(bad), '5.words')).toBe('fail');
  }, 60_000);
  it('4.loading', async () => {
    expect(status(await cell('4.loading', { kind: 'loading' }), '4.loading')).toBe('fail');
  }, 60_000);
  it.each(['empty', 'error', 'offline'])('4.state (%s)', async (state) => {
    expect(status(await cell('4.state', { state }), '4.state')).toBe('fail');
  }, 60_000);
});

describe('policy forced states (AC-91)', () => {
  const policy = SCREENS.find((s) => s.id === 'policy');
  it('policy runs fx-empty and fx-error', () => expect(policy.states).toEqual(['fx-empty', 'fx-error']));
  it.each([['fx-empty', 'f.empty'], ['fx-error', 'f.err']].flatMap(([s, k]) => ['es', 'en'].map((l) => [s, k, l])))('%s shows its message and next step (%s, %s)', async (state, key, lang) => {
    const rs = await cell('fx', { state, lang });
    expect(status(rs, '4.state'), JSON.stringify(rs.find((r) => r.id === '4.state'))).toBe('pass');
    expect(rs.find((r) => r.id === '4.state').measured).toContain(DICTS[lang][key].slice(0, 12));
  }, 60_000);
});

describe('detail-unread (AC-91)', () => {
  const inv = [{ id: 'a', outcome: 'PAGAR', fields: {} }, { id: 'b', outcome: 'ESCALAR', fields: { read_error: 'lector_no_disponible' } }, { id: 'c', outcome: null }];
  it('opens an invoice the agent has not decided or could not read', () => {
    expect(unreadId(inv)).toBe('b');
    expect(unreadId([inv[0], inv[2]])).toBe('c');
  });
  it('is undefined when the demo has none', () => expect(unreadId([inv[0]])).toBeUndefined());
  it('is reported N/A, not opened, when the demo has none', async () => {
    const lines = [];
    const log = console.log;
    console.log = (l) => lines.push(l);
    server.overview = { invoices: [inv[0]] };
    try {
      expect(await main(['--base', base, '--screens', 'detail-unread', '--only', '0.reach'])).toBe(0);
    } finally {
      console.log = log;
      server.overview = undefined;
    }
    expect(lines.join('\n')).toMatch(/detail-unread N\/A/);
  }, 60_000);
});

describe('palette-only mode', () => {
  it('reports only the colour audit', async () => {
    const rs = await cell('6.palette', { opts: { dicts: DICTS, only: ['6.palette'], shots: false } });
    expect(rs.map((r) => r.id)).toEqual(['6.palette']);
    expect(rs[0].status).toBe('fail');
  }, 60_000);
});

describe('report', () => {
  const rows = [
    { screen: 'inbox', width: 360, lang: 'es', id: '1.scroll', status: 'pass', value: 0, measured: 'scrollWidth 360 <= 360' },
    { screen: 'inbox', width: 390, lang: 'en', id: '1.scroll', status: 'fail', value: 12, measured: 'scrollWidth 402 > 390' },
    { screen: 'inbox', width: 390, lang: 'en', id: '6.primary_count', status: 'info', value: 1, measured: '1 primary button' },
  ];
  it('aggregates the worst cell per screen and check', () => {
    const a = aggregate(rows);
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ screen: 'inbox', id: '1.scroll', status: 'fail', cells: 2, failing: 1 });
    expect(a[0].measured).toContain('402');
    expect(a[0].measured).toContain('390/en');
  });
  it('writes a table with FAIL rows and a total', () => {
    const md = renderGate('finance', { inbox: aggregate(rows) }, 'http://x');
    expect(md).toMatch(/\| 1\.scroll \| FAIL \|/);
    expect(md).toContain('FAILED ITEMS: 1');
  });
  it('keeps the screens a partial run did not touch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-'));
    const file = join(dir, 'gate-finance.md');
    writeGate(file, 'finance', { inbox: aggregate(rows) }, 'http://x');
    writeGate(file, 'finance', { policy: aggregate(rows.slice(0, 1).map((r) => ({ ...r, screen: 'policy' }))) }, 'http://x');
    const md = readFileSync(file, 'utf8');
    expect(md).toContain('## inbox');
    expect(md).toContain('## policy');
    expect(md).toContain('FAILED ITEMS: 1');
    writeFileSync(file, md);
    expect(existsSync(file)).toBe(true);
  });
});
