-- Roll back supabase/migrations/20261116183000_add_events_is_promoted.sql.
-- Run in the Supabase SQL editor. Dropping the column deletes every pin.

drop index if exists public.events_promoted_event_date_idx;

alter table public.events
  drop column if exists is_promoted;
