// The agent works alone (D23, AC-62): every 5 minutes, with nobody logged in, it decides every company's pending invoices
// (not archived, no decision at all, R-24) through the same runAgent path. No user JWT exists here, so it uses the
// service-role client (R-23); after the cross-company pick every query names the company. No HTTP route calls this.
import type { Env } from '../env';
import { adminClient } from '../lib/admin';
import { Budget, must, SUBREQUESTS } from '../lib/supabase';
import { FIRST_INVOICE, runAgent } from './loop';
import { recorder } from './record';

// One tick works inside the invocation budget (R-58): oldest first within a company, and companies take turns so one
// company's backlog cannot starve another. The tick row is the budget's last subrequest, so it is held back from the runs.
export async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
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
