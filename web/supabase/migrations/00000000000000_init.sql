-- Fieldwork Engagement Setup — initial schema
-- Tables mirror the JSON Schema at specs/engagement-setup.schema.json.
-- RLS is enabled on every table. v1 access is server-only via service role.
-- Auth + per-firm row policies arrive in Milestone 2 alongside per-seat licensing.

create extension if not exists "pgcrypto";

-- Enums kept in sync with the JSON Schema enums.
create type framework_enum as enum ('AICPA', 'IFRS', 'PCAOB');
create type industry_enum as enum ('Manufacturing', 'SaaS', 'NFP', 'ConsumerBusiness', 'RealEstate');
create type risk_category_enum as enum (
  'Industry', 'EntitySpecific', 'Fraud', 'GoingConcern',
  'RelatedParty', 'SignificantEstimate', 'ITGeneral', 'Other'
);
create type business_change_category_enum as enum (
  'ManagementChange', 'SystemChange', 'NewProductOrMarket', 'MergerOrAcquisition',
  'Restructuring', 'SignificantContract', 'RegulatoryChange', 'Other'
);
create type engagement_file_kind_enum as enum ('py_audit', 'cy_tb');

create table engagements (
  id                              uuid primary key default gen_random_uuid(),
  client_name                     text not null check (length(client_name) between 1 and 200),
  fiscal_year_end                 date not null,
  reporting_period_start          date,
  framework                       framework_enum not null,
  industry                        industry_enum not null,
  risk_narrative                  text check (risk_narrative is null or length(risk_narrative) <= 10000),
  business_changes_narrative      text check (business_changes_narrative is null or length(business_changes_narrative) <= 10000),
  materiality_currency            text not null default 'USD' check (materiality_currency = 'USD'),
  overall_materiality             numeric(18, 2) not null check (overall_materiality > 0),
  performance_materiality         numeric(18, 2) not null check (performance_materiality > 0),
  clearly_trivial_threshold       numeric(18, 2) not null check (clearly_trivial_threshold > 0),
  materiality_basis               text not null check (length(materiality_basis) between 1 and 2000),
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

create table engagement_risk_items (
  id              uuid primary key default gen_random_uuid(),
  engagement_id   uuid not null references engagements(id) on delete cascade,
  category        risk_category_enum not null,
  description     text not null check (length(description) between 1 and 4000),
  position        integer not null default 0
);

create index engagement_risk_items_engagement_id_idx
  on engagement_risk_items(engagement_id, position);

create table engagement_business_changes (
  id              uuid primary key default gen_random_uuid(),
  engagement_id   uuid not null references engagements(id) on delete cascade,
  category        business_change_category_enum not null,
  description     text not null check (length(description) between 1 and 4000),
  position        integer not null default 0
);

create index engagement_business_changes_engagement_id_idx
  on engagement_business_changes(engagement_id, position);

create table engagement_files (
  id                  uuid primary key default gen_random_uuid(),
  engagement_id       uuid not null references engagements(id) on delete cascade,
  kind                engagement_file_kind_enum not null,
  storage_path        text not null,
  original_filename   text not null check (length(original_filename) between 1 and 300),
  content_type        text not null,
  size_bytes          bigint not null check (size_bytes >= 0),
  uploaded_at         timestamptz not null default now(),
  unique (engagement_id, kind)
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger engagements_set_updated_at
  before update on engagements
  for each row execute function set_updated_at();

-- RLS — v1 is server-only via service role; lock down anon/auth roles entirely.
alter table engagements                 enable row level security;
alter table engagement_risk_items       enable row level security;
alter table engagement_business_changes enable row level security;
alter table engagement_files            enable row level security;

-- No policies are defined for anon/auth. Service role bypasses RLS and is the
-- only credential the server uses for v1. Add per-firm policies in M2.

-- Storage bucket for engagement-uploaded files. Created idempotently.
insert into storage.buckets (id, name, public)
values ('engagement-files', 'engagement-files', false)
on conflict (id) do nothing;
