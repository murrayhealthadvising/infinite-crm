-- Infinite CRM — Runner Access + Per-Account Stages migration
-- Paste this entire block into Supabase → SQL Editor → Run.
-- Safe to re-run.

-- ── PROFILES: role + lead_agent_id columns ────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role          TEXT  DEFAULT 'agent';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS lead_agent_id UUID;
CREATE INDEX IF NOT EXISTS profiles_lead_agent_id_idx ON public.profiles(lead_agent_id);

-- ── LEADS: runner column + RLS (runners see their lead-agent's leads) ─────
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS runner TEXT;

DROP POLICY IF EXISTS "leads_select_owner_or_runner" ON public.leads;
CREATE POLICY "leads_select_owner_or_runner" ON public.leads FOR SELECT
  USING (
    user_id = auth.uid()
    OR user_id = (SELECT lead_agent_id FROM public.profiles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "leads_update_owner_or_runner" ON public.leads;
CREATE POLICY "leads_update_owner_or_runner" ON public.leads FOR UPDATE
  USING (
    user_id = auth.uid()
    OR user_id = (SELECT lead_agent_id FROM public.profiles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "leads_insert_owner_only" ON public.leads;
CREATE POLICY "leads_insert_owner_only" ON public.leads FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "leads_delete_owner_only" ON public.leads;
CREATE POLICY "leads_delete_owner_only" ON public.leads FOR DELETE
  USING (user_id = auth.uid());

-- ── TAGS (pipeline stages): per-account ownership ────────────────────────
-- 1) Add user_id, backfill any existing rows to Nic's account
ALTER TABLE public.tags ADD COLUMN IF NOT EXISTS user_id UUID;
UPDATE public.tags SET user_id = '01ef1bd7-f5d1-4279-bf9b-15a02eec5f4a' WHERE user_id IS NULL;
ALTER TABLE public.tags ALTER COLUMN user_id SET NOT NULL;

-- 2) Allow same id ('interested', 'not-started', etc.) across different agents.
-- We have to drop the leads.stage FK first since it depends on the old pkey;
-- the frontend already validates stages against the loaded tags so we don't
-- re-add it (that would block the migration until every agent's tags are seeded).
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_stage_fkey;
ALTER TABLE public.tags  DROP CONSTRAINT IF EXISTS tags_pkey;
ALTER TABLE public.tags  ADD CONSTRAINT tags_pkey PRIMARY KEY (id, user_id);
CREATE INDEX IF NOT EXISTS tags_user_id_idx ON public.tags(user_id);

-- 3) RLS: agents see/manage their own stages; runners see their lead-agent's
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tags_select_owner_or_runner" ON public.tags;
CREATE POLICY "tags_select_owner_or_runner" ON public.tags FOR SELECT
  USING (
    user_id = auth.uid()
    OR user_id = (SELECT lead_agent_id FROM public.profiles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "tags_insert_owner_only" ON public.tags;
CREATE POLICY "tags_insert_owner_only" ON public.tags FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "tags_update_owner_only" ON public.tags;
CREATE POLICY "tags_update_owner_only" ON public.tags FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "tags_delete_owner_only" ON public.tags;
CREATE POLICY "tags_delete_owner_only" ON public.tags FOR DELETE USING (user_id = auth.uid());

-- ── RUNNER RPCs ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.activate_runner(runner_email TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Must be signed in'; END IF;
  SELECT id INTO rid FROM auth.users WHERE lower(email) = lower(runner_email);
  IF rid IS NULL THEN RAISE EXCEPTION 'No account with that email — sign them up first.'; END IF;
  IF rid = auth.uid() THEN RAISE EXCEPTION 'You cannot activate yourself.'; END IF;
  IF (SELECT COUNT(*) FROM public.leads WHERE user_id = rid) > 0 THEN
    RAISE EXCEPTION 'That account has its own leads — runners must be fresh accounts.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = rid AND lead_agent_id IS NOT NULL AND lead_agent_id <> auth.uid()
  ) THEN
    RAISE EXCEPTION 'Already a runner for another agent.'; END IF;
  -- Upsert profile (use user_id as the conflict key, matching the existing schema)
  -- profiles requires email + full_name; fill them from the lookup so the
  -- INSERT doesn't violate NOT NULL constraints on first-time runner activation
  INSERT INTO public.profiles(user_id, email, full_name, role, lead_agent_id)
  VALUES (
    rid,
    lower(runner_email),
    split_part(runner_email, '@', 1),
    'runner',
    auth.uid()
  )
  ON CONFLICT (user_id) DO UPDATE SET role = 'runner', lead_agent_id = auth.uid();
  RETURN jsonb_build_object('id', rid, 'email', runner_email);
END; $$;
GRANT EXECUTE ON FUNCTION public.activate_runner(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.deactivate_runner(rid UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Must be signed in'; END IF;
  UPDATE public.profiles
  SET role = 'agent', lead_agent_id = NULL
  WHERE user_id = rid AND lead_agent_id = auth.uid();
  RETURN FOUND;
END; $$;
GRANT EXECUTE ON FUNCTION public.deactivate_runner(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_runners()
RETURNS TABLE(id UUID, email TEXT, full_name TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT p.user_id, u.email::TEXT, p.full_name, u.created_at
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.user_id
  WHERE p.role = 'runner' AND p.lead_agent_id = auth.uid()
  ORDER BY u.created_at DESC;
END; $$;
GRANT EXECUTE ON FUNCTION public.list_my_runners() TO authenticated;
