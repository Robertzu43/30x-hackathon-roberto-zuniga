// Shared web test helpers (Tasks 11-16). Supabase auth is faked in ./supabase; HTTP goes through mockApi.
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthProvider } from '../auth';
import { LangProvider } from '../i18n';

export { fakeAuth, signedInAs } from './supabase';
export const DEMO_EMAIL = 'demo@andina-labs.example';

type Reply = unknown | ((init: RequestInit) => unknown);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Stubs global fetch. Keys are "METHOD /path?query", e.g. 'GET /api/invoices'. A value is the JSON body,
 * a Response (for error statuses), or a function of the RequestInit returning either. GET /api/config is
 * always answered; anything unmocked answers 404. Returns the fetch mock for call assertions.
 */
export function mockApi(routes: Record<string, Reply> = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const key = `${init.method ?? 'GET'} ${url.pathname}${url.search}`;
    if (key === 'GET /api/config') return json({ supabaseUrl: 'http://supabase.test', supabaseAnonKey: 'anon', demo_email: DEMO_EMAIL });
    if (!(key in routes)) return json({ error: `no mock for ${key}` }, 404);
    const r = routes[key];
    const v = typeof r === 'function' ? await (r as (i: RequestInit) => unknown)(init) : r;
    return v instanceof Response ? v : json(v);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * Renders `ui` inside the app providers at URL `at`. Pass `route` (a pattern like '/invoices/:id')
 * when the component reads useParams.
 */
export function renderAt(ui: ReactNode, { at = '/', route }: { at?: string; route?: string } = {}) {
  return render(
    <LangProvider>
      <MemoryRouter initialEntries={[at]}>
        <AuthProvider>{route ? <Routes><Route path={route} element={ui} /></Routes> : ui}</AuthProvider>
      </MemoryRouter>
    </LangProvider>,
  );
}
