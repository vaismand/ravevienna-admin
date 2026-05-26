import { supabase } from './supabase';
import { formatPostgrestError } from './supabaseErrors';

export async function findPublishedEventId(
  sourceId: string,
  externalId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('events')
    .select('id')
    .eq('source_id', sourceId)
    .eq('external_id', externalId)
    .maybeSingle();

  if (error) throw new Error(formatPostgrestError(error));
  return data?.id ?? null;
}

export async function fetchDjsForEvent(eventId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('event_djs')
    .select('dj_id, position')
    .eq('event_id', eventId)
    .order('position', { ascending: true });

  if (error) throw new Error(formatPostgrestError(error));
  return (data ?? []).map((row) => row.dj_id as string);
}

export async function updateEventDjs(
  eventId: string,
  djIds: string[],
): Promise<void> {
  const { error: deleteError } = await supabase
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

  const { error: insertError } = await supabase.from('event_djs').insert(rows);
  if (insertError) throw new Error(formatPostgrestError(insertError));
}

export async function syncEventDjsForDraft(
  sourceId: string | null,
  externalId: string | null,
  djIds: string[],
): Promise<void> {
  if (!sourceId || !externalId) return;
  const eventId = await findPublishedEventId(sourceId, externalId);
  if (eventId) await updateEventDjs(eventId, djIds);
}
