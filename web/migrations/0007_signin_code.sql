-- Sign-in code · 2026-11-11
-- The sign-in email now carries a six-digit code beside the link, for readers who open the email somewhere
-- other than where they asked (the home-screen app on an iPhone keeps its own cookies, apart from the
-- browser the link opens in). The code shares the link's 15 minutes and is spent with it; five wrong
-- tries spend it too.
ALTER TABLE owners ADD COLUMN magic_code TEXT;
ALTER TABLE owners ADD COLUMN code_tries INTEGER NOT NULL DEFAULT 0;
