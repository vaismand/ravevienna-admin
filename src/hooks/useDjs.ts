import { useCallback, useEffect, useState } from 'react';
import { fetchDjs } from '../lib/djActions';
import { formatPostgrestError } from '../lib/supabaseErrors';
import type { Dj } from '../types/database';

export function useDjs() {
  const [djs, setDjs] = useState<Dj[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchDjs();
      setDjs(rows);
    } catch (err) {
      setError(formatPostgrestError(err));
      setDjs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { djs, loading, error, reload };
}
