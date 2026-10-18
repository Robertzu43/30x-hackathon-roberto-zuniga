/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file (Playwright is not a repo dependency; env-driven) */
// QA AC-98 (+AC-92 door timing, AC-67 count): requests per screen on the deployed URL. Needs QA_URL. QA_LIVE=1 (creates one anonymous trial user).
// Output is logged: every /api/* and Supabase request seen per step, with start offset and duration.
import { createRequire } from 'node:module';
const { test, expect } = createRequire(import.meta.url)('/opt/node22/lib/node_modules/playwright/test');

const URL = process.env.QA_URL!;
test.skip(process.env.QA_LIVE !== '1', 'creates a real anonymous user: set QA_LIVE=1');
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(240000);

function tracker(page: any) {
  let step = 'init';
  const log: { step: string; line: string }[] = [];
  const starts = new Map<any, number>();
  const steps = new Map<any, string>();
  const t0 = Date.now();
  page.on('request', (r: any) => {
    const u = r.url();
    if (/\/api\/|supabase\.co\/(rest|auth|functions)/.test(u)) { starts.set(r, Date.now()); steps.set(r, step); }
  });
  page.on('requestfinished', async (r: any) => {
    if (!starts.has(r)) return;
    const resp = await r.response();
    const u = new globalThis.URL(r.url());
    log.push({ step: steps.get(r)!, line: `${r.method()} ${u.host.startsWith('dhjum') ? 'SB:' : ''}${u.pathname}${u.search.slice(0, 60)} -> ${resp?.status()} ${Date.now() - starts.get(r)!}ms @+${starts.get(r)! - t0}ms` });
  });
  return { log, set: (s: string) => (step = s), report: () => { for (const s of [...new Set(log.map((l) => l.step))]) { const ls = log.filter((l) => l.step === s); console.log(`[${s}] ${ls.length} requests (screen/data: ${ls.filter((l) => /\/api\/screen|\/rpc\/screen|\/api\/invoices\/[0-9a-f-]{36}$/.test(l.line)).length})`); ls.forEach((l) => console.log('   ' + l.line)); } } };
}

async function walk(page: any, tr: any, label: string) {
  const link = (name: RegExp | string) => page.getByRole('link', { name }).first();
  const screens: [string, () => Promise<void>][] = [
    ['Periodo', async () => { await link('Periodo').click(); await expect(page.locator('h1')).toContainText(/Periodo/); }],
    ['Beneficiarios', async () => { await link(/Beneficiarios/).click(); await expect(page.locator('h1')).toContainText(/Beneficiarios/); }],
    ['Política', async () => { await link('Política').click(); await expect(page.locator('h1')).toContainText(/Pol/); }],
    ['Bandeja', async () => { await link('Bandeja').click(); await expect(page.locator('h1')).toContainText('Bandeja'); await page.locator('.inbox-list tbody tr').first().waitFor(); }],
  ];
  for (const pass of ['visit1', 'visit2']) {
    for (const [name, go] of screens) {
      tr.set(`${label} ${pass} ${name}`);
      const t = Date.now();
      await go();
      await page.waitForTimeout(1500);
      console.log(`   ${label} ${pass} ${name}: heading visible in ${Date.now() - t}ms (includes 1.5 s settle)`);
    }
    tr.set(`${label} ${pass} Detalle`);
    await page.locator('.inbox-list tbody tr a, .inbox-list tbody tr').first().click();
    await expect(page.getByRole('heading', { name: 'Lo que hice' })).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.getByRole('link', { name: 'Volver a la bandeja' }).first().click();
    await page.locator('.inbox-list tbody tr').first().waitFor();
  }
}

test('AC-98 trial user: requests per screen + door timing (D41)', async ({ browser }: any) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const tr = tracker(page);
  tr.set('trial door');
  await page.goto(`${URL}/login`);
  const door = page.getByRole('button', { name: 'Probar con mi propia empresa' });
  await expect(door).toBeVisible();
  const t0 = Date.now();
  await door.click();
  const prog = page.getByText(/Decidiendo tus facturas pendientes/);
  await expect(prog).toBeVisible({ timeout: 10000 });
  const seen: string[] = [];
  let bandejaAt = 0;
  while (Date.now() - t0 < 40000) {
    const txt = (await prog.first().textContent({ timeout: 300 }).catch(() => null)) ?? null;
    if (txt && seen[seen.length - 1] !== txt) seen.push(`${Date.now() - t0}ms: ${txt}`);
    if (await page.locator('h1', { hasText: 'Bandeja' }).isVisible().catch(() => false)) { bandejaAt = Date.now() - t0; break; }
    await page.waitForTimeout(150);
  }
  console.log('DOOR progress texts seen:', JSON.stringify(seen));
  console.log('DOOR click-to-Bandeja ms:', bandejaAt);
  expect(bandejaAt).toBeGreaterThan(0);
  expect(bandejaAt).toBeLessThanOrEqual(30000);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  console.log('DOOR tour dialog text:', (await dialog.innerText()).replace(/\s+/g, ' ').slice(0, 200));
  await expect(dialog.getByText(/^1 de \d+$/)).toBeVisible();
  console.log('DOOR url:', page.url());
  console.log('DOOR top bar:', (await page.locator('header').first().innerText()).replace(/\s+/g, ' '));
  await page.screenshot({ path: '.wrangler/qa-39c/door-bandeja.png' });
  await dialog.getByRole('button', { name: 'Saltar' }).click();
  await page.locator('.inbox-list tbody tr').first().waitFor();
  await page.waitForTimeout(1500);
  const rows = await page.locator('.inbox-list tbody tr').count();
  console.log('DOOR Bandeja rows:', rows);
  await walk(page, tr, 'trial');
  // deep-link (full load) per screen
  for (const [p, n] of [['/', 'Bandeja'], ['/period', 'Periodo'], ['/beneficiaries', 'Beneficiarios'], ['/policy', 'Política']] as const) {
    tr.set(`trial deeplink ${n}`);
    await page.goto(`${URL}${p}`);
    await page.locator('h1').first().waitFor();
    await page.waitForTimeout(2500);
  }
  tr.report();
  await ctx.close();
});

test('AC-98 demo user: requests per screen', async ({ browser }: any) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const tr = tracker(page);
  tr.set('demo entry');
  await page.goto(`${URL}/demo`);
  await page.getByRole('button', { name: 'Entrar como Andina Labs' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 20000 });
  await dialog.getByRole('button', { name: 'Saltar' }).click();
  await page.locator('.inbox-list tbody tr').first().waitFor();
  await page.waitForTimeout(1500);
  await walk(page, tr, 'demo');
  for (const [p, n] of [['/', 'Bandeja'], ['/period', 'Periodo'], ['/beneficiaries', 'Beneficiarios'], ['/policy', 'Política']] as const) {
    tr.set(`demo deeplink ${n}`);
    await page.goto(`${URL}${p}`);
    await page.locator('h1').first().waitFor();
    await page.waitForTimeout(2500);
  }
  tr.report();
  await ctx.close();
});

test('AC-98/AC-100 demo user: second visit shows cached data at once (screen API delayed 4 s)', async ({ browser }: any) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${URL}/demo`);
  await page.getByRole('button', { name: 'Entrar como Andina Labs' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 20000 });
  await dialog.getByRole('button', { name: 'Saltar' }).click();
  await page.locator('.inbox-list tbody tr').first().waitFor();
  const marks: Record<string, any> = {
    Periodo: page.getByText(/Violaciones/).first(),
    Beneficiarios: page.getByRole('table').or(page.locator('li, tr').filter({ hasText: /Forma Studio/ })).first(),
    'Política': page.getByText(/versión|Versión/).first(),
  };
  const nav: Record<string, any> = { Periodo: /^Periodo$/, Beneficiarios: /Beneficiarios/, 'Política': /^Política$/ };
  for (const n of Object.keys(marks)) { // visit 1, un-delayed
    await page.getByRole('link', { name: nav[n] }).first().click();
    await marks[n].waitFor({ timeout: 15000 });
    await page.getByRole('link', { name: 'Bandeja' }).first().click();
    await page.locator('.inbox-list tbody tr').first().waitFor();
  }
  await page.route('**/api/screen/**', async (route: any) => { await new Promise((r) => setTimeout(r, 4000)); await route.continue(); });
  const reqs: string[] = [];
  page.on('request', (r: any) => { if (/\/api\/screen/.test(r.url())) reqs.push(new globalThis.URL(r.url()).pathname + ' @' + Date.now()); });
  for (const n of Object.keys(marks)) { // visit 2, screen API delayed
    const t = Date.now();
    await page.getByRole('link', { name: nav[n] }).first().click();
    await marks[n].waitFor({ timeout: 15000 });
    console.log(`CACHE visit2 ${n}: data marker visible after ${Date.now() - t}ms (API delayed 4000ms)`);
    await page.waitForTimeout(500);
  }
  const t = Date.now();
  await page.getByRole('link', { name: 'Bandeja' }).first().click();
  await page.locator('.inbox-list tbody tr').first().waitFor({ timeout: 15000 });
  console.log(`CACHE visit2 Bandeja: rows visible after ${Date.now() - t}ms (API delayed 4000ms)`);
  console.log('screen requests during delayed visit2:', reqs.length, reqs.join(' | '));
  await ctx.close();
});
