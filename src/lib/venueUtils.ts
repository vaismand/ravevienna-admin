import type { Venue } from '../types/database';

/** Map a display venue name to venues.id for events.venue_id FK. */
export function resolveVenueIdFromName(
  venueName: string | null | undefined,
  venues: Venue[],
): string | null {
  const trimmed = venueName?.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  const byId = venues.find((v) => v.id.toLowerCase() === lower);
  if (byId) return byId.id;

  const byName = venues.find((v) => v.name.toLowerCase() === lower);
  if (byName) return byName.id;

  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
