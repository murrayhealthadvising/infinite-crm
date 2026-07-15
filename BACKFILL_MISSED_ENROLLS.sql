-- Infinite CRM — Backfill leads that were enrolled in PitchPrfct but never
-- got their pp_response_status set or an Auto-enrolled activity logged.
--
-- Root cause: verifyAndLogEnroll's 15-second timing window occasionally
-- misses the actual outbound send (PP is slower than usual, worker restarted
-- mid-verify, etc.). Without a status or activity, agents see no "No reply"
-- pill and no activity-log entry despite PP having sent a real text.
--
-- The Cloudflare Worker v4.25 cron now self-heals these going forward. This
-- script fixes leads that already fell through the cracks.
--
-- Safe to run multiple times. Doesn't touch anything for leads that were
-- correctly marked already.

-- ── 1) Mark any lead as 'awaiting' if:
--    - its pp_response_status is null / unknown
--    - AND it has a pitchprfct_queue row with status='done' (means the
--      queue actually enrolled it)
UPDATE public.leads
   SET pp_response_status = 'awaiting'
 WHERE (pp_response_status IS NULL OR pp_response_status = 'unknown')
   AND id IN (
     SELECT DISTINCT lead_id
       FROM public.pitchprfct_queue
      WHERE status = 'done'
        AND lead_id IS NOT NULL
   );

-- ── 2) Write an Auto-enrolled activity for the same leads if they don't
--    already have one. This is what makes the Action Log show "Auto-enrolled
--    in PitchPrfct workflow" on the lead detail page.
INSERT INTO public.activities (user_id, lead_id, type, note, created_at)
SELECT l.user_id,
       l.id AS lead_id,
       'note'::text AS type,
       'Auto-enrolled in PitchPrfct workflow: (recovered — backfilled)' AS note,
       COALESCE(
         (SELECT MIN(q.updated_at) FROM public.pitchprfct_queue q
           WHERE q.lead_id = l.id AND q.status = 'done'),
         now()
       ) AS created_at
  FROM public.leads l
 WHERE l.pp_response_status IN ('awaiting', 'responded')
   AND NOT EXISTS (
     SELECT 1 FROM public.activities a
      WHERE a.lead_id = l.id
        AND (a.note LIKE 'Auto-enrolled%' OR a.note LIKE 'Manually %')
   )
   -- Only for leads that DEFINITELY were enrolled via the queue
   AND EXISTS (
     SELECT 1 FROM public.pitchprfct_queue q
      WHERE q.lead_id = l.id AND q.status = 'done'
   );

-- ── 3) Sanity check counts
SELECT pp_response_status, COUNT(*) AS lead_count
  FROM public.leads
 GROUP BY 1
 ORDER BY 1;
