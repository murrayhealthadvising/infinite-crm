-- Worker v4.11+ adds an attempts column to pitchprfct_queue so the cron can
-- retry transient failures (e.g. PitchPrfct API hiccup) up to 3 times before
-- giving up. Existing rows default to 0. Safe to run multiple times.

alter table pitchprfct_queue
  add column if not exists attempts integer not null default 0;
