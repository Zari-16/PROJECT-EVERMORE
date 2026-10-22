-- Enable Row Level Security and policies for privacy

-- Helper: function to check membership
create or replace function is_space_member(p_space uuid, p_user uuid) returns boolean
language sql stable as $$
  select exists (select 1 from space_members where space_id = p_space and user_id = p_user);
$$;

-- RLS on private_spaces
alter table private_spaces enable row level security;

-- allow reading a space if user is a member
create policy "select_space_if_member" on private_spaces
  for select using ( is_space_member(id, auth.uid()) );

-- allow insert when owner = auth.uid()
create policy "insert_space_owner_is_auth" on private_spaces
  for insert with check ( owner = auth.uid() );

-- allow update only for owner
create policy "update_space_owner_only" on private_spaces
  for update using ( owner = auth.uid() ) with check ( owner = auth.uid() );

-- RLS on space_members
alter table space_members enable row level security;

create policy "select_members_if_member" on space_members
  for select using ( is_space_member(space_id, auth.uid()) );

-- allow a user to insert a membership for themselves only through invite flow (we'll allow insert when user_id = auth.uid())
create policy "insert_member_self" on space_members
  for insert with check ( user_id = auth.uid() );

-- allow delete for owner or member leaving themselves
create policy "delete_member_owner_or_self" on space_members
  for delete using ( (select owner from private_spaces where id = space_members.space_id) = auth.uid() OR user_id = auth.uid() );

-- RLS on profiles
alter table profiles enable row level security;

create policy "profiles_self_select" on profiles for select using ( id = auth.uid() );
create policy "profiles_update_own" on profiles for update using ( id = auth.uid() ) with check ( id = auth.uid() );

-- RLS on user_preferences
alter table user_preferences enable row level security;
create policy "prefs_own" on user_preferences for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

-- RLS on discord_links
alter table discord_links enable row level security;
create policy "discord_own" on discord_links for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

-- RLS on whiteboards
alter table whiteboards enable row level security;
create policy "wb_select_member" on whiteboards for select using ( is_space_member(space_id, auth.uid()) );
create policy "wb_insert_member" on whiteboards for insert with check ( is_space_member(space_id, auth.uid()) AND created_by = auth.uid() );
create policy "wb_update_owner" on whiteboards for update using ( is_space_member(space_id, auth.uid()) );

-- RLS on whiteboard_operations
alter table whiteboard_operations enable row level security;
create policy "wbops_select_member" on whiteboard_operations for select using ( is_space_member((select space_id from whiteboards where id = whiteboard_operations.board_id), auth.uid()) );
create policy "wbops_insert_member" on whiteboard_operations for insert with check ( author = auth.uid() AND is_space_member((select space_id from whiteboards where id = whiteboard_operations.board_id), auth.uid()) );

-- RLS on messages
alter table messages enable row level security;
create policy "messages_select_member" on messages for select using ( is_space_member(space_id, auth.uid()) );
create policy "messages_insert_member" on messages for insert with check ( author = auth.uid() AND is_space_member(space_id, auth.uid()) );
create policy "messages_delete_author_or_owner" on messages for delete using ( author = auth.uid() OR (select owner from private_spaces where id = messages.space_id) = auth.uid() );
create policy "messages_update_author" on messages for update using ( author = auth.uid() ) with check ( author = auth.uid() );
