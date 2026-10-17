/* global process, console */ // Node script: eslint.config.js declares no Node globals
// AC-95, R-118: the one live probe of «Guardar mi acceso», run once by the orchestrator after deploy E1 (never by a test):
//   node scripts/probe-save-access.mjs
// Env: SUPABASE_URL, SUPABASE_ANON_KEY. Signs in one throwaway anonymous user (the trigger gives it a trial company; nothing
// deletes either, CLAUDE.md), attaches qa-probe-<random>@example.com and a random password with updateUser, then reads the
// user back. PASS (exit 0): email_confirmed_at set and is_anonymous false. FALLBACK (exit 1): R-118's POST /api/account/save
// is needed. Prints the user id, the email and the two fields; never the password or a token.
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function probe({ anon, random = () => randomBytes(6).toString('hex'), log }) {
  const must = ({ data, error }, step) => { if (error) throw new Error(`${step}: ${error.message}`); return data; };
  must(await anon.auth.signInAnonymously(), 'signInAnonymously');
  const email = `qa-probe-${random()}@example.com`;
  must(await anon.auth.updateUser({ email, password: `${random()}-${random()}` }), 'updateUser');
  const { user } = must(await anon.auth.getUser(), 'getUser');
  const confirmed = user.email === email && !!user.email_confirmed_at && user.is_anonymous === false;
  log(`probe: user ${user.id} email ${user.email || '(none)'} new_email ${user.new_email ?? null}`);
  log(`email_confirmed_at ${user.email_confirmed_at ?? null}`);
  log(`is_anonymous ${user.is_anonymous ?? null}`);
  log(confirmed ? 'PASS: updateUser attached a confirmed email at once (AC-95)' : 'FALLBACK: the email is not confirmed at once; R-118 applies (POST /api/account/save)');
  return confirmed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'].filter((k) => !env[k]);
  if (missing.length) { console.error(`usage: node scripts/probe-save-access.mjs; missing env: ${missing.join(', ')}`); process.exit(2); }
  const { createClient } = await import('@supabase/supabase-js');
  const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    process.exit((await probe({ anon, log: console.log })) ? 0 : 1);
  } catch (e) { console.error(`probe-save-access: ${e.message}`); process.exit(2); }
}
