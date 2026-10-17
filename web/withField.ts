// api.put/post keep only the 400's `error`; forms also need its `field` to mark the input (R-31, AC-30, AC-33).
// ponytail: delete this file once ApiError in api.ts carries `field`.
import { ApiError, supabase } from './api';
import { storedLang } from './i18n';

export class FieldError extends ApiError {
  field?: string;
}

export async function send<T>(method: 'POST' | 'PUT', path: string, body: unknown): Promise<T> {
  const { data } = await (await supabase()).auth.getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Lang': storedLang() }; // R-98
  if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  const res = await fetch(path, { method, headers, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: string; field?: string };
  if (!res.ok) throw Object.assign(new FieldError(json.error ?? res.statusText, res.status), { field: json.field });
  return json as T;
}

/** An error as the forms show it: the text, and the input to mark when the API named one. */
export const failure = (e: unknown): { text: string; field?: string } => ({
  text: e instanceof Error ? e.message : String(e),
  field: e instanceof FieldError ? e.field : undefined,
});
