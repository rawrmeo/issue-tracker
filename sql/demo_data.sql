-- ============================================================================
--  DEMO DATA  (testing helper)
-- ----------------------------------------------------------------------------
--  Fills the board with sample issues so every feature has something to show:
--    * varied statuses (pending / fixing / done) and priorities
--    * two repeated titles, so "Most repeated issues" has a group
--    * several issues older than 7 days, so the stale badges appear
--
--  SAFE BY DESIGN — it only inserts when the issues table is EMPTY, so it can
--  never overwrite real work. Run it in Supabase -> SQL Editor -> Run.
--
--  Want to wipe the board first? Uncomment the DELETE lines below.
-- ============================================================================

-- Uncomment to start from a clean board (this is destructive):
-- delete from public.backups;                    -- optional: also clear snapshots
-- delete from public.issues;                     -- removes everything, bin included

insert into public.issues
  (title, description, priority, status, label, author_id, created_at, updated_at, completed_at)
select
  v.title,
  v.description,
  v.priority,
  v.status,
  v.label,
  a.id,
  now() - (v.days_ago || ' days')::interval,
  now() - (v.days_ago || ' days')::interval,
  case when v.status = 'done'
       then now() - ((v.days_ago - 1) || ' days')::interval
       else null end
from (values
  ('Login button does nothing on mobile',  'Tapping Sign in on the phone does nothing. Works on desktop.',      'high',   'fixing',  'bug',     35),
  ('Login button does nothing on mobile',  'Same problem, still happening after the last deploy.',               'high',   'pending', 'bug',     28),
  ('Login button does nothing on mobile',  'Only on iPhone Safari.',                                             'medium', 'pending', 'bug',      3),
  ('Export to CSV misses closed issues',   'The CSV only contains open issues.',                                 'medium', 'pending', 'bug',     22),
  ('Export to CSV misses closed issues',   'Also seen when the date filter is left empty.',                      'low',    'done',    'bug',     31),
  ('Dark mode flashes white on load',      'A white flash before the dark theme applies.',                       'low',    'done',    'style',   14),
  ('Search should match the description',  'Searching only looks at titles today.',                              'medium', 'done',    'feature', 40),
  ('Add a due date to each issue',         'A due date would help prioritise.',                                  'low',    'pending', 'feature', 12),
  ('Sidebar overlaps the footer on iPad',  'The sidebar cuts off the last menu item.',                           'medium', 'fixing',  'style',    9),
  ('Password reset email never arrives',   'Requested a reset twice, nothing came through.',                     'high',   'pending', 'bug',      5),
  ('Slow dashboard with many issues',      'The dashboard takes about 6s with 200+ issues.',                     'medium', 'pending', 'perf',    18),
  ('Typo in the empty state message',      'Says "no issue yet" instead of "no issues yet".',                    'low',    'done',    'docs',    26),
  ('Make the app installable on a phone',  'Add it to the home screen like a real app.',                         'medium', 'done',    'feature', 33),
  ('Add keyboard shortcuts',               'Nice to have on the issues page.',                                   'low',    'pending', 'feature',  2)
) as v(title, description, priority, status, label, days_ago)
cross join lateral (
  select id from public.profiles where role = 'admin' order by created_at limit 1
) as a
where not exists (select 1 from public.issues)
  and exists (select 1 from public.profiles where role = 'admin');

-- How many rows are on the board now:
select count(*) as issues_on_the_board from public.issues;
