-- Failure sensors · 2026-11-10
-- Every place the wall depends on something outside itself writes a row here when it fails (and the
-- page reports its own errors). The worker emails Brock when a kind keeps failing, the nightly job
-- sums yesterday, and /admin shows the last 24 hours. Rows older than 30 days are swept.
CREATE TABLE IF NOT EXISTS failures (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  at               INTEGER NOT NULL,
  kind             TEXT NOT NULL,      -- cutout · words · screen · mail · newsletter · post · server · cap · page · canary
  detail           TEXT,
  visitor          TEXT,
  ua               TEXT
);
CREATE INDEX IF NOT EXISTS failures_at ON failures (at);
CREATE INDEX IF NOT EXISTS failures_kind_at ON failures (kind, at);

-- When Brock was last emailed about a kind, so a bad night is a few emails, not a hundred.
CREATE TABLE IF NOT EXISTS alert_marks (
  kind             TEXT PRIMARY KEY,
  last_at          INTEGER NOT NULL
);
