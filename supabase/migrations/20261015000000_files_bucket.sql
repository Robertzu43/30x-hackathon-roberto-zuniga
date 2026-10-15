-- Private bucket for app files (INFRA.md Supabase step 5). Access only through signed URLs from the Worker.
insert into storage.buckets (id, name, public) values ('files', 'files', false) on conflict (id) do nothing;
-- down
-- delete from storage.buckets where id = 'files';
