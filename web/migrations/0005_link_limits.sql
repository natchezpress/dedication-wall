-- Sign-in link limits · 2026-11-09
-- The maker gained a "Send it again" button. Three caps keep Resend's 100-a-day and a stranger's inbox safe:
-- one link per email per minute, six per email per Central day, and twenty per visitor hash per day.
ALTER TABLE owners ADD COLUMN link_sent_at INTEGER;
ALTER TABLE owners ADD COLUMN links_day TEXT;
ALTER TABLE owners ADD COLUMN links_n INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS link_uses (
  visitor          TEXT NOT NULL,
  day              TEXT NOT NULL,
  n                INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (visitor, day)
);
