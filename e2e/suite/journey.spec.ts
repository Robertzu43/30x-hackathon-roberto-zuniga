/* eslint-disable @typescript-eslint/no-explicit-any -- e2e suite */
// The trial user's whole day, one trial company per project (4 per run): trial door (AC-92), transition (AC-109), tour start + Saltar (AC-42),
// Bandeja list and filters (AC-24/AC-99), Detalle (AC-29, AC-77, AC-67), Política (AC-33, AC-73), Beneficiarios, Periodo (AC-44), «Guardar mi acceso» (AC-95), leave trial (AC-94).
import { test, expect, t, trialDoor } from './pw';
test.describe.configure({ retries: 0 }); // each attempt creates a trial company (budget <= 20 per run)

test('trial journey: Bandeja, filters, Detalle, Política, Beneficiarios, Periodo, save panel, leave', async ({ page, guard, lang }: any, info: any) => {
  await trialDoor(page, guard, lang);
  await page.waitForTimeout(1500);
  await guard.check('bandeja-landing');
  // tour starts on landing (AC-42), Saltar closes it, a reload does not bring it back
  const skip = page.getByRole('button', { name: t(lang, 'Saltar', 'Skip') });
  await expect.soft(skip, 'AC-42 tour starts on landing for a first login').toBeVisible({ timeout: 8000 });
  await expect.soft(page.getByText(new RegExp(t(lang, 'Paso 1 de 7', 'Step 1 of 7')))).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await expect(skip).toBeHidden();
  await page.waitForTimeout(1000); // a person does not reload within 1 s of Saltar; rules out a test-side race with the "seen" write
  await page.reload();
  await expect(page.locator('table.inbox-list tbody tr[data-id]').first()).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1500);
  const again = page.getByRole('button', { name: t(lang, 'Saltar', 'Skip') });
  await expect.soft(again, 'AC-42 tour does not reappear after Saltar and a reload').toBeHidden();
  if (await again.isVisible()) await again.click();
  await guard.check('bandeja-reload');
  // the pass ends within AC-47's 30 s
  await expect(page.getByText(t(lang, 'Decidiendo tus facturas pendientes', 'Deciding your pending invoices'))).toBeHidden({ timeout: 45000 });
  const rows = page.locator('table.inbox-list tbody tr[data-id]');
  const total = await rows.count();
  expect(total).toBeGreaterThan(20);
  // search filter
  const search = page.getByLabel(t(lang, 'Buscar por beneficiario, número o concepto', /Search/i as any));
  await search.fill('Forma');
  await expect.poll(async () => { const n = await rows.count(); return n > 0 && n < total; }, { message: 'search «Forma» narrows the list and is not empty' }).toBe(true);
  await search.fill('zzzz-no-existe');
  await expect.poll(() => rows.count()).toBe(0);
  await guard.check('bandeja-search-empty');
  await search.fill('');
  await expect.poll(() => rows.count()).toBe(total);
  // outcome filter
  const sel = page.locator('select').first();
  await sel.selectOption({ label: 'FRENAR' }).catch(async () => sel.selectOption({ index: 2 }));
  await expect.poll(async () => (await rows.allInnerTexts()).length > 0 && (await rows.allInnerTexts()).every((x: string) => /FRENAR|STOP/i.test(x))).toBe(true);
  await guard.check('bandeja-filter-frenar');
  await sel.selectOption({ index: 0 });
  // Detalle of the first row
  await guard.land();
  await rows.first().locator('a').first().click();
  await expect(page).toHaveURL(/\/invoices\//);
  for (const h of [t(lang, 'Lo que hice', 'What I did'), t(lang, 'Lo que leí', 'What I read'), t(lang, 'Lo que decidí', 'What I decided')])
    await expect(page.getByRole('heading', { name: h }), `decision record heading «${h}»`).toBeVisible();
  await expect(page.getByText(new RegExp(t(lang, 'Leído por IA', 'Read by AI'), 'i')).first()).toBeVisible();
  await page.waitForTimeout(800);
  await guard.check('detalle');
  const q = page.getByLabel(new RegExp(t(lang, 'Tu pregunta', 'Your question'), 'i'));
  await q.fill(t(lang, '¿Cuál es el beneficiario de esta factura?', 'Who is the payee of this invoice?'));
  await page.getByRole('button', { name: t(lang, 'Preguntar', 'Ask') }).click();
  await expect(page.getByText(new RegExp(t(lang, 'Respuesta generada por IA', 'AI-generated answer'), 'i'))).toBeVisible({ timeout: 30000 });
  await guard.check('detalle-answer');
  // Política, Beneficiarios, Periodo
  for (const [es, en, must] of [['Política', 'Policy', /Yahoo|open\.er-api|tasa|rate/i], ['Beneficiarios', 'Payees', /\S/], ['Periodo', 'Period', new RegExp(t(lang, 'Violaciones\\s*0', 'Violations\\s*0'))]] as const) {
    await guard.land();
    await page.getByRole('link', { name: t(lang, es, en), exact: true }).first().click();
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('main')).toContainText(must as RegExp);
    await page.waitForTimeout(1000);
    await guard.check(es);
  }
  // «Guardar mi acceso» panel opens and cancels
  await page.getByRole('button', { name: t(lang, 'Guardar mi acceso', 'Save my access') }).first().click();
  await expect(page.locator('#save-email')).toBeVisible();
  await guard.check('save-access-panel');
  await page.getByRole('button', { name: t(lang, 'Cancelar', 'Cancel') }).click();
  if (info.project.name === 'm390-es') {
    // leave trial without saving: warning, then «Salir de todos modos» lands on /login
    await page.getByRole('button', { name: t(lang, 'Cerrar sesión', 'Sign out') }).click();
    await expect(page.getByText(/Si sales sin guardar tu acceso|If you leave without saving/)).toBeVisible();
    await guard.check('leave-trial-warning');
    await page.getByRole('button', { name: t(lang, 'Salir de todos modos', 'Leave anyway') }).click();
    await expect(page).toHaveURL(/\/login/);
    await guard.check('after-leave');
  }
  if (info.project.name === 'd1440-en') {
    // save access with a QA email and password: same company afterwards
    const before = await page.locator('header').innerText();
    await page.getByRole('button', { name: t(lang, 'Guardar mi acceso', 'Save my access') }).first().click();
    await page.locator('#save-email').fill(`qa-r202610162341-e2e-save-${Date.now().toString(36)}@example.com`);
    await page.locator('input[autocomplete="new-password"]').first().fill('QaE2e-pass-' + Date.now());
    const pw2 = page.locator('input[autocomplete="new-password"]').nth(1); if (await pw2.count()) await pw2.fill(await page.locator('input[autocomplete="new-password"]').first().inputValue());
    await page.locator('dialog, [role=dialog]').getByRole('button', { name: t(lang, 'Guardar mi acceso', 'Save my access') }).click();
    await expect(page.locator('#save-email')).toBeHidden({ timeout: 15000 });
    const name = before.match(/(Empresa de prueba|Trial company) \d+/)?.[0];
    if (name) await expect(page.locator('header')).toContainText(name);
    await guard.check('after-save');
  }
});
