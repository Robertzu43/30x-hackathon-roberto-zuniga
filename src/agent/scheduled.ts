// The agent works alone (D23, AC-62): every 5 minutes, with nobody logged in, it decides every company's pending invoices
// (not archived, no decision at all, R-24) through the same runAgent path. No user JWT exists here, so it uses the
// service-role client (R-23); after the cross-company pick every query names the company. No HTTP route calls this.
import type { PolicyRules } from '../engine/types';
import type { Env } from '../env';
import { adminClient } from '../lib/admin';
import { CRON_CURRENCIES, fetchChain, providers } from '../lib/fx';
import { Budget, must, SUBREQUESTS } from '../lib/supabase';
import { FIRST_INVOICE, runAgent } from './loop';
import { recorder } from './record';

const FX_CRON = '0 11 * * *'; // 06:00 Bogotá (wrangler.toml [triggers])

// The daily market rates (AC-73, R-85.7): the five currencies plus every currency pinned in a company's latest policy,
// once each through the provider chain, upserted by record.ts. Decides nothing and writes no agent_runs row.
async function fxTick(env: Env): Promise<void> {
  const budget = new Budget();
  const admin = adminClient(env, budget);
  try {
    // ponytail: every policy version (PostgREST caps it at 1000 rows); a latest-policy view past that.
    const [latest, policies] = await Promise.all([
      admin.from('fx_latest').select('currency, usd_per_unit').then(must) as Promise<Array<{ currency: string; usd_per_unit: number | string }>>,
      admin.from('policies').select('company_id, version, rules').then(must) as Promise<Array<{ company_id: string; version: number; rules: PolicyRules | null }>>,
    ]);
    const newest = new Map<string, (typeof policies)[number]>();
    for (const p of policies) if ((newest.get(p.company_id)?.version ?? 0) < p.version) newest.set(p.company_id, p);
    const pinned = [...newest.values()].flatMap((p) => Object.keys(p.rules?.fx_rates ?? {}));
    // One Yahoo call per currency: keep er-api's call and the upsert inside the invocation budget (R-56).
    const currencies = [...new Set([...CRON_CURRENCIES, ...pinned])].filter((c) => c !== 'USD');
    const fits = currencies.slice(0, budget.left() - 2);
    if (fits.length < currencies.length) console.error('fx cron: over the subrequest budget, skipped', currencies.slice(fits.length).join(','));
    const rows = await fetchChain(providers(env.FX_PROVIDER, budget.fetch), fits,
      Object.fromEntries(latest.map((r) => [r.currency, Number(r.usd_per_unit)])));
    await recorder(env, null, budget).fxRates(rows);
  } catch (e) {
    console.error('fx cron: rates not stored', e instanceof Error ? e.message : e);
  }
}

// One tick works inside the invocation budget (R-58): oldest first within a company, and companies take turns so one
// company's backlog cannot starve another. The tick row is the budget's last subrequest, so it is held back from the runs.
export async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
  if (controller.cron === FX_CRON) return fxTick(env);
  const budget = new Budget(SUBREQUESTS - 1);
  const admin = adminClient(env, budget);
  try {
    // ponytail: reads every pending row (PostgREST caps it at 1000) to list companies; a distinct-companies RPC past that.
    const pending: Array<{ company_id: string }> = must(await admin.from('invoice_current').select('company_id').is('outcome', null));
    const companies = [...new Set(pending.map((p) => p.company_id))].sort();
    const first = Math.floor(controller.scheduledTime / 300_000) % companies.length; // NaN when none: the loop never runs
    for (let i = 0; i < companies.length && budget.left() >= FIRST_INVOICE; i++) {
      const companyId = companies[(first + i) % companies.length]!;
      try {
        await runAgent({ db: admin, env, budget }, companyId, 'pending', 'cron');
      } catch (e) {
        console.error('cron: company not run', companyId, e instanceof Error ? e.message : e);
      }
    }
  } catch (e) {
    console.error('cron: pending invoices not read', e instanceof Error ? e.message : e);
  } finally {
    // One row per tick, even when nothing was pending (AC-63). Always decided null, errors 0 (R-54): members of every company
    // can read it, so no cross-company aggregate. Each company's counts live on its own runAgent row; failures outside any run are logged above.
    await recorder(env, null, budget).run('cron', null, 0);
  }
}
