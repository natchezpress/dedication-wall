-- Heart emails · 2026-11-13
-- A dog's person hears about hearts: one catch-up email for the hearts already given, then at most one
-- short email a day, on evenings a dog got new hearts. Off with one tap.
--   entries.hearts_mailed  the heart count the owner was last told about (new hearts = hearts − this)
--   owners.heart_mail_day  Central day of the last heart email (the once-a-day guard)
--   owners.heart_mail_off  1 = the owner turned heart emails off
--   owners.mail_key        opaque key for the on/off link, so no address rides in a URL
-- The catch-up runs once, on the first hourly tick after this ships (setting heart_catchup).
ALTER TABLE entries ADD COLUMN hearts_mailed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE owners ADD COLUMN heart_mail_day TEXT;
ALTER TABLE owners ADD COLUMN heart_mail_off INTEGER NOT NULL DEFAULT 0;
ALTER TABLE owners ADD COLUMN mail_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS owners_mail_key ON owners(mail_key);
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('heart_catchup', 'pending', strftime('%s','now'));
