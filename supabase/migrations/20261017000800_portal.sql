-- Vendor portal (Task 25: AC-83..AC-86; AC-07, AC-63 and AC-68 Clarified; R-90). Forward-only and additive.

-- R-90.2: the channel an invoice came through. `source` keeps the document kind (pdf, image, email, chat).
alter table public.invoices add column origin text not null default 'app' check (origin in ('app', 'portal', 'email'));
alter table public.invoices add column sender text; -- the From address of an email (Task 30)
alter table public.invoices add column sender_note text check (char_length(sender_note) <= 2000); -- a vendor's portal message, never read (R-90.5)

-- AC-68 Clarified: on a member insert the database stores origin 'app', sender and sender_note null, whatever the body
-- sends (000400's R-70 function plus three lines). The Worker's service role (intake.ts) keeps its values.
create or replace function public.invoices_member_insert() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.expected_outcome := null;
    new.received_at := now();
    new.archived := false;
    new.origin := 'app';
    new.sender := null;
    new.sender_note := null;
  end if;
  return new;
end $$;

-- 000200's view with the channel columns appended (create or replace view may only add columns at the end).
create or replace view public.invoice_current with (security_invoker = true) as
select i.id, i.company_id, i.source, i.file_path, i.raw_text, i.fields, i.expected_outcome, i.archived, i.received_at, i.created_at,
       d.id as decision_id, d.seq, d.outcome, d.actor, d.actor_email, d.channel, d.headline_es, d.headline_en,
       d.question_es, d.question_en, d.policy_version, d.amount_usd, d.payment, d.created_at as decided_at,
       i.origin, i.sender, i.sender_note
from public.invoices i
left join lateral (
  select * from public.decisions x where x.invoice_id = i.id order by x.seq desc limit 1
) d on true
where not i.archived;

-- AC-63 Clarified: a run started by the portal or the email intake; null for every other run.
alter table public.agent_runs add column via text check (via in ('portal', 'email'));

-- AC-86, R-90.4: the public portal path. A random p-<12 hex> per company (existing rows get their own, the default is
-- volatile); the seed script sets the demo's `andina-labs`. Not in 000100's member column grant, so members cannot edit it.
alter table public.companies add column portal_slug text not null unique
  default 'p-' || left(replace(gen_random_uuid()::text, '-', ''), 12)
  check (portal_slug ~ '^[a-z0-9][a-z0-9-]{2,39}$');

-- AC-84: only the SHA-256 of a status link token. No member policy and no grant: the service role (intake.ts) only.
create table public.portal_status_tokens (
  token_hash text primary key,
  company_id uuid not null references public.companies,
  invoice_id uuid not null references public.invoices,
  created_at timestamptz not null default now()
);
alter table public.portal_status_tokens enable row level security;
revoke all on public.portal_status_tokens from public, anon, authenticated;

-- AC-85.3: intake counters, one row per (key, window), only ever upserted. Same shape as 000500's rate_limits.
create table public.intake_rate_limits (
  key text not null,
  "window" bigint not null, -- unix epoch hour, day or minute, by the key's kind
  n int not null,
  primary key (key, "window")
);
alter table public.intake_rate_limits enable row level security;
revoke all on public.intake_rate_limits from public, anon, authenticated;

-- Counts one portal or email invoice ('invoice': 10 an hour per IP when p_ip is given, then 100 a UTC day per company)
-- or one status view ('status': 60 a minute per IP). Answers the limit that refused it ('ip', 'company', 'status'), or
-- null. The IP is stored as its md5, never raw. A refusal by the IP limit does not count against the company.
create function public.intake_hit(p_kind text, p_ip text, p_company uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_epoch bigint := floor(extract(epoch from now()));
  v_n int;
begin
  if p_kind = 'status' then
    insert into public.intake_rate_limits as r (key, "window", n) values ('status:' || md5(p_ip), v_epoch / 60, 1)
      on conflict (key, "window") do update set n = r.n + 1 returning r.n into v_n;
    return case when v_n > 60 then 'status' end;
  end if;
  if p_kind <> 'invoice' or p_company is null then raise exception 'INVALID_KIND'; end if;
  if p_ip is not null then
    insert into public.intake_rate_limits as r (key, "window", n) values ('ip:' || md5(p_ip), v_epoch / 3600, 1)
      on conflict (key, "window") do update set n = r.n + 1 returning r.n into v_n;
    if v_n > 10 then return 'ip'; end if;
  end if;
  insert into public.intake_rate_limits as r (key, "window", n) values ('company:' || p_company, v_epoch / 86400, 1)
    on conflict (key, "window") do update set n = r.n + 1 returning r.n into v_n;
  return case when v_n > 100 then 'company' end;
end $$;
revoke execute on function public.intake_hit(text, text, uuid) from public, anon, authenticated;
grant execute on function public.intake_hit(text, text, uuid) to service_role;
