// GET /api/portal-link (AC-86): the member's own company's portal URL, read with the user's JWT (AC-38).
import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../agent/__fixtures__/fake-db';
import type { Env } from '../env';

const db = Object.assign(fakeDb({
  company_members: [{ company_id: 'A', user_id: 'user-a' }],
  companies: [{ id: 'A', name: 'Andina Labs Inc.', portal_slug: 'andina-labs' }, { id: 'B', name: 'Otra', portal_slug: 'p-0123456789ab' }],
}), { auth: { getUser: async (jwt: string) => (jwt === 'tok-a' ? { data: { user: { id: 'user-a', user_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } }) } });
const jwts: string[] = [];
vi.mock('../lib/supabase', async (orig) => ({ ...(await orig<typeof import('../lib/supabase')>()), userClient: (_e: Env, jwt: string) => { jwts.push(jwt); return db; } }));
const { app } = await import('../index');

const env = { PORTAL_URL: 'https://facturas.test' } as Env;
const get = (jwt?: string) => app.request('/api/portal-link', { headers: jwt ? { Authorization: `Bearer ${jwt}` } : {} }, env);

describe('GET /api/portal-link (AC-86)', () => {
  it("answers the member's company portal URL and no email address while email intake is off", async () => {
    const res = await get('tok-a');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ portal_url: 'https://facturas.test/andina-labs', email_address: null });
    expect(jwts.every((j) => j === 'tok-a')).toBe(true); // the user's client only, never the service role
    expect(db.queries.at(-1)).toEqual({ table: 'companies', op: 'select', eq: { id: 'A' } });
  });

  it('refuses without a valid JWT', async () => {
    expect((await get()).status).toBe(401);
    expect((await get('tok-x')).status).toBe(401);
  });
});
