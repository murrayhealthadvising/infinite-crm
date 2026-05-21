-- Infinite CRM — PitchPrfct workflow automation
-- Run this ONCE in the Supabase dashboard → SQL editor.
--
-- Adds the column that stores each agent's comment-keyword → workflow rules.
-- It's read by the email Worker (v4.6) and edited in the CRM under
-- Settings → "PitchPrfct Automation".
--
-- JSONB shape:
--   {
--     "rules": [
--       { "id": "r1", "keyword": "ACN",
--         "workflowId": "<pp workflow id>", "workflowName": "ACN Workflow" }
--     ],
--     "defaultWorkflowId": "<pp workflow id>",
--     "defaultWorkflowName": "Generic Workflow"
--   }
--
-- No RLS change is needed: agents already update their own profiles row, and
-- the Worker reads it with the service key.

alter table public.profiles
  add column if not exists pitchprfct_rules jsonb;
