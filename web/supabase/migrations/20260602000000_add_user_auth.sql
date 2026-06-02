-- Adds per-user ownership to engagements and the engagement-scoped child
-- tables, plus row-level-security policies so authenticated users only see
-- their own engagements through the anon/authenticated key. The server-
-- side service-role key continues to bypass RLS for trusted operations
-- (intake parsing, generation pipelines).
--
-- Ownership is nullable so the migration can run without a user existing
-- yet. New rows must set owner_id. Existing rows (e.g. the Hartwell demo)
-- are left null until the corresponding user logs in and claims them.

-- ---------------------------------------------------------------------------
-- engagements
-- ---------------------------------------------------------------------------
alter table engagements
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

create index if not exists idx_engagements_owner_id on engagements (owner_id);

-- Authenticated users may select / insert / update / delete only their own
-- engagements. INSERT additionally enforces that the new row's owner_id
-- matches the caller's uid (you can't create an engagement for someone else).
drop policy if exists "engagements_owner_select" on engagements;
drop policy if exists "engagements_owner_insert" on engagements;
drop policy if exists "engagements_owner_update" on engagements;
drop policy if exists "engagements_owner_delete" on engagements;

create policy "engagements_owner_select" on engagements
  for select to authenticated using (owner_id = auth.uid());
create policy "engagements_owner_insert" on engagements
  for insert to authenticated with check (owner_id = auth.uid());
create policy "engagements_owner_update" on engagements
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "engagements_owner_delete" on engagements
  for delete to authenticated using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- engagement_risk_items + engagement_business_changes — child tables that
-- inherit ownership via the engagement they belong to.
-- ---------------------------------------------------------------------------
drop policy if exists "engagement_risk_items_owner_all" on engagement_risk_items;
create policy "engagement_risk_items_owner_all" on engagement_risk_items
  for all to authenticated
  using (
    exists (
      select 1 from engagements e
      where e.id = engagement_risk_items.engagement_id
        and e.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from engagements e
      where e.id = engagement_risk_items.engagement_id
        and e.owner_id = auth.uid()
    )
  );

drop policy if exists "engagement_business_changes_owner_all" on engagement_business_changes;
create policy "engagement_business_changes_owner_all" on engagement_business_changes
  for all to authenticated
  using (
    exists (
      select 1 from engagements e
      where e.id = engagement_business_changes.engagement_id
        and e.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from engagements e
      where e.id = engagement_business_changes.engagement_id
        and e.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- engagement_files — same pattern.
-- ---------------------------------------------------------------------------
drop policy if exists "engagement_files_owner_all" on engagement_files;
create policy "engagement_files_owner_all" on engagement_files
  for all to authenticated
  using (
    exists (
      select 1 from engagements e
      where e.id = engagement_files.engagement_id
        and e.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from engagements e
      where e.id = engagement_files.engagement_id
        and e.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- engagement_py_workpapers — same pattern.
-- ---------------------------------------------------------------------------
drop policy if exists "engagement_py_workpapers_owner_all" on engagement_py_workpapers;
create policy "engagement_py_workpapers_owner_all" on engagement_py_workpapers
  for all to authenticated
  using (
    exists (
      select 1 from engagements e
      where e.id = engagement_py_workpapers.engagement_id
        and e.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from engagements e
      where e.id = engagement_py_workpapers.engagement_id
        and e.owner_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
