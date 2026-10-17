// Every /api route except approval-by-token runs behind requireUser (AC-38): the JWT is verified by Supabase Auth and the
// company comes from the user's own membership, read under RLS. That company is what record.ts is authorised for.
import type { User } from '@supabase/supabase-js';
import { createMiddleware } from 'hono/factory';
import type { Env } from '../env';
import type { Lang } from '../i18n';
import { Budget, must, userClient, type Db } from './supabase';

export type AppEnv = { Bindings: Env; Variables: { user: User; companyId: string; lang: Lang; db: Db; budget: Budget } };

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const deny = () => c.json({ error: 'No autorizado' }, 401);
  const jwt = /^Bearer (\S+)$/.exec(c.req.header('Authorization') ?? '')?.[1];
  if (!jwt) return deny();
  const budget = new Budget(); // the request's subrequest counter, from its first Supabase call (R-56)
  const db = userClient(c.env, jwt, budget);
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user) return deny();
  const member: { company_id: string } | null =
    must(await db.from('company_members').select('company_id').eq('user_id', data.user.id).order('company_id').limit(1).maybeSingle());
  if (!member) return deny();
  c.set('user', data.user);
  c.set('companyId', member.company_id);
  // R-98: the tab's language (X-Lang, sent by web/api.ts) first, then the user's stored one, then Spanish.
  const asked = c.req.header('X-Lang');
  c.set('lang', asked === 'es' || asked === 'en' ? asked : data.user.user_metadata?.lang === 'en' ? 'en' : 'es');
  c.set('db', db);
  c.set('budget', budget);
  await next();
});
