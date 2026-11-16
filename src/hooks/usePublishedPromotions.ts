import { useCallback, useEffect, useState } from 'react';
import {
  fetchPublishedPromotions,
  type PromotionLookup,
  type PromotionMatch,
} from '../lib/eventPromotedActions';
import { formatPostgrestError } from '../lib/supabaseErrors';

export function usePublishedPromotions(lookups: PromotionLookup[]) {
  const [byRowId, setByRowId] = useState<Map<string, PromotionMatch>>(
    () => new Map(),
  );
  const [columnReady, setColumnReady] = useState(true);
  const [fetchedKey, setFetchedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lookupKey = lookups
    .map(
      (lookup) =>
        `${lookup.rowId}\0${lookup.sourceId ?? ''}\0${lookup.externalId ?? ''}`,
    )
    .join('\n');

  if (lookups.length === 0 && fetchedKey !== lookupKey) {
    setByRowId(new Map());
    setColumnReady(true);
    setError(null);
    setFetchedKey(lookupKey);
  }

  useEffect(() => {
    if (lookups.length === 0) return;

    let cancelled = false;
    const key = lookupKey;
    void (async () => {
      try {
        const result = await fetchPublishedPromotions(lookups);
        if (cancelled) return;
        setByRowId(result.byRowId);
        setColumnReady(result.columnReady);
        setError(null);
        setFetchedKey(key);
      } catch (err) {
        if (cancelled) return;
        setError(formatPostgrestError(err));
        setFetchedKey(key);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lookupKey, lookups]);

  const patchPromotion = useCallback(
    (rowId: string, eventId: string, isPromoted: boolean) => {
      setByRowId((current) => {
        const next = new Map(current);
        next.set(rowId, { eventId, isPromoted });
        return next;
      });
    },
    [],
  );

  return {
    byRowId,
    columnReady,
    loaded: fetchedKey === lookupKey,
    error,
    patchPromotion,
  };
}
