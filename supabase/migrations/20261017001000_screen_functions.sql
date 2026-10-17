-- Task 42 (D40; AC-98, R-122). One read function per screen, so a screen costs one PostgREST round trip. Additive: new
-- functions only. Each is security invoker (RLS applies with the caller's JWT), stable (Postgres refuses writes in it),
-- returns jsonb, and is null when auth.uid() belongs to no company. They return the rows today's endpoints read, with the
-- same filters and order; the Worker computes from them exactly what those endpoints compute (src/routes/screen.ts).
-- Task 45 replaces them (create or replace) with the D39 fields.

-- The caller's company: its first membership, as requireUser picks it (src/lib/auth.ts).
create function public.screen_company() returns uuid
language sql stable security invoker set search_path = '' as $$
  select m.company_id from public.company_members m where m.user_id = auth.uid() order by m.company_id limit 1
$$;

-- Bandeja: GET /api/invoices (headline in p_lang), GET /api/agent/last-run, and the portal slug of GET /api/portal-link.
create function public.screen_inbox(p_lang text) returns jsonb
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
    'portal_slug', (select co.portal_slug from public.companies co where co.id = c.id))
  end from (select public.screen_company() as id) c
$$;

-- Periodo: the five reads of GET /api/period.
create function public.screen_period() returns jsonb
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
                           'checks', d.checks) order by d.seq) from public.decisions d where d.company_id = c.id), '[]'))
  end from (select public.screen_company() as id) c
$$;

-- Beneficiarios: GET /api/beneficiaries.
create function public.screen_beneficiaries() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select case when c.id is not null then jsonb_build_object(
    'beneficiaries', coalesce((select jsonb_agg(to_jsonb(b) order by b.name) from public.beneficiaries b
                               where b.company_id = c.id and not b.archived), '[]'))
  end from (select public.screen_company() as id) c
$$;

-- Política: GET /api/policy (every version, newest first), GET /api/company, and the rates of GET /api/fx.
create function public.screen_policy() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select case when c.id is not null then jsonb_build_object(
    'versions', coalesce((select jsonb_agg(to_jsonb(p) order by p.version desc) from public.policies p where p.company_id = c.id), '[]'),
    'company', (select jsonb_build_object('id', co.id, 'name', co.name, 'approver_email', co.approver_email, 'lang', co.lang,
                'is_demo', co.is_demo, 'is_trial', co.is_trial) from public.companies co where co.id = c.id),
    'fx', coalesce((select jsonb_agg(jsonb_build_object('currency', f.currency, 'usd_per_unit', f.usd_per_unit, 'source', f.source,
                    'fetched_at', f.fetched_at)) from public.fx_latest f), '[]'))
  end from (select public.screen_company() as id) c
$$;

-- Detalle: the reads of GET /api/invoices/:id; null when the caller's company has no such invoice.
create function public.screen_detail(p_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select case when v.id is not null then jsonb_build_object(
    'company_id', c.id,
    'invoice', to_jsonb(v),
    'decisions', coalesce((select jsonb_agg(to_jsonb(d) order by d.seq) from public.decisions d where d.company_id = c.id and d.invoice_id = v.id), '[]'),
    'directory', coalesce((select jsonb_agg(to_jsonb(b)) from public.beneficiaries b where b.company_id = c.id and not b.archived), '[]'),
    'company', (select jsonb_build_object('is_demo', co.is_demo, 'is_trial', co.is_trial) from public.companies co where co.id = c.id),
    'notification', (select jsonb_build_object('email_sent', t.email_sent, 'sent_to', t.sent_to) from public.approval_tokens t
                     where t.company_id = c.id and t.invoice_id = v.id order by t.created_at desc limit 1),
    'policy', (select jsonb_build_object('name', p.name, 'version', p.version, 'created_at', p.created_at) from public.policies p
               where p.company_id = c.id and p.version = v.policy_version))
  end
  from (select public.screen_company() as id) c
  left join public.invoice_current v on v.company_id = c.id and v.id = p_id
$$;

-- The public demo overview (AC-45): Bandeja's rows and Periodo's reads, only when the caller's company is the demo one.
create function public.screen_demo_overview(p_lang text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('invoices', public.screen_inbox(p_lang) -> 'invoices', 'period', public.screen_period())
  from public.companies co where co.id = public.screen_company() and co.is_demo
$$;

revoke execute on function public.screen_company(), public.screen_inbox(text), public.screen_period(), public.screen_beneficiaries(),
  public.screen_policy(), public.screen_detail(uuid), public.screen_demo_overview(text) from public, anon, service_role;
grant execute on function public.screen_company(), public.screen_inbox(text), public.screen_period(), public.screen_beneficiaries(),
  public.screen_policy(), public.screen_detail(uuid), public.screen_demo_overview(text) to authenticated;
