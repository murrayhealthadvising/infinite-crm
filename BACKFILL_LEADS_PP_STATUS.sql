-- 1. First confirm the column exists. If this errors "column does not exist",
--    run MIGRATE_LEADS_PP_RESPONSE_STATUS.sql first.
select column_name from information_schema.columns
  where table_name = 'leads' and column_name = 'pp_response_status';

-- 2. Backfill: any lead that has an existing "Auto-enrolled" or "Manually →"
--    activity row was already sent through PitchPrfct at some point. Mark them
--    'awaiting' so the cron will start checking their conversations for replies
--    and the badge will show up on the card.
update leads
set pp_response_status = 'awaiting',
    pp_response_checked_at = null
where id in (
  select distinct lead_id from activities
    where note like 'Auto-enrolled in PitchPrfct workflow:%'
       or note like 'Manually %'
)
and (pp_response_status is null or pp_response_status = 'unknown');

-- 3. Also mark any lead that was successfully processed by the queue as
--    awaiting — covers the enrollment path that fires without leaving an
--    activity row (v4.22 and earlier).
update leads
set pp_response_status = 'awaiting',
    pp_response_checked_at = null
where id in (
  select distinct lead_id from pitchprfct_queue
    where status = 'done'
)
and (pp_response_status is null or pp_response_status = 'unknown');

-- 4. Peek at what we ended up with:
select pp_response_status, count(*) from leads group by 1;
