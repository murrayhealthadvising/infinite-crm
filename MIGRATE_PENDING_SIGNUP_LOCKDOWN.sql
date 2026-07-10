-- Infinite CRM — Signup lockdown migration
--
-- Problem: profiles.role defaulted to 'agent', so any auto-trigger creating a
-- profiles row on signup produced a fully-functional agent account. New users
-- landed in the app without going through Nic's approval. This was the bug
-- Nic hit when rolling out to teammates — the AppContext code that stamps
-- role='pending' for brand-new signups never runs because a profile already
-- exists (created by the DB trigger).
--
-- Fix: change the column DEFAULT to 'pending', patch the handle_new_user
-- trigger (if present) to explicitly set 'pending', and surface any existing
-- profiles that ARE currently 'agent' so Nic can audit them before rollout.
--
-- Safe to run multiple times.

-- ── 1) Flip the column default so no code path can produce an 'agent' by omission
ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'pending';

-- ── 2) Replace the auto-signup trigger. This is the Supabase-standard
--    "on new auth.users row → create profile row" trigger. We rewrite it to
--    stamp 'pending' explicitly so no future migration or manual insert can
--    silently produce an 'agent' account.
--
--    If your project doesn't have a handle_new_user trigger, this block still
--    runs safely — CREATE OR REPLACE handles both new and existing cases.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The bootstrap admin gets 'admin' by email match; everyone else starts
  -- 'pending' and has to be approved via the admin panel before they can
  -- see or do anything.
  INSERT INTO public.profiles (user_id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    CASE
      WHEN lower(NEW.email) = 'murrayhealthadvising@gmail.com' THEN 'admin'
      ELSE 'pending'
    END
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Ensure the trigger exists and points at the updated function. Idempotent.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 3) Audit existing profiles Nic didn't explicitly approve. This does NOT
--    demote anyone — it just LISTS them so Nic can review before deciding
--    whether to demote to 'pending' or leave as 'agent'.
--
--    Ideally: rows with role='agent' that have never inserted a lead are
--    almost certainly ghost accounts that snuck in through the default.
SELECT
  p.user_id,
  p.email,
  p.full_name,
  p.role,
  p.created_at,
  (SELECT COUNT(*) FROM public.leads l WHERE l.user_id = p.user_id) AS lead_count,
  CASE
    WHEN lower(p.email) = 'murrayhealthadvising@gmail.com' THEN 'BOOTSTRAP — keep admin'
    WHEN (SELECT COUNT(*) FROM public.leads l WHERE l.user_id = p.user_id) = 0
         AND p.role = 'agent'
      THEN '⚠ Never used — probably a ghost. Consider demoting to pending.'
    WHEN p.role IN ('agent', 'admin', 'runner')
      THEN 'Active user — leave as-is'
    ELSE 'Review'
  END AS audit_note
FROM public.profiles p
ORDER BY p.created_at DESC;

-- ── 4) OPTIONAL: run this only if the audit above shows ghost 'agent' rows
--    you want to demote in one shot. Commented out by default so it doesn't
--    surprise anyone. Uncomment and re-run selectively.
--
-- UPDATE public.profiles
-- SET role = 'pending'
-- WHERE role = 'agent'
--   AND lower(email) <> 'murrayhealthadvising@gmail.com'
--   AND user_id NOT IN (SELECT DISTINCT user_id FROM public.leads WHERE user_id IS NOT NULL);
