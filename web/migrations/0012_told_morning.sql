-- Telling owners about morning notes · 2026-11-13
-- 1 once an owner's evening note has carried the one-time "New: the Dog of the Day on your phone" section.
ALTER TABLE owners ADD COLUMN told_morning INTEGER NOT NULL DEFAULT 0;
