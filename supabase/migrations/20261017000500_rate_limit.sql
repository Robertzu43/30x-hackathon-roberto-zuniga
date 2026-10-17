-- AC-43, R-72 (Task 8g): the per-user POST limit, counted in the database. The Workers ratelimit binding was deployed
-- and called, yet refused nothing in a live burst (QA: 160+ POSTs a minute by one user, no 429). One row per (user,
-- minute), only ever upserted, never deleted. No member policy: only rate_limit_hit (security definer) touches it.
create table public.rate_limits (
  user_id uuid not null,
  minute bigint not null, -- unix epoch minute
  n int not null,
  primary key (user_id, minute)
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from public, anon, authenticated;

-- Counts this call for auth.uid() (never a caller value) and answers whether the last 60 s stay within 60: this
-- minute's count plus the previous minute's, weighted by the part of it still inside the window.
-- ponytail: sliding-window estimate (Cloudflare's own scheme), not an exact log; exact needs a row per request.
create function public.rate_limit_hit() returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_at double precision := extract(epoch from now()) / 60;
  v_min bigint := floor(v_at);
  v_n int;
  v_prev int;
begin
  insert into public.rate_limits as r (user_id, minute, n) values (auth.uid(), v_min, 1)
    on conflict (user_id, minute) do update set n = r.n + 1
    returning r.n into v_n;
  select p.n into v_prev from public.rate_limits p where p.user_id = auth.uid() and p.minute = v_min - 1;
  return coalesce(v_prev, 0) * (1 - (v_at - v_min)) + v_n <= 60;
end $$;
revoke execute on function public.rate_limit_hit() from public, anon;
grant execute on function public.rate_limit_hit() to authenticated;
