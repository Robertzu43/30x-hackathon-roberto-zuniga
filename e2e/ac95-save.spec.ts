/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA AC-95 (+AC-94 leaving rule once saved): trial -> Guardar mi acceso (mid-pass) -> password login from a fresh window. QA_URL + QA_LIVE=1.
// Creates one anonymous user and saves access with qa-r202610162341-53-<n>@example.com (never deleted). The already-registered case uses an existing QA user from users-pw.json.
import fs from 'node:fs';
import { test, expect, newPage, URL_, DIR } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'creates real users: set QA_LIVE=1');
test.setTimeout(150000);

test('AC-95 save access, errors, password login elsewhere, no warning once saved', async ({ browser }: any) => {
  const taken = JSON.parse(fs.readFileSync(`${DIR}/users-pw.json`, 'utf8'))[0].email;
  const n = 100 + Math.floor(Math.random() * 800); const email = `qa-r202610162341-53-${n}@example.com`; const password = 'Qa-' + Math.random().toString(36).slice(2, 12) + 'Z9';
  const A = await newPage(browser);
  const pa = A.page; await pa.goto(`${URL_}/login`);
  await pa.getByRole('button', { name: 'Probar con mi propia empresa' }).click();
  await expect(pa.locator('h1', { hasText: 'Bandeja' })).toBeVisible(); await pa.keyboard.press('Escape');
  const company = (await pa.locator('header').first().innerText()).match(/Empresa de prueba \d+/)?.[0] ?? (await pa.waitForFunction(() => /Empresa de prueba \d+/.test(document.querySelector('header')!.innerText)).then(async () => (await pa.locator('header').first().innerText()).match(/Empresa de prueba \d+/)![0]));
  console.log('A company:', company, '| top bar before save:', (await pa.locator('header').first().innerText()).replace(/\s+/g, ' '));
  await pa.getByRole('button', { name: 'Guardar mi acceso' }).first().click();
  const tokenCalls = () => A.net.filter((x: any) => /token|user/.test(x.path)).length;
  await pa.locator('#save-email').fill(email); await pa.locator('input[autocomplete="new-password"]').fill('abc1234');
  await pa.getByRole('button', { name: 'Guardar mi acceso' }).last().click();
  console.log('short password (7 chars) ->', JSON.stringify(await pa.getByText(/La contraseña debe tener al menos 8 caracteres/).allInnerTexts()));
  await pa.locator('#save-email').fill(taken); await pa.locator('input[autocomplete="new-password"]').fill(password);
  await pa.getByRole('button', { name: 'Guardar mi acceso' }).last().click();
  await pa.waitForTimeout(2500);
  console.log('already registered email ->', JSON.stringify(await pa.getByText(/Ese correo ya tiene una cuenta/).allInnerTexts()));
  await pa.locator('#save-email').fill(email); await pa.locator('input[autocomplete="new-password"]').fill(password);
  await pa.getByRole('button', { name: 'Guardar mi acceso' }).last().click();
  await pa.getByText(/Listo: ya puedes entrar desde cualquier dispositivo/).waitFor({ timeout: 20000 });
  console.log('success text:', await pa.getByText(/Listo: ya puedes entrar/).first().innerText());
  const bar = (await pa.locator('header').first().innerText()).replace(/\s+/g, ' ');
  console.log('top bar after save:', bar);
  console.log('top bar has company name:', bar.includes(company), '| has email:', bar.includes(email), '| still says Acceso sin guardar:', bar.includes('Acceso sin guardar'), '| null/undefined:', /null|undefined/.test(bar));
  // the pass was running when access was saved: it must still finish
  await pa.waitForFunction(() => !document.querySelector('.chip-pending') && !/Decidiendo/.test(document.body.innerText), null, { timeout: 90000 });
  console.log('pass finished after saving access mid-pass: no Pendiente chip left, rows:', await pa.locator('table.inbox-list tbody tr[data-id]').count());
  // B: fresh window, password login
  const B = await newPage(browser); const pb = B.page; await pb.goto(`${URL_}/login`);
  await pb.getByRole('button', { name: 'Entrar con contraseña' }).click();
  await pb.getByLabel('Correo').fill(email); await pb.getByLabel('Contraseña').fill('abc1234');
  const before = B.net.length; await pb.getByRole('button', { name: 'Entrar', exact: true }).click(); await pb.waitForTimeout(800);
  console.log('login short password ->', JSON.stringify(await pb.getByText(/La contraseña debe tener al menos 8 caracteres/).allInnerTexts()), 'network calls made:', B.net.length - before);
  await pb.getByLabel('Contraseña').fill('Wrong-' + password);
  await pb.getByRole('button', { name: 'Entrar', exact: true }).click(); await pb.waitForTimeout(2500);
  console.log('login wrong password ->', JSON.stringify(await pb.getByText(/Correo o contraseña incorrectos/).allInnerTexts()));
  await pb.getByLabel('Contraseña').fill(password);
  await pb.evaluate(() => (window as any).__qa.arm(false)); const t0 = Date.now();
  await pb.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(pb.locator('h1', { hasText: 'Bandeja' })).toBeVisible({ timeout: 20000 });
  await expect(pb.locator('table.inbox-list tbody tr[data-id]:not([data-id^="s"])').first()).toBeVisible();
  console.log('password login -> usable Bandeja in', Date.now() - t0, 'ms');
  await pb.waitForTimeout(2500);
  const hb = (await pb.locator('header').first().innerText()).replace(/\s+/g, ' ');
  console.log('B top bar:', hb, '| tour dialog present:', await pb.getByRole('dialog').count(), '| rows:', await pb.locator('table.inbox-list tbody tr[data-id]').count(), '| pending chips:', await pb.locator('.chip-pending').count());
  console.log('B top bar has company name:', hb.includes(company));
  // leaving with saved access: no warning
  await pa.getByRole('button', { name: 'Cerrar sesión' }).click(); await pa.waitForTimeout(1500);
  console.log('A sign-out after saving: warning shown =', await pa.getByText(/Si sales sin guardar/).count(), '; url', pa.url());
  await A.ctx.close(); await B.ctx.close();
});
