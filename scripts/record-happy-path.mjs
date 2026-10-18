/* global process, console, fetch, Buffer */ // Node script: eslint.config.js declares no Node globals
// Records the happy path (AC-50, R-35) on the DEPLOYED product: node scripts/record-happy-path.mjs [URL]
// Needs Playwright (local node_modules, else the global one) and its Chromium; writes docs/demo/happy-path.webm
// and web/public/demo/happy-path.webm. Before and after the recording the demo company is reset through the API
// (outside the video), so the script is re-runnable and leaves the seeded state. It also asserts what the video claims.
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, openSync, readSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = (process.argv[2] ?? 'https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev').replace(/\/$/, '');
const DEMO_PASSWORD = 'andina-demo-2026'; // public by design (D8, AC-46)
const OUT = [join(ROOT, 'docs/demo/happy-path.webm'), join(ROOT, 'web/public/demo/happy-path.webm')];

const { chromium } = await import('playwright').catch(() =>
  createRequire(join(execSync('npm root -g').toString().trim(), '_'))('playwright'));

// Step 0 (outside the video): sign in as the demo user and run the reset loop until every invoice is decided (R-60).
async function resetDemo() {
  const cfg = await (await fetch(`${URL_}/api/config`)).json();
  const auth = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: cfg.supabaseAnonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: cfg.demo_email, password: DEMO_PASSWORD }),
  });
  if (!auth.ok) throw new Error(`demo sign-in failed: ${auth.status}`);
  const headers = { Authorization: `Bearer ${(await auth.json()).access_token}`, 'content-type': 'application/json' };
  const post = async (path, body) => {
    const r = await fetch(URL_ + path, { method: 'POST', headers, body: body && JSON.stringify(body) });
    if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
    return r.json();
  };
  let b = await post('/api/demo/reset');
  for (let i = 0; b.cursor && i < 30; i++) b = await post('/api/invoices/run', { cursor: b.cursor });
  if (b.cursor) throw new Error('reset loop did not finish');
}

const beat = (page, ms = 2000) => page.waitForTimeout(ms);
// Slow wheel scroll so a viewer can follow the page (negative = up).
async function scrollBy(page, dy) {
  await page.mouse.move(640, 400);
  for (let left = Math.abs(dy); left > 0; left -= 25) {
    await page.mouse.wheel(0, Math.sign(dy) * Math.min(25, left));
    await page.waitForTimeout(40);
  }
}
const glide = async (page, loc, top = 110) => scrollBy(page, (await loc.boundingBox()).y - top);

await resetDemo();
const dir = mkdtempSync(join(tmpdir(), 'happy-path-'));
const browser = await chromium.launch({ headless: true });
let video;
try {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 }, locale: 'es-CO', timezoneId: 'America/Bogota',
    recordVideo: { dir, size: { width: 1280, height: 720 } },
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45_000);
  video = page.video();
  const button = (name) => page.getByRole('button', { name, exact: true });
  const link = (name) => page.getByRole('link', { name });
  const h1 = page.getByRole('heading', { level: 1 });
  const bandeja = async () => { await link('Bandeja').click(); await h1.filter({ hasText: 'Bandeja' }).waitFor(); await page.locator('.inbox-list tbody tr').first().waitFor(); };

  // 1. /demo: the pitch, the loop and the read-only inbox, then "Entrar como Andina Labs" and the tour.
  await page.goto(`${URL_}/demo`);
  await page.locator('[data-testid=problem-line]').first().waitFor();
  await page.locator('.demo-rows li').first().waitFor();
  await beat(page, 3000);
  await glide(page, page.locator('blockquote'), 260);
  await beat(page, 3000);
  await scrollBy(page, -3000);
  await button('Entrar como Andina Labs').click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await beat(page, 2500);
  for (const n of [2, 3]) {
    await dialog.getByRole('button', { name: 'Siguiente' }).click();
    await dialog.getByText(new RegExp(`^${n} de \\d+$`)).waitFor();
    await beat(page, 2500);
  }
  await dialog.getByRole('button', { name: 'Saltar' }).click();
  await dialog.waitFor({ state: 'detached' });

  // 2. Bandeja: the list and the line that says when the agent last ran (AC-63).
  await bandeja();
  await page.getByText(/El agente revisó las facturas pendientes/).waitFor();
  await beat(page, 2500);
  await scrollBy(page, 600);
  await beat(page, 1500);
  await scrollBy(page, -600);
  await page.locator('.inbox-list tbody tr').nth(3).hover();
  await beat(page, 1500);

  // 3. Upload 01.pdf: the seeded #01 is already paid, so the agent says FRENAR, exact duplicate.
  await button('Nueva factura').click();
  await page.getByRole('tab', { name: 'Subir PDF o imagen' }).click();
  await page.locator('input[type=file]').setInputFiles(join(ROOT, 'web/public/demo/invoices/01.pdf'));
  await beat(page, 2000);
  await button('Enviar al agente').click();
  await h1.filter({ hasText: /FRENAR.*duplicado exacto/ }).waitFor();
  await beat(page, 3000);
  await glide(page, page.getByRole('heading', { name: 'Lo que hice' }));
  await beat(page, 3000);
  await scrollBy(page, 450);
  await beat(page, 3000);
  await scrollBy(page, 450);
  await beat(page, 2500);

  // 4. R-35 first half: reject the escalated "cuenta cambiada" invoice (#15).
  await link('Volver a la bandeja').click();
  await link(/ESCALAR.*cuenta cambiada/).click();
  await h1.filter({ hasText: 'cuenta cambiada' }).waitFor();
  await glide(page, page.getByRole('heading', { name: 'Necesito tu respuesta' }), 200);
  await beat(page, 3500);
  await button('Rechazar').click();
  await h1.filter({ hasText: /^FRENAR/ }).waitFor();
  await beat(page, 3000);

  // 5. R-35 second half: approve Nube Sur LLC #2044 (4.200 USD): it ends in PAGAR with its payment order.
  await link('Volver a la bandeja').click();
  await link(/ESCALAR.*4\.200 USD a Nube Sur LLC/).click();
  await h1.filter({ hasText: 'Nube Sur LLC' }).waitFor();
  await glide(page, page.getByRole('heading', { name: 'Necesito tu respuesta' }), 200);
  await beat(page, 3500);
  await button('Aprobar').click();
  await h1.filter({ hasText: /^PAGAR/ }).waitFor();
  const order = page.getByRole('heading', { name: 'Orden de pago' });
  await order.waitFor();
  await glide(page, order, 200);
  await beat(page, 4000);

  // 6. Política: lower the per-payment limit to 1000, save as a new version, read the banner, re-evaluate.
  await link('Política').click();
  const limit = page.getByLabel('Límite por pago (USD)');
  await limit.waitFor();
  await beat(page, 1500);
  await glide(page, limit, 200);
  await limit.fill('1000');
  await beat(page, 2000);
  await page.getByRole('button', { name: /^Guardar como versión/ }).click();
  await page.getByText(/^Versión \d+ guardada\.$/).waitFor();
  const banner = page.locator('.banner');
  await banner.waitFor();
  await glide(page, banner, 200);
  await beat(page, 5000);
  await button('Reevaluar pendientes').click();
  await page.getByText(/\d+ PAGAR · \d+ FRENAR · \d+ ESCALAR/).waitFor();
  await beat(page, 3000);

  // 7. Periodo: autonomy, violations 0, decisions explained 100%.
  await link('Periodo').click();
  await page.getByText(/^Violaciones 0$/).waitFor();
  await page.getByText(/^Decisiones explicadas 100\s?%$/).waitFor();
  await page.getByText(/^Autonomía /).waitFor();
  await beat(page, 4000);
  await scrollBy(page, 500);
  await beat(page, 3000);

  await ctx.close();
  mkdirSync(join(ROOT, 'docs/demo'), { recursive: true });
  mkdirSync(join(ROOT, 'web/public/demo'), { recursive: true });
  for (const f of OUT) copyFileSync(await video.path(), f);
} finally {
  await browser.close();
  await resetDemo(); // leave the demo company in the seeded state, also when a step failed
}

// A real WebM starts with the EBML magic 1A 45 DF A3.
const head = Buffer.alloc(4);
readSync(openSync(OUT[0], 'r'), head, 0, 4, 0);
if (head.toString('hex') !== '1a45dfa3') throw new Error(`${OUT[0]} is not a WebM`);
console.log(`${OUT[0]} ${statSync(OUT[0]).size} bytes`);
