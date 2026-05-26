import { useEffect, useState } from 'react';
import { fetchActiveDjs } from '../lib/djActions';
import {
  fetchDjsForEvent,
  findPublishedEventId,
} from '../lib/eventDjActions';
import type { Dj } from '../types/database';

export function useEventDjSelection(
  open: boolean,
  sourceId: string | null,
  externalId: string | null,
) {
  const [activeDjs, setActiveDjs] = useState<Dj[]>([]);
  const [selectedDjIds, setSelectedDjIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasPublishedEvent, setHasPublishedEvent] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const djs = await fetchActiveDjs();
        if (cancelled) return;
        setActiveDjs(djs);

        if (!sourceId || !externalId) {
          setHasPublishedEvent(false);
          setSelectedDjIds([]);
          return;
        }

        const eventId = await findPublishedEventId(sourceId, externalId);
        if (cancelled) return;

        setHasPublishedEvent(Boolean(eventId));
        if (eventId) {
          const ids = await fetchDjsForEvent(eventId);
          if (!cancelled) setSelectedDjIds(ids);
        } else if (!cancelled) {
          setSelectedDjIds([]);
        }
      } catch {
        if (!cancelled) {
          setActiveDjs([]);
          setSelectedDjIds([]);
          setHasPublishedEvent(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, sourceId, externalId]);

  return {
    activeDjs,
    selectedDjIds,
    setSelectedDjIds,
    loading,
    hasPublishedEvent,
  };
}
