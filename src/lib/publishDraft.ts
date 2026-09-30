import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ensureDjsFromLineup,
  resolveLineupDjIds,
  type EnsureLineupDjsResult,
} from './lineupDjEnsure';
import { formatPostgrestError } from './supabaseErrors';
import type { DraftEvent } from '../types/database';

/**
 * `draft_events.genres` is jsonb. `events.genres` is text[].
 * Keep the string values (including custom genres); only coerce the shape.
 */
export function genresJsonToTextArray(genres: unknown): string[] {
  const values = unwrapList(genres);
  const result: string[] = [];

  for (const value of values) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const text = String(value).trim();
    if (!text) continue;
    result.push(text);
  }

  return result;
}

/** Lineup is one plain DJ name per array element. */
export function lineupToTextArray(lineup: unknown): string[] {
  if (lineup == null) return [];

  if (Array.isArray(lineup)) {
    return lineup
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof lineup === 'string') {
    const trimmed = lineup.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) return lineupToTextArray(parsed);
      } catch {
        // Fall through and treat the string as a single name.
      }
    }
    return [trimmed];
  }

  return [];
}

function unwrapList(value: unknown): unknown[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) return parsed;
      } catch {
        return [trimmed];
      }
    }
    return [trimmed];
  }

  return [];
}

function parsePrice(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[^\d.,-]/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeEventPrice(
  price: number | string | null | undefined,
): number | null {
  if (price === null || price === undefined) return null;
  if (typeof price === 'number') return Number.isFinite(price) ? price : null;
  return parsePrice(String(price));
}

/** Payload aligned with public.events, including the draft back-reference. */
export function buildPublishedEventPayload(draft: DraftEvent) {
  return {
    source_id: draft.source_id,
    venue_id: draft.venue_id,
    title: draft.title,
    event_date: draft.event_date,
    start_time: draft.start_time,
    price: normalizeEventPrice(draft.price),
    genres: genresJsonToTextArray(draft.genres),
    description: draft.description,
    lineup: lineupToTextArray(draft.lineup),
    ticket_url: draft.ticket_url,
    image_url: draft.image_url,
    external_url: draft.external_url,
    external_id: draft.external_id,
    draft_event_id: draft.id,
  };
}

async function syncEventDjs(
  client: SupabaseClient,
  eventId: string,
  djIds: string[],
): Promise<void> {
  const { data, error } = await client
    .from('event_djs')
    .select('dj_id, position')
    .eq('event_id', eventId)
    .order('position', { ascending: true });

  if (error) throw new Error(formatPostgrestError(error));

  const current = (data ?? []).map((row) => String(row.dj_id));
  if (
    current.length === djIds.length &&
    current.every((id, index) => id === djIds[index])
  ) {
    return;
  }

  const { error: deleteError } = await client
    .from('event_djs')
    .delete()
    .eq('event_id', eventId);

  if (deleteError) throw new Error(formatPostgrestError(deleteError));

  if (djIds.length === 0) return;

  const rows = djIds.map((dj_id, index) => ({
    event_id: eventId,
    dj_id,
    position: index,
  }));

  const { error: insertError } = await client.from('event_djs').insert(rows);
  if (insertError) throw new Error(formatPostgrestError(insertError));
}

/**
 * Publish one draft into `events`, create any missing lineup DJs, and write
 * `event_djs` in lineup order. Safe to run again for the same draft.
 */
export async function publishDraftRecord(
  client: SupabaseClient,
  draft: DraftEvent,
): Promise<{ eventId: string; djs: EnsureLineupDjsResult }> {
  if (!draft.source_id || !draft.external_id) {
    throw new Error(
      'Cannot publish: source_id and external_id are required.',
    );
  }

  if (!draft.event_date) {
    throw new Error('Cannot publish: event_date is required.');
  }

  const payload = buildPublishedEventPayload(draft);
  const lineup = payload.lineup ?? [];

  const { data: existing, error: findError } = await client
    .from('events')
    .select('id')
    .eq('source_id', payload.source_id)
    .eq('external_id', payload.external_id)
    .maybeSingle();

  if (findError) throw new Error(formatPostgrestError(findError));

  let eventId: string;

  if (existing?.id) {
    const { error: updateError } = await client
      .from('events')
      .update(payload)
      .eq('id', existing.id);

    if (updateError) throw new Error(formatPostgrestError(updateError));
    eventId = existing.id as string;
  } else {
    const { data: inserted, error: insertError } = await client
      .from('events')
      .insert(payload)
      .select('id')
      .single();

    if (insertError || !inserted?.id) {
      throw new Error(
        insertError
          ? formatPostgrestError(insertError)
          : 'Publish did not return an event id.',
      );
    }
    eventId = inserted.id as string;
  }

  const djs = await ensureDjsFromLineup(client, lineup, payload.genres);
  const djIds = await resolveLineupDjIds(client, lineup);
  await syncEventDjs(client, eventId, djIds);

  const { error: statusError } = await client
    .from('draft_events')
    .update({ status: 'published', updated_at: new Date().toISOString() })
    .eq('id', draft.id);

  if (statusError) throw new Error(formatPostgrestError(statusError));

  return { eventId, djs };
}
