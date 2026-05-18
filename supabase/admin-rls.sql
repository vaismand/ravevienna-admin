-- Run in Supabase SQL Editor (Dashboard → SQL → New query)
-- Grants admin users full read/write on admin panel tables via RLS.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND lower(trim(role)) = 'admin'
  );
$$;

-- profiles: users can read their own row (required for login gate)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own profile" ON public.profiles;
CREATE POLICY "Users read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- draft_events
ALTER TABLE public.draft_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins select draft_events" ON public.draft_events;
CREATE POLICY "Admins select draft_events"
  ON public.draft_events FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins insert draft_events" ON public.draft_events;
CREATE POLICY "Admins insert draft_events"
  ON public.draft_events FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins update draft_events" ON public.draft_events;
CREATE POLICY "Admins update draft_events"
  ON public.draft_events FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- events (publish target)
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins select events" ON public.events;
CREATE POLICY "Admins select events"
  ON public.events FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins insert events" ON public.events;
CREATE POLICY "Admins insert events"
  ON public.events FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins update events" ON public.events;
CREATE POLICY "Admins update events"
  ON public.events FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Dedupe published events (recommended)
DO $$ BEGIN
  ALTER TABLE public.events
    ADD CONSTRAINT events_source_external_unique UNIQUE (source_id, external_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- venues & event_sources (reference data for filters/cards)
ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read venues" ON public.venues;
CREATE POLICY "Admins read venues"
  ON public.venues FOR SELECT
  USING (public.is_admin());

ALTER TABLE public.event_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read event_sources" ON public.event_sources;
CREATE POLICY "Admins read event_sources"
  ON public.event_sources FOR SELECT
  USING (public.is_admin());
