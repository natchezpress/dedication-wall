-- Photo cutout · 2026-11-03
-- For Jetson's Spots (sticker) backgrounds the maker can cut the dog out of the photo automatically:
-- the photo goes to Cloudflare Images (segment=foreground, BiRefNet) and comes back with a
-- transparent background. The photo is held in R2 under tmp/cut/ for the seconds the transform takes,
-- then deleted. This table only counts uses per visitor hash per day, to rate-limit the endpoint.
CREATE TABLE IF NOT EXISTS cutout_uses (
  visitor          TEXT NOT NULL,
  day              TEXT NOT NULL,
  n                INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (visitor, day)
);
