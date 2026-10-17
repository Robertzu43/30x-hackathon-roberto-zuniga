// The subrequest counter (R-56, AC-70): the real supabase-js clients send every request through Budget.fetch.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { Budget, SUBREQUESTS, userClient } from './supabase';

const env = { SUPABASE_URL: 'https://sb.test', SUPABASE_ANON_KEY: 'anon' } as Env;
afterEach(() => { vi.unstubAllGlobals(); });

describe('Budget (R-56)', () => {
  it('is 40 of the Free plan\'s 50 subrequests by default', () => {
    expect(SUBREQUESTS).toBe(40);
    expect(new Budget().left()).toBe(40);
  });

  it('counts every request of a user client built with it, plus explicit counts', async () => {
    const net = vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', net);
    const budget = new Budget();
    const db = userClient(env, 'jwt', budget);
    await db.from('invoices').select('id');
    await db.rpc('period_state', {});
    budget.count(); // a Workers AI or email call
    expect(net).toHaveBeenCalledTimes(2);
    expect(budget.used).toBe(3);
    expect(budget.left()).toBe(37);
  });

  it('the service-role client sends its requests through the same counter', async () => {
    vi.resetModules();
    vi.doMock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => args }));
    const { adminClient } = await import('./admin'); // no key needed: createClient is a stub that returns its arguments
    const budget = new Budget();
    const [, , options] = adminClient({} as Env, budget) as unknown as [string, string, { global: { fetch: unknown } }];
    expect(options.global.fetch).toBe(budget.fetch);
    vi.doUnmock('@supabase/supabase-js');
  });

  it('a client built without a budget counts nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const budget = new Budget();
    await userClient(env, 'jwt').from('invoices').select('id');
    expect(budget.used).toBe(0);
  });
});
