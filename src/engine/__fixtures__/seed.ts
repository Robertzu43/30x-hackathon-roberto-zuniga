/// <reference types="vite/client" />
// Test-only: the confidence the seed SQL stores (andina_seed), so every seed replay reads what the database holds (R-71).
// The current seed is the one migration 000600 installs (AC-75); 000300's older data set stays for tests written on it.
import sql from '../../../supabase/migrations/20261017000600_fx_rates.sql?raw';
import type { MarketRates } from '../types';

export const SEED = JSON.parse(sql.match(/\$seed\$([\s\S]*?)\$seed\$/)?.[1] ?? 'null');
export const FULL_CONFIDENCE: Record<string, number> =
  JSON.parse(/else '(\{"payee_name"[\s\S]*?\})'::jsonb/.exec(sql)?.[1] ?? 'null');
// The illegible row (no amount) has no confidence at all; every other row has all eight entries.
export const seedConfidence = (f: { amount?: unknown }) => (f.amount == null ? {} : FULL_CONFIDENCE);

// The market rates fetched on 17 Oct 2026 (Yahoo Finance; src/lib/__fixtures__/fx/yahoo-*.json), as stored: USD per
// unit, 8 significant digits (AC-73, AC-75). The seed is designed around them, robust within ±20 % (R-86).
export const FX_DAY = '2026-10-17';
export const FIXTURE_RATES: Record<string, number> = { COP: 0.00031538976, MXN: 0.054115482, BRL: 0.19726589, ARS: 0.00065897858, EUR: 1.1242271 };
// The stored rates as the engine reads them, fetched at `now`, each scaled by its factor (1 when absent).
export const marketAt = (now: string, scale: Record<string, number> = {}): MarketRates => Object.fromEntries(Object.entries(FIXTURE_RATES)
  .map(([currency, r]) => [currency, { currency, usd_per_unit: r * (scale[currency] ?? 1), source: 'Yahoo Finance', fetched_at: now }]));
// The 32 corners of the ±20 % box: each of the five currencies at ×0.8 or ×1.2 (R-86).
export const CORNERS: Array<Record<string, number>> = Array.from({ length: 32 }, (_, n) =>
  Object.fromEntries(Object.keys(FIXTURE_RATES).map((c, i) => [c, (n >> i) & 1 ? 1.2 : 0.8])));
