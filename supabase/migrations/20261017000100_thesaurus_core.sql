-- Thesaurus core schema (Task 2: AC-03..08, AC-63..65). Forward-only and additive. Every table is scoped by company_id
-- and has RLS on from this migration. decisions, approval_tokens, approval_uses, agent_runs and policies are
-- append-only: they have no update policy and no delete policy (D10).

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text,
  approver_email text,
  lang text not null default 'es' check (lang in ('es', 'en')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.companies enable row level security;

create table public.company_members (
  company_id uuid not null references public.companies,
  user_id uuid not null references auth.users,
  role text not null default 'owner',
  primary key (company_id, user_id)
);
alter table public.company_members enable row level security;
create policy members_select_company_members on public.company_members for select to authenticated
  using (user_id = (select auth.uid()));

create policy members_select_companies on public.companies for select to authenticated
  using (id in (select company_id from public.company_members where user_id = (select auth.uid())));
-- The shared demo company row is read-only to members; the seed upsert is its only writer (AC-32, R-31).
create policy members_update_companies on public.companies for update to authenticated
  using (not is_demo and id in (select company_id from public.company_members where user_id = (select auth.uid())))
  with check (not is_demo and id in (select company_id from public.company_members where user_id = (select auth.uid())));
-- Members edit only what the API sends; is_demo stays out of reach (R-15).
revoke update on public.companies from anon, authenticated;
grant update (name, approver_email, lang) on public.companies to authenticated;

create table public.policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  version int not null,
  name text not null,
  rules jsonb not null,
  created_at timestamptz not null default now(),
  unique (company_id, version)
);
alter table public.policies enable row level security;
create policy members_select_policies on public.policies for select to authenticated
  using (company_id in (select company_id from public.company_members where user_id = (select auth.uid())));
create policy members_insert_policies on public.policies for insert to authenticated
  with check (company_id in (select company_id from public.company_members where user_id = (select auth.uid())));

create table public.beneficiaries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  name text not null,
  country text,
  currency text,
  bank_account text,
  route text,
  category text,
  agreement jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.beneficiaries enable row level security;
create policy members_select_beneficiaries on public.beneficiaries for select to authenticated
  using (company_id in (select company_id from public.company_members where user_id = (select auth.uid())));
create policy members_insert_beneficiaries on public.beneficiaries for insert to authenticated
  with check (company_id in (select company_id from public.company_members where user_id = (select auth.uid())));
create policy members_update_beneficiaries on public.beneficiaries for update to authenticated
  using (company_id in (select company_id from public.company_members where user_id = (select auth.uid())))
  with check (company_id in (select company_id from public.company_members where user_id = (select auth.uid())));

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  source text not null check (source in ('pdf', 'image', 'email', 'chat')),
  file_path text,
  raw_text text,
  fields jsonb,
  expected_outcome text check (expected_outcome in ('PAGAR', 'FRENAR', 'ESCALAR')),
  archived boolean not null default false,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.invoices enable row level security;
create policy members_select_invoices on public.invoices for select to authenticated
  using (company_id in (select company_id from public.company_members where user_id = (select auth.uid())));
create policy members_insert_invoices on public.invoices for insert to authenticated
  with check (company_id in (select company_id from public.company_members where user_id = (select auth.uid())));
create policy members_update_invoices on public.invoices for update to authenticated
  using (company_id in (select company_id from public.company_members where user_id = (select auth.uid())))
  with check (company_id in (select company_id from public.company_members where user_id = (select auth.uid())));
-- Invoices are immutable for members except the archived flag (R-12, AC-06).
revoke update on public.invoices from anon, authenticated;
grant update (archived) on public.invoices to authenticated;

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  invoice_id uuid not null references public.invoices,
  seq int not null,
  outcome text not null check (outcome in ('PAGAR', 'FRENAR', 'ESCALAR')),
  actor text not null check (actor in ('agent', 'human')),
  actor_email text,
  channel text check (channel in ('link', 'dashboard')),
  checks jsonb not null default '[]',
  headline_es text,
  headline_en text,
  question_es text,
  question_en text,
  policy_version int,
  amount_usd numeric(14, 2),
  payment jsonb,
  note text,
  created_at timestamptz not null default now(),
  unique (invoice_id, seq),
  check (outcome = 'ESCALAR' or (question_es is null and question_en is null)),  -- AC-65, R-28
  check (actor = 'agent' or (actor_email is not null and channel is not null))   -- R-13
);
alter table public.decisions enable row level security;
create policy members_select_decisions on public.decisions for select to authenticated
  using (company_id in (select company_id from public.company_members where user_id = (select auth.uid())));
create policy members_insert_decisions on public.decisions for insert to authenticated
  with check (company_id in (select company_id from public.company_members where user_id = (select auth.uid())));

create table public.approval_tokens (
  token_hash text primary key,
  company_id uuid not null references public.companies,
  invoice_id uuid not null references public.invoices,
  decision_id uuid not null references public.decisions,
  expires_at timestamptz not null,
  email_sent boolean not null,  -- R-29: the row is inserted after the send attempt
  sent_to text not null,
  created_at timestamptz not null default now()
);
alter table public.approval_tokens enable row level security;
create policy members_select_approval_tokens on public.approval_tokens for select to authenticated
  using (company_id in (select company_id from public.company_members where user_id = (select auth.uid())));
create policy members_insert_approval_tokens on public.approval_tokens for insert to authenticated
  with check (company_id in (select company_id from public.company_members where user_id = (select auth.uid())));

create table public.approval_uses (
  token_hash text primary key,
  company_id uuid not null references public.companies,
  decision_id uuid not null unique references public.decisions,  -- R-03: one use spends the escalation's pair
  created_at timestamptz not null default now()
);
alter table public.approval_uses enable row level security;
create policy members_select_approval_uses on public.approval_uses for select to authenticated
  using (company_id in (select company_id from public.company_members where user_id = (select auth.uid())));
create policy members_insert_approval_uses on public.approval_uses for insert to authenticated
  with check (company_id in (select company_id from public.company_members where user_id = (select auth.uid())));

-- AC-63: one row per runAgent call (company set) and one per cron tick (company null, written by the service role).
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies,
  trigger text not null check (trigger in ('cron', 'ingest', 'manual', 'login', 'reevaluate', 'reset')),
  decided jsonb,
  errors int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.agent_runs enable row level security;
create index agent_runs_company_created_idx on public.agent_runs (company_id, created_at desc);
create policy members_select_agent_runs on public.agent_runs for select to authenticated
  using (company_id is null or company_id in (select company_id from public.company_members where user_id = (select auth.uid())));
create policy members_insert_agent_runs on public.agent_runs for insert to authenticated
  with check (company_id in (select company_id from public.company_members where user_id = (select auth.uid())));

-- AC-08: private bucket files, one folder per company.
create policy members_select_files on storage.objects for select to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] in
    (select company_id::text from public.company_members where user_id = (select auth.uid())));
create policy members_insert_files on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and (storage.foldername(name))[1] in
    (select company_id::text from public.company_members where user_id = (select auth.uid())));

-- Task 3 replaces this stub with create or replace (grants survive the replace). Not callable through the API.
create or replace function public.seed_company(p_company uuid) returns void language plpgsql as $$ begin end $$;
revoke execute on function public.seed_company(uuid) from public, anon, authenticated;

-- AC-03: every signup gets its own company, membership and seed, inside the auth insert (no service-role call).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_company uuid;
begin
  insert into public.companies (name, approver_email)
    values (coalesce(nullif(split_part(new.email, '@', 1), ''), 'Mi empresa'), new.email)
    returning id into v_company;
  insert into public.company_members (company_id, user_id) values (v_company, new.id);
  perform public.seed_company(v_company);
  return new;
end $$;
create or replace trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
