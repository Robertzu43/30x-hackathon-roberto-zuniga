-- R-150 (Task 52d; AC-97 target 3, AC-98, AC-103, AC-104, AC-44): screen_period carried every decision the company ever had,
-- with its checks: 2.1 MB for the demo company (880 decisions, 849 of them of invoices archived by resets), and so did
-- screen_beneficiary and screen_demo_overview, which embed it. Same signatures and keys, security invoker (RLS), stable,
-- grants kept by create or replace. Periodo's rows are now Bandeja's trimmed ones (migration 20261018000100): only
-- non-archived invoices' decisions (every figure but one reads only those), checks only where the invoice has no stored
-- fields (recordedFields' fallback). The one figure over every decision, «Decisiones explicadas», is counted here instead:
-- `explained` { n, m }, which periodOf reads (src/routes/screen.ts). screen_beneficiary calls this function and is unchanged.
create or replace function public.screen_period() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select case when c.id is not null then jsonb_build_object(
    'current', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'received_at', v.received_at, 'fields', v.fields, 'outcome', v.outcome,
                         'amount_usd', v.amount_usd) order by v.received_at, v.id)
                         from public.invoice_current v where v.company_id = c.id), '[]'),
    'directory', coalesce((select jsonb_agg(to_jsonb(b)) from public.beneficiaries b where b.company_id = c.id and not b.archived), '[]'),
    'policy', (select jsonb_build_object('version', p.version, 'rules', p.rules) from public.policies p where p.company_id = c.id
               order by p.version desc limit 1),
    'seeded', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'expected_outcome', i.expected_outcome)) from public.invoices i
                        where i.company_id = c.id and not i.archived and i.expected_outcome is not null), '[]'),
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('invoice_id', d.invoice_id, 'seq', d.seq, 'outcome', d.outcome, 'actor', d.actor,
                           'checks', case when i.fields is null then d.checks end, 'created_at', d.created_at) order by d.seq)
                           from public.decisions d join public.invoices i on i.id = d.invoice_id
                           where d.company_id = c.id and not i.archived), '[]'),
    'explained', (select jsonb_build_object('n', count(*) filter (where jsonb_typeof(d.checks) = 'array' and jsonb_array_length(d.checks) > 0),
                  'm', count(*)) from public.decisions d where d.company_id = c.id))
  end from (select public.screen_company() as id) c
$$;

-- The public demo overview (AC-45): the rows /demo draws (web/pages/Demo.tsx: id, outcome, both headlines, for the page's
-- own language) instead of screen_inbox's whole answer, which also rebuilt Periodo's rows only to drop them.
create or replace function public.screen_demo_overview(p_lang text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'outcome', v.outcome, 'headline_es', v.headline_es,
                          'headline_en', v.headline_en) order by v.received_at desc)
                          from public.invoice_current v where v.company_id = co.id), '[]'),
    'period', public.screen_period())
  from public.companies co where co.id = public.screen_company() and co.is_demo
$$;
