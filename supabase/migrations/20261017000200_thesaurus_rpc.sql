-- Thesaurus decision path (Task 2: AC-24, AC-25, AC-37, AC-62 R-25). Everything runs as the caller (security invoker):
-- RLS scopes members to their company; the service role (cron, approval link) passes through and is scoped by the
-- invoice's own company_id, which these functions always take from the invoice row, never from the caller.

-- Each non-archived invoice with its latest decision (null = pending).
create or replace view public.invoice_current with (security_invoker = true) as
select i.*, d.id as decision_id, d.seq, d.outcome, d.actor, d.actor_email, d.channel, d.headline_es, d.headline_en,
       d.question_es, d.question_en, d.policy_version, d.amount_usd, d.payment, d.created_at as decided_at
from public.invoices i
left join lateral (
  select * from public.decisions x where x.invoice_id = i.id order by x.seq desc limit 1
) d on true
where not i.archived;

-- Table-level guard, so a direct REST insert cannot skip the rules: PAGAR and FRENAR are final (R-04, D16), a human
-- answers only an ESCALAR (R-03), seq is always the next one and company_id is always the invoice's.
create or replace function public.decisions_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_last public.decisions;
begin
  select * into v_last from public.decisions where invoice_id = new.invoice_id order by seq desc limit 1;
  if v_last.outcome in ('PAGAR', 'FRENAR') then raise exception 'FINAL_DECISION'; end if;
  if new.actor = 'human' and v_last.outcome is distinct from 'ESCALAR' then raise exception 'NOT_ESCALATED'; end if;
  new.seq := coalesce(v_last.seq, 0) + 1;
  new.company_id := (select company_id from public.invoices where id = new.invoice_id);
  return new;
end $$;
create or replace trigger decisions_guard before insert on public.decisions
  for each row execute function public.decisions_guard();

-- The only way the Worker writes a decision. p_expected_seq = latest seq the caller decided against (0 = none);
-- p_expected_committed_usd = committed USD of the invoice's month excluding this invoice.
-- Errors: INVOICE_NOT_FOUND, ALREADY_DECIDED (skip, no mail), STALE_PERIOD (re-decide), FINAL_DECISION, NOT_ESCALATED.
create or replace function public.insert_decision(
  p_invoice_id uuid, p_expected_committed_usd numeric, p_decision jsonb, p_expected_seq int
) returns public.decisions language plpgsql security invoker set search_path = '' as $$
declare
  v_inv public.invoices;
  v_seq int;
  v_committed numeric;
  v_row public.decisions;
begin
  select * into v_inv from public.invoices where id = p_invoice_id;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  -- ponytail: one lock per company serializes its decisions; per-month locks if one company decides at volume.
  perform pg_advisory_xact_lock(hashtext(v_inv.company_id::text));
  select coalesce(max(seq), 0) into v_seq from public.decisions where invoice_id = p_invoice_id;
  if v_seq is distinct from p_expected_seq then raise exception 'ALREADY_DECIDED'; end if;
  select coalesce(sum(c.amount_usd), 0) into v_committed from public.invoice_current c
  where c.company_id = v_inv.company_id and c.id <> p_invoice_id and c.outcome in ('PAGAR', 'ESCALAR')
    and date_trunc('month', c.received_at at time zone 'America/Bogota')
      = date_trunc('month', v_inv.received_at at time zone 'America/Bogota');
  if p_expected_committed_usd is null or abs(v_committed - p_expected_committed_usd) > 0.005 then
    raise exception 'STALE_PERIOD';
  end if;
  v_row := jsonb_populate_record(null::public.decisions, p_decision);
  v_row.id := gen_random_uuid();
  v_row.company_id := v_inv.company_id;
  v_row.invoice_id := p_invoice_id;
  v_row.seq := v_seq + 1;
  v_row.created_at := now();
  insert into public.decisions select (v_row).* returning * into v_row;  -- decisions_guard: FINAL_DECISION, NOT_ESCALATED
  return v_row;
end $$;

-- Month figures by the latest decision per non-archived invoice (month of received_at in America/Bogota).
-- p_exclude_invoice lets the agent read committed_usd without the invoice it is re-deciding, as insert_decision does.
create or replace function public.period_state(p_company_id uuid, p_month date, p_exclude_invoice uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with cur as (
    select coalesce(c.payment ->> 'beneficiary', c.fields ->> 'payee_name') as beneficiary, c.outcome,
           coalesce(c.amount_usd, 0) as usd
    from public.invoice_current c
    where c.company_id = p_company_id and c.outcome is not null and c.id is distinct from p_exclude_invoice
      and date_trunc('month', c.received_at at time zone 'America/Bogota') = date_trunc('month', p_month::timestamp)
  )
  select jsonb_build_object(
    'paid_usd', coalesce(sum(usd) filter (where outcome = 'PAGAR'), 0),
    'committed_usd', coalesce(sum(usd) filter (where outcome in ('PAGAR', 'ESCALAR')), 0),
    'count_by_outcome', jsonb_build_object(
      'PAGAR', count(*) filter (where outcome = 'PAGAR'),
      'FRENAR', count(*) filter (where outcome = 'FRENAR'),
      'ESCALAR', count(*) filter (where outcome = 'ESCALAR')),
    'by_beneficiary', coalesce((
      select jsonb_agg(b order by b.beneficiary) from (
        select beneficiary,
               coalesce(sum(usd) filter (where outcome = 'PAGAR'), 0) as paid_usd,
               coalesce(sum(usd) filter (where outcome in ('PAGAR', 'ESCALAR')), 0) as committed_usd,
               count(*) as count
        from cur group by beneficiary) b), '[]'::jsonb))
  from cur;
$$;
