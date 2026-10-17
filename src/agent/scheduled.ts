// The agent works alone (D23, AC-62): every 5 minutes, with nobody logged in, it decides every company's pending invoices
// (not archived, no decision at all, R-24) through the same runAgent path. No user JWT exists here, so it uses the
// service-role client (R-23); after the cross-company pick every query names the company. No HTTP route calls this.
import type { Env } from '../env';
import { adminClient } from '../lib/admin';
import { must } from '../lib/supabase';
import { runAgent } from './loop';
import { recorder } from './record';

// ponytail: fixed cap per tick, ~7 subrequests per invoice + 4 per company keeps a tick far under the Workers Paid
// limit (1000); the rest wait for the next tick. Raise it, or fan out per company, if a backlog outgrows 50 every 5 min.
export const CRON_MAX_INVOICES = 50;

export async function scheduled(_controller: ScheduledController, env: Env): Promise<void> {
  const admin = adminClient(env);
  try {
    const pending: Array<{ id: string; company_id: string }> = must(await admin.from('invoice_current').select('id, company_id')
      .is('outcome', null).order('received_at').order('id').limit(CRON_MAX_INVOICES));
    const byCompany = new Map<string, string[]>();
    for (const p of pending) byCompany.set(p.company_id, [...(byCompany.get(p.company_id) ?? []), p.id]);
    for (const [companyId, ids] of byCompany) {
      try {
        await runAgent({ db: admin, env }, companyId, ids, 'cron');
      } catch (e) {
        console.error('cron: company not run', companyId, e instanceof Error ? e.message : e);
      }
    }
  } catch (e) {
    console.error('cron: pending invoices not read', e instanceof Error ? e.message : e);
  } finally {
    // One row per tick, even when nothing was pending (AC-63). Always decided null, errors 0 (R-54): members of every company
    // can read it, so no cross-company aggregate. Each company's counts live on its own runAgent row; failures outside any run are logged above.
    await recorder(env, null).run('cron', null, 0);
  }
}
