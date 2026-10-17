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
  es: { 'f.title': 'Bandeja', 'f.empty': 'Todavía no hay facturas.', 'f.retry': 'Reintentar', 'f.send': 'Enviar', 'f.save': 'Guardar cambios', 'f.err': 'No pude cargar los datos. Inténtalo de nuevo.', 'f.decide': 'decide', 'f.nopay': 'No puedo mostrar este pago', 'f.nopay.next': 'Pídele a quien te lo envió que lo reenvíe.', 'f.offline': 'Sin conexión. Revisa tu conexión e inténtalo de nuevo.', 'f.failed': 'No se pudo enviar. Inténtalo de nuevo.' },
  en: { 'f.title': 'Inbox', 'f.empty': 'There are no invoices yet.', 'f.retry': 'Retry', 'f.send': 'Send', 'f.save': 'Save changes', 'f.err': 'I could not load the data. Please try again.', 'f.decide': 'decide', 'f.nopay': "I can't show this payment", 'f.nopay.next': 'Ask the sender to send it again.', 'f.offline': 'You are offline. Check your connection and try again.', 'f.failed': 'It could not be sent. Please try again.' },
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
  .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
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
  <span class="sr-only">Texto solo para lectores de pantalla</span>
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
  ${bad === '5.mixed:short' ? `<button type="button">${DICTS.es['f.send']}</button>` : ''}
  ${bad === '5.mixed:both' ? `<p>  ${DICTS.en['f.decide'].toUpperCase()} </p>` : ''}
  ${bad === '5.locale' ? '<p>Total 1,234.50</p>' : ''}
  ${bad === '6.palette' ? '<p class="pal">Color</p>' : ''}
  ${bad === '6.fonts' ? '<p class="fnt">Fuente</p>' : ''}
  ${bad === '6.images' ? `<img src="${PNG}" width="300" height="100" alt="">` : `<img src="${SVG}" width="8" height="8" alt="">`}
  <form id="f" onsubmit="return false">
    ${bad === 'compose' ? '<label for="msg">Mensaje</label><textarea id="msg" rows="1" style="display:block;width:100%;font-size:16px"></textarea>' : ''}
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
    if (bad === 'compose' && !document.getElementById('msg').value.trim()) return;
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

// A vendor page that picks its language like the portal: ?lang= (src q) or localStorage portal.lang (src s), else es.
const portalPage = (src) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>p</title></head><body><main><h1 id="h"></h1><p id="m"></p></main><script>
const l = (${src === 'q' ? "new URLSearchParams(location.search).get('lang')" : "localStorage.getItem('portal.lang')"}) === 'en' ? 'en' : 'es';
const T = ${JSON.stringify(DICTS)}[l];
document.documentElement.lang = l; document.getElementById('h').textContent = T['f.title']; document.getElementById('m').textContent = T['f.empty'];
</script></body></html>`;
// The designed 404 page (AC-83): a sentence with the next step, no control. ?sub=1 adds a broken image, ?bare=1 drops the verb.
const gonePage = (u) => {
  const lang = u.searchParams.get('lang') === 'en' ? 'en' : 'es';
  const text = u.searchParams.has('bare') ? 'No existe esta página en el sitio' : lang === 'en' ? 'This link does not exist. Ask the company for the right link.' : 'Este enlace no existe. Pídele el enlace correcto a la empresa.';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>g</title></head><body><header><svg data-logo role="img" aria-label="Logo" width="32" height="32"><rect width="32" height="32" fill="#111111"/></svg></header><main><h1>${text}</h1>${u.searchParams.has('sub') ? '<img src="/missing.png" width="8" height="8" alt="">' : ''}</main>${u.searchParams.has('spoof') ? "<script>console.error('Failed to load resource: the server responded with a status of 404 (Not Found)')</script>" : ''}</body></html>`;
};

// R-112: the approve screen. ?s= is the status of GET /api/approve/<token>; ?wrong shows another heading, ?ctl adds a primary button,
// ?x logs a second error, ?n skips the main request and ?o asks another URL instead.
const approvePage = (u, token) => {
  const q = u.searchParams, lang = q.get('lang') === 'en' ? 'en' : 'es', t = DICTS[lang];
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>a</title></head><body><header><svg data-logo role="img" aria-label="Logo" width="32" height="32"><rect width="32" height="32" fill="#111111"/></svg></header><main><h1>${q.has('wrong') ? t['f.title'] : t['f.nopay']}</h1><p>${t['f.nopay.next']}</p>${q.has('ctl') ? `<button class="primary" type="button">${t['f.retry']}</button>` : ''}</main><script>
  const u = '/api/approve/' + ${JSON.stringify(token)};
  ${q.has('n') ? '' : 'fetch(u + location.search);'}
  ${q.has('o') ? "fetch(u + '-other' + location.search);" : ''}
  ${q.has('x') ? "console.error('boom');" : ''}
  </script></body></html>`;
};
// R-114: a sticky header (?mode: opaque, translucent, same layer, outside its box, content above it) over content scrolled under it.
const overlapPage = (mode) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>o</title><style>
  body{margin:0;font:16px/1.6 ${FONTS[0]};color:#111111;background:#ffffff}
  header{position:sticky;top:0;z-index:2;height:${mode === 'outside' ? 20 : 56}px;padding:0 16px;background:${mode === 'translucent' ? 'rgba(255,255,255,0.5)' : '#ffffff'}}
  header span{position:absolute;left:16px;top:0}
  p{margin:0;padding:0 16px;${mode === 'above' ? 'position:relative;z-index:5' : ''}}
  </style></head><body><header><span>Cabecera fija</span>${mode === 'same' ? '<span style="top:6px">Otra marca de cabecera</span>' : ''}</header><p>Contenido que pasa por debajo</p><div style="height:2000px"></div><script>scrollTo(0,${mode === 'outside' ? 12 : 56})</script></body></html>`;
// Vendor pages for the forced states: the portal chat (POST answers a bubble) and the server-rendered status page (offline notice).
const portalFixture = (bare) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>p</title></head><body><main><h1>Portal</h1><div class="log"></div><form id="f"><label for="m">Mensaje</label><textarea id="m" style="font-size:16px"></textarea><button type="submit" class="primary">Enviar</button></form></main><script>
  const log = document.querySelector('.log');
  const bubble = (t) => { log.innerHTML = '<article class="bubble error"><p>' + t + '</p></article>'; };
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (navigator.onLine === false) return bubble(${JSON.stringify(bare ? 'Algo salió mal.' : DICTS.es['f.offline'])});
    const r = await fetch(location.pathname, { method: 'POST' }).catch(() => null);
    if (!r || !r.ok) bubble(${JSON.stringify(bare ? 'Algo salió mal.' : DICTS.es['f.failed'])});
  });
  </script></body></html>`;
const statusFixture = () => `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>s</title></head><body><main><p class="state" role="status" hidden>${DICTS.es['f.offline']}</p><h1>Recibida</h1></main><script>
  const n = document.querySelector('.state');
  for (const e of ['online', 'offline']) addEventListener(e, () => { n.hidden = navigator.onLine !== false; });
  </script></body></html>`;

let server, base, browser;
const seen = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method !== 'GET') seen.push(`${req.method} ${u.pathname}`);
    if (u.pathname === '/f') return void res.writeHead(200, { 'content-type': 'text/html', ...(u.searchParams.has('csp') ? { 'content-security-policy': "script-src 'self'" } : {}) }).end(page(u.searchParams.get('bad') ?? '', u.searchParams.get('lang') ?? 'es'));
    if (u.pathname === '/pq' || u.pathname === '/ps') return void res.writeHead(200, { 'content-type': 'text/html' }).end(portalPage(u.pathname === '/pq' ? 'q' : 's'));
    if (u.pathname.startsWith('/approve/')) return void res.writeHead(200, { 'content-type': 'text/html' }).end(approvePage(u, u.pathname.slice(9)));
    if (u.pathname.startsWith('/api/approve/')) return void res.writeHead(+(u.searchParams.get('s') ?? 404), { 'content-type': 'application/json' }).end('{"error":"invalid_token"}');
    if (u.pathname === '/ov') return void res.writeHead(200, { 'content-type': 'text/html' }).end(overlapPage(u.searchParams.get('mode')));
    if (u.pathname === '/pf') return void res.writeHead(200, { 'content-type': 'text/html' }).end(req.method === 'POST' ? '{"ok":true}' : portalFixture(u.searchParams.has('bare')));
    if (u.pathname === '/sf') return void res.writeHead(200, { 'content-type': 'text/html' }).end(statusFixture());
    if (u.pathname === '/gone') return void res.writeHead(u.searchParams.has('spoof') ? 200 : 404, { 'content-type': 'text/html' }).end(gonePage(u));
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
const vendor = (id, path, extra = {}) => ({ id, exp: 'vendor', path, ...extra });
const run = (screen, o = {}) => runCell(browser, { base, kind: 'static', width: 390, lang: 'es', state: null, screen, opts: { dicts: DICTS, speed: true, shots: false }, ...o });
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
    const found = new Set([...css.matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map((m) => hex(m[0])));
    found.add('#000000'); // rgba(0, 0, 0, 0.6) tour overlay
    expect([...found].sort()).toEqual([...PALETTE].sort());
    for (const f of css.match(/--font-(?:sans|serif|mono): [^;]+/g)) expect(FONTS).toContain(f.split(': ')[1]);
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

describe('portal harness fixes (QA run 1)', () => {
  it('measures axe on a page served with a strict CSP (no crash)', async () => {
    const rs = await run({ id: 'csp', exp: 'test', path: '/f?bad=3.axe&csp=1', primary: '#go' });
    expect(status(rs, '0.run')).toBeUndefined();
    expect(status(rs, '3.axe'), JSON.stringify(rs.find((r) => r.id === '3.axe'))).toBe('fail');
  }, 60_000);
  it('keeps a clean page passing axe under the strict CSP', async () => {
    const rs = await run({ id: 'csp', exp: 'test', path: '/f?bad=none&csp=1', primary: '#go' });
    expect(['3.axe', '3.contrast'].map((id) => status(rs, id))).toEqual(['pass', 'pass']);
  }, 60_000);

  it.each([['/pq', 'the ?lang= query'], ['/ps', 'localStorage portal.lang']])('reaches English through %s on a vendor screen', async (path) => {
    const rs = await run(vendor('portal', path), { lang: 'en' });
    expect(status(rs, '3.lang'), JSON.stringify(rs.find((r) => r.id === '3.lang'))).toBe('pass');
    expect(status(rs, '5.mixed'), JSON.stringify(rs.find((r) => r.id === '5.mixed'))).toBe('pass');
  }, 60_000);
  it('keeps the portal in Spanish for es', async () => {
    const rs = await run(vendor('portal', '/pq'), { lang: 'es' });
    expect(['3.lang', '5.mixed'].map((id) => status(rs, id))).toEqual(['pass', 'pass']);
  }, 60_000);

  it('types into the composer before the busy check when the screen names one', async () => {
    const screen = (compose) => ({ id: 'fixture', exp: 'test', path: '/f?bad=compose', primary: '#go', compose });
    expect(status(await run(screen(undefined), { kind: 'dynamic' }), '4.busy')).toBe('fail');
    expect(status(await run(screen('#msg'), { kind: 'dynamic' }), '4.busy')).toBe('pass');
  }, 60_000);
});

describe('designed 404 pages (R-103)', () => {
  const gone = (q = '') => vendor('portal-error', `/gone${q}`, { notFound: true });
  it.each(['es', 'en'])('6.console excludes exactly the main-document 404 and prints it (%s)', async (lang) => {
    const rs = await run(gone(), { lang });
    expect(status(rs, '6.console'), JSON.stringify(rs.find((r) => r.id === '6.console'))).toBe('pass');
    expect(rs.find((r) => r.id === '6.console').measured).toContain('excluded: expected 404 (AC-83/AC-84)');
    expect(status(rs, '3.lang')).toBe('pass');
    expect(status(rs, '5.mixed')).toBe('pass');
  }, 60_000);
  it('still fails the same 404 line on any other screen', async () => {
    expect(status(await run(vendor('portal', '/gone')), '6.console')).toBe('fail');
  }, 60_000);
  it('still fails a 404 for a subresource on a designed 404 page', async () => {
    const r = (await run(gone('?sub=1'))).find((x) => x.id === '6.console');
    expect(r.status, JSON.stringify(r)).toBe('fail');
    expect(r.measured).toContain('/missing.png');
  }, 60_000);
  it('does not exclude the line when the main response is not a 404', async () => {
    expect(status(await run(gone('?spoof=1')), '6.console')).toBe('fail');
  }, 60_000);

  it.each(['es', 'en'])('4.state needs no control: the sentence with its verb is the next step (%s)', async (lang) => {
    const r = (await run(gone(), { lang })).find((x) => x.id === '4.state');
    expect(r.status, JSON.stringify(r)).toBe('pass');
  }, 60_000);
  it('4.state fails a 404 page whose sentence names no next step', async () => {
    expect(status(await run(gone('?bare=1')), '4.state')).toBe('fail');
  }, 60_000);

  it('2.primary and 7.usable carry the design reason, never FAIL', async () => {
    const rs = await run(gone());
    const p = rs.find((r) => r.id === '2.primary');
    expect([p.status, p.measured]).toEqual(['na', 'sin acción por diseño (R-103)']);
    const u = rs.find((r) => r.id === '7.usable');
    expect(u.status, JSON.stringify(u)).toBe('pass');
    expect(u.measured).toContain('sin acción por diseño (R-103)');
  }, 60_000);
  it('3.focus, 3.enter and 4.busy are N/A with the design reason', async () => {
    const rs = await run(gone(), { kind: 'dynamic' });
    expect(['3.focus', '3.enter', '4.busy'].map((id) => rs.find((r) => r.id === id)).map((r) => [r.status, r.measured])).toEqual(Array(3).fill(['na', 'sin acción por diseño (R-103)']));
  }, 60_000);
  it('keeps the primary-action items for every other screen', async () => {
    expect(status(await run({ id: 'x', exp: 'test', path: '/f?bad=3.focus', primary: '#go' }, { kind: 'dynamic' }), '3.focus')).toBe('fail');
  }, 60_000);
  it('marks the two designed 404 screens in SCREENS', () => {
    expect(SCREENS.filter((s) => s.notFound).map((s) => s.id)).toEqual(['portal-error', 'status-invalid']);
    expect(SCREENS.find((s) => s.id === 'portal').compose).toBeTruthy();
  });
});

describe('invalid approval link: the one expected 404 line (R-112)', () => {
  const approve = (q = '', o = {}) => ({ ...SCREENS.find((s) => s.id === 'approve'), path: `/approve/tok-gate?lang=${o.lang ?? 'es'}${q}` });
  const row = (rs, id) => rs.find((r) => r.id === id);
  it.each(['es', 'en'])('excludes exactly that line and prints it (%s)', async (lang) => {
    const rs = await run(approve('&s=404', { lang }), { lang });
    expect(status(rs, '6.console'), JSON.stringify(row(rs, '6.console'))).toBe('pass');
    expect(row(rs, '6.console').measured).toContain('excluded: expected 404 (invalid link)');
  }, 60_000);
  it.each([['a second error line', '&s=404&x=1'], ['a 409', '&s=409'], ['a 500', '&s=500'], ['another URL', '&s=404&n=1&o=1'], ['a second request that fails', '&s=404&o=1'], ['no designed heading', '&s=404&wrong=1']])('still fails with %s', async (_, q) => {
    const rs = await run(approve(q));
    expect(status(rs, '6.console'), JSON.stringify(row(rs, '6.console'))).toBe('fail');
    expect(row(rs, '6.console').measured).toMatch(/^1 console errors/); // the expected line may go (exactly one); the other stays
  }, 60_000);
  it('still fails the same line on any other screen', async () => {
    expect(status(await run({ id: 'inbox', exp: 'finance', path: '/approve/tok-gate?s=404' }), '6.console')).toBe('fail');
  }, 60_000);
  it('has nothing to exclude on a page that loads', async () => {
    const r = row(await run(approve('&s=200&wrong=1')), '6.console');
    expect([r.status, r.measured.includes('excluded')]).toEqual(['pass', false]);
  }, 60_000);

  it('2.primary, 3.focus, 3.enter, 4.busy and the 7.usable primary part are N/A with the design reason when it has no control', async () => {
    const rs = await run(approve('&s=404'));
    expect([row(rs, '2.primary').status, row(rs, '2.primary').measured]).toEqual(['na', 'sin acción por diseño (R-103)']);
    expect(row(rs, '7.usable').measured).toContain('sin acción por diseño (R-103)');
    const d = await run(approve('&s=404'), { kind: 'dynamic' });
    expect(['3.focus', '3.enter', '4.busy'].map((id) => row(d, id)).map((r) => [r.status, r.measured])).toEqual(Array(3).fill(['na', 'sin acción por diseño (R-103)']));
  }, 60_000);
  it('keeps the action items when the state has a control', async () => {
    const d = await run(approve('&s=404&ctl=1'), { kind: 'dynamic' });
    expect(row(d, '3.focus').measured).not.toBe('sin acción por diseño (R-103)');
  }, 60_000);
});

describe('5.mixed: only strings that belong to the other language alone (R-113)', () => {
  it('lets a string both dictionaries hold pass, ignoring case and spacing', async () => {
    const r = (await cell('5.mixed:both', { lang: 'en' })).find((x) => x.id === '5.mixed');
    expect(r.status, JSON.stringify(r)).toBe('pass');
  }, 60_000);
  it('flags a one-word string that only the es dictionary holds, on an en screen', async () => {
    const r = (await cell('5.mixed:short', { lang: 'en' })).find((x) => x.id === '5.mixed');
    expect([r.status, r.measured]).toEqual(['fail', expect.stringContaining('Enviar')]);
  }, 60_000);
  it('flags an en-only string on an es screen, and passes it once the es dictionary holds it too', async () => {
    const screen = { id: 'x', exp: 'test', path: '/pq' }; // shows «Bandeja» in es
    const dicts = (es) => ({ es, en: { b: 'Bandeja' } });
    const mixed = async (d) => status(await run(screen, { opts: { dicts: d, speed: true, shots: false } }), '5.mixed');
    expect(await mixed(dicts({ a: 'Hola' }))).toBe('fail');
    expect(await mixed(dicts({ a: 'Hola', b: 'Bandeja' }))).toBe('pass');
  }, 60_000);
});

describe('1.overlap: text under an opaque sticky or fixed layer (R-114)', () => {
  const ov = (mode) => run({ id: 'ov', exp: 'test', path: `/ov?mode=${mode}` });
  const one = (rs) => rs.find((r) => r.id === '1.overlap');
  it('passes an opaque sticky header over scrolled content and prints the pair', async () => {
    const r = one(await ov('opaque'));
    expect(r.status, JSON.stringify(r)).toBe('pass');
    expect(r.measured).toContain('excluded: occluded by sticky/fixed layer');
  }, 60_000);
  it.each([['a translucent header', 'translucent'], ['two texts inside the header', 'same'], ['a rectangle outside the layer box', 'outside'], ['content drawn above the header', 'above']])('still fails %s', async (_, mode) => {
    const r = one(await ov(mode));
    expect(r.status, JSON.stringify(r)).toBe('fail');
    expect(r.measured).toMatch(/^[1-9] overlapping text boxes/);
  }, 60_000);
  it('keeps the excluded line in the aggregate when another cell has none', () => {
    const rows = [{ screen: 's', width: 360, lang: 'es', id: '1.overlap', status: 'pass', value: 0, measured: '0 overlapping text boxes' }, { screen: 's', width: 390, lang: 'es', id: '1.overlap', status: 'pass', value: 0, measured: '0 overlapping text boxes; excluded: occluded by sticky/fixed layer ("a" under "b")' }];
    expect(aggregate(rows)[0].measured).toContain('excluded: occluded by sticky/fixed layer');
  });
});

describe('vendor forced states (QA of Task 25)', () => {
  const forced = (id, path) => ({ ...SCREENS.find((s) => s.id === id), path });
  const state = async (screen, st, lang = 'es') => (await run(screen, { state: st, lang })).find((r) => r.id === '4.state');
  it('portal error: types a message, the POST answers 500 (never reaches the server), the message has a next step', async () => {
    seen.length = 0;
    const r = await state(forced('portal', '/pf'), 'error');
    expect(r.status, JSON.stringify(r)).toBe('pass');
    expect(r.measured).toContain('No se pudo enviar');
    expect(seen).toEqual([]);
  }, 60_000);
  it('portal error fails when the message offers no next step', async () => {
    expect((await state(forced('portal', '/pf?bare=1'), 'error')).status).toBe('fail');
  }, 60_000);
  it('portal offline: sends while offline and checks the message', async () => {
    const r = await state(forced('portal', '/pf'), 'offline');
    expect(r.status, JSON.stringify(r)).toBe('pass');
    expect(r.measured).toContain('Sin conexión');
  }, 60_000);
  it('portal offline fails when the message offers no next step', async () => {
    expect((await state(forced('portal', '/pf?bare=1'), 'offline')).status).toBe('fail');
  }, 60_000);
  it('portal empty is N/A: no list by design', async () => {
    const r = await state(forced('portal', '/pf'), 'empty');
    expect([r.status, r.measured]).toEqual(['na', 'sin estado vacío por diseño']);
  }, 60_000);
  it.each(['empty', 'error'])('status %s is N/A: server-rendered, no request to fail', async (st) => {
    const r = await state(forced('status', '/sf'), st);
    expect([r.status, r.measured]).toEqual(['na', 'servidor: sin petición que fallar']);
  }, 60_000);
  it('status offline shows the «Sin conexión» notice', async () => {
    const r = await state(forced('status', '/sf'), 'offline');
    expect(r.status, JSON.stringify(r)).toBe('pass');
    expect(r.measured).toContain('Sin conexión');
  }, 60_000);
});
