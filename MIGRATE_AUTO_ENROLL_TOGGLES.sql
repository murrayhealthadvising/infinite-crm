-- Infinite CRM — Auto-text (auto PP enroll) toggles
--
-- Adds two kill-switches so agents can disable AUTOMATIC PitchPrfct enrollment
-- without losing the ability to manually enroll or view PP conversations.
--
-- 1. profiles.pp_auto_enroll_enabled — global per-agent switch. Default TRUE
--    so existing behavior is unchanged. Flip FALSE in Settings → PitchPrfct
--    to stop auto-enrolling on every new lead; agent can still click the
--    Enroll button on any individual lead.
--
-- 2. leads.auto_enroll — per-lead opt-out. Default TRUE. Flip FALSE on a
--    specific lead to prevent auto-enroll firing for just that one (useful
--    for a lead you want to work manually before PP reaches out).
--
-- Worker's enrollLeadInPitch() checks BOTH before firing. Manual enroll
-- (/pp-enroll-manual) and conversation view (/pp-conversation) IGNORE
-- these flags — they're explicit agent actions, not automatic.
--
-- Safe to re-run.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pp_auto_enroll_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS auto_enroll BOOLEAN NOT NULL DEFAULT TRUE;

-- Backfill (defensive — DEFAULT already handles new rows; this fills any
-- existing NULLs that slipped through on legacy rows).
UPDATE public.profiles SET pp_auto_enroll_enabled = TRUE WHERE pp_auto_enroll_enabled IS NULL;
UPDATE public.leads    SET auto_enroll           = TRUE WHERE auto_enroll           IS NULL;

-- Verify
SELECT 'profiles' AS t, COUNT(*) FILTER (WHERE pp_auto_enroll_enabled) AS enabled, COUNT(*) AS total FROM public.profiles
UNION ALL
SELECT 'leads',          COUNT(*) FILTER (WHERE auto_enroll),                    COUNT(*)      FROM public.leads;
