-- Add 'subsequent_cash_receipts' to the engagement_file_kind_enum so we
-- can store the per-engagement Subsequent Cash Receipts supporting
-- schedule. Unique (engagement_id, kind) on engagement_files keeps one
-- SCR file per engagement (replace-on-reupload).
alter type engagement_file_kind_enum add value if not exists 'subsequent_cash_receipts';

notify pgrst, 'reload schema';
