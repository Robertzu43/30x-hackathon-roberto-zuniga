import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'

// Carolina's day, start to finish, recorded to docs/demo/happy-path.webm (AC-26).
// Needs BASE_URL plus SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY: it reseeds today's demo data first.
const PASSWORD = 'Demo2026!'

test.beforeAll(() => {
  if (!process.env.BASE_URL) throw new Error('set BASE_URL to the deployed Worker URL')
  execFileSync('node', ['scripts/seed.mjs'], { stdio: 'inherit' })
})

async function login(page: Page, path: string, email: string) {
  await page.goto(path)
  await page.getByLabel('Correo').fill(email)
  await page.getByLabel('Contraseña').fill(PASSWORD)
  await page.getByRole('button', { name: 'Entrar' }).click()
}

test('dispatcher imports and assigns, courier marks, dispatcher closes the day', async ({ browser }) => {
  const context = await browser.newContext({ recordVideo: { dir: 'test-results/video', size: { width: 1024, height: 640 } }, viewport: { width: 1024, height: 640 } })
  const page = await context.newPage()

  // Dispatcher: upload CSV, preview shows skipped rows, confirm.
  await login(page, '/', 'carolina@rutasdelnorte.demo')
  await expect(page.getByRole('heading', { name: 'Despacho' })).toBeVisible()
  await page.getByLabel('Archivo CSV').setInputFiles('docs/demo/pedidos-ejemplo.csv')
  await expect(page.getByRole('heading', { name: 'Filas omitidas (2)' })).toBeVisible()
  await expect(page.getByText('Falta teléfono')).toBeVisible()
  await expect(page.getByText('Falta dirección')).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar' }).click()
  await expect(page.getByText('5 entregas importadas')).toBeVisible()

  // Assign two imported deliveries to Andrés.
  for (const pedido of ['RN-1001', 'RN-1002']) {
    await page.getByLabel(`Mensajero del pedido ${pedido}`).selectOption({ label: 'Andrés Pérez' })
    await expect(page.getByRole('row', { name: new RegExp(pedido) }).getByText('Asignado')).toBeVisible()
  }
  await page.getByRole('button', { name: 'Cerrar sesión' }).click()

  // Courier on a 360 px phone: one entregado, one fallido (no estaba).
  await page.setViewportSize({ width: 360, height: 640 })
  await login(page, '/mensajero', 'andres@rutasdelnorte.demo')
  const card = (pedido: string) => page.getByRole('listitem').filter({ hasText: pedido })
  await card('RN-1001').getByRole('button', { name: 'Entregado' }).click()
  await card('RN-1001').getByRole('button', { name: 'Confirmar' }).click()
  await expect(card('RN-1001').getByText('Entregado')).toBeVisible()
  await card('RN-1002').getByRole('button', { name: 'Fallido' }).click()
  await card('RN-1002').getByLabel('No estaba').check()
  await card('RN-1002').getByRole('button', { name: 'Confirmar' }).click()
  await expect(card('RN-1002').getByText('Motivo: No estaba')).toBeVisible()
  await page.getByRole('button', { name: 'Salir' }).click()

  // Dispatcher: Cierre del día. Seed 4/2/6 plus 5 imported: 1 entregado, 1 fallido, 3 pendientes.
  await page.setViewportSize({ width: 1024, height: 640 })
  await login(page, '/', 'carolina@rutasdelnorte.demo')
  const closing = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Cierre del día' }) })
  await expect(closing.locator('dd')).toHaveText(['5', '3', '9'])
  await expect(closing.getByRole('row', { name: /RN-1002/ })).toContainText('No estaba')
  await page.waitForTimeout(2000)

  await context.close()
  await page.video()!.saveAs('docs/demo/happy-path.webm')
})
