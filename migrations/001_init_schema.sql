-- Phase 1: core tables for Project Evermore
-- Run this only after verifying no conflicting tables exist.

-- Enable pgcrypto extension for UUID and hashing if not enabled
create extension if not exists "pgcrypto";

-- profiles: linkable to auth.users
create table if not exists profiles (
  id uuid primary key default auth.uid(), -- We will set id to auth.uid() when creating rows from auth
  display_name text,
  avatar_url text,
  created_at timestamptz default now()
);

-- private_spaces
create table if not exists private_spaces (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references profiles(id) on delete cascade,
  name text not null,
  pairing_locked boolean not null default false,
  created_at timestamptz default now()
);

-- space_members
create table if not exists space_members (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references private_spaces(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz default now(),
  unique(space_id, user_id)
);

-- user_preferences
create table if not exists user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  theme text default 'lavender',
  mode text default 'light',
  prefs jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- discord_links
create table if not exists discord_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  display_name text,
  username text,
  discord_id text,
  profile_url text,
  avatar_url text,
  created_at timestamptz default now()
);

-- whiteboards (minimal)
create table if not exists whiteboards (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references private_spaces(id) on delete cascade,
  title text,
  created_by uuid not null references profiles(id),
  created_at timestamptz default now(),
  latest_snapshot_url text
);

create index if not exists idx_whiteboards_space on whiteboards(space_id);

-- whiteboard_operations
create table if not exists whiteboard_operations (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references whiteboards(id) on delete cascade,
  op jsonb not null,
  author uuid not null references profiles(id),
  created_at timestamptz default now()
);

create index if not exists idx_wbops_board on whiteboard_operations(board_id);

-- messages
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references private_spaces(id) on delete cascade,
  author uuid not null references profiles(id),
  content text,
  metadata jsonb,
  created_at timestamptz default now(),
  edited_at timestamptz,
  deleted boolean default false
);

create index if not exists idx_messages_space on messages(space_id);
