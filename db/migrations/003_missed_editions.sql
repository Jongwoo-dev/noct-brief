ALTER TABLE briefings ADD COLUMN missed_at timestamptz;
ALTER TABLE briefings ADD CONSTRAINT missed_edition_without_report
  CHECK (missed_at IS NULL OR (published_at IS NULL AND current_version_id IS NULL));
