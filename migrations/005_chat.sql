-- Persisted, paired-space chat with RLS and Realtime publication.
alter table public.messages
  add column if not exists edited_at timestamptz,
  add column if not exists deleted boolean not null default false;

alter table public.messages alter column deleted set default false;

create index if not exists messages_space_created_idx
  on public.messages(space_id, created_at desc, id desc);

do $block$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.messages'::regclass
       and conname = 'messages_content_length_check'
  ) then
    alter table public.messages
      add constraint messages_content_length_check
      check (content is null or pg_catalog.char_length(content) <= 4000);
  end if;
end;
$block$;

alter table public.messages enable row level security;
revoke all privileges on table public.messages from anon, public, authenticated;
grant select on table public.messages to authenticated;
grant insert (space_id, author, content) on table public.messages to authenticated;
grant update (content, edited_at, deleted) on table public.messages to authenticated;

drop policy if exists messages_select_member on public.messages;
drop policy if exists messages_insert_member on public.messages;
drop policy if exists messages_delete_author_or_owner on public.messages;
drop policy if exists messages_update_author on public.messages;
drop policy if exists messages_select_paired_space on public.messages;
drop policy if exists messages_insert_paired_space on public.messages;
drop policy if exists messages_update_own_paired_space on public.messages;

create policy messages_select_paired_space
  on public.messages for select to authenticated
  using (public.is_space_member(space_id, (select auth.uid())));

create policy messages_insert_paired_space
  on public.messages for insert to authenticated
  with check (
    author = (select auth.uid())
    and public.is_space_member(space_id, (select auth.uid()))
    and content is not null
    and pg_catalog.char_length(pg_catalog.btrim(content)) between 1 and 4000
    and deleted = false
    and edited_at is null
  );

create policy messages_update_own_paired_space
  on public.messages for update to authenticated
  using (
    author = (select auth.uid())
    and public.is_space_member(space_id, (select auth.uid()))
    and deleted = false
  )
  with check (
    author = (select auth.uid())
    and public.is_space_member(space_id, (select auth.uid()))
    and (
      (deleted = false and content is not null and pg_catalog.char_length(pg_catalog.btrim(content)) between 1 and 4000)
      or (deleted = true and content is null)
    )
  );

do $block$
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Supabase Realtime publication supabase_realtime does not exist';
  end if;

  if not exists (
       select 1 from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'messages'
     ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end;
$block$;
