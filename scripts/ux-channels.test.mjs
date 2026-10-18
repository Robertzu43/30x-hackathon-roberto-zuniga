// The gate row 1.channels (AC-123): three rows share one row from 600 px of content box (equal widths, level tops, +-1 px),
// stack below it (each as wide as the content box), and no row's text crosses its box. Fixture pages use the card's real CSS.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { en, es } from '../src/i18n/features/channels.ts';
import { checkChannels, judgeChannels } from './ux-channels.mjs';
import { launch } from './ux-gate.mjs';

const CSS = readFileSync('web/styles.css', 'utf8').match(/:root\s*{[^}]*}/)[0] + readFileSync('web/components/channels-card.css', 'utf8'); // the real tokens and the real card CSS
const BASE = 'body{margin:0;font:16px/1.6 sans-serif} .muted{color:#6d6c69} button{font:inherit}';
const PORTAL = 'https://facturas.30x-hackathon-roberto-zuniga.workers.dev/andina-labs';
const WIDTHS = [360, 390, 768, 1024, 1440, 1920, 2560];

// The card as ChannelsCard renders it. `rows` can drop or reorder rows; `css` is the one known violation.
const html = (lang, { css = '', rows = ['portal', 'email', 'telegram'], band = 1440 } = {}) => {
  const t = lang === 'es' ? es : en;
  const row = {
    portal: `<li data-channel="portal"><h3>${t['channels.portal.name']}</h3><span class="channel-chip channel-chip-active">${t['channels.status.active']}</span><p>${t['channels.portal.text']}</p><p class="channel-url">${PORTAL}</p><button type="button">Copiar enlace</button></li>`,
    email: `<li data-channel="email"><h3>${t['channels.email.name']}</h3><span class="channel-chip channel-chip-idle">${t['channels.status.pending_domain']}</span><p>${t['channels.email.pending']}</p></li>`,
    telegram: `<li data-channel="telegram"><h3>${t['channels.telegram.name']}</h3><span class="channel-chip channel-chip-idle">${t['channels.status.off']}</span><p>${t['channels.telegram.off']}</p></li>`,
  };
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>c</title><style>${BASE}${CSS} main{max-width:${band}px;margin:0 auto;padding:0 16px}${css}</style></head><body><main>
    <section class="channels-card" data-block aria-labelledby="t"><h2 id="t">${t['channels.title']}</h2><p class="muted">${t['channels.lead']}</p><ul class="channels-list">${rows.map((r) => row[r]).join('')}</ul></section></main></body></html>`;
};

let browser;
beforeAll(async () => { browser = await launch(); }, 60_000);
afterAll(async () => { await browser?.close(); });

const gate = async (width, lang, opts) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  await page.setContent(html(lang, opts));
  const r = await checkChannels(page);
  await ctx.close();
  return r;
};

describe('1.channels passes the real card CSS at every gate width, es and en', () => {
  for (const lang of ['es', 'en'])
    for (const w of WIDTHS)
      it(`${w} px ${lang}`, async () => {
        const r = await gate(w, lang);
        expect(r.id).toBe('1.channels');
        expect(r.measured).toMatch(w >= 768 ? /three across/ : /stacked/); // the card's content box is 600 px or more from 768
        expect(r.status).toBe('pass');
      }, 30_000);
});

describe('1.channels fails one known violation each', () => {
  const bad = async (width, css, opts = {}) => gate(width, 'es', { css, ...opts });
  it('a 2 + 1 split at 1440', async () => {
    const r = await bad(1440, '.channels-list{grid-template-columns:repeat(2,minmax(0,1fr))}');
    expect(r.status).toBe('fail');
    expect(r.measured).toMatch(/top/);
  }, 30_000);
  it('unequal widths at 1440', async () => {
    const r = await bad(1440, '.channels-list{grid-template-columns:2fr 1fr 1fr}');
    expect(r.status).toBe('fail');
    expect(r.measured).toMatch(/width/);
  }, 30_000);
  it('a URL overflowing its row at 360', async () => {
    const r = await bad(360, '.channels-list>li{overflow:visible} .channel-url{white-space:nowrap;overflow-wrap:normal}');
    expect(r.status).toBe('fail');
    expect(r.measured).toMatch(/crosses/);
  }, 30_000);
  it('rows narrower than the content box at 360', async () => {
    const r = await bad(360, '.channels-list>li{width:50%}');
    expect(r.status).toBe('fail');
    expect(r.measured).toMatch(/width/);
  }, 30_000);
  it('three across below 600 px of content (forced columns at 360)', async () => {
    const r = await bad(360, '.channels-list{grid-template-columns:repeat(3,minmax(0,1fr))}');
    expect(r.status).toBe('fail');
  }, 30_000);
  it('stacked from 600 px of content (forced single column at 1440)', async () => {
    const r = await bad(1440, '.channels-list{grid-template-columns:minmax(0,1fr)}');
    expect(r.status).toBe('fail');
  }, 30_000);
  it('a missing row', async () => {
    const r = await bad(1440, '', { rows: ['portal', 'email'] });
    expect(r.status).toBe('fail');
    expect(r.measured).toMatch(/portal, email/);
  }, 30_000);
  it('rows out of order', async () => {
    const r = await bad(1440, '', { rows: ['email', 'portal', 'telegram'] });
    expect(r.status).toBe('fail');
  }, 30_000);
  it('no card on the page', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.setContent('<!doctype html><body><main><h1>Bandeja</h1></main></body>');
    expect((await checkChannels(page)).status).toBe('fail');
    await ctx.close();
  }, 30_000);
});

describe('the threshold is the content box, not the viewport', () => {
  // A band whose card has a content box of exactly 599 / 600 px: card padding 24 + border 1 on each side (main's padding is outside its max-width).
  const band = (content) => content + 2 * 25;
  it('599 px: stacked passes', async () => {
    const r = await gate(1440, 'es', { band: band(599) });
    expect(r.measured).toMatch(/stacked/);
    expect(r.status).toBe('pass');
  }, 30_000);
  it('600 px: three across passes', async () => {
    const r = await gate(1440, 'es', { band: band(600) });
    expect(r.measured).toMatch(/three across/);
    expect(r.status).toBe('pass');
  }, 30_000);
});

describe('judgeChannels, on raw measurements', () => {
  const rows = (...r) => r.map(([id, left, top, width]) => ({ id, left, top, width, right: left + width, over: [] }));
  const across = rows(['portal', 0, 0, 100], ['email', 110, 0, 100], ['telegram', 220, 0, 100]);
  it('accepts a difference of 1 px and refuses 2', () => {
    expect(judgeChannels({ content: 700, rows: rows(['portal', 0, 0, 100], ['email', 110, 1, 101], ['telegram', 220, 0, 99]) }).status).toBe('pass');
    expect(judgeChannels({ content: 700, rows: rows(['portal', 0, 0, 100], ['email', 110, 0, 102], ['telegram', 220, 0, 100]) }).status).toBe('fail');
    expect(judgeChannels({ content: 700, rows: rows(['portal', 0, 0, 100], ['email', 110, 2, 100], ['telegram', 220, 0, 100]) }).status).toBe('fail');
  });
  it('reports a row whose text crosses its box', () => {
    const r = judgeChannels({ content: 700, rows: across.map((x, i) => (i === 0 ? { ...x, over: ['p.channel-url'] } : x)) });
    expect(r.status).toBe('fail');
    expect(r.measured).toMatch(/crosses.*channel-url/);
  });
  it('a threshold of 600 px is the content box, so 600 is across and 599 is stacked', () => {
    expect(judgeChannels({ content: 600, rows: across }).status).toBe('pass');
    expect(judgeChannels({ content: 599, rows: across }).status).toBe('fail');
  });
});
