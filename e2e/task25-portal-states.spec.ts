/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file (Playwright is not a repo dependency; env-driven) */
// QA Task 25 (AC-83, AC-85, AC-90, AC-91): portal UI states on a phone with the POST faked in the browser (no server write, no AI).
// Needs QA_BASE (the facturas Worker) and QA_STATUS_PATH (a real /estado/<token> path); QA_OUT is optional (default .wrangler/qa-out, gitignored).
import { createRequire } from 'node:module';
const { test } = createRequire(import.meta.url)('/opt/node22/lib/node_modules/playwright/test');
import fs from 'node:fs';

const BASE = process.env.QA_BASE!;
const STATUS = process.env.QA_STATUS_PATH!;
const OUT = process.env.QA_OUT ?? '.wrangler/qa-out';
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const log = (k: string, v: unknown) => console.log(k, typeof v === 'string' ? v : JSON.stringify(v));
const ok = { ok: true, status_path: '/estado/FAKE', reply: { es: ['Esto leí en tu factura:', 'Beneficiario: X', 'Estado: en revisión'], en: ['This is what I read on your invoice:', 'Payee: X', 'Status: under review'] } };
// Registered first, so every later route wins: a write that no fake answers is aborted and never reaches the server.
const noLiveWrites = (page: any) => page.route('**/*', (route: any) => (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.fallback() : route.abort()));

for (const lang of ['es', 'en']) {
  test(`chat ${lang}: switch, busy, errors`, async ({ page, context }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await noLiveWrites(page);
    const dialogs: string[] = [];
    page.on('dialog', (d: any) => { dialogs.push(d.message()); d.dismiss(); });
    await page.goto(`${BASE}/andina-labs?lang=${lang}`);
    await page.locator('h1').waitFor();
    log(`LANG_${lang}_html`, await page.evaluate(() => document.documentElement.lang));
    log(`LANG_${lang}_greeting`, await page.locator('ol.log').innerText());
    log(`LANG_${lang}_controls`, await page.evaluate(() => [...document.querySelectorAll('button,textarea,label')].map((e: any) => `${e.tagName}:${e.getAttribute('aria-label') || e.textContent || e.getAttribute('placeholder')}`)));
    await page.screenshot({ path: `${OUT}/chat-${lang}.png` });
    // switch by the button
    const other = lang === 'es' ? 'en' : 'es';
    await page.locator(`button[data-lang=${other}]`).click();
    log(`SWITCH_to_${other}_html`, await page.evaluate(() => document.documentElement.lang));
    await page.locator(`button[data-lang=${lang}]`).click();
    // busy within 100 ms, vendor bubble, XSS literal
    let release: any; const gate = new Promise((r) => { release = r; });
    await page.route('**/andina-labs', async (route: any) => { if (route.request().method() !== 'POST') return route.fallback(); await gate; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ok) }); });
    const xss = '<img src=x onerror=alert(1)>';
    await page.locator('textarea').fill(xss);
    const t = Date.now();
    await page.locator('button.primary').click();
    await page.getByText(/Recibido; estoy leyendo|Received; I'm reading/).waitFor({ timeout: 2000 });
    log(`BUSY_${lang}`, { ms: Date.now() - t, disabled: await page.locator('button.primary').isDisabled(), ariaBusy: await page.locator('form.composer').getAttribute('aria-busy'), textareaCleared: (await page.locator('textarea').inputValue()) === '' });
    log(`BUBBLE_${lang}`, await page.locator('ol.log').innerText());
    log(`IMG_IN_LOG_${lang}`, await page.locator('ol.log img').count());
    await page.screenshot({ path: `${OUT}/chat-${lang}-busy.png` });
    release();
    await page.locator('a[href*="/estado/"]').waitFor();
    log(`REPLY_${lang}`, await page.locator('ol.log').innerText());
    log(`DIALOGS_${lang}`, dialogs);
    await page.unroute('**/andina-labs');
    // errors by faked answers
    for (const [name, status, body] of [['429_ip', 429, { ok: false, error: 'rate_ip' }], ['429_company', 429, { ok: false, error: 'rate_company' }], ['500', 500, 'boom'], ['503', 503, { ok: false, error: 'failed' }]] as any[]) {
      await page.route('**/andina-labs', (route: any) => route.request().method() === 'POST' ? route.fulfill({ status, contentType: 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body) }) : route.fallback());
      await page.locator('textarea').fill('mi factura');
      await page.locator('button.primary').click();
      await page.waitForFunction(() => !document.querySelector('li.pending'));
      log(`ERR_${name}_${lang}`, { last: (await page.locator('ol.log li').last().innerText()), textRestored: await page.locator('textarea').inputValue(), disabled: await page.locator('button.primary').isDisabled() });
      await page.unroute('**/andina-labs');
    }
    await page.screenshot({ path: `${OUT}/chat-${lang}-err.png` });
    // offline
    await context.setOffline(true);
    await page.locator('textarea').fill('mi factura');
    await page.locator('button.primary').click();
    await page.waitForFunction(() => !document.querySelector('li.pending'));
    log(`ERR_offline_${lang}`, await page.locator('ol.log li').last().innerText());
    await page.screenshot({ path: `${OUT}/chat-${lang}-offline.png` });
    await context.setOffline(false);
    // client-side validation
    await page.locator('textarea').fill('');
    await page.locator('button.primary').click();
    log(`ERR_empty_${lang}`, await page.locator('ol.log li').last().innerText());
    await page.locator('input[type=file]').setInputFiles({ name: 'x.docx', mimeType: 'application/msword', buffer: Buffer.from('PK') });
    log(`ERR_docx_${lang}`, await page.locator('ol.log li').last().innerText());
    await page.locator('input[type=file]').setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(11 * 1024 * 1024, 65) });
    log(`ERR_11mb_${lang}`, await page.locator('ol.log li').last().innerText());
    await page.locator('textarea').fill('a'.repeat(20001));
    await page.locator('button.primary').click();
    log(`ERR_20001_${lang}`, await page.locator('ol.log li').last().innerText());
    log(`SCROLLW_${lang}`, await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
    await page.screenshot({ path: `${OUT}/chat-${lang}-validation.png` });
  });

  test(`status + invalid + 404 ${lang}`, async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    for (const [name, path] of [['status', STATUS], ['invalid', '/estado/abcdefghijklmnopqrstuvwxyz0123456789abcdefg'], ['notfound', '/zzz-no']] as string[][]) {
      await page.goto(`${BASE}${path}?lang=${lang}`);
      await page.locator('h1').waitFor();
      log(`PAGE_${name}_${lang}`, { html: await page.evaluate(() => document.documentElement.lang), text: await page.locator('main').innerText(), scroll: await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]) });
      await page.screenshot({ path: `${OUT}/${name}-${lang}.png` });
    }
  });
}
