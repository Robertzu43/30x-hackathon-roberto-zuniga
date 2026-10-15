import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Env } from '../app'

export const adminClient = (env: Env): SupabaseClient =>
  createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
