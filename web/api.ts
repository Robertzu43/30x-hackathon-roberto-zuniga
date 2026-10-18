import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import { storedLang } from './i18n';

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

/** R-150 lever 4 (AC-107): a 5xx is asked once more, about 300 ms later, while the caller's skeleton stays. GETs only. */
export const fetchRetry = async (path: string, init?: RequestInit): Promise<Response> => {
  const res = await fetch(path, init);
  return res.status < 500 ? res : new Promise<Response>((ok) => setTimeout(() => ok(fetch(path, init)), 300));
};
const retried = (method: string, path: string) => method === 'GET' && /^\/api\/(screen\/inbox|demo\/overview)\b/.test(path);

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { data } = await (await supabase()).auth.getSession();
  const headers = new Headers();
  if (data.session) headers.set('Authorization', `Bearer ${data.session.access_token}`);
  headers.set('X-Lang', storedLang()); // R-98: the API renders the record in this tab's language
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    payload = JSON.stringify(body);
  }
  const write = method !== 'GET';
  if (write) dropCache(); // AC-100: any write from this tab; again once it settles, so a GET that left during it is not kept
  const res = await (retried(method, path) ? fetchRetry : fetch)(path, { method, headers, body: payload }).finally(() => write && dropCache());
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(json.error ?? res.statusText, res.status);
  return json as T;
}

/** Every call to the Worker API. Adds the session JWT and the tab's language (X-Lang); throws ApiError (message = the API's `error`) on non-2xx. */
export const api = {
  get: <T = unknown>(path: string) => request<T>('GET', path),
  post: <T = unknown>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T = unknown>(path: string, body?: unknown) => request<T>('PUT', path, body),
};

/** Bogota-day month, the one GET /api/screen/period defaults to. */
export const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7);
/** AC-98's one request per screen. The screens load these paths and App prefetches the same ones (AC-100). */
export const screens = {
  inbox: () => `/api/screen/inbox?lang=${storedLang()}`,
  period: (month = thisMonth()) => `/api/screen/period?month=${month}`,
  beneficiaries: () => '/api/screen/beneficiaries',
  policy: () => '/api/screen/policy',
};

// AC-100: this tab's last answer per screen GET, per language. A screen shows it at once and revalidates. Any write from this
// tab drops it all (request above, withField.send), and so does another signed-in user (App calls cacheOwner as it renders).
const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();
const prefetched = new Map<string, number>(); // R-177: key -> when a hover prefetched it; the screen's next load takes that answer, once
let era = 0; // an answer that left before a drop is never cached after it
let owner: string | undefined;
export const dropCache = () => {
  cache.clear();
  inflight.clear();
  prefetched.clear();
  era++;
};
export const cacheOwner = (uid: string | undefined) => {
  if (uid !== owner) {
    dropCache();
    company = undefined;
    handed = undefined;
  }
  owner = uid;
};
// R-135, R-141 (AC-98): GET /api/company once per signed-in user per page load, for the top bar's name; a failure is asked again.
let company: Promise<string> | undefined;
export const companyName = (): Promise<string> => {
  if (!company) {
    const mine = api.get<{ name: string }>('/api/company').then((c) => c.name);
    mine.catch(() => company === mine && (company = undefined));
    company = mine;
  }
  return company;
};
const keyOf = (path: string) => `${storedLang()} ${path}`;
// R-150 lever 2 (AC-107, AC-98): a door puts Bandeja's one request in flight as its sign-in resolves, beside the route change
// and the chunk; Bandeja's first load takes that promise instead of asking again. Tab memory only (R-122), this user only.
let handed: { key: string; answer: Promise<unknown> } | undefined;
export const startInbox = (uid: string) => {
  cacheOwner(uid);
  const path = screens.inbox();
  handed = { key: keyOf(path), answer: api.get(path) };
  handed.answer.catch(() => {}); // Bandeja shows its own error
};
export const cached = <T = unknown>(path: string) => cache.get(keyOf(path)) as T | undefined;

/** GET a screen's data. One request per path at a time, so a prefetch and the screen share it; the answer is kept for this tab. */
export function load<T>(path: string): Promise<T> {
  const key = keyOf(path);
  const at = era;
  let p = inflight.get(key) as Promise<T> | undefined;
  const used = (prefetched.get(key) ?? 0) + 10_000 > Date.now(); // a prefetch from the last 10 s is this load's request (R-177)
  prefetched.delete(key);
  if (!p && used && cache.has(key)) return Promise.resolve(cache.get(key) as T);
  if (!p) {
    const door = handed?.key === key ? (handed.answer as Promise<T>) : undefined;
    if (door) handed = undefined;
    p = (door ?? api.get<T>(path)).then((d) => {
      if (at === era) cache.set(key, d);
      return d;
    }).finally(() => at === era && inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** Hover or focus on a nav link (AC-100): fetch the screen's data unless this tab already holds it. */
export const prefetch = (path: string) => {
  if (cache.has(keyOf(path))) return;
  load(path).catch(() => {}); // the screen asks again and shows its own error
  prefetched.set(keyOf(path), Date.now());
};

type Shown<T> = { key: string; data?: T; error?: unknown };
/** A screen's one request (AC-98): the cached answer at once, then the fresh one. `reload` revalidates and resolves once shown. */
export function useScreen<T>(path: string) {
  const key = keyOf(path); // the tab language is part of it: a switch refetches the record in the new language (R-98)
  const [s, setS] = useState<Shown<T>>(() => ({ key, data: cached<T>(path) }));
  const live = useRef('');
  const reload = () => {
    setS((x) => (x.key === key && x.error !== undefined ? { key, data: x.data } : x));
    return load<T>(path).then(
      (data) => void (live.current === key && setS({ key, data })),
      (error: unknown) => void (live.current === key && setS((x) => ({ key, data: x.key === key ? x.data : undefined, error }))),
    );
  };
  useEffect(() => {
    live.current = key;
    setS((x) => (x.key === key ? x : { key, data: cached<T>(path) }));
    void reload();
    return () => {
      live.current = '';
    };
  }, [key]);
  const shown: Shown<T> = s.key === key ? s : { key, data: cached<T>(path) };
  return { data: shown.data, error: shown.error, reload };
}

/** The tab's reload, one place so tests can watch it. */
export const tab = { reload: () => window.location.reload() };
/** Whether the Worker answers now. navigator.onLine alone misses a network that drops while the browser still says online. */
export const reachable = () => fetch('/', { method: 'HEAD', cache: 'no-store' }).then((r) => r.ok, () => false);
/**
 * AC-99: a deploy removes the page chunks an open tab may still ask for; reload once to get the new index.html, never in a loop.
 * With the server out of reach a reload only lands on the browser's error page, so the page's designed message stays (AC-91 item 4).
 */
export const reloadOnce = async (reload = () => tab.reload()) => {
  if (Date.now() - Number(sessionStorage.getItem('chunk-reload')) < 10_000 || !(await reachable())) return;
  sessionStorage.setItem('chunk-reload', String(Date.now()));
  reload();
};
