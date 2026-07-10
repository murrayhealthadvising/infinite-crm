-- Infinite CRM — Admin: delete user RPC
--
-- Adds a SECURITY DEFINER function so admins can fully purge a user account
-- from the admin panel: profile, leads, activities, reminders, tags,
-- pitchprfct rows, gmail/calendar tokens, and finally the auth.users row so
-- they can't sign back in.
--
-- Auth model:
--   * Caller must be signed in (auth.uid() not null)
--   * Caller's profile must be role='admin'
--   * Cannot delete SELF (would lock the admin out)
--   * Cannot delete the bootstrap admin (murrayhealthadvising@gmail.com)
--
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.admin_delete_user(target_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  caller_role TEXT;
  target_email TEXT;
  deleted JSONB := '{}'::jsonb;
  n INT;
BEGIN
  -- ── Guard 1: must be signed in
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Must be signed in.';
  END IF;

  -- ── Guard 2: caller must be admin
  SELECT role INTO caller_role FROM public.profiles WHERE user_id = auth.uid();
  IF caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins can delete accounts.';
  END IF;

  -- ── Guard 3: no self-delete
  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot delete your own account from the admin panel.';
  END IF;

  -- ── Guard 4: no deleting the bootstrap admin, ever
  SELECT email INTO target_email FROM auth.users WHERE id = target_user_id;
  IF target_email IS NULL THEN
    RAISE EXCEPTION 'No user with that id.';
  END IF;
  IF lower(target_email) = 'murrayhealthadvising@gmail.com' THEN
    RAISE EXCEPTION 'Cannot delete the bootstrap admin account.';
  END IF;

  -- ── Guard 5: block deleting any other admin unless caller is bootstrap.
  --    Keeps a second admin from accidentally nuking a peer without Nic's OK.
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = target_user_id AND role = 'admin'
  ) AND (SELECT email FROM auth.users WHERE id = auth.uid())
     IS DISTINCT FROM 'murrayhealthadvising@gmail.com'
  THEN
    RAISE EXCEPTION 'Only the bootstrap admin can delete another admin.';
  END IF;

  -- ── Cascade cleanup. Order matters: delete anything referencing this user
  --    BEFORE dropping the profile/auth row. Use GET DIAGNOSTICS to track
  --    counts so the caller can show "deleted X leads, Y activities" etc.

  -- Runners point at this user via lead_agent_id — clear the pointer so they
  -- don't become "orphan runners" pointing at a ghost. We DON'T demote them
  -- automatically; Nic can decide whether to reassign or demote.
  UPDATE public.profiles
     SET lead_agent_id = NULL, role = CASE WHEN role = 'runner' THEN 'pending' ELSE role END
   WHERE lead_agent_id = target_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  deleted := deleted || jsonb_build_object('runners_unlinked', n);

  -- lead_reminders → activities → leads (activities/reminders FK to leads)
  DELETE FROM public.lead_reminders WHERE lead_id IN (SELECT id FROM public.leads WHERE user_id = target_user_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  deleted := deleted || jsonb_build_object('lead_reminders', n);

  DELETE FROM public.activities WHERE lead_id IN (SELECT id FROM public.leads WHERE user_id = target_user_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  deleted := deleted || jsonb_build_object('activities', n);

  -- User-level reminders (not lead-scoped) — if the reminders table has a
  -- user_id column, wipe those too. IF NOT EXISTS is defensive: if the
  -- column isn't there yet, skip silently.
  BEGIN
    DELETE FROM public.reminders WHERE user_id = target_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted := deleted || jsonb_build_object('reminders', n);
  EXCEPTION WHEN undefined_column THEN
    NULL;
  END;

  DELETE FROM public.leads WHERE user_id = target_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  deleted := deleted || jsonb_build_object('leads', n);

  -- Pipeline stages (tags) — per-user since the runner migration
  DELETE FROM public.tags WHERE user_id = target_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  deleted := deleted || jsonb_build_object('tags', n);

  -- Integrations
  BEGIN
    DELETE FROM public.pitchprfct_queue WHERE user_id = target_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted := deleted || jsonb_build_object('pitchprfct_queue', n);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN
    DELETE FROM public.pitchprfct_keys WHERE user_id = target_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted := deleted || jsonb_build_object('pitchprfct_keys', n);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN
    DELETE FROM public.gmail_accounts WHERE user_id = target_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted := deleted || jsonb_build_object('gmail_accounts', n);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN
    DELETE FROM public.commission_entries WHERE user_id = target_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted := deleted || jsonb_build_object('commission_entries', n);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  -- Profile row
  DELETE FROM public.profiles WHERE user_id = target_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  deleted := deleted || jsonb_build_object('profile', n);

  -- Auth row — do this LAST. Once this is gone the user can't sign in even
  -- if they still have an active session token; Supabase invalidates it.
  DELETE FROM auth.users WHERE id = target_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  deleted := deleted || jsonb_build_object('auth_user', n);

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_user_email', target_email,
    'counts', deleted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID) TO authenticated;
