-- Dog of the Day rotation and morning notes · 2026-11-13
-- dotd_log: one row per Central day, so the wall, the dog's page, the owner's email and the morning
-- notification agree on the day's dog, and the rotation knows who has had a turn.
-- push_subs: phones that asked for the Dog of the Day each morning (Web Push). No names or emails.
CREATE TABLE IF NOT EXISTS dotd_log (
  day        TEXT PRIMARY KEY,     -- YYYY-MM-DD, America/Chicago
  entry_id   TEXT NOT NULL,
  picked_at  INTEGER NOT NULL,
  mailed_at  INTEGER               -- the morning job claimed the owner email (sent, skipped or off)
);
CREATE INDEX IF NOT EXISTS dotd_log_entry ON dotd_log(entry_id, day);
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint   TEXT PRIMARY KEY,     -- the phone's push service address (Apple, Google, Mozilla, Microsoft)
  p256dh     TEXT NOT NULL,        -- the phone's public key, base64url
  auth       TEXT NOT NULL,        -- the phone's auth secret, base64url
  created_at INTEGER NOT NULL,
  last_day   TEXT,                 -- Central day of the last morning note tried
  last_ok_at INTEGER,
  fails      INTEGER NOT NULL DEFAULT 0,
  ua         TEXT                  -- browser family, e.g. Safari/iOS
);
