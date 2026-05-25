export type ReviewStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'passed'
  | 'published';

/** @deprecated Use ReviewStatus */
export type DraftEventStatus = ReviewStatus;

export interface Profile {
  id: string;
  role: string;
  email?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Venue {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  created_at?: string;
}

export interface EventSource {
  id: string;
  name: string;
  slug?: string | null;
  url?: string | null;
  created_at?: string;
}

export interface DraftEvent {
  id: string;
  source_id: string | null;
  venue_id: string | null;
  title: string;
  event_date: string | null;
  start_time: string | null;
  price: number | string | null;
  genres: string[] | null;
  description: string | null;
  lineup: string[] | null;
  ticket_url: string | null;
  image_url: string | null;
  external_url: string | null;
  external_id: string | null;
  status: ReviewStatus;
  confidence: number | null;
  raw_data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface Event {
  id?: string;
  source_id: string | null;
  venue_id: string | null;
  title: string;
  event_date: string | null;
  start_time: string | null;
  price: number | string | null;
  genres: string[] | null;
  description: string | null;
  lineup?: string[] | null;
  ticket_url: string | null;
  image_url: string | null;
  external_url: string | null;
  external_id: string | null;
  draft_event_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface DraftEventFormData {
  title: string;
  venue_id: string | null;
  event_date: string;
  start_time: string;
  price: string;
  genres: string[];
  description: string;
  lineup: string;
  image_url: string;
  ticket_url: string;
  external_url: string;
}

export interface DraftEventFilters {
  status: ReviewStatus | 'all';
  venueId: string;
  genre: string;
  sourceId: string;
  search: string;
}

export interface EventSubmission {
  id: string;
  user_id: string | null;
  title: string;
  venue_name: string | null;
  event_date: string | null;
  start_time: string | null;
  genres: string[] | null;
  event_url: string | null;
  description: string | null;
  contact: string | null;
  status: ReviewStatus;
  created_at: string;
}

export interface EventSubmissionFormData {
  title: string;
  venue_name: string;
  event_date: string;
  start_time: string;
  genres: string[];
  event_url: string;
  description: string;
  lineup: string;
  contact: string;
}

export interface SubmissionFilters {
  venueName: string;
  genre: string;
  search: string;
}

export type ReferenceMaps = {
  venues: Map<string, Venue>;
  sources: Map<string, EventSource>;
};
