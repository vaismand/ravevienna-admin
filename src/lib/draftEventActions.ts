import { supabase } from './supabase';
import { formatPostgrestError } from './supabaseErrors';
import type {
  DraftEvent,
  DraftEventFormData,
  ReviewStatus,
} from '../types/database';

function parsePrice(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[^\d.,-]/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePrice(price: number | string | null | undefined): number | null {
  if (price === null || price === undefined) return null;
  if (typeof price === 'number') return price;
  return parsePrice(String(price));
}

/** Payload aligned with public.events (same shape as draft_events, no status/raw_data). */
function buildPublishedEventPayload(draft: DraftEvent) {
  return {
    source_id: draft.source_id!,
    venue_id: draft.venue_id,
    title: draft.title,
    event_date: draft.event_date,
    start_time: draft.start_time,
    price: normalizePrice(draft.price),
    genres: draft.genres ?? [],
    description: draft.description,
    ticket_url: draft.ticket_url,
    image_url: draft.image_url,
    external_url: draft.external_url,
    external_id: draft.external_id!,
  };
}

export function formDataToUpdatePayload(data: DraftEventFormData) {
  return {
    title: data.title.trim(),
    venue_id: data.venue_id || null,
    event_date: data.event_date || null,
    start_time: data.start_time || null,
    price: parsePrice(data.price),
    genres: data.genres.length > 0 ? data.genres : null,
    description: data.description.trim() || null,
    image_url: data.image_url.trim() || null,
    ticket_url: data.ticket_url.trim() || null,
    external_url: data.external_url.trim() || null,
    updated_at: new Date().toISOString(),
  };
}

export function resolveManualSourceId(
  sources: { id: string; name: string; slug?: string | null }[],
  preferredId?: string,
): string | null {
  if (preferredId) return preferredId;
  const manual = sources.find(
    (s) =>
      s.slug?.toLowerCase() === 'manual' ||
      s.name.toLowerCase() === 'manual' ||
      s.name.toLowerCase().includes('manual'),
  );
  return manual?.id ?? sources[0]?.id ?? null;
}

export async function createDraftEvent(
  data: DraftEventFormData,
  sourceId: string,
  initialStatus: ReviewStatus = 'pending',
): Promise<DraftEvent> {
  const externalId = `manual-${crypto.randomUUID()}`;

  const { data: row, error } = await supabase
    .from('draft_events')
    .insert({
      ...formDataToUpdatePayload(data),
      source_id: sourceId,
      external_id: externalId,
      status: initialStatus,
      confidence: 1,
      raw_data: { manual: true, created_at: new Date().toISOString() },
    })
    .select('*')
    .single();

  if (error) throw new Error(formatPostgrestError(error));
  return row as DraftEvent;
}

export async function saveDraftEvent(
  id: string,
  data: DraftEventFormData,
): Promise<void> {
  const { error } = await supabase
    .from('draft_events')
    .update(formDataToUpdatePayload(data))
    .eq('id', id);

  if (error) throw new Error(formatPostgrestError(error));
}

export async function updateDraftStatus(
  id: string,
  status: ReviewStatus,
): Promise<void> {
  const { error } = await supabase
    .from('draft_events')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw new Error(formatPostgrestError(error));
}

/**
 * Publish draft → events using select-then-insert/update (works without upsert constraint).
 * Matches draft_events columns only (no draft_event_id — add column + field if needed).
 */
export async function publishDraftEvent(draft: DraftEvent): Promise<void> {
  if (!draft.source_id || !draft.external_id) {
    throw new Error(
      'Cannot publish: source_id and external_id are required.',
    );
  }

  const payload = buildPublishedEventPayload(draft);

  const { data: existing, error: findError } = await supabase
    .from('events')
    .select('id')
    .eq('source_id', payload.source_id)
    .eq('external_id', payload.external_id)
    .maybeSingle();

  if (findError) {
    throw new Error(formatPostgrestError(findError));
  }

  if (existing?.id) {
    const { error: updateError } = await supabase
      .from('events')
      .update(payload)
      .eq('id', existing.id);

    if (updateError) {
      throw new Error(formatPostgrestError(updateError));
    }
  } else {
    const { error: insertError } = await supabase
      .from('events')
      .insert(payload);

    if (insertError) {
      throw new Error(formatPostgrestError(insertError));
    }
  }

  const { error: statusError } = await supabase
    .from('draft_events')
    .update({ status: 'published', updated_at: new Date().toISOString() })
    .eq('id', draft.id);

  if (statusError) {
    throw new Error(formatPostgrestError(statusError));
  }
}

export async function bulkUpdateStatus(
  ids: string[],
  status: ReviewStatus,
): Promise<void> {
  const { error } = await supabase
    .from('draft_events')
    .update({ status, updated_at: new Date().toISOString() })
    .in('id', ids);

  if (error) throw new Error(formatPostgrestError(error));
}

/** Permanently remove drafts from draft_events (scraper can re-insert them later). */
export async function bulkDeleteDraftEvents(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const { error } = await supabase.from('draft_events').delete().in('id', ids);

  if (error) throw new Error(formatPostgrestError(error));
}

export async function bulkPublish(
  drafts: DraftEvent[],
): Promise<{ succeeded: number; failed: string[] }> {
  const failed: string[] = [];
  let succeeded = 0;

  for (const draft of drafts) {
    try {
      await publishDraftEvent(draft);
      succeeded++;
    } catch (err) {
      failed.push(
        `${draft.title}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }

  return { succeeded, failed };
}
