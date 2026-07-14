-- Infinite CRM — Profiles RLS policies
--
-- The leads RLS policy allows runners to see their lead-agent's leads via
-- a sub-query on profiles: `user_id = (SELECT lead_agent_id FROM profiles
-- WHERE user_id = auth.uid())`. That sub-query runs as the querying user,
-- so it needs SELECT permission on profiles. Without an explicit SELECT
-- policy, the sub-query returns NULL for everyone, and runners see zero
-- leads (the exact symptom Chelsea hit).
--
-- Also adds a limited UPDATE policy so users can edit their own display
-- fields (full_name, etc.) without an admin. Role/lead_agent_id changes
-- must still go through admin RPCs — enforced by the CHECK clause.
--
-- Safe to re-run.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ── SELECT: users can read their own row + admins can read all + runners
--    can read their lead-agent's row (so the app can show "Running for X")
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT
  USING (
    -- own row
    user_id = auth.uid()
    -- admins see all
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.role = 'admin'
    )
    -- runners see their lead-agent's row (for the "Running for X" label)
    OR user_id = (SELECT lead_agent_id FROM public.profiles WHERE user_id = auth.uid())
    -- lead-agents see profiles of their runners (so admin/settings can list them)
    OR auth.uid() = (SELECT lead_agent_id FROM public.profiles WHERE user_id = public.profiles.user_id)
  );

-- ── UPDATE: users can update their OWN row, but NOT change role or
--    lead_agent_id — those are admin-only via the existing RPCs. Enforced
--    by the WITH CHECK clause that requires those columns to stay unchanged.
DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND role = (SELECT role FROM public.profiles WHERE user_id = auth.uid())
    AND lead_agent_id IS NOT DISTINCT FROM
        (SELECT lead_agent_id FROM public.profiles WHERE user_id = auth.uid())
  );

-- ── INSERT: only allowed for auth trigger (via SECURITY DEFINER) or admins.
--    Regular users cannot insert a profile row directly.
DROP POLICY IF EXISTS "profiles_insert_admin" ON public.profiles;
CREATE POLICY "profiles_insert_admin" ON public.profiles FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.role = 'admin'
    )
  );

-- ── DELETE: admin-only. Handled via the admin_delete_user RPC in most cases.
DROP POLICY IF EXISTS "profiles_delete_admin" ON public.profiles;
CREATE POLICY "profiles_delete_admin" ON public.profiles FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.role = 'admin'
    )
  );

-- ── Verify: this select should return 4 policies after running the above.
SELECT policyname, cmd
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'profiles'
  ORDER BY cmd, policyname;
