-- Word help · 2026-11-03
-- "Need help finding the words?" can ask Claude for five lines from a few words the visitor types
-- about their dog. Nothing the visitor types is stored; this table only counts uses, per visitor hash
-- (IP + browser + the Central day, never the IP itself) and per day, to rate-limit the endpoint.
CREATE TABLE IF NOT EXISTS suggest_uses (
  visitor          TEXT NOT NULL,
  day              TEXT NOT NULL,
  n                INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (visitor, day)
);
