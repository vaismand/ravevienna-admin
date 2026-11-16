-- Run this in Supabase before merging.
-- An admin save of a city or country sets location_locked. Enrichment must
-- leave those columns unchanged afterwards, including --force and
-- --fix-default-location. Existing rows stay unlocked.

alter table public.djs
  add column if not exists location_locked boolean not null default false;

comment on column public.djs.location_locked is
  'True after an admin saves a city or country. Enrichment leaves city and country unchanged.';
