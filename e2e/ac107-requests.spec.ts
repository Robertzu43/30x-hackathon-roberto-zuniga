/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA AC-107 / R-143: request accounting per page load. /api/company at most once per page load (incl. reload); a deep link to «/» while signed out, then password/OTP sign-in,
// starts exactly one /api/screen/inbox at sign-in; the demo door fetches /api/config at most once. QA_URL + QA_LIVE=1.
import fs from 'node:fs';
import { test, expect, newPage, adminOtp, URL_, DIR } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'creates real users: set QA_LIVE=1');
test.setTimeout(150000);
const pw = JSON.parse(fs.readFileSync(`${DIR}/users-pw-short.json`, 'utf8'));
const otp = JSON.parse(fs.readFileSync(`${DIR}/users-otp.json`, 'utf8'));
function track(page: any) { const log: any[] = []; page.on('request', (r: any) => { const u = new globalThis.URL(r.url()); if (/^\/api\/(company|screen\/inbox|config|invoices\/run|demo\/overview)/.test(u.pathname) || /\/auth\/v1\/(token|verify|signup|user)/.test(u.pathname)) log.push({ t: Date.now(), m: r.method(), p: u.pathname }); }); return log; }
const count = (log: any[], re: RegExp) => log.filter((x) => re.test(x.p)).length;
const sum = (log: any[]) => { const o: any = {}; for (const x of log) o[`${x.m} ${x.p}`] = (o[`${x.m} ${x.p}`] || 0) + 1; return JSON.stringify(o); };

test('demo door: /api/company + inbox + config counts (click through +4 s), then reload', async ({ browser }: any) => {
  const { ctx, page } = await newPage(browser); const log = track(page);
  await page.goto(`${URL_}/demo`); const b = page.getByRole('button', { name: 'Entrar como Andina Labs' }); await expect(b).toBeEnabled(); await page.waitForTimeout(500);
  const before = log.length; await b.click(); await expect(page.locator('h1', { hasText: 'Bandeja' })).toBeVisible({ timeout: 20000 }); await page.waitForTimeout(4000);
  console.log('demo door requests (whole page load incl. /demo):', sum(log)); console.log('  /api/company:', count(log, /company/), '/api/screen/inbox:', count(log, /inbox/), '/api/config:', count(log, /config/), 'before click:', before);
  log.length = 0; await page.keyboard.press('Escape'); await page.reload(); await expect(page.locator('h1', { hasText: 'Bandeja' })).toBeVisible({ timeout: 20000 }); await page.waitForTimeout(4000);
  console.log('demo reload requests:', sum(log)); await ctx.close();
});

test('trial door: counts over the whole pass, then reload', async ({ browser }: any) => {
  const { ctx, page } = await newPage(browser); const log = track(page);
  await page.goto(`${URL_}/login`); await page.getByRole('button', { name: 'Probar con mi propia empresa' }).click();
  await expect(page.locator('h1', { hasText: 'Bandeja' })).toBeVisible({ timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('.chip-pending') && !/Decidiendo/.test(document.body.innerText), null, { timeout: 90000 }); await page.waitForTimeout(2000);
  console.log('trial whole page load incl. pass:', sum(log)); console.log('  /api/company:', count(log, /company/), '| screen/inbox:', count(log, /inbox/), '| run POSTs:', count(log, /invoices\/run/));
  log.length = 0; await page.reload(); await expect(page.locator('h1', { hasText: 'Bandeja' })).toBeVisible({ timeout: 20000 }); await page.waitForTimeout(4000);
  console.log('trial reload requests:', sum(log), '| /api/company:', count(log, /company/)); await ctx.close();
});

for (const kind of ['password', 'otp']) test(`deep link to / signed out, then ${kind} sign-in starts one inbox request at sign-in (first login, then returning)`, async ({ browser }: any) => {
  for (const visit of [1, 2]) {
    const { ctx, page } = await newPage(browser); const log = track(page);
    if (kind === 'otp') await page.route('**/auth/v1/otp*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.goto(`${URL_}/`); await page.waitForURL(/\/login/, { timeout: 15000 });
    if (kind === 'password') { await page.getByRole('button', { name: 'Entrar con contraseña' }).click(); await page.getByLabel('Correo').fill(pw[0].email); await page.getByLabel('Contraseña').fill(pw[0].password); }
    else { await page.getByLabel('Correo').fill(otp[2].email); await page.getByRole('button', { name: 'Enviar código' }).click(); await page.getByLabel('Código de 6 dígitos').fill(await adminOtp(otp[2].email)); }
    await page.waitForTimeout(500); log.length = 0; const t = Date.now(); await page.getByRole('button', { name: kind === 'otp' ? 'Verificar código' : 'Entrar', exact: true }).click();
    await expect(page.locator('h1', { hasText: 'Bandeja' })).toBeVisible({ timeout: 20000 }); await page.waitForTimeout(visit === 1 ? 1500 : 5000);
    if (visit === 1) await page.waitForFunction(() => !document.querySelector('.chip-pending') && !/Decidiendo/.test(document.body.innerText), null, { timeout: 90000 }).catch(() => console.log('  pass did not finish in 90 s'));
    await page.waitForTimeout(1500);
    const auth = log.find((x) => /\/auth\/v1\/(token|verify)/.test(x.p)); const inbox = log.filter((x) => /inbox/.test(x.p)); const firstRun = log.find((x) => /invoices\/run/.test(x.p));
    const inboxBeforeRun = inbox.filter((x) => !firstRun || x.t < firstRun.t).length;
    console.log(`${kind} visit ${visit}: sign-in request at +${auth && auth.t - t} ms; first inbox request at +${inbox[0] && inbox[0].t - t} ms; inbox requests before the first run POST: ${inboxBeforeRun}; total inbox ${inbox.length}; run POSTs ${count(log, /invoices\/run/)}; /api/company ${count(log, /company/)}; all: ${sum(log)}`);
    expect(inboxBeforeRun).toBe(1); if (visit === 2) expect(inbox.length).toBe(1);
    await ctx.close();
  }
});
