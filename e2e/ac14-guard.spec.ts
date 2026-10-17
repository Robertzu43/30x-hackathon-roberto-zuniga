// QA AC-14 (R-80/R-81/R-82) live UI check. Needs QA_URL and QA_SESSION_FILE (a Supabase password-login response saved by the QA run).
import { createRequire } from 'node:module';
const { test, expect } = createRequire(import.meta.url)('/opt/node22/lib/node_modules/playwright/test');
import fs from 'node:fs';

const URL = process.env.QA_URL!;
const sess = fs.readFileSync(process.env.QA_SESSION_FILE!, 'utf8');
const REF = process.env.SUPABASE_PROJECT_REF!;
const NO_CUADRA = process.env.QA_ID_NOCUADRA!; // orig2, total_no_cuadra
const CREDITO = process.env.QA_ID_CREDITO!; // orig6, nota_credito

test.beforeEach(async ({ context }) => {
  await context.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, sess]);
});

function watch5xx(page: any) {
  const bad: string[] = [];
  page.on('response', (r) => { if (r.status() >= 500) bad.push(`${r.status()} ${r.url()}`); });
  return bad;
}

test('detail es+en, Aprobar re-escalates, Rechazar gives FRENAR, Bandeja and Periodo load', async ({ page }) => {
  const bad = watch5xx(page);
  await page.goto(`${URL}/`);
  await page.getByText('Saltar').click({ timeout: 4000 }).catch(() => {});

  // Bandeja shows guard headlines, not only "factura sin leer"
  await expect(page.getByText('parece una nota crédito').first()).toBeVisible();
  await expect(page.getByText('no cuadra:').first()).toBeVisible();

  // detail, Spanish
  await page.locator(`a[href="/invoices/${NO_CUADRA}"]`).click();
  await expect(page.getByText('no cuadra').first()).toBeVisible();
  await expect(page.locator('body')).toContainText(/Lectura: subtotal .* no cuadra, no se pudo verificar/);
  // detail, English
  await page.getByRole('button', { name: 'en', exact: true }).click();
  await expect(page.getByText('does not add up').first()).toBeVisible();
  await expect(page.locator('body')).toContainText(/Reading: subtotal .* does not add up, could not be verified/);
  await page.getByRole('button', { name: 'es', exact: true }).click();

  // dashboard Aprobar on total_no_cuadra: still ESCALAR, never PAGAR
  await page.getByRole('button', { name: 'Aprobar' }).first().click();
  await expect(page.getByText('aprobó en el tablero').first()).toBeVisible();
  await expect(page.getByText(/resultado es ESCALAR/).first()).toBeVisible();
  await expect(page.getByText(/resultado es PAGAR/)).toHaveCount(0);

  // dashboard Rechazar on nota_credito: FRENAR by the human
  await page.getByRole('link', { name: 'Volver a la bandeja' }).click();
  await page.locator(`a[href="/invoices/${CREDITO}"]`).click();
  await expect(page.getByText('parece una nota crédito').first()).toBeVisible();
  await page.getByRole('button', { name: 'Rechazar' }).first().click();
  await expect(page.getByText(/rechazó en el tablero; el resultado es FRENAR/).first()).toBeVisible();

  // Ejecutar agente from Bandeja
  await page.goto(`${URL}/`);
  await page.getByText('Saltar').click({ timeout: 4000 }).catch(() => {});
  await page.getByRole('button', { name: 'Ejecutar agente' }).click();
  await page.waitForTimeout(4000);
  await expect(page.getByText('parece una nota crédito').first()).toBeVisible();

  // Periodo
  await page.getByRole('link', { name: 'Periodo', exact: true }).click();
  await expect(page.getByText(/Violaciones/).first()).toBeVisible();
  await page.screenshot({ path: process.env.QA_SHOT_DIR + '/periodo.png', fullPage: true });
  console.log('PERIODO_TEXT', (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 1200));
  await page.getByRole('button', { name: 'en', exact: true }).click();
  await expect(page.getByText(/Violations/).first()).toBeVisible();
  console.log('PERIODO_EN', (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 600));
  await page.getByRole('link', { name: 'Inbox', exact: true }).click();
  await expect(page.getByText('looks like a credit note').first()).toBeVisible();
  await expect(page.getByText('does not add up').first()).toBeVisible();
  expect(bad).toEqual([]);
});
