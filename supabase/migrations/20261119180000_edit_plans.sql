-- Saved edit plans for the AI Editor (masvid.vercel.app/editor/).
-- Run once in Supabase: SQL Editor → New query → paste → Run. Safe to re-run.
-- Row level security means each signed-in person can only see and change
-- their own plans; signed-out visitors can read nothing.

create table if not exists public.edit_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  plan jsonb not null check (pg_column_size(plan) < 200000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists edit_plans_user_updated on public.edit_plans (user_id, updated_at desc);

alter table public.edit_plans enable row level security;

drop policy if exists "read own plans" on public.edit_plans;
drop policy if exists "add own plans" on public.edit_plans;
drop policy if exists "update own plans" on public.edit_plans;
drop policy if exists "delete own plans" on public.edit_plans;

create policy "read own plans" on public.edit_plans
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "add own plans" on public.edit_plans
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own plans" on public.edit_plans
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own plans" on public.edit_plans
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.edit_plans from anon;
grant select, insert, update, delete on public.edit_plans to authenticated;

create or replace function public.touch_updated_at() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists edit_plans_touch on public.edit_plans;
create trigger edit_plans_touch before update on public.edit_plans
  for each row execute function public.touch_updated_at();
