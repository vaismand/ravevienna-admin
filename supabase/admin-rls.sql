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

DROP POLICY IF EXISTS "Admins delete draft_events" ON public.draft_events;
CREATE POLICY "Admins delete draft_events"
  ON public.draft_events FOR DELETE
  USING (public.is_admin());

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

-- Dedupe published events (safe to re-run; skips if constraint already exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'events_source_external_unique'
      AND conrelid = 'public.events'::regclass
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_source_external_unique UNIQUE (source_id, external_id);
  END IF;
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

-- Optional: source for hand-entered events (pick in "Add event" form)
-- INSERT INTO public.event_sources (name, slug)
-- VALUES ('Manual', 'manual')
-- ON CONFLICT DO NOTHING;

-- event_submissions (app user submissions)
ALTER TABLE public.event_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins select event_submissions" ON public.event_submissions;
CREATE POLICY "Admins select event_submissions"
  ON public.event_submissions FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins update event_submissions" ON public.event_submissions;
CREATE POLICY "Admins update event_submissions"
  ON public.event_submissions FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins delete event_submissions" ON public.event_submissions;
CREATE POLICY "Admins delete event_submissions"
  ON public.event_submissions FOR DELETE
  USING (public.is_admin());

-- Optional: source for published user submissions
-- INSERT INTO public.event_sources (name, slug)
-- VALUES ('User submission', 'user-submission')
-- ON CONFLICT DO NOTHING;
