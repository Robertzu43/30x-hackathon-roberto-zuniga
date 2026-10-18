/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA helper: log each QA password/OTP user in and let the first-login pass finish (no Pendiente chip, no «Decidiendo» line), so later door runs hit a user with nothing pending.
// QA_URL + QA_LIVE=1. Users come from .wrangler/qa-52x/users-{pw,otp}.json (Admin API, no mail; the OTP request is stubbed).
import fs from 'node:fs';
import { test, expect, newPage, adminOtp, URL_, DIR } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'creates real users: set QA_LIVE=1');
test.setTimeout(600000);
const pw = JSON.parse(fs.readFileSync(`${DIR}/users-pw.json`, 'utf8'));
const otp = JSON.parse(fs.readFileSync(`${DIR}/users-otp.json`, 'utf8'));
const done = (page: any) => page.waitForFunction(() => !!document.querySelector('table.inbox-list tbody tr[data-id]') && !document.querySelector('.chip-pending') && !/Decidiendo|Deciding/.test(document.body.innerText), null, { timeout: 100000 });
test('settle password users', async ({ browser }: any) => {
  for (const u of pw) {
    const { ctx, page } = await newPage(browser); await page.goto(`${URL_}/login`);
    await page.getByRole('button', { name: 'Entrar con contraseña' }).click(); await page.getByLabel('Correo').fill(u.email); await page.getByLabel('Contraseña').fill(u.password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click(); await expect(page.locator('h1', { hasText: 'Bandeja' })).toBeVisible({ timeout: 20000 });
    await done(page); await page.waitForTimeout(1500); console.log('settled', u.email.slice(-14)); await ctx.close();
  }
});
test('settle otp users', async ({ browser }: any) => {
  for (const u of otp) {
    const { ctx, page } = await newPage(browser); await page.route('**/auth/v1/otp*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.goto(`${URL_}/login`); await page.getByLabel('Correo').fill(u.email); await page.getByRole('button', { name: 'Enviar código' }).click();
    await page.getByLabel('Código de 6 dígitos').fill(await adminOtp(u.email)); await page.getByRole('button', { name: 'Verificar código', exact: true }).click();
    await expect(page.locator('h1', { hasText: 'Bandeja' })).toBeVisible({ timeout: 20000 }); await done(page); await page.waitForTimeout(1500); console.log('settled', u.email.slice(-14)); await ctx.close();
  }
});
