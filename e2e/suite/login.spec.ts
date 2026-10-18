/* eslint-disable @typescript-eslint/no-explicit-any -- e2e suite */
// /login: wordmark intro (AC-108), language toggle (AC-41), OTP form validation (AC-41/S-Auth), no writes (the OTP mail request is stubbed).
import { test, expect, BASE, t, setLang } from './pw';

test('login: intro, language toggle, OTP validation, password door form', async ({ page, guard, lang }: any) => {
  await page.route('**/auth/v1/otp*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto(`${BASE}/login`);
  await expect(page.locator('h1')).toHaveText('Thesaurus');
  await page.waitForTimeout(2500);
  await guard.check('login');
  await setLang(page, lang);
  await expect(page.getByRole('button', { name: t(lang, 'Probar con mi propia empresa', 'Try it with my own company') })).toBeVisible();
  await expect(page.getByRole('button', { name: t(lang, 'Enviar código', 'Send code') })).toBeVisible();
  await guard.check(`login-${lang}`);
  // empty email, twice: an error in the page's language, no request sent
  let sent = 0; page.on('request', (r: any) => { if (/\/auth\/v1\/otp/.test(r.url())) sent++; });
  const send = page.getByRole('button', { name: t(lang, 'Enviar código', 'Send code') });
  for (const bad of ['', '', 'no-es-un-correo', 'falta-arroba.com']) { // 'a@b' is valid per the HTML email rule, so it is not used
    await page.locator('#login-email').fill(bad);
    await send.click();
    await page.waitForTimeout(300);
    const invalid = await page.locator('#login-email').evaluate((e: any) => !e.checkValidity() || e.getAttribute('aria-invalid') === 'true');
    const alert = await page.locator('[role=alert], .error, [aria-live]').filter({ hasText: /\S/ }).allInnerTexts();
    expect(invalid || alert.length > 0, `email "${bad}" must be rejected with visible feedback`).toBe(true);
  }
  expect(sent, 'no OTP request for an invalid email').toBe(0);
  await guard.check(`login-otp-errors-${lang}`);
  // a valid email shows the code step (request stubbed: no mail)
  await page.locator('#login-email').fill('qa-e2e-nomail@example.com');
  await send.click();
  await expect(page.getByLabel(t(lang, 'Código de 6 dígitos', '6-digit code'))).toBeVisible();
  expect(sent).toBe(1);
  await guard.check(`login-code-step-${lang}`);
  // password door opens its form
  await page.goto(`${BASE}/login`); await setLang(page, lang);
  await page.getByRole('button', { name: t(lang, 'Entrar con contraseña', 'Sign in with password') }).click();
  await expect(page.locator('input[type=password]')).toBeVisible();
  await guard.check(`login-password-${lang}`);
});
