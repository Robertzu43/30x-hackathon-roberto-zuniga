-- Task 39c (AC-96 Clarified, R-133; AC-07, AC-38, AC-68). Forward-only and additive: one function and one trigger.
-- A member insert (current_user authenticated or anon, as invoices_member_insert tests it) into a trial company is refused
-- once that company has 30 member-inserted invoices in the current UTC day, so the direct REST insert is capped too.
-- Security invoker on purpose: inside a security definer function current_user is the owner. The service role (portal,
-- email intake, record.ts) and the signup seed copy (security definer seed_company) are never counted nor refused.
-- Member inserts are stored with origin 'app' and expected_outcome null (invoices_member_insert); seeded rows carry an
-- expected_outcome, so a fresh trial has all 30. RLS limits the count to the caller's own company, which is all it needs.
create function public.invoices_trial_cap() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon')
    or not exists (select 1 from public.companies where id = new.company_id and is_trial) then
    return new;
  end if;
  -- One lock per trial company, held to commit: a parallel insert waits, then counts this one (read committed).
  perform pg_advisory_xact_lock(hashtext('trial_invoice_cap:' || new.company_id::text));
  if (select count(*) from public.invoices
      where company_id = new.company_id and origin = 'app' and expected_outcome is null
        and received_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') >= 30 then
    raise exception 'TRIAL_INVOICE_LIMIT'
      using hint = 'A trial company stores at most 30 invoices per UTC day; it renews at 00:00 UTC (19:00 Bogota).';
  end if;
  return new;
end $$;
create trigger invoices_trial_cap before insert on public.invoices
  for each row execute function public.invoices_trial_cap();
