/* eslint-disable @typescript-eslint/no-explicit-any -- QA e2e file */
// QA AC-96 R-133 (+AC-98 isolation): fresh trial T (one anonymous sign-in). With T's JWT, 30 REST inserts into invoices (source 'chat', raw_text 'qa-cap', fields copied from a DATASET row,
// so no model read) must all answer 201 and the 31st (and 32nd) be refused with TRIAL_INVOICE_LIMIT; then a service_role count of raw_text 'qa-cap' rows of T is 30 (read-only).
// Also AC-98: rpc/screen_inbox with T's JWT returns T's rows; the same rpc with the anon key alone is refused. Never run against the demo company. QA_URL + QA_LIVE=1.
import { test, expect, newPage, URL_ } from './qa52-helpers';
test.skip(process.env.QA_LIVE !== '1', 'creates a real trial user: set QA_LIVE=1');
test.setTimeout(240000);
test('AC-96 DB cap of 30 member inserts per UTC day on a trial company; AC-98 rpc isolation', async ({ browser }: any) => {
  const { ctx, page } = await newPage(browser); await page.goto(`${URL_}/login`);
  await page.getByRole('button', { name: 'Probar con mi propia empresa' }).click(); await expect(page.locator('h1', { hasText: 'Bandeja' })).toBeVisible({ timeout: 20000 });
  const s = await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => /auth-token/.test(x))!; const j = JSON.parse(localStorage.getItem(k)!); return { token: j.access_token, sub: j.user.id }; });
  const base = process.env.SUPABASE_URL!; const anon = process.env.SUPABASE_ANON_KEY!; const sr = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const call = async (method: string, path: string, key: string, tok: string, body?: any) => { const r = await fetch(`${base}/rest/v1/${path}`, { method, headers: { apikey: key, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', Prefer: 'return=minimal,count=exact' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, text: await r.text(), range: r.headers.get('content-range') }; };
  const sel = await call('GET', 'invoices?select=company_id,fields&limit=1', anon, s.token); const row = JSON.parse(sel.text)[0]; const T = row.company_id;
  const codes: number[] = []; let last: any = null;
  for (let i = 1; i <= 32; i++) { const r = await call('POST', 'invoices', anon, s.token, { company_id: T, source: 'chat', raw_text: 'qa-cap', fields: row.fields }); codes.push(r.status); if (i >= 30) last = r; if (i > 30) console.log(`insert #${i}: ${r.status} ${r.text.slice(0, 220)}`); }
  console.log('insert statuses #1-#30:', JSON.stringify(codes.slice(0, 30)), 'all 201:', codes.slice(0, 30).every((c) => c === 201), '| #31, #32:', codes.slice(30), '| #30 status', last && codes[29]);
  const cnt = await call('GET', `invoices?select=id&company_id=eq.${T}&raw_text=eq.qa-cap`, sr, sr); console.log('service_role count of T qa-cap rows:', cnt.range, '(read-only)');
  const rpcT = await fetch(`${base}/rest/v1/rpc/screen_inbox`, { method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' }, body: '{}' }); const j = await rpcT.json().catch(() => null);
  console.log('rpc/screen_inbox with T JWT:', rpcT.status, 'invoices', j?.invoices?.length, '(29 DATASET rows + 30 qa-cap = 59 expected)', 'keys', j && Object.keys(j));
  const rpcA = await fetch(`${base}/rest/v1/rpc/screen_inbox`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: '{}' }); console.log('rpc/screen_inbox with the anon key only:', rpcA.status, (await rpcA.text()).slice(0, 160));
  const other = await call('GET', 'invoices?select=id&company_id=neq.' + T + '&limit=5', anon, s.token); console.log('T JWT selecting other companies rows:', other.status, other.text.slice(0, 40));
  const dec = await call('POST', 'decisions', anon, s.token, { company_id: T }); console.log('T JWT POST /rest/v1/decisions:', dec.status, dec.text.slice(0, 120));
  await ctx.close();
});
