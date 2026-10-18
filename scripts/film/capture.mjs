/* global process, console, fetch, URL, document, window, NodeFilter, innerHeight, innerWidth */ // Node + page code; eslint.config.js declares no globals
// The film's captures (AC-111, R-156, R-157, R-160). Two modes:
//   node scripts/film/capture.mjs <URL>                   phase B: the deployed site, Andina Labs after «Reiniciar demo», into docs/film/captures/
//   node scripts/film/capture.mjs --placeholders <dir>    phase A: neutral palette cards with the same names and pixel sizes
// Every live capture is the viewport only (no browser chrome) and passes the privacy guard first: no email address and not the
// HEARTBEAT_EMAIL value (read from the environment, never printed). Live AI budget per pass (R-157, R-94): 2 reads, 1 question.
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const DEVICES = { phone: { width: 390, height: 844 }, laptop: { width: 1440, height: 900 } }; // CSS px, captured at device scale 2

// name -> device and what the storyboard shows in it (docs/film/storyboard.html reads captures/<name>.png).
export const SHOTS = [
  ['recibe-envio', 'phone', 'Portal de proveedores: la factura adjunta, antes de enviar'],
  ['recibe-respuesta', 'phone', 'Portal de proveedores: la respuesta de Thesaurus'],
  ['recibe-carga', 'laptop', 'Bandeja: la carga directa recién decidida'],
  ['lee', 'laptop', 'Registro: «Leído por IA · Amazon Nova Lite»'],
  ['verifica', 'laptop', 'Registro: los 13 controles y la tasa del día'],
  ['decide-bandeja', 'laptop', 'Bandeja: PAGAR, FRENAR y ESCALAR'],
  ['decide-pagar', 'laptop', 'Registro PAGAR con su orden de pago'],
  ['decide-escalar', 'laptop', 'Registro ESCALAR con la pregunta del agente'],
  ['decide-aprobado', 'laptop', 'La aprobación de una persona: el registro termina en PAGAR'],
  ['rinde-registro', 'laptop', 'Registro: lo que hizo el agente, paso a paso'],
  ['rinde-pregunta', 'laptop', '«Pregúntale a Thesaurus»: una respuesta'],
  ['controla-politica', 'laptop', 'Política, sin el campo del aprobador en pantalla'],
  ['controla-periodo', 'laptop', 'Periodo: autonomía y «Violaciones 0»'],
].map(([name, device, what]) => ({ name, device, what }));

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/u;
/** R-156: why the visible text may not be captured, or null. Never echoes the address. */
export function privacyViolation(text, secret) {
  const squash = (s) => s.replace(/\s+/g, '').toLowerCase();
  if (secret && squash(text).includes(squash(secret))) return 'the viewport shows the HEARTBEAT_EMAIL value';
  if (EMAIL.test(text) || EMAIL.test(squash(text))) return 'the viewport shows an email address';
  return null;
}

async function playwright() {
  return import('playwright').catch(() => createRequire(join(execSync('npm root -g').toString().trim(), '_'))('playwright'));
}

async function placeholders(dir) {
  const { chromium } = await playwright();
  const browser = await chromium.launch();
  mkdirSync(dir, { recursive: true });
  try {
    for (const s of SHOTS) {
      const page = await browser.newPage({ viewport: DEVICES[s.device], deviceScaleFactor: 2 });
      const bar = (w) => `<i style="width:${w}%"></i>`;
      await page.setContent(`<style>body{margin:0;height:100vh;background:#fbfbfa;font:16px/1.5 'Helvetica Neue',sans-serif;color:#111111;display:grid;grid-template-rows:56px 1fr}
        header{border-bottom:1px solid #eaeaea;background:#ffffff;display:flex;align-items:center;gap:10px;padding:0 24px}
        header b{width:22px;height:22px;border-radius:5px;background:#111111}main{padding:32px 24px;display:grid;gap:14px;align-content:start}
        h1{font:400 28px/1.2 Georgia,serif;margin:0 0 8px}p{margin:0;color:#6d6c69}i{display:block;height:14px;border-radius:4px;background:#eaeaea}
        .tag{width:max-content;padding:2px 10px;border-radius:9999px;background:#edf3ec;color:#346538;font-size:12px;letter-spacing:.05em}</style>
        <header><b></b>Thesaurus</header><main><span class="tag">CAPTURA PENDIENTE</span><h1>${s.what}</h1><p>${s.name}.png · ${s.device}</p>
        ${[92, 78, 85, 60, 88, 70, 95, 66, 80, 74].map(bar).join('')}</main>`);
      await page.screenshot({ path: join(dir, `${s.name}.png`) });
      await page.close();
    }
  } finally { await browser.close(); }
  console.log(`${SHOTS.length} placeholders in ${dir}`);
}

// Phase B. Selectors follow scripts/record-happy-path.mjs; the order keeps R-35's sequence intact.
async function live(url) {
  const secret = process.env.HEARTBEAT_EMAIL;
  if (!secret) throw new Error('HEARTBEAT_EMAIL is not set: the privacy guard needs it (R-156)');
  const out = join(ROOT, 'docs/film/captures');
  mkdirSync(out, { recursive: true });
  const { chromium } = await playwright();

  const resetDemo = async () => { // «Reiniciar demo» through the API, then the agent decides every invoice (R-60)
    const cfg = await (await fetch(`${url}/api/config`)).json();
    const auth = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: cfg.supabaseAnonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email: cfg.demo_email, password: 'andina-demo-2026' }), // public by design (D8, AC-46)
    });
    if (!auth.ok) throw new Error(`demo sign-in failed: ${auth.status}`);
    const headers = { Authorization: `Bearer ${(await auth.json()).access_token}`, 'content-type': 'application/json' };
    const post = async (path, body) => {
      const r = await fetch(url + path, { method: 'POST', headers, body: body && JSON.stringify(body) });
      if (!r.ok) throw new Error(`${path} -> ${r.status}`);
      return r.json();
    };
    let b = await post('/api/demo/reset');
    for (let i = 0; b.cursor && i < 30; i++) b = await post('/api/invoices/run', { cursor: b.cursor });
    if (b.cursor) throw new Error('reset loop did not finish');
  };

  const viewportText = (page) => page.evaluate(() => {
    const seen = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const r = document.createRange();
      r.selectNodeContents(n);
      if ([...r.getClientRects()].some(seen)) out.push(n.textContent);
    }
    for (const el of document.querySelectorAll('input, textarea, select')) if (seen(el.getBoundingClientRect())) out.push(el.value ?? '', el.placeholder ?? '');
    return out.join('\n');
  });
  const shoot = async (page, name) => {
    await page.waitForTimeout(800); // let fades and charts settle
    const why = privacyViolation(await viewportText(page), secret);
    if (why) throw new Error(`${name}: ${why} (R-156); capture refused`);
    await page.screenshot({ path: join(out, `${name}.png`) }); // the viewport only, no browser chrome
    console.log(`captured ${name}`);
  };

  await resetDemo();
  const browser = await chromium.launch();
  try {
    const open = (device) => browser.newPage({ viewport: DEVICES[device], deviceScaleFactor: 2, locale: 'es-CO', timezoneId: 'America/Bogota' });
    const invoice = join(ROOT, 'web/public/demo/invoices/01.pdf');

    // Recibe (phone): a vendor sends 01.pdf through the portal (live read 1 of 2). It is a duplicate of a paid invoice, so the
    // real reply is «rechazada: duplicada»; the PAGAR beat therefore uses a seeded PAGAR record and never claims the portal (R-157).
    const phone = await open('phone');
    await phone.goto(`https://${new URL(url).hostname.replace(/^[^.]+/, 'facturas')}/andina-labs`); // the portal Worker, same account
    await phone.locator('#file').setInputFiles(invoice);
    await phone.locator('#msg').fill('Factura adjunta.');
    await shoot(phone, 'recibe-envio');
    await phone.locator('form.composer button[type=submit]').click();
    await phone.locator('.bubble').last().getByText(/duplicad/i).waitFor({ timeout: 90_000 });
    await shoot(phone, 'recibe-respuesta');

    // Laptop: the demo door, tour skipped.
    const page = await open('laptop');
    page.setDefaultTimeout(45_000);
    const button = (name) => page.getByRole('button', { name, exact: true });
    const link = (name) => page.getByRole('link', { name });
    const h1 = page.getByRole('heading', { level: 1 });
    const toTop = () => page.evaluate(() => window.scrollTo(0, 0));
    const scrollTo = async (loc, top = 120) => { await loc.scrollIntoViewIfNeeded(); await page.evaluate(([y, t]) => window.scrollBy(0, y - t), [(await loc.boundingBox()).y, top]); };
    const bandeja = async () => { await link('Bandeja').click(); await h1.filter({ hasText: 'Bandeja' }).waitFor(); await page.locator('.inbox-list tbody tr').first().waitFor(); };
    await page.goto(`${url}/demo`);
    await button('Entrar como Andina Labs').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Saltar' }).click();
    await bandeja();
    await shoot(page, 'decide-bandeja');

    // Recibe (laptop) and Lee: a direct upload (live read 2 of 2) and its record.
    await button('Nueva factura').click();
    await page.getByRole('tab', { name: 'Subir PDF o imagen' }).click();
    await page.locator('input[type=file]').setInputFiles(invoice);
    await button('Enviar al agente').click();
    await h1.filter({ hasText: /FRENAR/ }).waitFor({ timeout: 90_000 });
    await shoot(page, 'recibe-carga');
    await scrollTo(page.getByText(/Leído por IA · Amazon Nova Lite/));
    await shoot(page, 'lee');
    await scrollTo(page.getByRole('heading', { name: 'Lo que hice' }));
    await shoot(page, 'rinde-registro');

    // Verifica and Decide (PAGAR): a seeded PAGAR record in COP, so the day's rate is on screen.
    await bandeja();
    await page.locator('.inbox-list tbody tr', { hasText: 'PAGAR' }).filter({ hasText: 'COP' }).first().getByRole('link').first().click();
    await h1.filter({ hasText: /^PAGAR/ }).waitFor();
    await shoot(page, 'decide-pagar');
    await scrollTo(page.getByText(/Yahoo Finance/).first());
    await shoot(page, 'verifica');

    // Rinde cuentas: one question to the record (question 1 of 2).
    await page.getByRole('textbox', { name: /Pregúntale a Thesaurus/ }).fill('¿Por qué se pagó esta factura?');
    await button('Preguntar').click();
    await page.getByText(/Respuesta generada por IA/).waitFor({ timeout: 90_000 });
    await scrollTo(page.getByText(/Respuesta generada por IA/), 300);
    await shoot(page, 'rinde-pregunta');

    // Decide (ESCALAR, the person's yes): R-35's sequence, reject #15 then approve Nube Sur, which ends in PAGAR.
    await bandeja();
    await link(/ESCALAR.*4\.200 USD a Nube Sur LLC/).click();
    await scrollTo(page.getByRole('heading', { name: 'Necesito tu respuesta' }), 200);
    await shoot(page, 'decide-escalar');
    await link('Volver a la bandeja').click();
    await link(/ESCALAR.*cuenta cambiada/).click();
    await button('Rechazar').click();
    await h1.filter({ hasText: /^FRENAR/ }).waitFor();
    await link('Volver a la bandeja').click();
    await link(/ESCALAR.*4\.200 USD a Nube Sur LLC/).click();
    await button('Aprobar').click();
    await h1.filter({ hasText: /^PAGAR/ }).waitFor();
    await toTop();
    await shoot(page, 'decide-aprobado');

    // Controla: Política with the approver field above the viewport before the guard reads it (R-160), then Periodo.
    await link('Política').click();
    const approver = page.getByLabel('Correo del aprobador');
    await approver.waitFor();
    const y = await approver.evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY);
    await page.evaluate((top) => window.scrollTo(0, top + 24), y);
    try { await shoot(page, 'controla-politica'); } catch (e) {
      console.log(`${e.message}. R-160: Controla shows Periodo only and its line drops «Políticas».`);
    }
    await link('Periodo').click();
    await page.getByText(/^Violaciones 0$/).waitFor();
    await toTop();
    await shoot(page, 'controla-periodo');
  } finally {
    await browser.close();
    await resetDemo(); // leave Andina Labs seeded, also when a step failed
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [a, b] = process.argv.slice(2);
  if (a === '--placeholders' && b) await placeholders(b);
  else if (a?.startsWith('https://')) await live(a.replace(/\/$/, ''));
  else { console.error('usage: capture.mjs <https://URL> | --placeholders <dir>'); process.exit(2); }
}
