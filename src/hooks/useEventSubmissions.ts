import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatPostgrestError } from '../lib/supabaseErrors';
import type { EventSubmission, ReviewStatus } from '../types/database';

function isPermissionError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('permission denied') ||
    lower.includes('row-level security') ||
    lower.includes('jwt')
  );
}

export function useEventSubmissions(status: ReviewStatus) {
  const [submissions, setSubmissions] = useState<EventSubmission[]>([]);
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
        .from('event_submissions')
        .select('*')
        .eq('status', status)
        .order('event_date', { ascending: true, nullsFirst: false })
        .order('start_time', { ascending: true, nullsFirst: false }),
      supabase
        .from('event_submissions')
        .select('id', { count: 'exact', head: true }),
    ]);

    const fetchError = listRes.error ?? totalRes.error;
    const rows = (listRes.data ?? []) as EventSubmission[];
    const totalCount = totalRes.count;

    setTotalInDb(totalCount);

    if (fetchError) {
      setError(formatPostgrestError(fetchError));
      setSubmissions([]);
      setRlsBlocked(isPermissionError(fetchError.message ?? ''));
    } else {
      setSubmissions(rows);
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

  return {
    submissions,
    loading,
    error,
    rlsBlocked,
    totalInDb,
    reload: load,
  };
}
