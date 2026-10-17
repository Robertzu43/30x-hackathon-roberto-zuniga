-- Final QA A database guards (Task 8e-db: AC-06, AC-20, AC-23, AC-44, AC-47; R-69, R-70). Forward-only and additive.
-- Both triggers act only on a member's request (current_user authenticated or anon). They are security invoker on
-- purpose: inside reset_demo_company / seed_company (security definer) current_user is the owner, and the Worker's
-- service role is neither role, so seeding, reset and the record writer keep writing every column.

-- R-69: a member archives only a pending invoice (no decision at all) and never un-archives one. The check takes the
-- company lock insert_decision holds, so an archive and a decision being written never interleave. 42501 = 403 in PostgREST.
create or replace function public.invoices_archive_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if old.archived and not new.archived then
    raise exception 'Una factura archivada no se puede restaurar.'
      using errcode = '42501', hint = 'An archived invoice cannot be restored.';
  end if;
  if new.archived and not old.archived then
    perform pg_advisory_xact_lock(hashtext(old.company_id::text));
    if exists (select 1 from public.decisions where invoice_id = old.id) then
      raise exception 'Solo se puede archivar una factura pendiente; una factura con decisión queda en el registro. Para retirar una factura escalada, recházala.'
        using errcode = '42501', hint = 'Only a pending invoice can be archived; a decided invoice stays on the record. To withdraw an escalated invoice, reject it.';
    end if;
  end if;
  return new;
end $$;
create trigger invoices_archive_guard before update of archived on public.invoices
  for each row execute function public.invoices_archive_guard();

-- R-70: on a member insert the database ignores expected_outcome, received_at and archived (R-41's ignore-and-assign).
create or replace function public.invoices_member_insert() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.expected_outcome := null;
    new.received_at := now();
    new.archived := false;
  end if;
  return new;
end $$;
create trigger invoices_member_insert before insert on public.invoices
  for each row execute function public.invoices_member_insert();

-- 000200's insert_decision plus R-69: after the company lock it re-reads the invoice and refuses an archived one.
-- Errors in order: INVOICE_NOT_FOUND, ARCHIVED, ALREADY_DECIDED, STALE_PERIOD, then decisions_guard (000250):
-- FINAL_DECISION, NOT_ESCALATED, PAGAR_OUTSIDE_RULES.
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
  select * into v_inv from public.invoices where id = p_invoice_id;  -- an archive may have committed while we waited
  if v_inv.archived then raise exception 'ARCHIVED'; end if;
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
  v_row.invoice_id := p_invoice_id;
  v_row.created_at := now();
  insert into public.decisions select (v_row).* returning * into v_row;  -- decisions_guard: FINAL_DECISION, NOT_ESCALATED, PAGAR_OUTSIDE_RULES
  return v_row;
end $$;
revoke execute on function public.insert_decision(uuid, numeric, jsonb, int) from public, anon, authenticated;
grant execute on function public.insert_decision(uuid, numeric, jsonb, int) to service_role;
