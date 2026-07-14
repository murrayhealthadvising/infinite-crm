-- Infinite CRM — Fix runner RLS on leads
--
-- The current leads_select_owner_or_runner policy has a typo: it looks up
-- `profiles.id = auth.uid()` but the profiles table uses `user_id`, not
-- `id`. The sub-query returns NULL for everyone, so runners see zero of
-- their lead-agent's leads. Chelsea hit this exact bug.
--
-- Also cleans up duplicate/redundant policies (leads_select vs
-- leads_select_owner_or_runner both exist; the runner one is the correct
-- authoritative version).
--
-- Safe to re-run.

-- ── Drop the broken runner policy + the older/redundant one
DROP POLICY IF EXISTS "leads_select_owner_or_runner" ON public.leads;
DROP POLICY IF EXISTS "leads_select" ON public.leads;

-- ── Recreate the authoritative SELECT policy with the CORRECT sub-query
--    (profiles.user_id = auth.uid(), NOT profiles.id).
CREATE POLICY "leads_select_owner_or_runner" ON public.leads FOR SELECT
  USING (
    user_id = auth.uid()
    OR user_id = (SELECT lead_agent_id FROM public.profiles WHERE user_id = auth.uid())
  );

-- ── Same fix for UPDATE — runners can update their lead-agent's leads.
--    (Otherwise Chelsea couldn't change a stage, add a note, etc.)
DROP POLICY IF EXISTS "leads_update_owner_or_runner" ON public.leads;
DROP POLICY IF EXISTS "leads_update" ON public.leads;
CREATE POLICY "leads_update_owner_or_runner" ON public.leads FOR UPDATE
  USING (
    user_id = auth.uid()
    OR user_id = (SELECT lead_agent_id FROM public.profiles WHERE user_id = auth.uid())
  );

-- ── INSERT / DELETE: owner-only (runners can't create or delete leads).
--    Drop duplicates + reset to a single canonical policy per action.
DROP POLICY IF EXISTS "leads_insert" ON public.leads;
DROP POLICY IF EXISTS "leads_insert_owner_only" ON public.leads;
CREATE POLICY "leads_insert_owner_only" ON public.leads FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "leads_delete" ON public.leads;
DROP POLICY IF EXISTS "leads_delete_owner_only" ON public.leads;
CREATE POLICY "leads_delete_owner_only" ON public.leads FOR DELETE
  USING (user_id = auth.uid());

-- ── Verify — should return 4 policies, one per action.
SELECT policyname, cmd, qual::text
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'leads'
  ORDER BY cmd, policyname;
