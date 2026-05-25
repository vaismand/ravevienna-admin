import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  passedTabFilter,
  publishedTabFilter,
  reviewListSort,
} from '../lib/reviewStatusQuery';
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

function buildListQuery(status: ReviewStatus) {
  if (status === 'pending') {
    return supabase
      .from('event_submissions')
      .select('*')
      .or('status.eq.pending,status.eq.submitted,status.eq.new,status.is.null');
  }
  if (status === 'published') {
    const f = publishedTabFilter();
    return supabase
      .from('event_submissions')
      .select('*')
      .eq('status', f.status)
      .or(f.dateOr);
  }
  if (status === 'passed') {
    const f = passedTabFilter();
    return supabase
      .from('event_submissions')
      .select('*')
      .eq('status', f.status)
      .lt('event_date', f.beforeDate);
  }
  return supabase.from('event_submissions').select('*').eq('status', status);
}

export type SubmissionsLoadMeta = {
  totalAccessible: number;
  statusBreakdown: Record<string, number>;
  statusMismatch: boolean;
};

export function useEventSubmissions(status: ReviewStatus) {
  const [submissions, setSubmissions] = useState<EventSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rlsBlocked, setRlsBlocked] = useState(false);
  const [meta, setMeta] = useState<SubmissionsLoadMeta>({
    totalAccessible: 0,
    statusBreakdown: {},
    statusMismatch: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRlsBlocked(false);

    const sort = reviewListSort(status);

    const [listRes, allRes] = await Promise.all([
      buildListQuery(status)
        .order('event_date', {
          ascending: sort.eventDateAsc,
          nullsFirst: false,
        })
        .order('start_time', {
          ascending: sort.startTimeAsc,
          nullsFirst: false,
        }),
      supabase.from('event_submissions').select('id, status'),
    ]);

    const fetchError = listRes.error ?? allRes.error;
    const rows = (listRes.data ?? []) as EventSubmission[];
    const allRows = allRes.data ?? [];

    const breakdown: Record<string, number> = {};
    for (const row of allRows) {
      const key = (row.status as string | null)?.trim() || '(empty)';
      breakdown[key] = (breakdown[key] ?? 0) + 1;
    }

    const totalAccessible = allRows.length;
    const statusMismatch =
      status !== 'published' &&
      status !== 'passed' &&
      totalAccessible > 0 &&
      rows.length === 0;

    setMeta({
      totalAccessible,
      statusBreakdown: breakdown,
      statusMismatch,
    });

    if (fetchError) {
      setError(formatPostgrestError(fetchError));
      setSubmissions([]);
      setRlsBlocked(isPermissionError(fetchError.message ?? ''));
    } else {
      setSubmissions(rows);
      setRlsBlocked(false);
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
    meta,
    reload: load,
  };
}
