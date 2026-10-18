/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA AC-107: pressed-state copy in English and the timing at 390 px (trial + demo doors), plus R-137 (deep link with a stored session). QA_URL + QA_LIVE=1.
import { test, expect, newPage, q, URL_ } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'creates real trial users: set QA_LIVE=1');
test.setTimeout(120000);
const variants: [string, string, string, any][] = [
  ['trial en 1440', '/login', 'Try it with my own company', { w: 1440 }],
  ['demo en 1440', '/demo', 'Sign in as Andina Labs', { w: 1440 }],
  ['trial es 390', '/login', 'Probar con mi propia empresa', { w: 390, es: true }],
  ['demo es 390', '/demo', 'Entrar como Andina Labs', { w: 390, es: true }],
];
for (const [name, path, label, o] of variants) test(`AC-107 ${name}`, async ({ browser }: any) => {
  const { ctx, page } = await newPage(browser, { viewport: { width: o.w, height: o.w === 390 ? 844 : 900 } });
  await page.goto(`${URL_}${path}`);
  if (!o.es) await page.getByRole('button', { name: 'English' }).first().click();
  const b = page.getByRole('button', { name: label }); await expect(b).toBeEnabled(); await page.waitForTimeout(500);
  await page.evaluate(() => (window as any).__qa.arm(false)); await b.click();
  await page.waitForFunction(() => (window as any).__qa.usable !== null, null, { timeout: 20000 });
  const r = await q(page);
  console.log(`${name}: usable ${Math.round(r.usable.ms)} ms; pressed state ${Math.round(r.busy.ms)} ms "${r.busy.text}"; rows ${r.usable.rows}; door "n of m": ${JSON.stringify(r.doorText)}`);
  await ctx.close();
});

test('R-137 / AC-94: deep link with a stored session (new tab) opens that screen, not Bandeja', async ({ browser }: any) => {
  const { ctx, page } = await newPage(browser);
  await page.goto(`${URL_}/login`); await page.getByRole('button', { name: 'Probar con mi propia empresa' }).click();
  await expect(page.locator('h1', { hasText: 'Bandeja' })).toBeVisible(); await page.keyboard.press('Escape');
  const p2 = await ctx.newPage(); await p2.goto(`${URL_}/policy`); await p2.waitForTimeout(3000);
  console.log('new tab /policy -> url', p2.url(), '| h1:', await p2.locator('h1').first().innerText());
  console.log('Politica approver text for trial:', JSON.stringify((await p2.locator('main').innerText()).split('\n').filter((l: string) => /correo|aprobador|empresas de prueba/i.test(l)).slice(0, 4)));
  await ctx.close();
});
