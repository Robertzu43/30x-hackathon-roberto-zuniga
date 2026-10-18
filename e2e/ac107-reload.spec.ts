/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA AC-107: «A reload in the same tab while the pass runs resumes it». A fresh Admin-API user (no mail, never deleted) signs in through the password door; the tab is reloaded
// QA_RELOAD_AT ms after landing; we record whether «Decidiendo… n de m» comes back and whether every row is decided afterwards (no further input). QA_URL + QA_LIVE=1.
import { test, expect, newPage, URL_ } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'creates real users: set QA_LIVE=1');
test.setTimeout(300000);
const AT = (process.env.QA_RELOAD_AT || '3000,8000').split(',').map(Number);
async function mkUser() {
  const email = `qa-r202610162341-52x-rl${Math.random().toString(36).slice(2, 9)}@example.com`; const password = 'Qa-' + Math.random().toString(36).slice(2, 10) + 'Z9x';
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
  if (!r.ok) throw new Error('admin create ' + r.status); return { email, password };
}
for (const at of AT) test(`AC-107 reload ${at} ms after landing resumes the pass`, async ({ browser }: any) => {
  const { ctx, page } = await newPage(browser); const u = await mkUser(); const posts: string[] = [];
  page.on('request', (r: any) => { if (/\/api\/invoices\/run/.test(r.url()) && r.method() === 'POST') posts.push(`+${Date.now() - T0}`); });
  let T0 = Date.now();
  await page.goto(`${URL_}/login`); await page.getByRole('button', { name: 'Entrar con contraseña' }).click(); await page.getByLabel('Correo').fill(u.email); await page.getByLabel('Contraseña').fill(u.password);
  T0 = Date.now(); await page.getByRole('button', { name: 'Entrar', exact: true }).click(); await expect(page.locator('h1', { hasText: 'Bandeja' })).toBeVisible({ timeout: 20000 });
  const chips = () => page.evaluate(() => ({ pending: document.querySelectorAll('.chip-pending').length, rows: document.querySelectorAll('table.inbox-list tbody tr[data-id]').length, prog: (document.body.innerText.match(/(Decidiendo|Deciding)[^\n]*/) || [null])[0] }));
  await page.waitForTimeout(at); const before = await chips(); const tR = Date.now() - T0; await page.reload();
  await expect(page.locator('h1', { hasText: 'Bandeja' })).toBeVisible({ timeout: 20000 }); await page.waitForTimeout(2500); const after = await chips();
  console.log(`reload at +${tR} ms: before ${JSON.stringify(before)}; 2.5 s after reload ${JSON.stringify(after)}; run POSTs so far ${JSON.stringify(posts)}`);
  const t1 = Date.now(); let done = false; while (Date.now() - t1 < 60000) { const c = await chips(); if (c.rows > 0 && c.pending === 0 && !c.prog) { done = true; break; } await page.waitForTimeout(1000); }
  const fin = await chips(); console.log(`after reload: all decided without input within 60 s: ${done} (${Math.round((Date.now() - t1) / 1000)} s); final ${JSON.stringify(fin)}; run POSTs ${JSON.stringify(posts)}`);
  expect(done).toBe(true);
  await ctx.close();
});
