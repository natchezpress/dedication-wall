-- Morning notes at 9 a.m. the phone's own time · 2026-11-13
-- The phone's time zone (IANA name from the browser, e.g. America/Los_Angeles). Empty means Central.
ALTER TABLE push_subs ADD COLUMN tz TEXT;
