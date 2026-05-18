import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { EventSource, ReferenceMaps, Venue } from '../types/database';

interface ReferenceDataState {
  venues: Venue[];
  sources: EventSource[];
  maps: ReferenceMaps;
  loading: boolean;
  error: string | null;
  warning: string | null;
}

export function useReferenceData() {
  const [state, setState] = useState<ReferenceDataState>({
    venues: [],
    sources: [],
    maps: { venues: new Map(), sources: new Map() },
    loading: true,
    error: null,
    warning: null,
  });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null, warning: null }));

    const [venuesRes, sourcesRes] = await Promise.all([
      supabase.from('venues').select('id, name').order('name'),
      supabase.from('event_sources').select('id, name').order('name'),
    ]);

    const warnings: string[] = [];

    if (venuesRes.error) {
      warnings.push(`Venues: ${venuesRes.error.message}`);
    }
    if (sourcesRes.error) {
      warnings.push(`Sources: ${sourcesRes.error.message}`);
    }

    const venues = (venuesRes.data ?? []) as Venue[];
    const sources = (sourcesRes.data ?? []) as EventSource[];

    const venueMap = new Map(venues.map((v) => [v.id, v]));
    const sourceMap = new Map(sources.map((s) => [s.id, s]));

    setState({
      venues,
      sources,
      maps: { venues: venueMap, sources: sourceMap },
      loading: false,
      error: null,
      warning: warnings.length > 0 ? warnings.join(' · ') : null,
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, reload: load };
}
