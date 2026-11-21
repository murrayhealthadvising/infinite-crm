-- Infinite CRM — Paper Application in the CRM
--
-- Adds two columns to leads for the in-CRM paper-application flow:
--
--   1. application              JSONB  — the full form state. Saves as the
--                                        agent types so no data is ever lost.
--   2. application_pdf_path     TEXT   — path WITHIN the private Supabase
--                                        storage bucket. NOT a public URL —
--                                        the app generates a short-lived
--                                        signed URL on demand each time
--                                        someone clicks View PDF.
--
-- Safe to re-run.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS application          JSONB,
  ADD COLUMN IF NOT EXISTS application_pdf_path TEXT;

-- Legacy: if an earlier draft of this migration added application_pdf_url,
-- carry its data over to application_pdf_path. Safe no-op if the column
-- never existed. (The app code only reads/writes application_pdf_path now.)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'application_pdf_url'
  ) THEN
    UPDATE public.leads SET application_pdf_path = application_pdf_url
      WHERE application_pdf_path IS NULL AND application_pdf_url IS NOT NULL;
    -- Leave the old column in place for rollback safety; drop manually if desired.
  END IF;
END$$;

-- Verify
SELECT COUNT(*) FILTER (WHERE application IS NOT NULL)          AS started,
       COUNT(*) FILTER (WHERE application_pdf_path IS NOT NULL) AS finalized,
       COUNT(*)                                                  AS total
  FROM public.leads;

-- ─── Storage setup (one-time, in Supabase Dashboard): ─────────────────────
-- Storage → Buckets → New Bucket
--   Name: applications
--   Public: OFF   ← CRITICAL. Private bucket = no one can read without a
--                   signed URL from our authenticated backend. PHI stays
--                   PHI even if a URL leaks.
--   Click Save.
--
-- Then Storage → Policies → New policy on the `applications` bucket:
--   Policy 1 — "Agents upload only to their own folder"
--     Operation: INSERT
--     USING / WITH CHECK:
--       (bucket_id = 'applications'
--        AND (storage.foldername(name))[1] = auth.uid()::text)
--
--   Policy 2 — "Agents read only their own folder"
--     Operation: SELECT
--     USING:
--       (bucket_id = 'applications'
--        AND (storage.foldername(name))[1] = auth.uid()::text)
--
--   Policy 3 — "Agents delete only their own folder"
--     Operation: DELETE
--     USING:
--       (bucket_id = 'applications'
--        AND (storage.foldername(name))[1] = auth.uid()::text)
--
-- The app uploads files to  <user_id>/<lead_id>/<timestamp>_name.pdf  so
-- each agent's uploads sit under a folder named with their own user_id.
-- These three policies ensure: an agent can read/write THEIR OWN
-- applications, nobody else's, and the public internet gets nothing.
-- ──────────────────────────────────────────────────────────────────────
