-- AC-67, R-87 (Task 23): the «Pregúntale a Thesaurus» quota, taken before the model call. One row per (UTC day, key), only
-- ever upserted, never deleted. key 'global' = the whole deployment; 'u:<user id>' or 'u:<user id>:<ip>' (the shared demo
-- user) = one person. No member policy and no member grant (AC-68 Clarified): only take_question, run by the Worker's
-- record.ts with the service role, touches it, so the public demo password cannot burn the day's cap.
create table public.ai_usage (
  day date not null,
  key text not null,
  n int not null,
  primary key (day, key)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from public, anon, authenticated;

-- Counts one question for p_key and the deployment, atomically: {"remaining": 10 - n} when both are under their caps,
-- {"reason": "user_cap"} at 10 for the key (the deployment is not counted), {"reason": "ai_quota"} at 500 for the day
-- (the key's count is rolled back with the block). The day is the UTC day: it renews at 19:00 in Bogotá.
create function public.take_question(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_user int;
  v_all int;
begin
  if p_key is null or p_key not like 'u:%' then raise exception 'BAD_KEY'; end if;
  insert into public.ai_usage as u (day, key, n) values (v_day, p_key, 1)
    on conflict (day, key) do update set n = u.n + 1 where u.n < 10
    returning u.n into v_user;
  if v_user is null then return jsonb_build_object('reason', 'user_cap'); end if;
  insert into public.ai_usage as u (day, key, n) values (v_day, 'global', 1)
    on conflict (day, key) do update set n = u.n + 1 where u.n < 500
    returning u.n into v_all;
  if v_all is null then raise exception using errcode = 'AIQ01', message = 'AI_QUOTA'; end if;
  return jsonb_build_object('remaining', 10 - v_user);
exception when sqlstate 'AIQ01' then
  return jsonb_build_object('reason', 'ai_quota');
end $$;
revoke execute on function public.take_question(text) from public, anon, authenticated;
grant execute on function public.take_question(text) to service_role;
