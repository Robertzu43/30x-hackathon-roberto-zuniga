-- Dry run only (branch dryrun/deploy): one public-read row to prove Worker -> Supabase REST under RLS.
create table public.dryrun_ping (id int primary key, note text);
alter table public.dryrun_ping enable row level security;
create policy "anon read" on public.dryrun_ping for select to anon using (true);
grant select on public.dryrun_ping to anon;
insert into public.dryrun_ping values (1, 'hola');
-- down
-- drop table public.dryrun_ping;
