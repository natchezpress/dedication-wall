-- Email invites · 2026-10-31
-- An owner may invite up to five people by email from a live dedication. Nothing about the invitee
-- is stored: only a salted one-way hash, used to send once per entry and to honor "don't email me again."
CREATE TABLE IF NOT EXISTS invite_sends (
  entry_id         TEXT NOT NULL REFERENCES entries(id),
  to_hash          TEXT NOT NULL,
  sent_at          INTEGER NOT NULL,
  PRIMARY KEY (entry_id, to_hash)
);

CREATE TABLE IF NOT EXISTS suppressed (
  to_hash          TEXT PRIMARY KEY,
  added_at         INTEGER NOT NULL
);
