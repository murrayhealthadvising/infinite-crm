-- Infinite CRM — Auto-text (auto PP enroll) toggle
--
-- Adds a global per-agent kill-switch for AUTOMATIC PitchPrfct enrollment.
-- When FALSE, new leads land without firing any PP workflow — but the agent
-- can still manually enroll from the Enroll button and view the PP
-- conversation on any lead. Defaults to TRUE so existing behavior is
-- unchanged.
--
-- Per-lead opt-out isn't needed: the X (unenroll) button already handles
-- that case after a lead has been auto-enrolled.
--
-- Safe to re-run.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pp_auto_enroll_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Backfill any NULLs on legacy rows
UPDATE public.profiles SET pp_auto_enroll_enabled = TRUE WHERE pp_auto_enroll_enabled IS NULL;

-- Verify
SELECT COUNT(*) FILTER (WHERE pp_auto_enroll_enabled) AS enabled,
       COUNT(*)                                       AS total
  FROM public.profiles;
