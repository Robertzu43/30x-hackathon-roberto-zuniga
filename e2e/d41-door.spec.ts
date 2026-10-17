/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file (Playwright is not a repo dependency; env-driven) */
// QA D41 (AC-92, AC-94): the jury's door on the deployed URL. Creates ONE anonymous trial user per run (never deleted, AC-07).
// Needs QA_URL. Skipped unless QA_LIVE=1. No AI read, no question, no mail.
import { createRequire } from 'node:module';
const { test, expect } = createRequire(import.meta.url)('/opt/node22/lib/node_modules/playwright/test');

const URL = process.env.QA_URL!;
test.skip(process.env.QA_LIVE !== '1', 'creates a real anonymous user: set QA_LIVE=1');
test.use({ viewport: { width: 1440, height: 900 } });

test('fresh juror: door -> Bandeja <= 30 s -> top bar -> reload -> return door -> leave warning', async ({ browser }: any) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${URL}/login`);
  const door = page.getByRole('button', { name: 'Probar con mi propia empresa' });
  await expect(door).toBeVisible();
  const t0 = Date.now();
  await door.click();
  await expect(page.getByText(/Decidiendo tus facturas pendientes/)).toBeVisible();
  await expect(page.locator('h1', { hasText: 'Bandeja' })).toBeVisible({ timeout: 30000 });
  expect(Date.now() - t0).toBeLessThanOrEqual(30000);
  const bar = page.locator('header').first();
  await expect(bar).toContainText(/Empresa de prueba \d+/);
  await expect(bar).toContainText('Acceso sin guardar');
  await expect(bar.getByRole('button', { name: 'Guardar mi acceso' })).toBeVisible();
  await expect(bar).not.toContainText(/null|undefined/);
  await page.getByRole('button', { name: 'Saltar' }).click();
  // reload keeps the workspace; the door now says "Volver"
  await page.reload();
  await expect(bar).toContainText(/Empresa de prueba \d+/);
  await page.goto(`${URL}/demo`);
  await expect(page.getByRole('button', { name: 'Volver a mi empresa de prueba' })).toBeVisible();
  await page.goto(`${URL}/login`);
  await expect(page.getByRole('button', { name: 'Volver a mi empresa de prueba' })).toBeVisible();
  await page.getByRole('button', { name: 'Volver a mi empresa de prueba' }).click();
  await expect(page.locator('h1', { hasText: 'Bandeja' })).toBeVisible();
  // R-119: leaving an unsaved trial warns, Escape keeps the session
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByText(/Si sales sin guardar tu acceso/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salir de todos modos' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText(/Si sales sin guardar tu acceso/)).toHaveCount(0);
  await ctx.close();
});
