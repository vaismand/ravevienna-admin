import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  passedTabFilter,
  publishedTabFilter,
  reviewListSort,
} from '../lib/reviewStatusQuery';
import { formatPostgrestError } from '../lib/supabaseErrors';
import type { DraftEvent, ReviewStatus } from '../types/database';

function isPermissionError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('permission denied') ||
    lower.includes('row-level security') ||
    lower.includes('jwt')
  );
}

function buildListQuery(status: ReviewStatus) {
  if (status === 'published') {
    const f = publishedTabFilter();
    return supabase
      .from('draft_events')
      .select('*', { count: 'exact' })
      .eq('status', f.status)
      .or(f.dateOr);
  }
  if (status === 'passed') {
    const f = passedTabFilter();
    return supabase
      .from('draft_events')
      .select('*', { count: 'exact' })
      .eq('status', f.status)
      .lt('event_date', f.beforeDate);
  }
  return supabase
    .from('draft_events')
    .select('*', { count: 'exact' })
    .eq('status', status);
}

export function useDraftEvents(status: ReviewStatus) {
  const [events, setEvents] = useState<DraftEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rlsBlocked, setRlsBlocked] = useState(false);
  const [totalInDb, setTotalInDb] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRlsBlocked(false);

    const sort = reviewListSort(status);

    const [listRes, totalRes] = await Promise.all([
      buildListQuery(status)
        .order('event_date', {
          ascending: sort.eventDateAsc,
          nullsFirst: false,
        })
        .order('start_time', {
          ascending: sort.startTimeAsc,
          nullsFirst: false,
        }),
      supabase
        .from('draft_events')
        .select('id', { count: 'exact', head: true }),
    ]);

    const fetchError = listRes.error ?? totalRes.error;
    const rows = (listRes.data ?? []) as DraftEvent[];
    const totalCount = totalRes.count;

    setTotalInDb(totalCount);

    if (fetchError) {
      setError(formatPostgrestError(fetchError));
      setEvents([]);
      setRlsBlocked(isPermissionError(fetchError.message ?? ''));
    } else {
      setEvents(rows);
      const tableLooksEmpty =
        (totalCount === 0 || totalCount === null) &&
        rows.length === 0 &&
        (listRes.count === 0 || listRes.count === null);
      setRlsBlocked(tableLooksEmpty);
    }

    setLoading(false);
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  return { events, loading, error, rlsBlocked, totalInDb, reload: load, setEvents };
}
