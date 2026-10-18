/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA AC-107 R-150: nobody is signed in before they click; the sign-in starts on click, never on page load, hover or pointerdown. Loads /login and /demo, waits, hovers, presses the pointer down
// on the door without releasing it, and counts auth requests and stored sessions. Nothing is clicked, so no user is created. QA_URL + QA_LIVE=1.
import { test, newPage, URL_ } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'set QA_LIVE=1');
test.setTimeout(120000);
for (const [path, label] of [['/login', 'Probar con mi propia empresa'], ['/demo', 'Entrar como Andina Labs']] as [string, string][]) test(`AC-107 no sign-in before the click on ${path}`, async ({ browser }: any) => {
  const { ctx, page } = await newPage(browser); const calls: string[] = [];
  page.on('request', (r: any) => { if (/supabase\.co\/auth\/v1\/(token|signup|verify|otp)/.test(r.url())) calls.push(`${r.method()} ${new globalThis.URL(r.url()).pathname}`); });
  await page.goto(`${URL_}${path}`); await page.waitForTimeout(3000);
  const stored = () => page.evaluate(() => Object.keys(localStorage).filter((k) => /auth-token/.test(k)).length);
  console.log(`[${path}] after load + 3 s: auth calls ${JSON.stringify(calls)}; stored sessions ${await stored()}`);
  const b = page.getByRole('button', { name: label }); await b.hover(); await page.waitForTimeout(1500);
  console.log(`[${path}] after hover 1.5 s: auth calls ${JSON.stringify(calls)}; stored sessions ${await stored()}`);
  await page.mouse.down(); await page.waitForTimeout(1500);
  console.log(`[${path}] after pointerdown held 1.5 s: auth calls ${JSON.stringify(calls)}; stored sessions ${await stored()}; url ${new globalThis.URL(page.url()).pathname}`);
  await page.mouse.move(5, 5); await page.mouse.up(); await page.waitForTimeout(1500);
  console.log(`[${path}] pointer released outside the button: auth calls ${JSON.stringify(calls)}; stored sessions ${await stored()}; url ${new globalThis.URL(page.url()).pathname}`);
  await ctx.close();
});
