import { isTicketSwapUrlManuallySet } from "../../../src/lib/ticketswapManual.ts";
import { emptyToNull } from "../../../src/lib/ticketswapUrl.ts";

export type TicketSwapWritePlan = {
  draftUrl?: string;
  eventUrl?: string;
};

/**
 * What to store for one event. Never replaces a URL that is already set,
 * and never fills a row an admin locked (including a cleared link).
 * An existing link on one side is copied to the empty side so publish
 * does not wipe it.
 */
export function planTicketSwapRowUpdates(input: {
  hasDraft: boolean;
  hasEvent: boolean;
  draftUrl: string | null | undefined;
  eventUrl: string | null | undefined;
  manual: boolean;
  proposedUrl: string | null;
}): TicketSwapWritePlan | null {
  const draftUrl = emptyToNull(input.draftUrl);
  const eventUrl = emptyToNull(input.eventUrl);

  if (input.manual) {
    // A cleared link stays empty. A link the admin typed is copied onto the
    // live event when that side is still blank.
    if (input.hasDraft && draftUrl && input.hasEvent && !eventUrl) {
      return { eventUrl: draftUrl };
    }
    return null;
  }

  const existing = draftUrl ?? eventUrl;

  if (existing) {
    const plan: TicketSwapWritePlan = {};
    if (input.hasDraft && !draftUrl) plan.draftUrl = existing;
    if (input.hasEvent && !eventUrl) plan.eventUrl = existing;
    return plan.draftUrl || plan.eventUrl ? plan : null;
  }

  if (!input.proposedUrl) return null;

  const plan: TicketSwapWritePlan = {};
  if (input.hasDraft) plan.draftUrl = input.proposedUrl;
  if (input.hasEvent) plan.eventUrl = input.proposedUrl;
  return plan.draftUrl || plan.eventUrl ? plan : null;
}

export function isDiscoveryManual(raw: unknown): boolean {
  return isTicketSwapUrlManuallySet(raw);
}

export function compareDiscoveryTargets(
  a: { soldOut: boolean; eventDate: string; title: string },
  b: { soldOut: boolean; eventDate: string; title: string },
): number {
  if (a.soldOut !== b.soldOut) return a.soldOut ? -1 : 1;
  const byDate = a.eventDate.localeCompare(b.eventDate);
  if (byDate !== 0) return byDate;
  return a.title.localeCompare(b.title);
}
