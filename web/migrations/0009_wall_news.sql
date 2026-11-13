-- New dogs in the evening note · 2026-11-13
-- The evening note (0008) now also tells everyone with a dog on the wall about dogs other people put up.
--   owners.news_at  unix time up to which this owner has been told about new dogs
-- Existing owners start from 24 hours before this ships, so the first note covers the last day's dogs
-- rather than every dog ever posted. A new owner starts from their own first dog going live.
ALTER TABLE owners ADD COLUMN news_at INTEGER;
UPDATE owners SET news_at = CAST(strftime('%s','now') AS INTEGER) - 86400;
