-- 11/19, Brock: “flush any of those metrics … for ones that are just me, testing.”
-- Every removed or rejected entry so far came from Brock's own addresses (Nov 2–11 tests,
-- walkthroughs, sample dogs). Flag them as tests so no count includes them; the rows stay.
-- Only removed or rejected rows, so a dog on the wall can never be caught by this.
UPDATE entries SET is_test = 1
 WHERE status IN ('removed', 'rejected')
   AND id IN ('mqkqqdjw', 'c8b7zjwz', 'csmnqvqg', 'u5skufeg', 'swafjpt6', '5xxvgrr2', 'qbew4ff7',
              'w3zwwc9u', 'e72s36k4', 'queaj4bu', 'ne48489k', 'tsb8pye5', 'ag4c8esk',
              '5n9y75bq', 'upwpbdqd', 'jttzbrak');
-- Microsoft Outlook's link scanner, not a person (nine on 11/19 at 10:05 a.m.); /api/log drops these from now on.
DELETE FROM failures WHERE detail LIKE '%Object Not Found Matching Id%';
