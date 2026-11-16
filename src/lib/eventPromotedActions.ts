import { supabase } from './supabase';
import {
  isMissingPromotedColumn,
  PROMOTED_MIGRATION_PATH,
} from './eventPromoted';
import { formatPostgrestError } from './supabaseErrors';

export type PromotionLookup = {
  rowId: string;
  sourceId: string | null;
  externalId: string | null;
};

export type PromotionMatch = {
  eventId: string;
  isPromoted: boolean;
};

export type PromotionLoad = {
  columnReady: boolean;
  byRowId: Map<string, PromotionMatch>;
};

type EventPromotionRow = {
  id: string;
  source_id: string | null;
  external_id: string | null;
  draft_event_id: string | null;
  is_promoted: boolean | null;
};

const PROMOTION_COLUMNS =
  'id, source_id, external_id, draft_event_id, is_promoted';

function externalKey(
  sourceId: string | null,
  externalId: string | null,
): string | null {
  if (!sourceId || !externalId) return null;
  return `${sourceId}\0${externalId}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function promotedColumnMissingMessage(): string {
  return `events.is_promoted is not in the database yet. Run ${PROMOTED_MIGRATION_PATH} in the Supabase SQL editor.`;
}

/**
 * Live `events` rows for the drafts or submissions on screen.
 * A missing column (migration not applied yet) leaves the rest of the list usable.
 */
export async function fetchPublishedPromotions(
  lookups: PromotionLookup[],
): Promise<PromotionLoad> {
  const externalIds = unique(
    lookups
      .map((lookup) => lookup.externalId)
      .filter((id): id is string => Boolean(id)),
  );
  const draftIds = unique(lookups.map((lookup) => lookup.rowId));

  const [byExternal, byDraft] = await Promise.all([
    externalIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from('events')
          .select(PROMOTION_COLUMNS)
          .in('external_id', externalIds),
    draftIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from('events')
          .select(PROMOTION_COLUMNS)
          .in('draft_event_id', draftIds),
  ]);

  const error = byExternal.error ?? byDraft.error;
  if (error) {
    if (isMissingPromotedColumn(error)) {
      return { columnReady: false, byRowId: new Map() };
    }
    throw new Error(formatPostgrestError(error));
  }

  const rows = [
    ...((byExternal.data ?? []) as EventPromotionRow[]),
    ...((byDraft.data ?? []) as EventPromotionRow[]),
  ];
  const externalIndex = new Map<string, EventPromotionRow>();
  const draftIndex = new Map<string, EventPromotionRow>();
  for (const row of rows) {
    const key = externalKey(row.source_id, row.external_id);
    if (key) externalIndex.set(key, row);
    if (row.draft_event_id) draftIndex.set(row.draft_event_id, row);
  }

  const byRowId = new Map<string, PromotionMatch>();
  for (const lookup of lookups) {
    const key = externalKey(lookup.sourceId, lookup.externalId);
    const row =
      draftIndex.get(lookup.rowId) ??
      (key ? externalIndex.get(key) : undefined);
    if (!row?.id) continue;
    byRowId.set(lookup.rowId, {
      eventId: row.id,
      isPromoted: row.is_promoted === true,
    });
  }

  return { columnReady: true, byRowId };
}

/** The only writer of `events.is_promoted`. */
export async function setEventPromoted(
  eventId: string,
  isPromoted: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('events')
    .update({
      is_promoted: isPromoted,
      updated_at: new Date().toISOString(),
    })
    .eq('id', eventId);

  if (!error) return;
  if (isMissingPromotedColumn(error)) {
    throw new Error(promotedColumnMissingMessage());
  }
  throw new Error(formatPostgrestError(error));
}
