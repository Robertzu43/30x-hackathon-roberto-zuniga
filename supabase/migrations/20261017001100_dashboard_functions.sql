-- Task 45 (D39; AC-101, AC-103, AC-104, AC-98, R-124, R-132). Additive: create or replace of two 001000 functions with the
-- same signatures and grants, plus one new function. Still security invoker, stable, read-only, executable by authenticated
-- only. The rows feed src/routes/screen.ts, which computes R-124's numbers once (dashboardOf, chartsOf, beneficiaryOf) with
-- the same AC-19 name rule and AC-44 figures as Periodo, so a screen never disagrees with another.

-- Periodo: 001000's five reads; each decision now carries created_at, the day of AC-103's autonomy trend.
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
                           'checks', d.checks, 'created_at', d.created_at) order by d.seq) from public.decisions d where d.company_id = c.id), '[]'))
  end from (select public.screen_company() as id) c
$$;

-- Bandeja: 001000's keys unchanged (beneficiaries stays top level, R-132), plus Periodo's rows for AC-101's dashboard.
create or replace function public.screen_inbox(p_lang text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select case when c.id is not null then jsonb_build_object(
    'invoices', coalesce((select jsonb_agg(to_jsonb(v) || jsonb_build_object('headline', case when p_lang = 'en' then v.headline_en else v.headline_es end)
                          order by v.received_at desc)
                          from public.invoice_current v where v.company_id = c.id), '[]'),
    'last_run', (select jsonb_build_object('at', r.created_at, 'trigger', r.trigger, 'via', r.via) from (
                   (select * from public.agent_runs x where x.company_id = c.id order by x.created_at desc limit 1)
                   union all
                   (select * from public.agent_runs x where x.company_id is null order by x.created_at desc limit 1)) r
                 order by r.created_at desc limit 1),
    'portal_slug', (select co.portal_slug from public.companies co where co.id = c.id),
    'beneficiaries', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name) from public.beneficiaries b
                               where b.company_id = c.id and not b.archived), '[]'),
    'period', public.screen_period())
  end from (select public.screen_company() as id) c
$$;

-- Beneficiarios profile (AC-104): one non-archived directory row of the caller's company and Periodo's rows to match its
-- invoices; null for another company's, an archived or an unknown id.
create function public.screen_beneficiary(p_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('beneficiary', to_jsonb(b), 'period', public.screen_period())
  from public.beneficiaries b where b.id = p_id and b.company_id = public.screen_company() and not b.archived
$$;

revoke execute on function public.screen_beneficiary(uuid) from public, anon, service_role;
grant execute on function public.screen_beneficiary(uuid) to authenticated;
