-- Change calendar source URLs to sync daily by default instead of weekly
-- This ensures parents see up-to-date school/kindergarten calendars

-- Update existing sources to sync daily (unless user explicitly set a longer interval)
UPDATE external_source_urls
SET sync_frequency_days = 1
WHERE sync_frequency_days = 7;

-- Change column default for new sources
ALTER TABLE external_source_urls
ALTER COLUMN sync_frequency_days SET DEFAULT 1;

-- Add comment explaining the change
COMMENT ON COLUMN external_source_urls.sync_frequency_days IS 'Days between automatic syncs. Default: 1 (daily) for timely calendar updates.';
