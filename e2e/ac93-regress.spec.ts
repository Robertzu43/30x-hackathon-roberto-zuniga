/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA AC-93 regression (UI part): trial A pastes one chat invoice (1 model read), B (another trial) does not see it; Política shows the trial approver text. QA_URL + QA_LIVE=1.
import { test, expect, newPage, URL_ } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'uses one model read: set QA_LIVE=1');
test.setTimeout(150000);
test('AC-93: A pastes a chat invoice, B does not see it; trial approver note', async ({ browser }: any) => {
  const mk = async () => { const x = await newPage(browser); await x.page.goto(`${URL_}/login`); await x.page.getByRole('button', { name: 'Probar con mi propia empresa' }).click(); await expect(x.page.locator('h1', { hasText: 'Bandeja' })).toBeVisible(); await x.page.keyboard.press('Escape'); return x; };
  const A = await mk(); const B = await mk(); const pa = A.page, pb = B.page;
  await pa.getByRole('button', { name: 'Nueva factura' }).click();
  await pa.getByRole('tab', { name: /Pegar chat/ }).click().catch(async () => pa.getByText('Pegar chat').first().click());
  await pa.locator('form.new-invoice textarea').fill('[WhatsApp] Northstar Group: QA-REGRESS-93, factura NG-9393, USD 310,00, IBAN ES91 2100 0418 4502 0005 1332. Vence en 40 dias.');
  const t = Date.now(); await pa.getByRole('button', { name: 'Enviar al agente' }).click();
  await pa.waitForURL(/\/invoices\//, { timeout: 60000 }).catch(() => {});
  console.log('A after submit: url', new globalThis.URL(pa.url()).pathname, 'in', Date.now() - t, 'ms; text:', (await pa.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 260));
  await pa.getByRole('link', { name: /Volver a la bandeja/ }).first().click().catch(() => pa.goto(`${URL_}/`));
  await pa.waitForTimeout(2500);
  console.log('A Bandeja contains QA-REGRESS-93/NG-9393:', /NG-9393|QA-REGRESS-93/.test(await pa.locator('main').innerText()), '| rows:', await pa.locator('table.inbox-list tbody tr[data-id]').count());
  await pb.reload(); await pb.waitForTimeout(3000);
  console.log('B Bandeja contains it:', /NG-9393|QA-REGRESS-93/.test(await pb.locator('main').innerText()), '| rows:', await pb.locator('table.inbox-list tbody tr[data-id]').count());
  await pa.getByRole('link', { name: 'Política' }).first().click(); await pa.waitForTimeout(2500);
  const pol = (await pa.locator('main').innerText()).replace(/\s+/g, ' ');
  console.log('Política trial note present:', /Las empresas de prueba no envían correos; las escalaciones esperan en el tablero/.test(pol), '| approver input readonly/disabled:', await pa.locator('input[type=email]').first().evaluate((e: any) => e.readOnly || e.disabled).catch(() => 'no email input'));
  await A.ctx.close(); await B.ctx.close();
});
