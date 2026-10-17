/// <reference types="vite/client" />
// Test-only: the confidence the seed SQL stores (andina_seed), so every seed replay reads what the database holds (R-71).
import sql from '../../../supabase/migrations/20261017000300_seed_andina.sql?raw';

export const FULL_CONFIDENCE: Record<string, number> =
  JSON.parse(/else '(\{"payee_name"[\s\S]*?\})'::jsonb/.exec(sql)?.[1] ?? 'null');
// The illegible row (no amount) has no confidence at all; every other row has all eight entries.
export const seedConfidence = (f: { amount?: unknown }) => (f.amount == null ? {} : FULL_CONFIDENCE);
