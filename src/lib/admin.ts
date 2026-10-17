// The only place the service-role client is built (AC-38). It bypasses RLS, so exactly three modules may import it:
// src/routes/approvals.ts (approval by token), src/agent/scheduled.ts (the cron, R-23) and src/agent/record.ts (R-32).
import { createClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import type { Budget, Db } from './supabase';

export const adminClient = (env: Env, budget?: Budget): Db =>
  createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { global: { fetch: budget?.fetch }, auth: { persistSession: false, autoRefreshToken: false } });
