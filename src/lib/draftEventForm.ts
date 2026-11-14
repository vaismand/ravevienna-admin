import type { DraftEventFormData } from '../types/database';
import { ticketSwapUrlError } from './ticketswapUrl';

export const EMPTY_DRAFT_FORM: DraftEventFormData = {
  title: '',
  venue_id: null,
  event_date: '',
  start_time: '',
  price: '',
  sold_out: false,
  genres: [],
  description: '',
  lineup: '',
  image_url: '',
  ticket_url: '',
  ticketswap_url: '',
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
  return ticketSwapUrlError(data.ticketswap_url);
}
