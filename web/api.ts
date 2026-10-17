import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: Promise<SupabaseClient> | undefined;
export const supabase = (): Promise<SupabaseClient> =>
  (client ??= fetch('/api/config')
    .then((r) => r.json() as Promise<{ supabaseUrl: string; supabaseAnonKey: string }>)
    .then((c) => createClient(c.supabaseUrl, c.supabaseAnonKey))
    .catch((e) => {
      client = undefined;
      throw e;
    }));

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await (await supabase()).auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set('Authorization', `Bearer ${data.session.access_token}`);
  const res = await fetch(path, { ...init, headers });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body as T;
}
