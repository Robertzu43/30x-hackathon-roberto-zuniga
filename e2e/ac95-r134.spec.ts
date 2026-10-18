/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA AC-95 R-134: «Entrar con contraseña» with a 7-character password shows the message in place and makes NO request to /auth/v1/token (or any /auth/v1 call); also
// empty password, empty email, 7 spaces, twice in a row, es and en. An 8-character wrong password must call the token endpoint once and show the wrong-credentials message. QA_URL + QA_LIVE=1.
import fs from 'node:fs';
import { test, newPage, URL_, DIR } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'set QA_LIVE=1');
test.setTimeout(120000);
const pw = JSON.parse(fs.readFileSync(`${DIR}/users-pw.json`, 'utf8'))[0];
for (const lang of ['es', 'en']) test(`R-134 short password makes no auth call (${lang})`, async ({ browser }: any) => {
  const { ctx, page } = await newPage(browser); const calls: string[] = [];
  page.on('request', (r: any) => { if (/supabase\.co\/auth\/v1\//.test(r.url())) calls.push(`${r.method()} ${new globalThis.URL(r.url()).pathname}`); });
  await page.goto(`${URL_}/login`); if (lang === 'en') await page.getByRole('button', { name: 'English' }).first().click();
  await page.getByRole('button', { name: lang === 'en' ? 'Sign in with password' : 'Entrar con contraseña' }).click();
  const email = page.getByLabel(lang === 'en' ? 'Email' : 'Correo'); const pass = page.getByLabel(lang === 'en' ? 'Password' : 'Contraseña'); const go = page.getByRole('button', { name: lang === 'en' ? 'Sign in' : 'Entrar', exact: true });
  const msg = lang === 'en' ? /The password needs at least 8 characters/ : /La contraseña debe tener al menos 8 caracteres/;
  const row = async (label: string, e: string, p: string, n = 1) => { calls.length = 0; await email.fill(e); await pass.fill(p); for (let i = 0; i < n; i++) { await go.click(); await page.waitForTimeout(900); } console.log(`[${lang}] ${label}: message shown=${await page.getByText(msg).count()} auth calls=${calls.length} ${JSON.stringify(calls)} busy=${await go.getAttribute('aria-busy')} url=${new globalThis.URL(page.url()).pathname}`); };
  await row('7 chars', pw.email, 'abc1234'); await row('7 chars, twice more', pw.email, 'abc1234', 2); await row('7 spaces', pw.email, '       '); await row('empty password', pw.email, '');
  await row('empty email + 7 chars', '', 'abc1234');
  calls.length = 0; await email.fill(pw.email); await pass.fill('abcd1234'); await go.click(); await page.waitForTimeout(2000);
  console.log(`[${lang}] 8 chars wrong: auth calls=${JSON.stringify(calls)} wrong-credentials message=${await page.getByText(lang === 'en' ? /Wrong email or password/ : /Correo o contraseña incorrectos/).count()} short-message still shown=${await page.getByText(msg).count()}`);
  await ctx.close();
});
