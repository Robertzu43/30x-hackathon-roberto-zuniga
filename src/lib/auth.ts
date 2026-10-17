// Every /api route except approval-by-token runs behind requireUser (AC-38): a verified JWT, then the company from the
// user's own membership, read under RLS. That company is what record.ts is authorised for. The screen routes (AC-98) use
// requireAuth: the JWT only, because their one database function finds the company from auth.uid() itself.
import type { User } from '@supabase/supabase-js';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Env } from '../env';
import type { Lang } from '../i18n';
import { Budget, must, userClient, type Db } from './supabase';

export type AuthUser = Pick<User, 'id' | 'email' | 'is_anonymous' | 'user_metadata'>;
type Vars = { user: AuthUser; lang: Lang; db: Db; budget: Budget };
export type AuthEnv = { Bindings: Env; Variables: Vars };
export type AppEnv = { Bindings: Env; Variables: Vars & { companyId: string } };

// R-122: the project signs ES256 and publishes its keys, so the Worker checks signature, exp, aud and iss itself (no
// /auth/v1/user round trip). Accepted cost: a token stays valid until it expires (at most 1 h) after sign-out.
// The JWKS is cached per isolate for 10 minutes; an unknown kid refetches it at most once a minute (key rotation).
let jwks: { at: number; keys: Array<JsonWebKey & { kid?: string }> } | undefined;
async function signingKey(env: Env, kid: string, budget: Budget) {
  const find = () => jwks?.keys.find((k) => k.kid === kid);
  const age = jwks ? Date.now() - jwks.at : Infinity;
  if (age > 600_000 || (!find() && age > 60_000)) {
    const res = await budget.fetch(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
    if (!res.ok) throw new Error(`jwks: ${res.status}`);
    jwks = { at: Date.now(), keys: ((await res.json()) as { keys: NonNullable<typeof jwks>['keys'] }).keys };
  }
  const jwk = find();
  return jwk && crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

const bytes = (b64url: string) => Uint8Array.from(atob(b64url.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));
const part = (b64url: string): Record<string, unknown> | null => {
  try { return JSON.parse(new TextDecoder().decode(bytes(b64url))) as Record<string, unknown>; } catch { return null; }
};

// The token's user, or null. A token not signed ES256 with a kid (a legacy HS256 one) is left to Supabase Auth.
async function verify(env: Env, jwt: string, db: Db, budget: Budget): Promise<AuthUser | null> {
  const [h = '', p = '', s = ''] = jwt.split('.');
  const header = part(h);
  if (header?.alg !== 'ES256' || typeof header.kid !== 'string') {
    const { data, error } = await db.auth.getUser(jwt);
    return error || !data.user ? null : data.user;
  }
  const key = await signingKey(env, header.kid, budget);
  const claims = part(p);
  const signed = !!key && !!claims && await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes(s), new TextEncoder().encode(`${h}.${p}`))
    .catch(() => false);
  if (!signed || claims.aud !== 'authenticated' || claims.iss !== `${env.SUPABASE_URL}/auth/v1` || typeof claims.sub !== 'string'
    || !(typeof claims.exp === 'number' && claims.exp * 1000 > Date.now())) return null;
  return { id: claims.sub, email: claims.email as string | undefined, is_anonymous: claims.is_anonymous === true,
    user_metadata: (claims.user_metadata ?? {}) as AuthUser['user_metadata'] };
}

// Sets user, lang, db and budget; false when the request carries no valid token.
async function authenticate(c: Context<AuthEnv>) {
  const jwt = /^Bearer (\S+)$/.exec(c.req.header('Authorization') ?? '')?.[1];
  if (!jwt) return false;
  const budget = new Budget(); // the request's subrequest counter, from its first Supabase call (R-56)
  const db = userClient(c.env, jwt, budget);
  const user = await verify(c.env, jwt, db, budget);
  if (!user) return false;
  c.set('user', user);
  // R-98: the tab's language (X-Lang, sent by web/api.ts) first, then the user's stored one, then Spanish.
  const asked = c.req.header('X-Lang');
  c.set('lang', asked === 'es' || asked === 'en' ? asked : user.user_metadata?.lang === 'en' ? 'en' : 'es');
  c.set('db', db);
  c.set('budget', budget);
  return true;
}

const deny = (c: Context) => c.json({ error: 'No autorizado' }, 401);

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  if (!(await authenticate(c))) return deny(c);
  await next();
});

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!(await authenticate(c as unknown as Context<AuthEnv>))) return deny(c);
  const member: { company_id: string } | null = must(await c.var.db.from('company_members').select('company_id')
    .eq('user_id', c.var.user.id).order('company_id').limit(1).maybeSingle());
  if (!member) return deny(c);
  c.set('companyId', member.company_id);
  await next();
});
