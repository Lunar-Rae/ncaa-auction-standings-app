create extension if not exists pgcrypto;

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  message text not null check (char_length(trim(message)) > 0 and char_length(message) <= 400),
  author_name text not null check (char_length(trim(author_name)) > 0 and char_length(author_name) <= 40),
  author_team_id text,
  team_id text,
  client_id text not null check (char_length(trim(client_id)) > 0 and char_length(client_id) <= 64),
  reply_to_id uuid references public.comments(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz
);

create index if not exists comments_created_at_idx on public.comments (created_at asc);
create index if not exists comments_reply_to_id_idx on public.comments (reply_to_id);

alter table public.comments enable row level security;

drop policy if exists "comments are readable by anon" on public.comments;
create policy "comments are readable by anon"
on public.comments
for select
to anon, authenticated
using (true);

alter publication supabase_realtime add table public.comments;

comment on table public.comments is 'March Madness chat comments with reply/edit support.';
