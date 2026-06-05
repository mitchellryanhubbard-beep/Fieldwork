-- Add 'py_ar_aging' to the engagement_file_kind_enum so we can store a
-- prior-year AR Aging upload alongside the existing CY ar_aging slot.
-- Same parsed-canonical shape (ArAging) — separate kind keeps the
-- unique(engagement_id, kind) replace-on-reupload semantics intact and
-- gives downstream code (analytics, workpaper generation) a way to
-- pull either year independently.
alter type engagement_file_kind_enum add value if not exists 'py_ar_aging';

notify pgrst, 'reload schema';
