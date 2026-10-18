/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA AC-93 (trial does everything a customer does and nothing more). QA_AC93_DOOR=trial (one anonymous sign-in) or password (fresh Admin-API user, to rehearse the clicks).
// Steps: wait for the pass; open the portal card link (no send unless QA_PORTAL_SEND=1); reject #15 (Laura Méndez, cuenta cambiada) then approve Nube Sur (R-35 sequence) and read the timeline
// for «Invitado …»; lower «Límite por pago», save, press Reevaluar; trial approver 403 through PUT /api/policy; service_role count of approval_tokens for the company is 0; isolation vs another user's company.
// QA_URL + QA_LIVE=1. No model read unless QA_PORTAL_SEND=1 (1 portal read) or QA_ASK=1 (1 question).
import fs from 'node:fs';
import { test, expect, newPage, URL_, DIR } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'creates real users: set QA_LIVE=1');
test.setTimeout(300000);
const door = process.env.QA_AC93_DOOR || 'password';
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
test(`AC-93 ${door}: approvals, policy, portal card, isolation`, async ({ browser }: any) => {
  const { ctx, page } = await newPage(browser); await page.goto(`${URL_}/login`);
  if (door === 'trial') await page.getByRole('button', { name: 'Probar con mi propia empresa' }).click();
  else {
    const email = `qa-r202610162341-52x-a93${Math.random().toString(36).slice(2, 8)}@example.com`; const password = 'Qa-' + Math.random().toString(36).slice(2, 10) + 'Z9x';
    await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
    await page.getByRole('button', { name: 'Entrar con contraseña' }).click(); await page.getByLabel('Correo').fill(email); await page.getByLabel('Contraseña').fill(password); await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  }
  await expect(page.locator('h1', { hasText: 'Bandeja' })).toBeVisible({ timeout: 20000 }); await page.keyboard.press('Escape');
  await page.waitForFunction(() => !!document.querySelector('table.inbox-list tbody tr[data-id]') && !document.querySelector('.chip-pending') && !/Decidiendo/.test(document.body.innerText), null, { timeout: 100000 }); await page.waitForTimeout(1500);
  const ses = await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => /auth-token/.test(x))!; const j = JSON.parse(localStorage.getItem(k)!); return { token: j.access_token, sub: j.user.id, anon: j.user.is_anonymous }; });
  const hdr = norm(await page.locator('header').first().innerText()); console.log('top bar:', hdr, '| anonymous:', ses.anon);
  const company = (await (await fetch(`${URL_}/api/company`, { headers: { Authorization: `Bearer ${ses.token}` } })).json()) as any; console.log('/api/company keys:', Object.keys(company), 'is_trial:', company.is_trial);
  // portal card
  const portal = page.locator('section.portal-card'); const ptxt = norm(await portal.innerText()); console.log('portal card:', ptxt.slice(0, 300));
  const slug = ptxt.match(/\/(p-[0-9a-f]{12})/)?.[1] ?? (await portal.locator('a').first().getAttribute('href').catch(() => null)); console.log('portal slug shape:', slug && String(slug).replace(/[0-9a-f]{12}/, '<12hex>'), '| matches p-<12 hex>:', /p-[0-9a-f]{12}/.test(ptxt + (await portal.innerHTML())));
  // live reads (QA_LIVE_READS=1): one chat paste in the app and one portal message from the portal card (2 live reads in total), then one question (QA_ASK=1)
  if (process.env.QA_LIVE_READS === '1' || process.env.QA_PORTAL === '1') {
    let t1: number; const A93 = 'QA-93-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    if (process.env.QA_LIVE_READS === '1') {
    await page.getByRole('button', { name: 'Nueva factura' }).click(); await page.getByRole('tab', { name: /Pegar chat/ }).click().catch(async () => page.getByText('Pegar chat').first().click());
    await page.locator('form.new-invoice textarea').fill(`[WhatsApp] Northstar Group: ${A93}, factura NG-9393, USD 310,00, IBAN ES91 2100 0418 4502 0005 1332. Vence en 40 dias.`);
    t1 = Date.now(); await page.getByRole('button', { name: 'Enviar al agente' }).click(); await page.waitForURL(/\/invoices\//, { timeout: 60000 }).catch(() => {});
    console.log('chat paste ->', new globalThis.URL(page.url()).pathname, 'in', Date.now() - t1, 'ms:', norm(await page.locator('main').innerText()).slice(0, 200));
    await page.getByRole('link', { name: /Volver a la bandeja/ }).first().click().catch(() => page.goto(`${URL_}/`)); await page.waitForTimeout(2500);
    console.log('A Bandeja shows the pasted invoice:', /NG-9393/.test(await page.locator('main').innerText()), '| rows:', await page.locator('table.inbox-list tbody tr[data-id]').count());
    }
    const link = (await portal.innerText()).match(/https:\/\/\S+\/p-[0-9a-f]{12}/)![0]; const pp = await ctx.newPage(); await pp.goto(link); await pp.locator('textarea').fill('Hola, soy Pixel Lab. Factura PL-9393 por USD 295,90, vence en 30 dias. Cuenta terminada en 7712.');
    t1 = Date.now(); await pp.locator('button.primary').click(); await pp.locator('a[href*="/estado/"]').waitFor({ timeout: 90000 }).catch(() => console.log('portal: no status link within 90 s'));
    console.log('portal reply after', Date.now() - t1, 'ms:', norm(await pp.locator('body').innerText()).slice(0, 400)); await pp.close();
    await page.bringToFront(); await page.goto(`${URL_}/`); await page.locator('table.inbox-list tbody tr[data-id]').first().waitFor(); await page.waitForTimeout(3000);
    const portalRows = (await page.locator('table.inbox-list tbody tr[data-id]').allInnerTexts()).map(norm).filter((x) => /Portal de proveedores/.test(x)); console.log('rows with origin «Portal de proveedores»:', portalRows.length, portalRows[0]?.slice(0, 160));
    fs.writeFileSync(`${DIR}/a93-marker.txt`, A93);
  }
  if (process.env.QA_ASK === '1') {
    const input = page.getByPlaceholder(/pregunt|Escribe/i).first().or(page.locator('textarea, input[type=text]').first()); await input.fill('¿Cuántas facturas están en PAGAR, FRENAR y ESCALAR?'); await page.getByRole('button', { name: /^(Preguntar|Enviar|Pregunta)/ }).first().click();
    await expect(page.getByText(/Respuesta generada por IA/).first()).toBeVisible({ timeout: 40000 }); const tx = norm(await page.locator('main').innerText()); const i = tx.indexOf('Respuesta generada'); console.log('question answered:', tx.slice(Math.max(0, i - 300), i + 120), '| Te quedan:', tx.match(/Te quedan \d+/)?.[0]);
  }
  // R-35 sequence
  const rows = page.locator('table.inbox-list tbody tr[data-id]'); const n = await rows.count();
  const pick = async (re: RegExp) => { for (let i = 0; i < n; i++) { const t = norm(await rows.nth(i).innerText()); if (re.test(t)) return { i, t }; } return null; };
  const lm = await pick(/Laura Méndez.*ESCALAR/); const ns = await pick(/Nube Sur.*ESCALAR/); console.log('row Laura Méndez ESCALAR:', lm?.t.slice(0, 160), '| row Nube Sur ESCALAR:', ns?.t.slice(0, 160));
  const openRow = async (i: number) => { await rows.nth(i).locator('a.dash-headline').click(); await expect(page.getByRole('heading', { name: 'Lo que hice' })).toBeVisible({ timeout: 15000 }); await page.waitForTimeout(800); };
  const leaves: string[] = [];
  // there may be two Laura Méndez ESCALAR rows: find the one whose detail mentions cuenta
  let rejected = false;
  for (let i = 0; i < n && !rejected; i++) { const t = norm(await rows.nth(i).innerText()); if (!/Laura Méndez.*ESCALAR/.test(t)) continue; await openRow(i); const body = norm(await page.locator('main').innerText()); if (/cuenta/i.test(body) && (await page.getByRole('button', { name: /Rechazar/ }).count())) { console.log('opened #15-like invoice:', body.slice(0, 220)); const tt = Date.now(); await page.getByRole('button', { name: /Rechazar/ }).first().click(); await page.waitForTimeout(300); console.log('pending state text:', norm(await page.locator('main').innerText()).match(/Enviando tu respuesta…/)?.[0]); await page.waitForTimeout(4000); const after = norm(await page.locator('main').innerText()); console.log(`after Rechazar (${Date.now() - tt} ms):`, after.slice(0, 500)); rejected = true; leaves.push('rejected'); } await page.getByRole('link', { name: /Volver a la bandeja/ }).first().click(); await page.locator('table.inbox-list tbody tr[data-id]').first().waitFor(); await page.waitForTimeout(800); }
  console.log('Laura rejected:', rejected);
  await page.reload(); await page.locator('table.inbox-list tbody tr[data-id]').first().waitFor(); await page.waitForTimeout(1500);
  const rows2 = page.locator('table.inbox-list tbody tr[data-id]'); const m = await rows2.count(); let approved = false;
  for (let i = 0; i < m; i++) { const t = norm(await rows2.nth(i).innerText()); if (!/Nube Sur/.test(t)) continue; await rows2.nth(i).locator('a.dash-headline').click(); await expect(page.getByRole('heading', { name: 'Lo que hice' })).toBeVisible({ timeout: 15000 }); await page.waitForTimeout(800); const btn = page.getByRole('button', { name: /^Aprobar/ }); if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(6000); approved = true; } const after = norm(await page.locator('main').innerText()); console.log('Nube Sur after Aprobar:', after.slice(0, 700)); console.log('timeline mentions Invitado:', /Invitado [0-9a-f]{8}/.test(after) ? after.match(/Invitado [0-9a-f]{8}/)![0] : (/Invitado/.test(after) ? 'Invitado (no id)' : 'NO'), '| ends in PAGAR:', /PAGAR/.test(after)); break; }
  console.log('Nube Sur approved clicked:', approved);
  fs.writeFileSync(`${DIR}/a93-session.json`, JSON.stringify({ sub: ses.sub, door }));
  // policy: save unchanged (to capture the UI's PUT body), then the same body with approver_email -> trial 403; then lower «Límite por pago», save, Reevaluar
  const puts: any[] = []; page.on('request', (r: any) => { if (/\/api\/policy$/.test(r.url()) && r.method() === 'PUT') puts.push(r.postData()); });
  await page.getByRole('link', { name: 'Política' }).first().click(); await page.waitForTimeout(2500);
  const ptx = norm(await page.locator('main').innerText()); console.log('Política trial note present:', /Las empresas de prueba no envían correos; las escalaciones esperan en el tablero/.test(ptx), '| approver input readonly/disabled:', await page.locator('input[type=email]').first().evaluate((e: any) => e.readOnly || e.disabled).catch(() => 'no email input'));
  const limit = page.getByLabel(/Límite por pago/).first(); const before = await limit.inputValue().catch(() => null); console.log('«Límite por pago» before:', before);
  await limit.fill(String(Math.max(1, Math.floor(Number(String(before).replace(/\./g, '').replace(',', '.')) / 2) || 1000))); await page.getByRole('button', { name: /Guardar como versión/ }).click(); await page.waitForTimeout(3500);
  console.log('after save:', norm(await page.locator('main').innerText()).match(/Versión \d+ guardada[^.]*\.?/)?.[0], '| PUT bodies seen:', puts.length);
  if (puts[0]) { const body = JSON.parse(puts[0]); const put = await fetch(`${URL_}/api/policy`, { method: 'PUT', headers: { Authorization: `Bearer ${ses.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, approver_email: 'qa-x@example.com' }) }); console.log('PUT /api/policy with approver_email ->', put.status, (await put.text()).slice(0, 200)); }
  const re = page.getByRole('button', { name: /Reevaluar/ }); console.log('Reevaluar buttons:', await re.count()); if (await re.count()) { await re.first().click(); await page.waitForTimeout(6000); console.log('after Reevaluar:', norm(await page.locator('main').innerText()).match(/(Reevaluad|reevalu)[^.]{0,160}/i)?.[0]); }
  // approval_tokens as service_role (read-only count) for this user's company
  const cid = company.id; const sr = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const at = await fetch(`${process.env.SUPABASE_URL}/rest/v1/approval_tokens?select=id&company_id=eq.${cid}`, { headers: { apikey: sr, Authorization: `Bearer ${sr}`, Prefer: 'count=exact' } }); console.log('service_role approval_tokens for this company: status', at.status, 'range', at.headers.get('content-range'), 'body', (await at.text()).slice(0, 80), '(0 rows expected for a trial)');
  // isolation: this user cannot read the demo company
  const dem = await fetch(`${process.env.SUPABASE_URL}/rest/v1/invoices?select=id&company_id=neq.${cid}&limit=3`, { headers: { apikey: process.env.SUPABASE_ANON_KEY!, Authorization: `Bearer ${ses.token}` } }); console.log('REST select of other companies rows:', dem.status, (await dem.text()).slice(0, 30));
  await ctx.close();
});
