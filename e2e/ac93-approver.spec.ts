/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA AC-93 «A save that sends approver_email for a trial company answers 403 «Las empresas de prueba no envían correos.» and changes nothing» (PUT /api/company, the «Guardar empresa» request).
// QA_AC93_DOOR=trial (one anonymous sign-in) or a password user (expects 200). QA_URL + QA_LIVE=1.
import fs from 'node:fs';
import { test, expect, newPage, URL_, DIR } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'set QA_LIVE=1');
test.setTimeout(180000);
test(`AC-93 approver_email on a ${process.env.QA_AC93_DOOR || 'password'} company`, async ({ browser }: any) => {
  const { ctx, page } = await newPage(browser); await page.goto(`${URL_}/login`);
  if (process.env.QA_AC93_DOOR === 'trial') await page.getByRole('button', { name: 'Probar con mi propia empresa' }).click();
  else { const u = JSON.parse(fs.readFileSync(`${DIR}/users-pw.json`, 'utf8'))[0]; await page.getByRole('button', { name: 'Entrar con contraseña' }).click(); await page.getByLabel('Correo').fill(u.email); await page.getByLabel('Contraseña').fill(u.password); await page.getByRole('button', { name: 'Entrar', exact: true }).click(); }
  await expect(page.locator('h1', { hasText: 'Bandeja' })).toBeVisible({ timeout: 20000 }); await page.keyboard.press('Escape');
  const tok = await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => /auth-token/.test(x))!; return JSON.parse(localStorage.getItem(k)!).access_token; });
  const co = await (await fetch(`${URL_}/api/company`, { headers: { Authorization: `Bearer ${tok}` } })).json() as any; console.log('is_trial', co.is_trial, '| name', co.name, '| approver_email before:', JSON.stringify(co.approver_email));
  const put = async (label: string, body: any) => { const r = await fetch(`${URL_}/api/company`, { method: 'PUT', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); console.log(`PUT /api/company ${label} ->`, r.status, (await r.text()).slice(0, 170)); };
  await put('with approver_email qa-x@example.com', { name: co.name, approver_email: 'qa-x@example.com', lang: co.lang });
  await put('with approver_email "" (empty)', { name: co.name, approver_email: '', lang: co.lang });
  await put('with approver_email null', { name: co.name, approver_email: null, lang: co.lang });
  await put('without approver_email (name + lang only)', { name: co.name, lang: co.lang });
  const co2 = await (await fetch(`${URL_}/api/company`, { headers: { Authorization: `Bearer ${tok}` } })).json() as any; console.log('approver_email after:', JSON.stringify(co2.approver_email), '| name after', co2.name);
  await ctx.close();
});
