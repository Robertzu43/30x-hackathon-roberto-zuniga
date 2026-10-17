// Supabase clients for the Worker. Every HTTP route reads and writes with the caller's JWT, so RLS scopes it (AC-38).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';

export type Db = SupabaseClient;

export const userClient = (env: Env, jwt: string): Db =>
  createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

// A supabase-js result's data, or its error thrown. A SQL `raise exception 'X'` arrives as message 'X' (ALREADY_DECIDED, ...).
// Without error, list queries never return null; maybeSingle() callers declare their `| null` themselves.
export function must<T>(r: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (r.error) throw new Error(r.error.message);
  return r.data as NonNullable<T>;
}
