/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA AC-107: click to usable Bandeja through the four doors, three runs each. QA_URL + QA_LIVE=1. Users come from .wrangler/qa-52-53/users-{pw,otp}.json
// (created through the Admin API, no mail). The OTP request to Supabase is stubbed so no mail is sent; the code comes from the Admin API.
import fs from 'node:fs';
import { test, expect, newPage, q, median, adminOtp, URL_, DIR } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'creates real users: set QA_LIVE=1');
test.setTimeout(120000);
const door = process.env.QA_DOOR || 'all';
const pw = fs.existsSync(`${DIR}/users-pw.json`) ? JSON.parse(fs.readFileSync(`${DIR}/users-pw.json`, 'utf8')) : [];
const otp = fs.existsSync(`${DIR}/users-otp.json`) ? JSON.parse(fs.readFileSync(`${DIR}/users-otp.json`, 'utf8')) : [];
const results: Record<string, any[]> = {};
const RUNS = Number(process.env.QA_RUNS || 3);

async function report(name: string, i: number, page: any, net: any[], wall: number) {
  const r = await q(page);
  const shown = (r.cls as any[]).filter((c) => c.t >= r.t0e).reduce((s, c) => s + c.v, 0);
  const row = { run: i + 1, usableMs: r.usable?.ms && Math.round(r.usable.ms), rows: r.usable?.rows, busyMs: r.busy && Math.round(r.busy.ms), busyText: r.busy?.text, doorNdeM: r.doorText, clsSinceClick: +shown.toFixed(4), playwrightWall: wall, res: r.usable?.res };
  (results[name] ||= []).push(row);
  console.log(`DOOR ${name} run ${i + 1}: ${JSON.stringify(row)}`);
  const auth = (row.res || []).find((x: any) => /\/auth\/v1\//.test(x.n));
  console.log(`  postAuthMs=${auth ? row.usableMs! - auth.end : 'n/a'} res: ${(row.res || []).map((x: any) => `${x.n}@${x.start}-${x.end}(ttfb ${x.ttfb})`).join(' | ')}`);
  return row;
}
const wait = async (page: any) => { try { await page.waitForFunction(() => (window as any).__qa.usable !== null, null, { timeout: 15000 }); return true; } catch { console.log(`  USABLE NEVER REACHED in 15 s. alerts=${JSON.stringify(await page.getByRole('alert').allInnerTexts().catch(() => []))}`); return false; } };

for (const lang of ['es']) {
  if (door === 'all' || door === 'trial') test('AC-107 trial door x3', async ({ browser }: any) => {
    const NAME = 'trial'; results[NAME] ||= [];
    for (let i = 0; i < RUNS; i++) {
      const { ctx, page, net } = await newPage(browser);
      await page.goto(`${URL_}/login`);
      const b = page.getByRole('button', { name: 'Probar con mi propia empresa' });
      await expect(b).toBeEnabled(); await page.waitForTimeout(500);
      await page.evaluate(() => (window as any).__qa.arm(false));
      const t = Date.now(); await b.click(); const ok = await wait(page); const wall = Date.now() - t; if (!ok) { results[NAME].push({ usableMs: 99999, busyMs: null }); await ctx.close(); continue; }
      const row = await report('trial', i, page, net, wall);
      expect(row.busyMs).toBeLessThanOrEqual(100); expect(row.busyText).toBe('Creando tu empresa de prueba…');
      await page.waitForTimeout(800); await ctx.close();
    }
  });
  if (door === 'all' || door === 'demo') test('AC-107 demo door x3', async ({ browser }: any) => {
    const NAME = 'demo'; results[NAME] ||= [];
    for (let i = 0; i < RUNS; i++) {
      const { ctx, page, net } = await newPage(browser);
      await page.goto(`${URL_}/demo`);
      const b = page.getByRole('button', { name: 'Entrar como Andina Labs' });
      await expect(b).toBeEnabled(); await page.waitForTimeout(500);
      await page.evaluate(() => (window as any).__qa.arm(false));
      const t = Date.now(); await b.click(); const ok = await wait(page); const wall = Date.now() - t; if (!ok) { results[NAME].push({ usableMs: 99999, busyMs: null }); await ctx.close(); continue; }
      const row = await report('demo', i, page, net, wall);
      expect(row.busyText).toBe('Entrando…');
      await page.waitForTimeout(800); await ctx.close();
    }
  });
  if (door === 'all' || door === 'password') test('AC-107 password door x3', async ({ browser }: any) => {
    const NAME = 'password'; results[NAME] ||= [];
    for (let i = 0; i < RUNS; i++) {
      const { ctx, page, net } = await newPage(browser);
      await page.goto(`${URL_}/login`);
      await page.getByRole('button', { name: 'Entrar con contraseña' }).click();
      await page.getByLabel('Correo').fill(pw[i % pw.length].email); await page.getByLabel('Contraseña').fill(pw[i % pw.length].password);
      await page.waitForTimeout(500);
      await page.evaluate(() => (window as any).__qa.arm(false));
      const t = Date.now(); await page.getByRole('button', { name: 'Entrar', exact: true }).click(); const ok = await wait(page); const wall = Date.now() - t; if (!ok) { results[NAME].push({ usableMs: 99999, busyMs: null }); await ctx.close(); continue; }
      const row = await report('password', i, page, net, wall);
      expect(row.busyText).toBe('Entrando…');
      await page.waitForTimeout(800); await ctx.close();
    }
  });
  if (door === 'all' || door === 'otp') test('AC-107 otp door x3', async ({ browser }: any) => {
    const NAME = 'otp'; results[NAME] ||= [];
    for (let i = 0; i < RUNS; i++) {
      const { ctx, page, net } = await newPage(browser);
      let stubbed = 0;
      await page.route('**/auth/v1/otp*', (r: any) => { stubbed++; r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
      await page.goto(`${URL_}/login`);
      await page.getByLabel('Correo').fill(otp[i % otp.length].email);
      await page.getByRole('button', { name: 'Enviar código' }).click();
      const code = await adminOtp(otp[i % otp.length].email);
      await page.getByLabel('Código de 6 dígitos').fill(code);
      await page.waitForTimeout(500);
      await page.evaluate(() => (window as any).__qa.arm(false));
      const t = Date.now(); await page.getByRole('button', { name: 'Entrar', exact: true }).click(); const ok = await wait(page); const wall = Date.now() - t; if (!ok) { results[NAME].push({ usableMs: 99999, busyMs: null }); await ctx.close(); continue; }
      const row = await report('otp', i, page, net, wall);
      expect(stubbed).toBe(1);
      expect(row.busyText).toBe('Entrando…');
      await page.waitForTimeout(800); await ctx.close();
    }
  });
}
test.afterAll(() => { console.log('SUMMARY', JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { usable: v.map((r) => r.usableMs), median: median(v.map((r) => r.usableMs)), busy: v.map((r) => r.busyMs) }])))); });
