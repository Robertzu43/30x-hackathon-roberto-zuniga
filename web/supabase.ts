import { createClient } from '@supabase/supabase-js'

// Fallback keeps the module importable in unit tests, where vite's define does not run.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || 'http://localhost',
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'anon',
)

// fetch /api/* with the session token; throws {status, message} on non-2xx.
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const res = await fetch('/api' + path, {
    method: init.method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${data.session?.access_token ?? ''}`,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const json = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw Object.assign(new Error(json.error ?? 'Error'), { status: res.status })
  return json as T
}
