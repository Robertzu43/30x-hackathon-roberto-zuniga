/* global process, console, document */ // Node script; `document` runs in the page for --png
// Thesaurus architecture diagram (AC-110 item 8, R-153, R-154). Draws only what wrangler.toml, portal/wrangler.toml,
// src/lib/llm.ts (Bedrock first, Workers AI fallback) and src/lib/email.ts (SES) deploy or build; dashed = built, inactive.
// Usage (repo root): node docs/architecture/build_architecture.mjs [--png]
// Writes docs/architecture/architecture.svg (Node standard library only, deterministic) and copies it to web/public/demo/.
// --png also renders architecture.png at 2x through the repo's Playwright Chromium (/opt/pw-browsers/chromium).
import { execSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONTS, PALETTE } from '../../scripts/ux-gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO = join(HERE, '../../web/public/demo');
const W = 1620, H = 1080;
const INK = '#111111', SUB = '#333333', MUTED = '#6d6c69', LINE = '#eaeaea', ZONE = '#fbfbfa', CARD = '#ffffff';
// Brand colours from simple-icons@16.34.0 data/simple-icons.json (R-153: logos keep their own colour).
const BRAND = { cloudflare: '#F38020', cloudflareworkers: '#F38020', supabase: '#3FCF8E' };
const out = [];
const add = (s) => out.push(s);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function icon(slug, x, y, size) {
  const d = readFileSync(join(HERE, 'icons', `${slug}.svg`), 'utf8').match(/<path d="([^"]+)"/)[1];
  add(`<g data-brand="${slug}" transform="translate(${x},${y}) scale(${size / 24})"><path d="${d}" fill="${BRAND[slug]}"/></g>`);
}
function text(x, y, s, { size = 12, weight = 400, fill = SUB, anchor = 'start', font = FONTS[0] } = {}) {
  s.split('|').forEach((line, i) => add(`<text x="${x}" y="${y + i * (size + 5)}" font-family="${font}" font-size="${size}" ` +
    `font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(line)}</text>`));
}
const rect = (x, y, w, h, fill, stroke, dash) =>
  add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1"${dash ? ' stroke-dasharray="6 4"' : ''}/>`);
function zone(x, y, w, h, title, slug) {
  rect(x, y, w, h, ZONE, LINE);
  if (slug) icon(slug, x + 20, y + 16, 24);
  text(x + (slug ? 54 : 20), y + 34, title, { size: 16, weight: 600, fill: INK });
}
// A card: title, grey lines, optional brand icon at the top right; dashed = built but inactive.
function card(x, y, w, h, title, sub, { slug, dash } = {}) {
  rect(x, y, w, h, CARD, dash ? MUTED : LINE, dash);
  if (slug) icon(slug, x + w - 40, y + 16, 24);
  text(x + 20, y + 34, title, { size: 14, weight: 600, fill: INK });
  text(x + 20, y + 58, sub);
}
function arrow(points, label, lx, ly, { dash, anchor = 'start' } = {}) {
  add(`<polyline points="${points.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${MUTED}" stroke-width="1.5" ` +
    `marker-end="url(#a)"${dash ? ' stroke-dasharray="6 4"' : ''}/>`);
  if (label) text(lx, ly, label, { size: 11, fill: MUTED, anchor });
}
function tag(x, y, s, bg, fg) {
  add(`<rect x="${x}" y="${y}" width="${s.length * 8 + 20}" height="22" rx="11" fill="${bg}"/>`);
  text(x + 10, y + 15, s, { size: 11, weight: 600, fill: fg });
}

add(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">`);
add('<title id="t">Thesaurus: arquitectura desplegada</title>');
add('<desc id="d">Las facturas entran por el portal de proveedores (Worker facturas), por la app web (carga y chat) o por ' +
  'correo (construido, inactivo hasta conectar un dominio). Todas llegan al Worker 30x-hackathon en Cloudflare, que corre el ' +
  'ciclo del agente: percibe, lee, consulta, decide, actúa y rinde cuentas. Lee y escribe en Supabase (Postgres con RLS, Auth, ' +
  'Storage). La IA lee en Amazon Nova Lite sobre AWS Bedrock, con Workers AI de respaldo; las tasas de mercado vienen de ' +
  'Yahoo Finance y open.er-api.com. El código decide con 13 controles. Salidas: la decisión registrada, el escalado por ' +
  'correo con Amazon SES (solo direcciones verificadas) y la orden de pago preparada, sin mover dinero.</desc>');
add(`<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${MUTED}"/></marker></defs>`);
add(`<rect width="${W}" height="${H}" fill="${CARD}"/>`);
text(40, 60, 'Thesaurus · arquitectura', { size: 30, fill: INK, font: FONTS[1] });
text(40, 90, 'Solo lo desplegado o construido · línea punteada: construido y probado, inactivo en este despliegue', { size: 13, fill: MUTED });

// Entradas
zone(40, 120, 320, 640, 'Entradas');
card(60, 180, 280, 140, 'Portal de proveedores', 'Worker facturas|facturas.…workers.dev/<enlace>|sin cuenta: PDF, imagen o texto', { slug: 'cloudflareworkers' });
card(60, 360, 280, 140, 'Carga y chat en la app', 'Vite + React, servida por el Worker|subir PDF o imagen, pegar|un correo o un chat', {});
card(60, 540, 280, 140, 'Correo entrante', 'facturas+<enlace>@<dominio>|construido, inactivo: sin dominio|(INBOUND_EMAIL_DOMAIN vacío)', { dash: true });

// Agente en Cloudflare Workers
zone(440, 120, 500, 640, 'Agente en Cloudflare Workers', 'cloudflare');
card(460, 180, 460, 140, 'Worker 30x-hackathon (Hono)', 'API, app web y PortalApi|cron cada 5 min: decide sin nadie conectado|cron 06:00 Bogotá: tasas de cambio', { slug: 'cloudflareworkers' });
rect(460, 360, 460, 200, CARD, LINE);
text(480, 394, 'runAgent: el ciclo de cada factura', { size: 14, weight: 600, fill: INK });
['percibe', 'lee (IA)', 'consulta', 'decide', 'actúa', 'rinde cuentas'].forEach((s, i) => {
  const x = 480 + (i % 3) * 140, y = 420 + Math.floor(i / 3) * 60;
  rect(x, y, 120, 40, ZONE, LINE);
  text(x + 60, y + 25, s, { size: 12, weight: 600, fill: INK, anchor: 'middle' });
  if (i % 3 < 2) arrow([[x + 120, y + 20], [x + 140, y + 20]]);
});
arrow([[840, 460], [840, 470], [540, 470], [540, 480]]);
card(460, 600, 460, 140, 'decide(): 13 controles, solo código', 'PAGAR solo si los 13 cumplen; ningún modelo decide|la base rechaza un PAGAR fuera de las reglas|ESCALAR pregunta a una persona; FRENAR es final', {});

arrow([[340, 250], [458, 250]], 'PortalApi|(servicio interno)', 350, 222);
arrow([[340, 430], [458, 430]], 'HTTPS /api', 350, 422);
arrow([[340, 610], [400, 610], [400, 500], [458, 500]], 'email()', 350, 602, { dash: true });

// Datos en Supabase
zone(1020, 120, 560, 220, 'Datos en Supabase', 'supabase');
card(1040, 180, 160, 140, 'Postgres + RLS', 'facturas, políticas,|decisiones de solo|adición, fx_rates,|agent_runs');
card(1220, 180, 160, 140, 'Auth', 'código por correo|demo sin código|(Andina Labs)');
card(1400, 180, 160, 140, 'Storage', 'bucket privado|URL firmada|de 5 minutos');
arrow([[920, 230], [1038, 230]], 'escribe decisiones', 930, 222);
arrow([[1038, 270], [920, 270]], 'lee política y registro', 930, 290);

// IA en AWS Bedrock (Workers AI de respaldo)
zone(1020, 380, 560, 220, 'IA en AWS Bedrock (Workers AI de respaldo)');
card(1040, 440, 220, 140, 'Amazon Nova Lite', 'AWS Bedrock, us-east-2|primero, espera 20 s|lee facturas, responde el chat');
card(1320, 440, 240, 140, 'Workers AI', 'Llama 3.3 70B y visión 3.2 11B|solo si Bedrock falla');
arrow([[1260, 520], [1318, 520]]);
text(1290, 508, 'si falla', { size: 11, fill: MUTED, anchor: 'middle' });
arrow([[920, 450], [980, 450], [980, 510], [1038, 510]], 'documento → campos', 930, 442);

// Tasas de mercado (fuera de las cinco zonas: proveedores externos)
card(1020, 640, 560, 80, 'Tasas de mercado: Yahoo Finance, open.er-api.com de respaldo', 'consulta diaria y bajo demanda · se guardan en fx_rates', {});
arrow([[1018, 680], [922, 680]], 'tasa USD', 930, 672);

// Salidas
zone(440, 800, 1140, 200, 'Salidas');
card(460, 860, 340, 120, 'Decisión registrada', '', {});
tag(480, 904, 'PAGAR', '#edf3ec', '#346538');
tag(560, 904, 'FRENAR', '#fdebec', '#9f2f2d');
tag(648, 904, 'ESCALAR', '#fbf3db', '#956400');
text(480, 954, 'cada control con su valor y umbral', { fill: MUTED });
card(840, 860, 340, 120, 'Escalado por correo (Amazon SES)', 'pregunta concreta + enlace firmado|limitado: solo direcciones verificadas|(SES en sandbox)', { dash: true });
card(1220, 860, 340, 120, 'Orden de pago', 'preparada al decidir PAGAR|no mueve dinero real');
arrow([[560, 740], [560, 858]], 'registra', 570, 800);
arrow([[860, 740], [860, 858]], 'escala', 850, 800, { dash: true, anchor: 'end' });
arrow([[900, 740], [900, 780], [1360, 780], [1360, 858]], 'prepara', 1370, 800);

text(40, 1036, 'Fuentes: wrangler.toml, portal/wrangler.toml, src/lib/llm.ts, src/lib/email.ts y README «Arquitectura». ' +
  'Generado por docs/architecture/build_architecture.mjs.', { fill: MUTED });
text(40, 1058, 'Iconos: Simple Icons 16.34.0 (CC0). Cada logo es marca de su dueño, usado solo para nombrar la herramienta, sin respaldo implícito.', { fill: MUTED });
add('</svg>');

// Self-check (R-153): every colour outside the brand icons is in the approved palette (AC-53 Clarified).
const off = out.filter((l) => !l.startsWith('<g data-brand=')).join('\n').match(/#[0-9a-fA-F]{3,6}\b/g)
  .filter((c) => !PALETTE.includes(c.toLowerCase()));
if (off.length) throw new Error(`colours outside the approved palette: ${[...new Set(off)].join(' ')}`);

const svg = `${out.join('\n')}\n`;
writeFileSync(join(HERE, 'architecture.svg'), svg);
copyFileSync(join(HERE, 'architecture.svg'), join(DEMO, 'architecture.svg'));
console.log('wrote architecture.svg');

if (process.argv.includes('--png')) {
  const { chromium } = await import('playwright').catch(() =>
    createRequire(join(execSync('npm root -g').toString().trim(), '_'))('playwright'));
  const browser = await chromium.launch({ executablePath: process.env.GATE_CHROMIUM ?? '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><body style="margin:0">${svg}</body>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(HERE, 'architecture.png'), clip: { x: 0, y: 0, width: W, height: H } });
  await browser.close();
  copyFileSync(join(HERE, 'architecture.png'), join(DEMO, 'architecture.png'));
  console.log('wrote architecture.png');
}
