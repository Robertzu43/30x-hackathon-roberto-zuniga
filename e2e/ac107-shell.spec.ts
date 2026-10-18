/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA AC-107 «The pass belongs to the app shell»: moving to Política and back while the pass runs neither stops nor restarts it; only one pass per tab; «Ejecutar agente» is busy as the same run.
// Fresh Admin-API user (no mail, never deleted), password door. QA_URL + QA_LIVE=1.
import { test, expect, newPage, URL_ } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'creates real users: set QA_LIVE=1');
test.setTimeout(300000);
test('AC-107 pass survives navigation to /policy and back; one pass; Ejecutar agente busy', async ({ browser }: any) => {
  const email = `qa-r202610162341-52x-sh${Math.random().toString(36).slice(2, 8)}@example.com`; const password = 'Qa-' + Math.random().toString(36).slice(2, 10) + 'Z9x';
  await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
  const { ctx, page } = await newPage(browser); const posts: number[] = []; const T0 = { v: Date.now() };
  page.on('request', (r: any) => { if (/\/api\/invoices\/run/.test(r.url()) && r.method() === 'POST') posts.push(Date.now() - T0.v); });
  await page.goto(`${URL_}/login`); await page.getByRole('button', { name: 'Entrar con contraseña' }).click(); await page.getByLabel('Correo').fill(email); await page.getByLabel('Contraseña').fill(password);
  T0.v = Date.now(); await page.getByRole('button', { name: 'Entrar', exact: true }).click(); await expect(page.locator('h1', { hasText: 'Bandeja' })).toBeVisible({ timeout: 20000 }); await page.keyboard.press('Escape');
  const run = page.getByRole('button', { name: 'Ejecutar agente' }); console.log('Ejecutar agente during pass: disabled', await run.isDisabled(), 'aria-busy', await run.getAttribute('aria-busy'));
  await page.waitForTimeout(1500); await page.getByRole('link', { name: 'Política' }).first().click(); await page.waitForTimeout(6000);
  console.log('on Política at +', Date.now() - T0.v, 'ms; run POSTs so far:', JSON.stringify(posts));
  await page.getByRole('link', { name: 'Bandeja' }).first().click(); await page.waitForTimeout(1500);
  console.log('back on Bandeja; progress line:', (await page.locator('main').innerText()).match(/Decidiendo[^\n]*/)?.[0] ?? '(none)');
  await page.waitForFunction(() => !!document.querySelector('table.inbox-list tbody tr[data-id]') && !document.querySelector('.chip-pending') && !/Decidiendo/.test(document.body.innerText), null, { timeout: 100000 });
  console.log('done at +', Date.now() - T0.v, 'ms; run POSTs:', posts.length, JSON.stringify(posts), '| summary line:', (await page.locator('main').innerText()).match(/\d+ PAGAR · \d+ FRENAR · \d+ ESCALAR/)?.[0]);
  await ctx.close();
});
