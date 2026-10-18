/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA R-138 / AC-107: «Pregúntale a Thesaurus» count line follows the server's state while the pass runs. ONE question (trial user cap 10/day). QA_URL + QA_LIVE=1.
import { test, expect, newPage, URL_ } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'uses one model answer: set QA_LIVE=1');
test.setTimeout(150000);
test('ask mid-pass: the answer matches the pending count the server held at that moment', async ({ browser }: any) => {
  const { ctx, page } = await newPage(browser);
  await page.goto(`${URL_}/login`); await page.getByRole('button', { name: 'Probar con mi propia empresa' }).click();
  await expect(page.locator('h1', { hasText: 'Bandeja' })).toBeVisible(); await page.keyboard.press('Escape');
  const pending = () => page.evaluate(async () => {
    const k = Object.keys(localStorage).find((x) => /auth-token/.test(x))!; const tok = JSON.parse(localStorage[k]).access_token;
    const j = await (await fetch('/api/screen/inbox', { headers: { Authorization: `Bearer ${tok}` } })).json();
    return { pending: j.invoices.filter((i: any) => !i.outcome).length, t: Date.now() };
  });
  await page.getByText(/Decidiendo tus facturas pendientes… [1-9]\d* de 29/).waitFor({ timeout: 30000 });
  const before = await pending();
  await page.getByRole('textbox', { name: /Tu pregunta/ }).fill('¿Cuántas facturas están pendientes de decisión ahora mismo? Responde solo con el número.');
  const t0 = Date.now(); await page.getByRole('button', { name: 'Preguntar' }).click();
  await page.getByText(/Respuesta generada por IA/).first().waitFor({ timeout: 60000 });
  const after = await pending();
  const txt = (await page.locator('.ask, section[aria-labelledby="ask-title"]').first().innerText()).replace(/\s+/g, ' ');
  console.log(`pending before ask: ${before.pending}; after answer: ${after.pending}; answered in ${Date.now() - t0} ms`);
  console.log('ANSWER block:', txt.slice(0, 700));
  await ctx.close();
});
