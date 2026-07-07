-- Migration: add a per-lead PitchPrfct response tracker so the card can show
-- a "Responded" vs "No reply" tag without a live PP round-trip on every render.
--
-- Column values:
--   NULL / 'unknown'   — never enrolled in a PP workflow via this CRM
--   'awaiting'         — enrolled, no reply yet
--   'responded'        — inbound message detected on PP
--
-- The Cloudflare Worker cron flips 'awaiting' → 'responded' when it finds any
-- incoming message on the contact. Auto-enroll writes 'awaiting' on success.
-- Safe to run multiple times.

alter table leads
  add column if not exists pp_response_status text;

-- Also track when we last checked so the cron can round-robin efficiently
alter table leads
  add column if not exists pp_response_checked_at timestamptz;

-- Helpful partial index for the cron scan (only rows the cron cares about)
create index if not exists leads_pp_awaiting_idx
  on leads(pp_response_checked_at)
  where pp_response_status = 'awaiting';
