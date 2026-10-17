-- Task 39 (D41; AC-03 Clarified, AC-92, AC-93, AC-96; R-115, R-117). Forward-only and additive.
-- A Supabase anonymous user is a new user too: the same trigger gives it its own company, named «Empresa de prueba <n>»,
-- marked is_trial, with no approver, and the same Andina seed. Nothing here or anywhere deletes a user or a company.

-- R-115: only the trigger writes it. The member grant on companies stays (name, approver_email, lang), so no member can
-- change is_trial; a new column is outside that column grant.
alter table public.companies add column is_trial boolean not null default false;

create sequence public.trial_company_seq;
revoke all on sequence public.trial_company_seq from public, anon, authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_company uuid;
begin
  if coalesce(new.is_anonymous, false) then
    insert into public.companies (name, approver_email, is_trial)
      values ('Empresa de prueba ' || nextval('public.trial_company_seq'), null, true)
      returning id into v_company;
  else
    insert into public.companies (name, approver_email)
      values (coalesce(nullif(split_part(new.email, '@', 1), ''), 'Mi empresa'), new.email)
      returning id into v_company;
  end if;
  insert into public.company_members (company_id, user_id) values (v_company, new.id);
  perform public.seed_company(v_company);
  return new;
end $$;

-- AC-96, R-117: the existing quota function also counts a trial's ingests, 30 per key and UTC day, on keys
-- 'ingest:<user id>' (the Worker) and 'qa:ingest:<random>' (QA's DB-level check). Ingests never count on the
-- deployment's 500-question cap. Questions ('u:' keys) are unchanged. Grants survive the replace (service_role only).
create or replace function public.take_question(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_ingest boolean := coalesce(p_key ~ '^(qa:)?ingest:.', false);
  v_cap int := case when v_ingest then 30 else 10 end;
  v_user int;
  v_all int;
begin
  if p_key is null or not (v_ingest or p_key like 'u:%') then raise exception 'BAD_KEY'; end if;
  insert into public.ai_usage as u (day, key, n) values (v_day, p_key, 1)
    on conflict (day, key) do update set n = u.n + 1 where u.n < v_cap
    returning u.n into v_user;
  if v_user is null then return jsonb_build_object('reason', 'user_cap'); end if;
  if v_ingest then return jsonb_build_object('remaining', v_cap - v_user); end if;
  insert into public.ai_usage as u (day, key, n) values (v_day, 'global', 1)
    on conflict (day, key) do update set n = u.n + 1 where u.n < 500
    returning u.n into v_all;
  if v_all is null then raise exception using errcode = 'AIQ01', message = 'AI_QUOTA'; end if;
  return jsonb_build_object('remaining', 10 - v_user);
exception when sqlstate 'AIQ01' then
  return jsonb_build_object('reason', 'ai_quota');
end $$;
