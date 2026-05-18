import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatPostgrestError } from '../lib/supabaseErrors';
import type { DraftEvent, DraftEventStatus } from '../types/database';

function isPermissionError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('permission denied') ||
    lower.includes('row-level security') ||
    lower.includes('jwt')
  );
}

export function useDraftEvents(status: DraftEventStatus) {
  const [events, setEvents] = useState<DraftEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rlsBlocked, setRlsBlocked] = useState(false);
  const [totalInDb, setTotalInDb] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRlsBlocked(false);

    const [listRes, totalRes] = await Promise.all([
      supabase
        .from('draft_events')
        .select('*', { count: 'exact' })
        .eq('status', status)
        .order('event_date', { ascending: true, nullsFirst: false })
        .order('start_time', { ascending: true, nullsFirst: false }),
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
