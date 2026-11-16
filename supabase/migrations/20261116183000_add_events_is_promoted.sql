-- Run this in the Supabase SQL editor. This PR does not apply it.
--
-- Manual pin for the mobile Tonight list. An admin sets is_promoted.
-- Scrapers, draft republish, and submission republish must not write it.
-- There is no promoted_until; clear the flag by hand when the pin should end.
-- Existing rows stay unpromoted.

alter table public.events
  add column if not exists is_promoted boolean not null default false;

comment on column public.events.is_promoted is
  'Manual pin. Promoted events sort above the rest of Tonight. Admins set it; scrapers must not.';

-- Tonight looks up a day's promoted rows. The table is small, but a partial
-- index stays tiny and matches `where is_promoted and event_date = $day`.
create index if not exists events_promoted_event_date_idx
  on public.events (event_date)
  where is_promoted;

-- Privileges and RLS already cover a new column, so this file adds neither.
--
-- Grants are table-level (pg_attribute.attacl is null on events):
--   anon           SELECT, REFERENCES  (not INSERT or UPDATE)
--   authenticated  SELECT, INSERT, UPDATE, DELETE, ...
--   service_role   full table privileges, and it bypasses RLS
-- Table GRANTs apply to columns added later, so anon can read is_promoted
-- and anon still cannot update it.
--
-- Policies are row-level, so they include every column:
--   "Public can read events"     SELECT to anon              USING (true)
--   "events_select_public"       SELECT to anon, authenticated USING (true)
--   "events_admin_update"        UPDATE to authenticated     USING is_admin()
-- No anon UPDATE policy exists. Only an admin session can change the flag.
-- service_role bypasses RLS, which is why scraper writes omit is_promoted
-- in code instead of relying on a policy.
