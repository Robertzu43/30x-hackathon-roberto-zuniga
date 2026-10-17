import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type Config = { supabaseUrl: string; supabaseAnonKey: string; demo_email: string };

// Cached once loaded; a failed load is forgotten so the next call retries.
let cfg: Promise<Config> | undefined;
export const config = (): Promise<Config> =>
  (cfg ??= fetch('/api/config')
    .then((r) => {
      if (!r.ok) throw new Error(`config ${r.status}`);
      return r.json() as Promise<Config>;
    })
    .catch((e) => {
      cfg = undefined;
      throw e;
    }));

let client: Promise<SupabaseClient> | undefined;
export const supabase = (): Promise<SupabaseClient> =>
  (client ??= config().then((c) => createClient(c.supabaseUrl, c.supabaseAnonKey)).catch((e) => {
    client = undefined;
    throw e;
  }));

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { data } = await (await supabase()).auth.getSession();
  const headers = new Headers();
  if (data.session) headers.set('Authorization', `Bearer ${data.session.access_token}`);
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    payload = JSON.stringify(body);
  }
  const res = await fetch(path, { method, headers, body: payload });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(json.error ?? res.statusText, res.status);
  return json as T;
}

/** Every call to the Worker API. Adds the session JWT; throws ApiError (message = the API's `error`) on non-2xx. */
export const api = {
  get: <T = unknown>(path: string) => request<T>('GET', path),
  post: <T = unknown>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T = unknown>(path: string, body?: unknown) => request<T>('PUT', path, body),
};
