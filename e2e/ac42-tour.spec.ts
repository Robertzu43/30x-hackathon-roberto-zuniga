/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA AC-42 (+R-62, R-78, R-144): fresh Admin-API user (no mail, never deleted) first login -> tour on landing (1 de 7 ... 7 de 7, Siguiente/Atrás/Saltar), reload does not repeat,
// «Ver tutorial» restarts, Escape closes and counts as seen, language switch keeps the step. Demo user: tour on every «Entrar como Andina Labs», never on F5/deep link. QA_URL + QA_LIVE=1.
import { test, expect, newPage, URL_ } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'creates real users: set QA_LIVE=1');
test.setTimeout(300000);
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const dlg = (p: any) => p.getByRole('dialog');
const step = async (p: any) => norm(await dlg(p).locator('header').innerText());
test('AC-42 fresh user: first login tour, 7 steps, reload no repeat, Ver tutorial, Escape, language', async ({ browser }: any) => {
  const email = `qa-r202610162341-52x-tour${Math.random().toString(36).slice(2, 8)}@example.com`; const password = 'Qa-' + Math.random().toString(36).slice(2, 10) + 'Z9x';
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) }); expect(r.ok).toBe(true);
  const { ctx, page } = await newPage(browser); await page.goto(`${URL_}/login`); await page.getByRole('button', { name: 'Entrar con contraseña' }).click(); await page.getByLabel('Correo').fill(email); await page.getByLabel('Contraseña').fill(password); await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await dlg(page).waitFor({ timeout: 20000 }); const seq: string[] = []; const hl: string[] = [];
  for (let i = 1; i <= 7; i++) { const s = await step(page); seq.push(s); hl.push(norm(await page.locator('.tour-spotlight').evaluate((e: any) => `${e.style.width}x${e.style.height}`).catch(() => 'none'))); if (i === 4) { await dlg(page).getByRole('button', { name: 'Atrás' }).click(); await page.waitForTimeout(300); console.log('Atrás from step 4 ->', await step(page)); await dlg(page).getByRole('button', { name: 'Siguiente' }).click(); await page.waitForTimeout(300); } if (i < 7) { await dlg(page).getByRole('button', { name: 'Siguiente' }).click(); await page.waitForTimeout(500); } }
  console.log('first login steps:', JSON.stringify(seq)); console.log('spotlight sizes:', JSON.stringify(hl), '| route during last step:', new globalThis.URL(page.url()).pathname);
  const last = await dlg(page).getByRole('button', { name: /Siguiente|Terminar|Finalizar|Listo/ }).allInnerTexts(); console.log('last step buttons:', JSON.stringify(last));
  await dlg(page).getByRole('button', { name: /Terminar|Finalizar|Listo|Siguiente/ }).last().click(); await page.waitForTimeout(800); console.log('dialog after finishing:', await dlg(page).count());
  await page.reload(); await page.waitForTimeout(4000); console.log('after reload: dialog count', await dlg(page).count());
  await page.getByRole('button', { name: 'Ver tutorial' }).click(); await dlg(page).waitFor({ timeout: 5000 }); console.log('Ver tutorial restarts at:', await step(page));
  await page.getByRole('button', { name: 'en', exact: true }).click(); await page.waitForTimeout(500); console.log('after switching to English, same step:', await step(page));
  await page.keyboard.press('Escape'); await page.waitForTimeout(500); console.log('Escape closes:', (await dlg(page).count()) === 0);
  await page.reload(); await page.waitForTimeout(3500); console.log('after Escape + reload: dialog count', await dlg(page).count());
  await page.getByRole('button', { name: /Tutorial|tutorial/ }).first().click(); await dlg(page).waitFor(); await dlg(page).getByRole('button', { name: /Saltar|Skip/ }).click(); await page.waitForTimeout(500); console.log('Saltar closes:', (await dlg(page).count()) === 0);
  await ctx.close();
});
test('AC-42 demo user: tour on each «Entrar como Andina Labs», never on F5 / deep link / new tab', async ({ browser }: any) => {
  const { ctx, page } = await newPage(browser);
  const enter = async () => { await page.goto(`${URL_}/demo`); await page.getByRole('button', { name: /Entrar como Andina Labs|Volver/ }).first().click(); await dlg(page).waitFor({ timeout: 20000 }); };
  await enter(); console.log('demo Entrar #1 tour at:', await step(page)); await dlg(page).getByRole('button', { name: 'Saltar' }).click();
  await page.getByRole('link', { name: 'Política' }).first().click(); await page.waitForTimeout(1500); await page.reload(); await page.waitForTimeout(3500); console.log('F5 on /policy: path', new globalThis.URL(page.url()).pathname, 'dialog', await dlg(page).count());
  await page.goto(`${URL_}/period`); await page.waitForTimeout(3500); console.log('typed /period: path', new globalThis.URL(page.url()).pathname, 'dialog', await dlg(page).count());
  const t = await ctx.newPage(); await t.goto(`${URL_}/beneficiaries`); await t.waitForTimeout(3500); console.log('new tab /beneficiaries: path', new globalThis.URL(t.url()).pathname, 'dialog', await dlg(t).count()); await t.close();
  await page.getByRole('button', { name: 'Ver tutorial' }).click(); await dlg(page).waitFor(); console.log('Ver tutorial (demo):', await step(page)); await dlg(page).getByRole('button', { name: 'Saltar' }).click();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click().catch(() => {}); await page.waitForTimeout(1500); await enter(); console.log('demo Entrar #2 tour at:', await step(page));
  await ctx.close();
});
