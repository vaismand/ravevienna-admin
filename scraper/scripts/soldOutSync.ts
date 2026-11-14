import { isSoldOutManuallySet } from "../../src/lib/soldOutManual.ts";

/**
 * Sold-out value to store on a draft the scraper is allowed to upsert.
 * A manual admin value is kept, including the lock in raw_data.
 */
export function scrapedSoldOutForDraft(input: {
  scrapedSoldOut: boolean;
  existingRawData: unknown;
  existingSoldOut: boolean | null | undefined;
}): { soldOut: boolean; preserveManual: boolean } {
  if (isSoldOutManuallySet(input.existingRawData)) {
    return {
      soldOut: input.existingSoldOut === true,
      preserveManual: true,
    };
  }
  return { soldOut: input.scrapedSoldOut, preserveManual: false };
}

/**
 * Update for a published `events` row. Null means do not write: either there
 * is no live row, the value already matches, or an admin set sold_out.
 */
export function planPublishedSoldOutUpdate(input: {
  eventId: string | null;
  scrapedSoldOut: boolean;
  currentSoldOut: boolean | null | undefined;
  draftRawData: unknown;
}): { id: string; sold_out: boolean } | null {
  if (!input.eventId) return null;
  if (isSoldOutManuallySet(input.draftRawData)) return null;
  if ((input.currentSoldOut === true) === input.scrapedSoldOut) return null;
  return { id: input.eventId, sold_out: input.scrapedSoldOut };
}
