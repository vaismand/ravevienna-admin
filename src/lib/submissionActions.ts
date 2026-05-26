import { supabase } from './supabase';
import { parseLineupText } from './lineup';
import { formatPostgrestError } from './supabaseErrors';
import { resolveVenueIdFromName } from './venueUtils';
import type {
  EventSource,
  EventSubmission,
  EventSubmissionFormData,
  ReviewStatus,
  Venue,
} from '../types/database';

export function resolveSubmissionSourceId(
  sources: EventSource[],
): string | null {
  const match = sources.find(
    (s) =>
      s.slug?.toLowerCase() === 'user-submission' ||
      s.slug?.toLowerCase() === 'submission' ||
      s.name.toLowerCase().includes('user') ||
      s.name.toLowerCase().includes('submission'),
  );
  return match?.id ?? sources[0]?.id ?? null;
}

export function submissionFormToPayload(data: EventSubmissionFormData) {
  return {
    title: data.title.trim(),
    venue_name: data.venue_name.trim() || null,
    event_date: data.event_date || null,
    start_time: data.start_time || null,
    genres: data.genres.length > 0 ? data.genres : [],
    event_url: data.event_url.trim() || null,
    description: data.description.trim() || null,
    contact: data.contact.trim() || null,
  };
}

function buildDescriptionForPublish(
  description: string | null,
  contact: string | null,
): string | null {
  const parts = [
    description?.trim(),
    contact?.trim() ? `Contact: ${contact.trim()}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join('\n\n') : null;
}

export async function saveEventSubmission(
  id: string,
  data: EventSubmissionFormData,
): Promise<void> {
  const { error } = await supabase
    .from('event_submissions')
    .update(submissionFormToPayload(data))
    .eq('id', id);

  if (error) throw new Error(formatPostgrestError(error));
}

export async function updateSubmissionStatus(
  id: string,
  status: ReviewStatus,
): Promise<void> {
  const { error } = await supabase
    .from('event_submissions')
    .update({ status })
    .eq('id', id);

  if (error) throw new Error(formatPostgrestError(error));
}

export async function bulkUpdateSubmissionStatus(
  ids: string[],
  status: ReviewStatus,
): Promise<void> {
  const { error } = await supabase
    .from('event_submissions')
    .update({ status })
    .in('id', ids);

  if (error) throw new Error(formatPostgrestError(error));
}

export async function bulkDeleteSubmissions(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('event_submissions')
    .delete()
    .in('id', ids);
  if (error) throw new Error(formatPostgrestError(error));
}

export async function publishEventSubmission(
  submission: EventSubmission,
  formData: EventSubmissionFormData,
  venues: Venue[],
  sourceId: string,
): Promise<string> {
  const payload = submissionFormToPayload(formData);
  const venue_id = resolveVenueIdFromName(payload.venue_name, venues);
  const external_id = `submission-${submission.id}`;

  const eventPayload = {
    source_id: sourceId,
    venue_id,
    title: payload.title,
    event_date: payload.event_date,
    start_time: payload.start_time,
    price: null,
    genres: payload.genres,
    description: buildDescriptionForPublish(
      payload.description,
      payload.contact,
    ),
    lineup: parseLineupText(formData.lineup),
    ticket_url: payload.event_url,
    image_url: null,
    external_url: payload.event_url,
    external_id,
  };

  const { data: existing, error: findError } = await supabase
    .from('events')
    .select('id')
    .eq('source_id', sourceId)
    .eq('external_id', external_id)
    .maybeSingle();

  if (findError) throw new Error(formatPostgrestError(findError));

  let eventId: string;

  if (existing?.id) {
    const { error: updateError } = await supabase
      .from('events')
      .update(eventPayload)
      .eq('id', existing.id);
    if (updateError) throw new Error(formatPostgrestError(updateError));
    eventId = existing.id;
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from('events')
      .insert(eventPayload)
      .select('id')
      .single();
    if (insertError) throw new Error(formatPostgrestError(insertError));
    eventId = inserted.id as string;
  }

  const { error: statusError } = await supabase
    .from('event_submissions')
    .update({ status: 'published' })
    .eq('id', submission.id);

  if (statusError) throw new Error(formatPostgrestError(statusError));

  return eventId;
}

export async function bulkPublishSubmissions(
  items: { submission: EventSubmission; form: EventSubmissionFormData }[],
  venues: Venue[],
  sourceId: string,
): Promise<{ succeeded: number; failed: string[] }> {
  const failed: string[] = [];
  let succeeded = 0;

  for (const { submission, form } of items) {
    try {
      await publishEventSubmission(submission, form, venues, sourceId);
      succeeded++;
    } catch (err) {
      failed.push(
        `${submission.title}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }

  return { succeeded, failed };
}
