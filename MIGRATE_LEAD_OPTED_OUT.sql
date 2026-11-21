-- Infinite CRM — Per-lead opt-out flag
--
-- When the agent has personally contacted a lead and the lead asked not to be
-- texted again (or the agent just wants to make sure no PP workflow ever hits
-- them), they flip the Opt Out button on the card. From that point on:
--
--   • The worker's auto-enroll (enrollLeadInPitch) refuses to touch this lead
--   • The manual /pp-enroll-manual endpoint also refuses
--   • When the flag is first set the worker fires unenrollAllPPWorkflows to
--     stop any in-flight workflow from sending more texts
--
-- Default FALSE. Nothing changes for existing leads until you flip it.
--
-- Safe to re-run.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS opted_out BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill any NULLs on legacy rows (defensive — DEFAULT FALSE handles new rows)
UPDATE public.leads SET opted_out = FALSE WHERE opted_out IS NULL;

-- Verify
SELECT COUNT(*) FILTER (WHERE opted_out)    AS opted_out,
       COUNT(*) FILTER (WHERE NOT opted_out) AS active,
       COUNT(*)                              AS total
  FROM public.leads;
