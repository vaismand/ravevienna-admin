import type { DraftEventFormData } from '../types/database';

export const EMPTY_DRAFT_FORM: DraftEventFormData = {
  title: '',
  venue_id: null,
  event_date: '',
  start_time: '',
  price: '',
  genres: [],
  description: '',
  image_url: '',
  ticket_url: '',
  external_url: '',
};

export function validateDraftForm(
  data: DraftEventFormData,
  options?: { requireSource?: boolean; sourceId?: string },
): string | null {
  if (!data.title.trim()) return 'Title is required.';
  if (options?.requireSource && !options.sourceId) {
    return 'Source is required for manual events (needed when publishing).';
  }
  return null;
}
