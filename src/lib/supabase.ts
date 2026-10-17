// Supabase clients for the Worker. Every HTTP route reads and writes with the caller's JWT, so RLS scopes it (AC-38).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';

export type Db = SupabaseClient;

// ponytail: 40 of the Workers Free plan's 50 subrequests per invocation; the other 10 are headroom for anything uncounted
// (R-56). The one value to raise on a paid Workers plan.
export const SUBREQUESTS = 40;

// One counter per invocation (a request or a cron tick). Every Supabase request goes through its fetch; Workers AI,
// email and binding calls call count() themselves. It only counts: callers check left() before work that must not be cut.
export class Budget {
  used = 0;
  constructor(readonly limit = SUBREQUESTS) {}
  count = (n = 1) => { this.used += n; };
  left = () => this.limit - this.used;
  fetch: typeof fetch = (input, init) => { this.count(); return fetch(input, init); };
  readonly fxTried = new Set<string>(); // currencies whose FX provider chain already ran in this invocation (AC-73)
}

export const userClient = (env: Env, jwt: string, budget?: Budget): Db =>
  createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` }, fetch: budget?.fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });

// R-74: every row id is a uuid; anything else is answered as not found without asking the database.
export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// A supabase-js result's data, or its error thrown. A SQL `raise exception 'X'` arrives as message 'X' (ALREADY_DECIDED, ...).
// Without error, list queries never return null; maybeSingle() callers declare their `| null` themselves.
export function must<T>(r: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (r.error) throw new Error(r.error.message);
  return r.data as NonNullable<T>;
}
