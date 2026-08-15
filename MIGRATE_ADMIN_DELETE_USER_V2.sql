-- Infinite CRM — Admin: delete user RPC (v2)
--
-- Fixes the "can't delete runner accounts" case. The v1 RPC only enumerated a
-- handful of tables; anything else with a FK to auth.users (or missing an ON
-- DELETE CASCADE) would abort the final `DELETE FROM auth.users` and roll the
-- whole thing back with a vague constraint error.
--
-- v2 changes:
--   • Explicitly clears every currently-known user-scoped table (warm_bucket_*,
--     api_keys, user_settings, google_calendar_tokens, webhook_endpoints, etc.)
--     wrapped in per-table EXCEPTION blocks so a missing table never aborts.
--   • Catches the final auth.users DELETE and re-raises with the specific
--     constraint / table name so future gaps are obvious.
--   • Runner-specific: also nullifies profiles.lead_agent_id even when the
--     target has role='runner' (defensive; a runner being pointed AT would be
--     unusual but this keeps the graph consistent).
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
  err_msg TEXT;
BEGIN
  -- ── Guard 1: signed in
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Must be signed in.';
  END IF;

  -- ── Guard 2: caller is admin
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
    RAISE EXCEPTION 'No auth.users row for that id — profile may be orphaned. Delete the profile row directly.';
  END IF;
  IF lower(target_email) = 'murrayhealthadvising@gmail.com' THEN
    RAISE EXCEPTION 'Cannot delete the bootstrap admin account.';
  END IF;

  -- ── Guard 5: only bootstrap admin can delete another admin
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = target_user_id AND role = 'admin'
  ) AND (SELECT email FROM auth.users WHERE id = auth.uid())
     IS DISTINCT FROM 'murrayhealthadvising@gmail.com'
  THEN
    RAISE EXCEPTION 'Only the bootstrap admin can delete another admin.';
  END IF;

  -- ── Runners that pointed at this user (only relevant when target IS a
  --    lead-agent). Clear the pointer so we don't leave orphan runners.
  UPDATE public.profiles
     SET lead_agent_id = NULL,
         role = CASE WHEN role = 'runner' THEN 'pending' ELSE role END
   WHERE lead_agent_id = target_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  deleted := deleted || jsonb_build_object('runners_unlinked', n);

  -- ── Lead-scoped children (must precede leads)
  BEGIN
    DELETE FROM public.lead_reminders WHERE lead_id IN (SELECT id FROM public.leads WHERE user_id = target_user_id);
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted := deleted || jsonb_build_object('lead_reminders', n);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN
    DELETE FROM public.activities WHERE lead_id IN (SELECT id FROM public.leads WHERE user_id = target_user_id);
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted := deleted || jsonb_build_object('activities', n);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  -- ── User-level reminders (guard for missing user_id column)
  BEGIN
    DELETE FROM public.reminders WHERE user_id = target_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted := deleted || jsonb_build_object('reminders', n);
  EXCEPTION WHEN undefined_column OR undefined_table THEN NULL; END;

  -- ── Leads themselves
  BEGIN
    DELETE FROM public.leads WHERE user_id = target_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted := deleted || jsonb_build_object('leads', n);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  -- ── Per-user pipeline stages
  BEGIN
    DELETE FROM public.tags WHERE user_id = target_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted := deleted || jsonb_build_object('tags', n);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  -- ── PitchPrfct
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

  -- ── Google integrations
  BEGIN
    DELETE FROM public.gmail_accounts WHERE user_id = target_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted := deleted || jsonb_build_object('gmail_accounts', n);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN
    DELETE FROM public.google_calendar_tokens WHERE user_id = target_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted := deleted || jsonb_build_object('google_calendar_tokens', n);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  -- ── Commissions
  BEGIN
    DELETE FROM public.commission_entries WHERE user_id = target_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted := deleted || jsonb_build_object('commission_entries', n);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  -- ── Warm bucket
  BEGIN
    DELETE FROM public.warm_bucket_notes WHERE user_id = target_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted := deleted || jsonb_build_object('warm_bucket_notes', n);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN
    DELETE FROM public.warm_bucket_queue WHERE user_id = target_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted := deleted || jsonb_build_object('warm_bucket_queue', n);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  -- ── Infinite API keys
  BEGIN
    DELETE FROM public.api_keys WHERE user_id = target_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted := deleted || jsonb_build_object('api_keys', n);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  -- ── User settings (per-user prefs blob if present)
  BEGIN
    DELETE FROM public.user_settings WHERE user_id = target_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted := deleted || jsonb_build_object('user_settings', n);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  -- ── Webhook endpoints (if present)
  BEGIN
    DELETE FROM public.webhook_endpoints WHERE user_id = target_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted := deleted || jsonb_build_object('webhook_endpoints', n);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  -- ── Profile row
  BEGIN
    DELETE FROM public.profiles WHERE user_id = target_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted := deleted || jsonb_build_object('profile', n);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    RAISE EXCEPTION 'Profile delete failed: %', err_msg;
  END;

  -- ── Auth row — do this LAST. Wrap so an FK we didn't clear surfaces the
  --    specific constraint name instead of a mystery abort.
  BEGIN
    DELETE FROM auth.users WHERE id = target_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted := deleted || jsonb_build_object('auth_user', n);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    RAISE EXCEPTION 'auth.users delete blocked (probably an FK): %', err_msg;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_user_email', target_email,
    'counts', deleted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID) TO authenticated;
