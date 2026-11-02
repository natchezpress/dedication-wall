-- Dedication Wall · schema · 2026-10-31
-- Source: design doc "Dedication Maker and Wall: Design".
-- Applied on every push by the build script (wrangler d1 migrations apply); additive from here on.

-- Owners: one row per verified email.
CREATE TABLE IF NOT EXISTS owners (
  email            TEXT PRIMARY KEY,
  magic_token      TEXT,
  token_expires    INTEGER,            -- unix seconds
  newsletter_opt_in INTEGER NOT NULL DEFAULT 0,
  newsletter_at    INTEGER,
  created_at       INTEGER NOT NULL,
  last_seen_at     INTEGER
);

-- A posted dedication. status: pending → live | rejected | hidden (Brock's switch) | removed (owner's).
CREATE TABLE IF NOT EXISTS entries (
  id               TEXT PRIMARY KEY,   -- short public id, in /d/:id
  dog_name         TEXT NOT NULL,
  line             TEXT NOT NULL,
  mode             TEXT NOT NULL CHECK (mode IN ('for','in_memory')),
  background_id    TEXT NOT NULL,
  photo_key        TEXT NOT NULL,      -- R2: entries/<id>/original.jpg
  story_key        TEXT NOT NULL,      -- entries/<id>/story.jpg  9:16
  feed_key         TEXT NOT NULL,      -- entries/<id>/feed.jpg   4:5
  card_key         TEXT NOT NULL,      -- entries/<id>/card.jpg   1:1 (the link preview)
  owner_email      TEXT NOT NULL REFERENCES owners(email),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','live','rejected','hidden','removed')),
  screen_result    TEXT,               -- JSON verdict from screening
  screened_at      INTEGER,
  attested_at      INTEGER NOT NULL,   -- the 18+ and owner-or-permission box
  terms_version    TEXT NOT NULL,      -- the Terms version shown at Post it
  invite_code      TEXT NOT NULL UNIQUE,
  hearts           INTEGER NOT NULL DEFAULT 0,
  live_at          INTEGER,            -- first publicly visible
  created_at       INTEGER NOT NULL,
  removed_at       INTEGER,
  is_test          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS entries_status_live ON entries(status, live_at DESC);
CREATE INDEX IF NOT EXISTS entries_owner ON entries(owner_email);
CREATE INDEX IF NOT EXISTS entries_mode ON entries(mode, status, live_at DESC);

-- Hearts: one per visitor per entry per Central day.
CREATE TABLE IF NOT EXISTS hearts (
  entry_id         TEXT NOT NULL REFERENCES entries(id),
  visitor_hash     TEXT NOT NULL,
  day              TEXT NOT NULL,      -- YYYY-MM-DD, America/Chicago
  PRIMARY KEY (entry_id, visitor_hash, day)
);

-- Invite links: /i/:code counts a visit, then lands on the dog's page.
CREATE TABLE IF NOT EXISTS invites (
  code             TEXT PRIMARY KEY,
  entry_id         TEXT NOT NULL REFERENCES entries(id),
  visits           INTEGER NOT NULL DEFAULT 0
);

-- Request a background.
CREATE TABLE IF NOT EXISTS requests (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  text             TEXT NOT NULL,
  email            TEXT,
  status           TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','queued','done','declined')),
  created_at       INTEGER NOT NULL
);

-- Every email the wall sends, logged.
CREATE TABLE IF NOT EXISTS notices (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  kind             TEXT NOT NULL,      -- 'signin' | 'live' | 'rejected' | 'digest' | 'alert'
  to_email         TEXT NOT NULL,
  entry_id         TEXT,
  provider_id      TEXT,               -- Resend message id
  status           TEXT NOT NULL,      -- 'sent' | 'failed' | 'dev'
  sent_at          INTEGER NOT NULL,
  detail           TEXT
);

-- Admin switches: change without a deploy.
CREATE TABLE IF NOT EXISTS settings (
  key              TEXT PRIMARY KEY,
  value            TEXT NOT NULL,
  updated_at       INTEGER NOT NULL
);
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('terms_version',  'terms-of-use-2026-05-16', strftime('%s','now')),  -- bump when the Terms page changes
  ('dog_of_the_day', '', strftime('%s','now'));                          -- an entry id; blank = the daily pick
