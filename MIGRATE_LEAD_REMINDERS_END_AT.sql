-- Migration: add optional end_at to lead_reminders so appointments can span
-- across days (e.g. a Wed 9am → Thu 5pm block). Safe to run multiple times.
--
-- Backward compatible: existing rows with end_at NULL are treated as
-- single-point reminders and rendered on their due_at day only.

alter table lead_reminders
  add column if not exists end_at timestamptz;

-- Index on due_at is already implicit from ORDER BY; add end_at if needed
-- for future range queries. Optional — comment out if you don't want it.
-- create index if not exists lead_reminders_end_at_idx on lead_reminders(end_at);
