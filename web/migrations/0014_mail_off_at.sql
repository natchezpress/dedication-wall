-- 11/16: when an owner turned the wall's evening notes off (the admin page and the Monday summary list who and
-- when). Owners who turned them off before this have no time.
ALTER TABLE owners ADD COLUMN heart_mail_off_at INTEGER;
