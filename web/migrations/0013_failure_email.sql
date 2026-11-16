-- 11/16: who ran into a failure, when they were signed in (the email they gave to post), so the admin page can
-- say whether they got through afterwards. Failures are kept 30 days, then swept.
ALTER TABLE failures ADD COLUMN email TEXT;
