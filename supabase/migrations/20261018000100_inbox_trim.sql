-- R-150 lever 1 (Task 52c, AC-107, AC-98): Bandeja's one RPC carried every decision the company ever had, with its checks:
-- 2.2 MB for the demo company (878 decisions, 776 distinct invoices, most archived by resets), over the authenticated
-- statement timeout under concurrent load (QA E5a's 500s: "canceling statement due to statement timeout").
-- Same signature, same keys, security invoker (RLS). The invoice rows carry what the Worker reads (src/routes/screen.ts);
-- Periodo's rows keep their shape, with only the decisions of non-archived invoices, and their checks only where the invoice
-- has no stored fields (recordedFields' fallback): all AC-101's dashboard reads. screen_period, Periodo's own, is unchanged.
create or replace function public.screen_inbox(p_lang text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select case when c.id is not null then jsonb_build_object(
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'company_id', v.company_id, 'received_at', v.received_at, 'fields', v.fields,
                            'outcome', v.outcome, 'amount_usd', v.amount_usd, 'decided_at', v.decided_at, 'question_es', v.question_es,
                            'question_en', v.question_en, 'origin', v.origin, 'sender', v.sender,
                            'headline', case when p_lang = 'en' then v.headline_en else v.headline_es end) order by v.received_at desc)
                          from public.invoice_current v where v.company_id = c.id), '[]'),
    'last_run', (select jsonb_build_object('at', r.created_at, 'trigger', r.trigger, 'via', r.via) from (
                   (select * from public.agent_runs x where x.company_id = c.id order by x.created_at desc limit 1)
                   union all
                   (select * from public.agent_runs x where x.company_id is null order by x.created_at desc limit 1)) r
                 order by r.created_at desc limit 1),
    'portal_slug', (select co.portal_slug from public.companies co where co.id = c.id),
    'beneficiaries', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name) from public.beneficiaries b
                               where b.company_id = c.id and not b.archived), '[]'),
    'period', jsonb_build_object(
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
                             where d.company_id = c.id and not i.archived), '[]')))
  end from (select public.screen_company() as id) c
$$;
