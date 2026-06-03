-- Planning & Risk Questionnaire — single JSONB column on engagements.
-- Stores the 27-question answer set produced by the new form section that
-- replaces the old "CY Risk Profile" + "CY Significant Business Changes"
-- list-builders. Old risk_items / business_change_items tables are
-- intentionally left in place for now (their data is unused going forward).

alter table public.engagements
  add column if not exists planning_questionnaire jsonb not null default '{}'::jsonb;
