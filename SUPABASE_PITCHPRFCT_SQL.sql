-- Infinite CRM — PitchPrfct per-agent automation
-- Run this ONCE in the Supabase dashboard -> SQL editor. Safe to re-run.

-- 1) Workflow routing rules — keyword(comment) -> workflow map, per agent.
--    Not sensitive (workflow IDs + keywords). Lives on the profile row.
alter table public.profiles
  add column if not exists pitchprfct_rules jsonb;

-- 2) Per-agent PitchPrfct API key. SEPARATE table with row-level security so
--    each agent can only ever read/write their OWN key. The email Worker reads
--    keys with the service role, which bypasses RLS.
create table if not exists public.pitchprfct_keys (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  api_key    text,
  updated_at timestamptz not null default now()
);

alter table public.pitchprfct_keys enable row level security;

drop policy if exists "pitchprfct_keys own select" on public.pitchprfct_keys;
drop policy if exists "pitchprfct_keys own insert" on public.pitchprfct_keys;
drop policy if exists "pitchprfct_keys own update" on public.pitchprfct_keys;

create policy "pitchprfct_keys own select" on public.pitchprfct_keys
  for select using (auth.uid() = user_id);
create policy "pitchprfct_keys own insert" on public.pitchprfct_keys
  for insert with check (auth.uid() = user_id);
create policy "pitchprfct_keys own update" on public.pitchprfct_keys
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
