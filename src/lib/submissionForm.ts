import type { EventSubmission, EventSubmissionFormData } from '../types/database';

export function submissionToFormData(
  s: EventSubmission,
): EventSubmissionFormData {
  return {
    title: s.title ?? '',
    venue_name: s.venue_name ?? '',
    event_date: s.event_date?.slice(0, 10) ?? '',
    start_time: s.start_time?.slice(0, 5) ?? '',
    genres: s.genres ?? [],
    event_url: s.event_url ?? '',
    description: s.description ?? '',
    lineup: '',
    contact: s.contact ?? '',
  };
}

export function matchesSubmissionSearch(
  s: EventSubmission,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    s.title,
    s.venue_name,
    s.description,
    s.contact,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}
