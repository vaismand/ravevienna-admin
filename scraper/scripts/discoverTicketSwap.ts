/**
 * Find TicketSwap event links for upcoming Rave Vienna events.
 *
 * Dry run is the default and does not write to the database.
 * Pass --write to store high-confidence links on rows that are still empty
 * and were not set by hand.
 *
 *   npm run discover:ticketswap
 *   npm run discover:ticketswap -- --write
 *   npm run discover:ticketswap -- --sold-out-only
 */

import { createClient } from "@supabase/supabase-js";

import { loadScriptEnv } from "../../scripts/lib/loadEnv.ts";
import { getTodayDateKey, toDateKey } from "../../scripts/lib/dates.ts";
import { emptyToNull, isTicketSwapUrl } from "../../src/lib/ticketswapUrl.ts";
import {
  buildTicketSwapSearchQuery,
  indexListingsByDate,
  matchTicketSwapEvent,
} from "./ticketswap/match.ts";
import {
  compareDiscoveryTargets,
  isDiscoveryManual,
  planTicketSwapRowUpdates,
  type TicketSwapWritePlan,
} from "./ticketswap/plan.ts";
import { loadViennaTicketSwapListings } from "./ticketswap/sitemap.ts";

loadScriptEnv();

type DraftRow = {
  id: string;
  title: string;
  event_date: string | null;
  venue_id: string | null;
  sold_out: boolean | null;
  ticketswap_url: string | null;
  status: string;
  raw_data: unknown;
  source_id: string | null;
  external_id: string | null;
};

type EventRow = {
  id: string;
  title: string;
  event_date: string;
  venue_id: string | null;
  sold_out: boolean | null;
  ticketswap_url: string | null;
  source_id: string | null;
  external_id: string | null;
  draft_event_id: string | null;
};

type Target = {
  title: string;
  venueName: string | null;
  eventDate: string;
  soldOut: boolean;
  draftId: string | null;
  eventId: string | null;
  draftUrl: string | null;
  eventUrl: string | null;
  manual: boolean;
};

function readFlag(name: string): boolean {
  return process.argv.includes(name);
}

function readLimit(): number | null {
  const index = process.argv.indexOf("--limit");
  if (index < 0) return null;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("--limit needs a positive integer.");
  }
  return value;
}

function pairKey(
  sourceId: string | null | undefined,
  externalId: string | null | undefined,
): string | null {
  if (!sourceId || !externalId) return null;
  return `${sourceId}|${externalId}`;
}

function buildTargets(
  drafts: DraftRow[],
  events: EventRow[],
  venueNames: Map<string, string>,
  today: string,
): Target[] {
  const eventsByDraftId = new Map<string, EventRow>();
  const eventsByPair = new Map<string, EventRow>();
  for (const event of events) {
    if (event.draft_event_id) eventsByDraftId.set(event.draft_event_id, event);
    const key = pairKey(event.source_id, event.external_id);
    if (key && !eventsByPair.has(key)) eventsByPair.set(key, event);
  }

  const usedEventIds = new Set<string>();
  const targets: Target[] = [];

  for (const draft of drafts) {
    if (draft.status === "rejected") continue;
    if (!draft.event_date) continue;
    const eventDate = toDateKey(draft.event_date);
    if (eventDate < today) continue;

    const linked =
      eventsByDraftId.get(draft.id) ??
      eventsByPair.get(pairKey(draft.source_id, draft.external_id) ?? "") ??
      null;
    if (linked) usedEventIds.add(linked.id);

    targets.push({
      title: draft.title,
      venueName: draft.venue_id ? (venueNames.get(draft.venue_id) ?? null) : null,
      eventDate,
      soldOut: draft.sold_out === true || linked?.sold_out === true,
      draftId: draft.id,
      eventId: linked?.id ?? null,
      draftUrl: draft.ticketswap_url,
      eventUrl: linked?.ticketswap_url ?? null,
      manual: isDiscoveryManual(draft.raw_data),
    });
  }

  for (const event of events) {
    if (usedEventIds.has(event.id)) continue;
    const eventDate = toDateKey(event.event_date);
    if (eventDate < today) continue;
    targets.push({
      title: event.title,
      venueName: event.venue_id ? (venueNames.get(event.venue_id) ?? null) : null,
      eventDate,
      soldOut: event.sold_out === true,
      draftId: null,
      eventId: event.id,
      draftUrl: null,
      eventUrl: event.ticketswap_url,
      manual: false,
    });
  }

  targets.sort(compareDiscoveryTargets);
  return targets;
}

function describePlan(plan: TicketSwapWritePlan): string {
  const sides = [
    plan.draftUrl ? "draft" : null,
    plan.eventUrl ? "event" : null,
  ].filter(Boolean);
  return sides.join(" + ");
}

async function applyPlan(
  supabase: ReturnType<typeof createClient>,
  target: Target,
  plan: TicketSwapWritePlan,
): Promise<string[]> {
  const notes: string[] = [];
  const updatedAt = new Date().toISOString();

  if (plan.draftUrl && target.draftId) {
    if (!isTicketSwapUrl(plan.draftUrl)) {
      throw new Error(`Refusing to store a non-TicketSwap URL for ${target.title}.`);
    }
    const { data, error } = await supabase
      .from("draft_events")
      .update({ ticketswap_url: plan.draftUrl, updated_at: updatedAt })
      .eq("id", target.draftId)
      .is("ticketswap_url", null)
      .select("id");
    if (error) throw new Error(error.message);
    notes.push(data && data.length > 0 ? "draft updated" : "draft already had a link");
  }

  if (plan.eventUrl && target.eventId) {
    if (!isTicketSwapUrl(plan.eventUrl)) {
      throw new Error(`Refusing to store a non-TicketSwap URL for ${target.title}.`);
    }
    const { data, error } = await supabase
      .from("events")
      .update({ ticketswap_url: plan.eventUrl, updated_at: updatedAt })
      .eq("id", target.eventId)
      .is("ticketswap_url", null)
      .select("id");
    if (error) throw new Error(error.message);
    notes.push(data && data.length > 0 ? "event updated" : "event already had a link");
  }

  return notes;
}

async function main() {
  const write = readFlag("--write");
  const soldOutOnly = readFlag("--sold-out-only");
  const limit = readLimit();

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    console.error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Put them in .env.scripts (they are not printed).",
    );
    process.exit(1);
  }

  console.log(
    write
      ? "Mode: write (empty, non-manual rows only)"
      : "Mode: dry run (no database writes). Pass --write to store high-confidence links.",
  );

  const loaded = await loadViennaTicketSwapListings();
  console.log(
    `Sitemap: ${loaded.sitemapCount} event files, ${loaded.listings.length} Vienna listings (${loaded.fetched} fetched, ${loaded.cached} cached).`,
  );

  const supabase = createClient(supabaseUrl, serviceKey);
  const today = getTodayDateKey();

  const [draftRes, eventRes, venueRes] = await Promise.all([
    supabase
      .from("draft_events")
      .select(
        "id, title, event_date, venue_id, sold_out, ticketswap_url, status, raw_data, source_id, external_id",
      )
      .gte("event_date", today),
    supabase
      .from("events")
      .select(
        "id, title, event_date, venue_id, sold_out, ticketswap_url, source_id, external_id, draft_event_id",
      )
      .gte("event_date", today),
    supabase.from("venues").select("id, name"),
  ]);

  if (draftRes.error) throw new Error(draftRes.error.message);
  if (eventRes.error) throw new Error(eventRes.error.message);
  if (venueRes.error) throw new Error(venueRes.error.message);

  const venueNames = new Map<string, string>(
    ((venueRes.data ?? []) as { id: string; name: string }[]).map((venue) => [
      venue.id,
      venue.name,
    ]),
  );

  let targets = buildTargets(
    (draftRes.data ?? []) as DraftRow[],
    (eventRes.data ?? []) as EventRow[],
    venueNames,
    today,
  );
  if (soldOutOnly) targets = targets.filter((target) => target.soldOut);
  if (limit != null) targets = targets.slice(0, limit);

  const byDate = indexListingsByDate(loaded.listings);
  let proposed = 0;
  let review = 0;
  let none = 0;
  let skippedManual = 0;
  let skippedLinked = 0;
  let writeFailures = 0;

  for (const target of targets) {
    const label = `${target.eventDate}${target.soldOut ? " [sold out]" : ""}  ${target.title} — ${target.venueName ?? "no venue"}`;
    const alreadyLinked = Boolean(
      emptyToNull(target.draftUrl) || emptyToNull(target.eventUrl),
    );

    if (target.manual && !alreadyLinked) {
      skippedManual += 1;
      console.log(`SKIP     ${label}`);
      console.log("         admin cleared or locked the TicketSwap link");
      continue;
    }

    const matched = matchTicketSwapEvent(
      {
        title: target.title,
        venueName: target.venueName,
        date: target.eventDate,
      },
      byDate.get(target.eventDate) ?? [],
    );

    const proposedUrl =
      matched.status === "match" && matched.url && isTicketSwapUrl(matched.url)
        ? matched.url
        : null;

    const plan = planTicketSwapRowUpdates({
      hasDraft: Boolean(target.draftId),
      hasEvent: Boolean(target.eventId),
      draftUrl: target.draftUrl,
      eventUrl: target.eventUrl,
      manual: target.manual,
      proposedUrl,
    });

    if (!plan) {
      if (target.manual) {
        skippedManual += 1;
        console.log(`SKIP     ${label}`);
        console.log("         admin locked the TicketSwap link");
      } else if (alreadyLinked) {
        skippedLinked += 1;
      } else if (matched.status === "review") {
        review += 1;
        console.log(`REVIEW   ${label}`);
        console.log(`         ${matched.reason}`);
        for (const candidate of matched.candidates) {
          console.log(`         - ${candidate.url}`);
          console.log(`           ${candidate.reason}`);
        }
        console.log(
          `         search: ${buildTicketSwapSearchQuery({
            title: target.title,
            venueName: target.venueName,
            date: target.eventDate,
          })}`,
        );
      } else {
        none += 1;
        console.log(`NONE     ${label}`);
      }
      continue;
    }

    proposed += 1;
    const mirrored = alreadyLinked ? "mirror existing link" : matched.reason;
    console.log(`PROPOSE  ${label}`);
    console.log(`         ${plan.draftUrl ?? plan.eventUrl}`);
    console.log(`         ${mirrored}; write ${describePlan(plan)}`);

    if (!write) continue;

    try {
      const notes = await applyPlan(supabase, target, plan);
      console.log(`         ${notes.join(", ")}`);
    } catch (error) {
      writeFailures += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`         write failed: ${message}`);
    }
  }

  console.log(
    `Summary: ${proposed} proposed, ${review} for review, ${none} unmatched, ${skippedLinked} already linked, ${skippedManual} admin-locked.`,
  );

  if (writeFailures > 0) process.exit(1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
