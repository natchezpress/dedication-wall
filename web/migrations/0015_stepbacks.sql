-- 11/16 (Brock: “can you tell me when someone disengages”): every way someone steps back from the wall, with
-- when. kind: mail_off (turned the evening emails off), mail_on (back on), spam (marked a wall email as spam),
-- bounce (an email to them bounced for good), push_off (a phone turned the weekly notification off),
-- dog_removed (took their own dog off the wall), invite_off (an invited friend said “don't email me again”).
-- email is kept for people who have signed in; never for invited friends (their address isn't kept anywhere).
CREATE TABLE IF NOT EXISTS stepbacks (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      INTEGER NOT NULL,
  kind    TEXT NOT NULL,
  email   TEXT,
  detail  TEXT
);
CREATE INDEX IF NOT EXISTS stepbacks_at ON stepbacks(at);
