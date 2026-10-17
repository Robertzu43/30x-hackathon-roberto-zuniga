/* global process, console, fetch, URL */ // Node script: eslint.config.js declares no Node globals
// Task 10 (AC-46, R-18, D8): the shared demo user. Run once after the migrations and the deploy, and again whenever
// anyone locked judges out by changing its password:
//   node scripts/seed-demo-user.mjs <APP_URL>
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, HEARTBEAT_EMAIL. The demo email comes from wrangler.toml [vars] only (the Worker reads the same value); no env override.
// Idempotent: find or create the user, reset its password, mark its company as the demo company, then run the agent
// through the deployed app so the demo shows decisions before anyone enters. Never deletes anything; never prints a key.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DEMO_PASSWORD = 'andina-demo-2026'; // public by design (D8); same constant as src/routes/demo.ts
const PER_PAGE = 1000;
const MAX_CALLS = 20; // R-60

// One source of truth: the DEMO_EMAIL var the Worker signs in with. Missing = stop, never guess another user.
export const demoEmailFrom = (toml) => {
  const email = toml.match(/^DEMO_EMAIL\s*=\s*"([^"]+)"/m)?.[1];
  if (!email) throw new Error('DEMO_EMAIL missing in wrangler.toml [vars]');
  return email;
};

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

export async function main({ admin, anon, fetch, appUrl, demoEmail, approverEmail, log }) {
  let user;
  for (let page = 1; !user; page++) {
    const { users } = must(await admin.auth.admin.listUsers({ page, perPage: PER_PAGE }), 'listUsers');
    user = users.find((u) => u.email?.toLowerCase() === demoEmail.toLowerCase());
    if (users.length < PER_PAGE) break;
  }
  if (!user) {
    // The signup trigger gives the new user its own company, membership and Andina seed (AC-03).
    ({ user } = must(await admin.auth.admin.createUser({ email: demoEmail, password: DEMO_PASSWORD, email_confirm: true, user_metadata: { lang: 'es' } }), 'createUser'));
    log(`created ${demoEmail}`);
  }
  must(await admin.auth.admin.updateUserById(user.id, { password: DEMO_PASSWORD }), 'updateUserById'); // R-18
  const { company_id } = must(await admin.from('company_members').select('company_id').eq('user_id', user.id).single(), 'company_members');
  // Service role: members cannot write is_demo or any column of the demo row (R-15, R-31); this script is its writer.
  // AC-86: the demo's vendor portal is .../andina-labs; every other company keeps its random p-<12 hex> slug.
  must(await admin.from('companies').update({ is_demo: true, approver_email: approverEmail, name: 'Andina Labs Inc.', portal_slug: 'andina-labs' }).eq('id', company_id), 'companies');
  const { session } = must(await anon.auth.signInWithPassword({ email: demoEmail, password: DEMO_PASSWORD }), 'demo sign-in');
  // The same call loop as the browser (R-60): each call decides what fits; go on with its cursor until it is null, it
  // makes no progress, or 20 calls. Only a non-2xx fails the script.
  const counts = { PAGAR: 0, FRENAR: 0, ESCALAR: 0, errors: 0 };
  let cursor = null;
  for (let call = 0; call < MAX_CALLS; call++) {
    const res = await fetch(`${appUrl}/api/invoices/run`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cursor ? { cursor } : {}),
    });
    if (!res.ok) throw new Error(`POST /api/invoices/run answered ${res.status}`);
    const out = await res.json();
    for (const k of Object.keys(counts)) counts[k] += out[k] ?? 0;
    if (!out.cursor || out.cursor === cursor) break;
    cursor = out.cursor;
  }
  log(`demo company ${company_id} ready: ${JSON.stringify(counts)}`);
  return counts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const appUrl = process.argv[2]?.replace(/\/$/, '');
  const env = process.env;
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'HEARTBEAT_EMAIL'].filter((k) => !env[k]);
  if (!appUrl || missing.length) {
    console.error(`usage: node scripts/seed-demo-user.mjs <APP_URL>${missing.length ? `; missing env: ${missing.join(', ')}` : ''}`);
    process.exit(1);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  try {
    await main({
      admin: createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, opts),
      anon: createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, opts),
      fetch, appUrl, demoEmail: demoEmailFrom(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')), approverEmail: env.HEARTBEAT_EMAIL, log: console.log,
    });
  } catch (e) { console.error(`seed-demo-user: ${e.message}`); process.exit(1); }
}
