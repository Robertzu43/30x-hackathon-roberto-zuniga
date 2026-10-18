/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA R-135 / AC-94 / AC-95: the top bar company name over time (every header text change recorded) for a trial user at landing, after «Guardar mi acceso»,
// after reload and after a fresh password login; never the placeholder «tu empresa de prueba» / "your trial company" as a name, never null/undefined. QA_URL + QA_LIVE=1.
import { test, expect, newPage, URL_ } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'creates real users: set QA_LIVE=1');
test.setTimeout(180000);
const WATCH = `(() => { const h = (window.__hdr = []); const t0 = performance.now(); let last = '';
  const f = () => { const e = document.querySelector('header'); const t = e ? e.innerText.replace(/\\s+/g, ' ') : '(no header)'; if (t !== last) { last = t; h.push([Math.round(performance.now() - t0), t]); } };
  new MutationObserver(f).observe(document, { subtree: true, childList: true, characterData: true }); f(); })();`;
const lang = process.env.QA_LANG || 'es';
for (const [vw, name] of [[1440, 'desktop'], [360, 'mobile']] as [number, string][]) test(`R-135 top bar name over time ${name} ${lang}`, async ({ browser }: any) => {
  const n = 100 + Math.floor(Math.random() * 800); const email = `qa-r202610162341-52-${vw}${n}@example.com`; const password = 'Qa-' + Math.random().toString(36).slice(2, 12) + 'Z9';
  const A = await newPage(browser, { viewport: { width: vw, height: 844 } }); await A.ctx.addInitScript(WATCH); const pa = A.page;
  const bad = (hist: any[]) => hist.filter(([, t]) => /tu empresa de prueba|your trial company|null|undefined/i.test(t));
  const dump = async (p: any, label: string) => { const h = await p.evaluate(() => (window as any).__hdr); const names = [...new Set(h.map(([, t]: any) => (t.match(/Empresa de prueba \d+|Trial company \d+|(?:Andina Labs)|\(no header\)/) || ['<none>'])[0]))]; console.log(`${label}: ${h.length} header states; names seen over time: ${JSON.stringify(names)}; bad states: ${JSON.stringify(bad(h))}`); console.log(`   first 3: ${JSON.stringify(h.slice(0, 3).map(([a, t]: any) => [a, t.slice(0, 120)]))}`); };
  await pa.goto(`${URL_}/login`);
  if (lang === 'en') await pa.getByRole('button', { name: 'English' }).first().click();
  await pa.getByRole('button', { name: lang === 'en' ? 'Try it with my own company' : 'Probar con mi propia empresa' }).click();
  await expect(pa.locator('h1', { hasText: /Bandeja|Inbox/ })).toBeVisible(); await pa.waitForTimeout(3500); await pa.keyboard.press('Escape');
  await dump(pa, `A landing ${name}`);
  await pa.getByRole('button', { name: /Guardar mi acceso|Save my access/ }).first().click();
  await pa.locator('#save-email').fill(email); await pa.locator('input[autocomplete="new-password"]').fill(password);
  await pa.getByRole('button', { name: /Guardar mi acceso|Save my access/ }).last().click();
  await pa.getByText(/Listo: ya puedes entrar|Done: you can now sign in/).waitFor({ timeout: 20000 }); await pa.waitForTimeout(1500);
  await dump(pa, `A after save ${name}`);
  await pa.evaluate(() => { (window as any).__hdr.length = 0; });
  await pa.reload(); await expect(pa.locator('h1', { hasText: /Bandeja|Inbox/ })).toBeVisible({ timeout: 20000 }); await pa.waitForTimeout(3000);
  await dump(pa, `A after reload ${name}`);
  const B = await newPage(browser, { viewport: { width: vw, height: 844 } }); await B.ctx.addInitScript(WATCH); const pb = B.page;
  await pb.goto(`${URL_}/login`); if (lang === 'en') await pb.getByRole('button', { name: 'English' }).first().click();
  await pb.getByRole('button', { name: /Entrar con contraseña|Sign in with password/ }).click();
  await pb.getByLabel(/Correo|Email/).fill(email); await pb.getByLabel(/Contraseña|Password/).fill(password);
  await pb.evaluate(() => { (window as any).__hdr.length = 0; });
  await pb.getByRole('button', { name: /^Entrar$|^Sign in$/ }).click();
  await expect(pb.locator('h1', { hasText: /Bandeja|Inbox/ })).toBeVisible({ timeout: 20000 }); await pb.waitForTimeout(3500);
  await dump(pb, `B fresh password login ${name}`);
  const final = (await pb.locator('header').first().innerText()).replace(/\s+/g, ' ');
  console.log(`B final top bar ${name}: ${final}`);
  expect(final).toMatch(/(Empresa de prueba|Trial company) \d+/);
  await A.ctx.close(); await B.ctx.close();
});
