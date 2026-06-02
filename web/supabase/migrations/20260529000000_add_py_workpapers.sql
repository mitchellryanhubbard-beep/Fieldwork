-- Prior-year workpaper ingest table.
--
-- One row per uploaded PY workpaper xlsx. Many per engagement (vs. the
-- single-record-per-kind shape of engagement_files), so a dedicated
-- table is the right home.
--
-- fsli is best-effort AI tagging — null until classification runs, or
-- when the auditor explicitly marks a file "Unsorted" / overrides.
--
-- generated_cy_storage_path is set when the auditor clicks "Generate CY
-- workpaper" for this PY. Null until then.

create table engagement_py_workpapers (
  id                              uuid primary key default gen_random_uuid(),
  engagement_id                   uuid not null references engagements(id) on delete cascade,
  storage_path                    text not null,
  original_filename               text not null check (length(original_filename) between 1 and 300),
  content_type                    text not null,
  size_bytes                      bigint not null check (size_bytes >= 0),
  fsli                            text,                         -- e.g. "Accounts Receivable, net"; null until tagged
  fsli_tagged_at                  timestamptz,
  generated_cy_storage_path       text,                          -- null until CY is generated
  generated_cy_at                 timestamptz,
  uploaded_at                     timestamptz not null default now()
);

create index engagement_py_workpapers_engagement_id_idx
  on engagement_py_workpapers(engagement_id, fsli);

alter table engagement_py_workpapers enable row level security;

-- No policies on anon/auth — service role bypasses RLS and is the only
-- credential the server uses in v1.

notify pgrst, 'reload schema';
