/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA R-119 / AC-107: a trial user who opens /demo mid-pass and enters the demo company must trigger no POST /api/invoices/run with the demo token.
// QA_URL + QA_LIVE=1. Creates one anonymous trial user per mode (never deleted). Reads the demo user's id from .wrangler/qa-52-run2/demo-tok.json.
import fs from 'node:fs';
import { test, expect, newPage, URL_, DIR } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'creates real trial users: set QA_LIVE=1');
test.setTimeout(120000);
const sub = (auth: string) => { try { return JSON.parse(Buffer.from(auth.split(' ')[1].split('.')[1], 'base64url').toString()).sub as string; } catch { return 'none'; } };

for (const mode of ['spa-navigation', 'full-reload']) test(`R-119 ${mode}`, async ({ browser }: any) => {
  const demoId = JSON.parse(fs.readFileSync(`${DIR}/demo-tok.json`, 'utf8')).user.id;
  const { ctx, page } = await newPage(browser);
  const t0 = { v: 0 }; const runs: any[] = [];
  page.on('request', (r: any) => { if (/\/api\/invoices\/run/.test(r.url()) && r.method() === 'POST') runs.push({ at: Date.now() - t0.v, sub: sub(r.headers()['authorization'] || '') }); });
  await page.goto(`${URL_}/login`);
  t0.v = Date.now();
  await page.getByRole('button', { name: 'Probar con mi propia empresa' }).click();
  await expect(page.locator('h1', { hasText: 'Bandeja' })).toBeVisible();
  await expect(page.locator('table.inbox-list tbody tr[data-id]:not([data-id^="s"])').first()).toBeVisible();
  await page.keyboard.press('Escape'); // close the tour
  await page.waitForTimeout(1500);
  const trialSub = runs[0]?.sub;
  console.log(`[${mode}] trial landed at ${Date.now() - t0.v} ms; run POSTs so far: ${runs.length}; progress: ${(await page.locator('main').innerText()).match(/Decidiendo[^\n]*/)?.[0]}`);
  if (mode === 'spa-navigation') await page.evaluate(() => { history.pushState({}, '', '/demo'); window.dispatchEvent(new PopStateEvent('popstate')); });
  else await page.goto(`${URL_}/demo`);
  const enter = page.getByRole('button', { name: 'Entrar como Andina Labs' });
  await expect(enter).toBeVisible();
  console.log(`[${mode}] on /demo at ${Date.now() - t0.v} ms; buttons: ${JSON.stringify(await page.locator('button').allInnerTexts())}`);
  await enter.click();
  const warn = page.getByText(/Si sales sin guardar tu acceso/);
  const warned = await warn.isVisible({ timeout: 3000 }).catch(() => false);
  console.log(`[${mode}] leave warning shown: ${warned}`);
  if (warned) await page.getByRole('button', { name: 'Salir de todos modos' }).click();
  await expect(page.locator('header').first()).toContainText('demo@andina-labs.example', { timeout: 20000 });
  const enteredAt = Date.now() - t0.v;
  await page.waitForTimeout(30000);
  const bySub = runs.map((r) => `${r.at}ms ${r.sub === demoId ? 'DEMO-TOKEN' : r.sub === trialSub ? 'trial-token' : r.sub}`);
  console.log(`[${mode}] entered demo at ${enteredAt} ms. All POST /api/invoices/run: ${JSON.stringify(bySub)}`);
  const after = runs.filter((r) => r.at >= enteredAt - 200);
  console.log(`[${mode}] POSTs after entering demo: ${after.length}; with the demo token (anywhere): ${runs.filter((r) => r.sub === demoId).length}`);
  expect(runs.filter((r) => r.sub === demoId).length).toBe(0);
  console.log(`[${mode}] demo Bandeja rows: ${await page.locator('table.inbox-list tbody tr[data-id]').count()}; progress text present: ${/Decidiendo/.test(await page.locator('main').innerText())}`);
  await ctx.close();
});
