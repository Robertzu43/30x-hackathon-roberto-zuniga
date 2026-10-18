// D45 gate rows (AC-112..AC-116, AC-91 Clarified): one fixture page per check fails it; the same page, fixed, passes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launch } from './ux-gate.mjs';
import { judgeLayout, judgeTour, layoutMeasure, rowsOf, tourMeasure } from './ux-layout.mjs';

const LONG = 'Thesaurus lee cada factura, revisa las trece reglas de la política y deja un registro que cualquier persona de finanzas puede leer sin ayuda.';
const CSS = `*{box-sizing:border-box} body{margin:0;font:16px/1.6 sans-serif}
  .topbar{display:flex;justify-content:space-between;padding:8px max(48px, calc((100% - 1440px) / 2))}
  main{padding:24px 0} [data-band]{max-width:1536px;margin:0 auto;padding:0 48px}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:16px} [data-block]{min-height:40px;border:1px solid #eaeaea}
  .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px} [data-step-card]{border:1px solid #eaeaea;padding:16px}
  p{max-width:70ch}`;
const bandPage = (bad = '') => `<!doctype html><html><head><style>${CSS}
  ${bad === '1.band' ? '[data-band]{padding:0 68px}' : ''}
  ${bad === '1.cap' ? '.capped{max-width:768px}' : ''}
  ${bad === '1.measure' ? 'p.wide{max-width:none;width:900px}' : ''}
  ${bad === '6.cards' ? '.cards{grid-template-columns:repeat(2,1fr)}' : ''}
  </style></head><body>
  <header class="topbar"><svg class="logo" data-logo width="32" height="32"></svg><button>es</button></header>
  <main><section data-band>
    <div data-block class="capped"><h1>Bandeja</h1><p class="wide">${LONG}</p></div>
    ${bad === '1.grid' ? '<div data-block>a</div><div data-block>b</div>' : '<div class="two"><div data-block>a</div><div data-block>b</div></div>'}
    ${bad === '1.fill:half' ? '<div data-block style="width:50%">medio</div>' : ''}
    ${bad === '1.fill:unmarked' ? '<p>sin marca</p>' : ''}
    <div data-block><div class="cards">${[1, 2, 3].map((n) => `<div data-step-card><b data-step-title>Paso ${n}</b><p>Uno.</p></div>`).join('')}</div></div>
  </section></main></body></html>`;
const centredPage = (bad = '') => `<!doctype html><html><head><style>*{box-sizing:border-box} body{margin:0} main{padding:24px}
  .card{width:600px;margin:0 ${bad ? '0' : 'auto'};border:1px solid #eaeaea;padding:24px}</style></head>
  <body><main><div class="card"><h1>Aprobar</h1></div></main></body></html>`;
const heroPage = (bad = '', w = 1440) => `<!doctype html><html><head><style>*{box-sizing:border-box} body{margin:0}
  [data-band]{max-width:1376px;margin:0 auto;padding:0 48px;position:relative}
  [data-topbar]{position:absolute;right:48px;top:0} .hero{display:grid;grid-template-columns:${bad || w < 1024 ? '1fr' : '1fr 1fr'};gap:48px;padding-top:48px}
  [data-hero-video]{aspect-ratio:16/9;width:100%;background:#111}</style></head>
  <body><div data-band><div data-topbar data-block><button>es</button></div>
  <header class="hero" data-block><div><svg class="logo" data-logo width="32" height="32"></svg><h1>Un agente</h1><button data-door>Probar</button></div><div data-hero-video></div></header>
  </div></body></html>`;
const tourPage = (bad = '') => `<!doctype html><html><head><style>body{margin:0;height:3000px}
  .t{position:absolute;top:120px;left:40px;width:200px;height:44px} .tour-card{position:fixed;left:${bad ? '30px' : '600px'};top:${bad ? '110px' : '600px'};width:400px;height:200px}
  .tour-spotlight{position:fixed}</style></head>
  <body><button class="t" data-tour="new-invoice">Nueva factura</button><div class="tour-spotlight"></div><section class="tour-card" data-tour-step="new-invoice">Paso 2 de 7</section></body></html>`;

let browser, page;
beforeAll(async () => {
  browser = await launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
}, 30_000);
afterAll(async () => browser?.close());

const rows = async (html, id, width = 1440) => {
  await page.setViewportSize({ width, height: 900 });
  await page.setContent(html);
  return judgeLayout(await page.evaluate(layoutMeasure), { id, width });
};
const status = (rs, id) => rs.find((r) => r.id === id)?.status;

describe('band screens (AC-112, AC-113, AC-116)', () => {
  it('the fixed band page passes every row', async () => {
    const rs = await rows(bandPage(), 'inbox');
    expect(rs.filter((r) => r.status === 'fail')).toEqual([]);
    expect(rs.map((r) => r.id)).toEqual(['1.band', '1.cap', '1.fill', '1.measure', '1.grid', '6.cards']);
    expect(rs[0].measured).toContain('band x 48 width 1344');
  });
  it.each([
    ['1.band', '1.band'], ['1.cap', '1.cap'], ['1.fill:half', '1.fill'], ['1.fill:unmarked', '1.fill'],
    ['1.measure', '1.measure'], ['1.grid', '1.grid'], ['6.cards', '6.cards'],
  ])('%s fails %s', async (bad, id) => {
    expect(status(await rows(bandPage(bad), 'inbox'), id)).toBe('fail');
  });
  it('a band screen with no [data-band] fails its band rows', async () => {
    expect(status(await rows(centredPage(), 'policy'), '1.band')).toBe('fail');
  });
  it('1.grid is not asked of the empty, error and offline states (nothing to place side by side)', async () => {
    for (const st of ['empty', 'error', 'offline']) expect(status(await rows(bandPage('1.grid'), `inbox-${st}`), '1.grid')).toBeUndefined();
  });
  it('1.grid is N/A under 1440 and never asked of beneficiaries', async () => {
    expect(status(await rows(bandPage('1.grid'), 'inbox', 1024), '1.grid')).toBe('na');
    expect(status(await rows(bandPage('1.grid'), 'beneficiaries'), '1.grid')).toBeUndefined();
  });
});

describe('other screens: 1.centred (AC-112)', () => {
  it('passes a centred card and fails an off-centre one', async () => {
    expect(status(await rows(centredPage(), 'approve'), '1.centred')).toBe('pass');
    expect(status(await rows(centredPage('off'), 'approve'), '1.centred')).toBe('fail');
  });
  it('is N/A under 1024', async () => expect(status(await rows(centredPage('off'), 'approve', 768), '1.centred')).toBe('na'));
});

describe('/demo hero (AC-114)', () => {
  it('passes the video beside the h1 at 1440 and after the doors at 390', async () => {
    expect(status(await rows(heroPage('', 1440), 'demo'), '1.hero')).toBe('pass');
    expect(status(await rows(heroPage('', 390), 'demo', 390), '1.hero')).toBe('pass');
  });
  it('fails a video stacked under the h1 at 1440', async () => expect(status(await rows(heroPage('stacked'), 'demo'), '1.hero')).toBe('fail'));
  it('uses M = 1280 on /demo', async () => expect((await rows(heroPage(), 'demo')).find((r) => r.id === '1.band').measured).toContain('band x 80 width 1280'));
});

describe('tour card (AC-115)', () => {
  it('passes a card clear of its target and fails one over it', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.setContent(tourPage());
    expect(judgeTour(await page.evaluate(tourMeasure)).status).toBe('pass');
    await page.setContent(tourPage('over'));
    expect(judgeTour(await page.evaluate(tourMeasure)).status).toBe('fail');
  });
  it('measures a target inside its own horizontal scroller by the part the scroller shows (a table row at 390)', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(`<!doctype html><body style="margin:0"><div style="overflow-x:auto;margin:100px 24px 0"><table style="width:640px"><tr data-tour="invoice-row"><td>Fila</td></tr></table></div>
      <div class="tour-spotlight" style="position:fixed"></div><section class="tour-card" data-tour-step="invoice-row" style="position:fixed;left:12px;bottom:12px;width:366px;height:300px">Paso 4 de 7</section></body>`);
    expect(judgeTour(await page.evaluate(tourMeasure)).status).toBe('pass');
  });
  it('a large target passes with its heading clear and at most half covered', () => {
    const big = { step: 'policy', T: { left: 0, right: 1000, top: 100, bottom: 3000, width: 1000, height: 2900 }, head: { left: 0, right: 300, top: 100, bottom: 150 }, vw: 1000, vh: 900, top: 90 };
    expect(judgeTour({ ...big, C: { left: 250, right: 750, top: 600, bottom: 880, width: 500, height: 280 } }).status).toBe('pass');
    expect(judgeTour({ ...big, C: { left: 0, right: 1000, top: 120, bottom: 880, width: 1000, height: 760 } }).status).toBe('fail');
  });
});

it('rowsOf groups blocks that overlap by more than half the shorter one', () => {
  const b = (top, bottom) => ({ top, bottom, height: bottom - top });
  expect(rowsOf([b(0, 100), b(10, 90), b(95, 200)]).map((r) => r.length)).toEqual([2, 1]);
});
