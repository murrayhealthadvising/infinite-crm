-- Infinite CRM — Dynamic email routing (kills hardcoded AGENT_ROUTING for new agents)
--
-- Adds `email_routing_local` to profiles so the worker can look up who owns
-- any `<local>-leads@infinite-crm.net` address on the fly without a code
-- change or deploy. Onboarding a new agent: sign up → admin approve →
-- their email alias is live immediately (with Cloudflare catch-all on).
--
-- Backfills from full_name (first word) or email local-part.
-- Safe to re-run.

-- ── Column
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_routing_local TEXT;

-- ── Backfill: derive from full_name (first word) or email local-part,
--    matching the same normalization the worker uses (lowercase, alphanumeric).
UPDATE public.profiles
   SET email_routing_local = LOWER(REGEXP_REPLACE(
       SPLIT_PART(COALESCE(NULLIF(full_name, ''), SPLIT_PART(email, '@', 1)), ' ', 1),
       '[^a-z0-9]', '', 'g'))
 WHERE email_routing_local IS NULL
   AND COALESCE(full_name, email) IS NOT NULL;

-- ── Uniqueness: two agents can't share the same alias. NULL is ignored
--    by the partial unique index so unconfigured rows don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_routing_local_key
  ON public.profiles (email_routing_local)
  WHERE email_routing_local IS NOT NULL;

-- ── Trigger: whenever a profile is created OR its full_name/email changes
--    and email_routing_local isn't set, auto-populate it. Handles the "new
--    signup" case so admins don't have to fill in the field 99% of the time.
CREATE OR REPLACE FUNCTION public.profiles_auto_routing_local()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  derived TEXT;
BEGIN
  IF NEW.email_routing_local IS NULL OR NEW.email_routing_local = '' THEN
    derived := LOWER(REGEXP_REPLACE(
      SPLIT_PART(COALESCE(NULLIF(NEW.full_name, ''), SPLIT_PART(NEW.email, '@', 1)), ' ', 1),
      '[^a-z0-9]', '', 'g'));
    IF derived IS NOT NULL AND derived <> '' THEN
      -- Handle collision by appending a numeric suffix. First-come keeps
      -- their bare alias; collision gets "cole2", "cole3", etc.
      IF EXISTS (SELECT 1 FROM public.profiles
                  WHERE email_routing_local = derived
                    AND user_id <> NEW.user_id) THEN
        FOR i IN 2..99 LOOP
          IF NOT EXISTS (SELECT 1 FROM public.profiles
                          WHERE email_routing_local = derived || i::text
                            AND user_id <> NEW.user_id) THEN
            derived := derived || i::text;
            EXIT;
          END IF;
        END LOOP;
      END IF;
      NEW.email_routing_local := derived;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_auto_routing_local_trg ON public.profiles;
CREATE TRIGGER profiles_auto_routing_local_trg
  BEFORE INSERT OR UPDATE OF full_name, email
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_auto_routing_local();

-- ── Verify: should show every profile with a populated routing_local
SELECT user_id, full_name, email, email_routing_local
  FROM public.profiles
  ORDER BY created_at;
