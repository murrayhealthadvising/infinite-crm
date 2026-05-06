-- Infinite CRM — Runner Access setup
-- Paste this entire block into Supabase → SQL Editor → Run.
-- Safe to run multiple times.

-- 1. Schema
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role          TEXT  DEFAULT 'agent';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS lead_agent_id UUID;
CREATE INDEX IF NOT EXISTS profiles_lead_agent_id_idx ON public.profiles(lead_agent_id);

-- 2. Row-level security: runners see + edit their lead-agent's leads, never delete.
DROP POLICY IF EXISTS "leads_select_owner_or_runner"   ON public.leads;
CREATE POLICY "leads_select_owner_or_runner" ON public.leads FOR SELECT
  USING (
    user_id = auth.uid()
    OR user_id = (SELECT lead_agent_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "leads_update_owner_or_runner"   ON public.leads;
CREATE POLICY "leads_update_owner_or_runner" ON public.leads FOR UPDATE
  USING (
    user_id = auth.uid()
    OR user_id = (SELECT lead_agent_id FROM public.profiles WHERE id = auth.uid())
  );

-- INSERT and DELETE remain owner-only (runners cannot add or wipe leads).
DROP POLICY IF EXISTS "leads_insert_owner_only" ON public.leads;
CREATE POLICY "leads_insert_owner_only" ON public.leads FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "leads_delete_owner_only" ON public.leads;
CREATE POLICY "leads_delete_owner_only" ON public.leads FOR DELETE
  USING (user_id = auth.uid());

-- 3. RPC: activate an existing account as MY runner
CREATE OR REPLACE FUNCTION public.activate_runner(runner_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rid UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Must be signed in'; END IF;

  SELECT id INTO rid FROM auth.users WHERE lower(email) = lower(runner_email);
  IF rid IS NULL THEN RAISE EXCEPTION 'No account with that email — sign them up first.'; END IF;
  IF rid = auth.uid() THEN RAISE EXCEPTION 'You cannot activate yourself.'; END IF;

  IF (SELECT COUNT(*) FROM public.leads WHERE user_id = rid) > 0 THEN
    RAISE EXCEPTION 'That account has leads of its own — only fresh accounts can become runners.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = rid AND lead_agent_id IS NOT NULL AND lead_agent_id <> auth.uid()
  ) THEN
    RAISE EXCEPTION 'That account already runs for another agent.';
  END IF;

  INSERT INTO public.profiles(id, role, lead_agent_id)
  VALUES (rid, 'runner', auth.uid())
  ON CONFLICT (id) DO UPDATE SET role = 'runner', lead_agent_id = auth.uid();

  RETURN jsonb_build_object('id', rid, 'email', runner_email);
END;
$$;
GRANT EXECUTE ON FUNCTION public.activate_runner(TEXT) TO authenticated;

-- 4. RPC: deactivate one of my runners
CREATE OR REPLACE FUNCTION public.deactivate_runner(rid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Must be signed in'; END IF;
  UPDATE public.profiles
  SET role = 'agent', lead_agent_id = NULL
  WHERE id = rid AND lead_agent_id = auth.uid();
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.deactivate_runner(UUID) TO authenticated;

-- 5. RPC: list MY runners (with email)
CREATE OR REPLACE FUNCTION public.list_my_runners()
RETURNS TABLE(id UUID, email TEXT, full_name TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, u.email::TEXT, p.full_name, u.created_at
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.role = 'runner' AND p.lead_agent_id = auth.uid()
  ORDER BY u.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_my_runners() TO authenticated;
