-- Add 'ar_aging' to the engagement_file_kind_enum so we can store the
-- per-engagement AR Aging supporting schedule alongside the existing
-- py_audit + cy_tb files. The unique (engagement_id, kind) constraint on
-- engagement_files keeps one aging per engagement (replace-on-reupload).
alter type engagement_file_kind_enum add value if not exists 'ar_aging';

notify pgrst, 'reload schema';
