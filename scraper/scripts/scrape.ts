import { createClient } from "@supabase/supabase-js";

import { loadScriptEnv } from "../../scripts/lib/loadEnv.ts";
import { normalizeEventGenres } from "../../scripts/lib/genres.ts";
import { getTodayDateKey, parseDateKey, toDateKey } from "../../scripts/lib/dates.ts";
import { isSoldOutManuallySet } from "../../src/lib/soldOutManual.ts";
import {
  planPublishedSoldOutUpdate,
  scrapedSoldOutForDraft,
} from "./soldOutSync.ts";

loadScriptEnv();
import { enrichEventText } from "./scrapers/lineup";
import { scrapers } from "./scrapers";
import type { ScrapedEvent, ScrapeSource } from "./scrapers/types";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Draft statuses managed in Rave-Vienna-admin-panel (draftEventActions.ts):
 * pending → approved / rejected → published (writes to public.events).
 * Scraper must never reset approved/published/rejected review work.
 */
const PROTECTED_DRAFT_STATUSES = new Set([
  "approved",
  "published",
  "rejected",
]);

/* ----------------------------- DATABASE ----------------------------- */

type ExistingDraftRow = {
  external_id: string;
  lineup: string[] | null;
  status: string;
  raw_data: Record<string, unknown> | null;
  sold_out: boolean | null;
};

type LiveEventRow = {
  id: string;
  external_id: string | null;
  title: string;
  event_date: string;
  venue_id: string;
  sold_out: boolean | null;
};

type SoldOutPatch = {
  eventId: string;
  draftExternalId: string | null;
  sold_out: boolean;
};

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildEventIdentityKey(
  venueId: string,
  title: string,
  eventDate: string | null
): string {
  return `${venueId}|${normalizeTitle(title)}|${eventDate ?? ""}`;
}

/** Skip events before today (Vienna calendar day). Events without a date are kept. */
function isPastEventDate(eventDate: string | null): boolean {
  if (!eventDate?.trim()) {
    return false;
  }

  const today = parseDateKey(getTodayDateKey());
  const eventDay = parseDateKey(toDateKey(eventDate));

  return eventDay.getTime() < today.getTime();
}

function buildDraftRow(
  source: ScrapeSource,
  event: ScrapedEvent,
  existing: ExistingDraftRow | undefined
) {
  const enriched = enrichEventText(event.description);
  const existingLineup = Array.isArray(existing?.lineup) ? existing.lineup : [];
  const lineup =
    enriched.lineup.length > 0 ? enriched.lineup : existingLineup;
  const soldOut = scrapedSoldOutForDraft({
    scrapedSoldOut: event.sold_out === true,
    existingRawData: existing?.raw_data,
    existingSoldOut: existing?.sold_out,
  });

  return {
    source_id: source.id,
    venue_id: source.venue_id,
    title: event.title,
    event_date: event.event_date,
    start_time: event.start_time,
    price: event.price,
    sold_out: soldOut.soldOut,
    genres: normalizeEventGenres(event.genres),
    description: enriched.description,
    lineup,
    ticket_url: event.ticket_url,
    image_url: event.image_url,
    external_url: event.external_url,
    external_id: event.external_id,
    status: "pending" as const,
    confidence: event.event_date ? 0.8 : 0.35,
    raw_data: {
      ...event.raw_data,
      extracted_lineup: enriched.lineup,
      ...(soldOut.preserveManual ? { sold_out_manual: true } : {}),
    },
  };
}

async function upsertDraftEvents(source: ScrapeSource, events: ScrapedEvent[]) {
  const upcomingEvents = events.filter(
    (event) => !isPastEventDate(event.event_date)
  );
  const skippedPast = events.length - upcomingEvents.length;

  if (upcomingEvents.length === 0) {
    console.log(
      `No upcoming events for ${source.name}${skippedPast > 0 ? ` (${skippedPast} past skipped)` : ""}`
    );
    return;
  }

  const externalIds = upcomingEvents.map((event) => event.external_id);

  const [
    { data: existingRows, error: existingError },
    { data: liveEvents, error: liveEventsError },
  ] = await Promise.all([
    supabase
      .from("draft_events")
      .select("external_id, lineup, status, raw_data, sold_out")
      .eq("source_id", source.id)
      .in("external_id", externalIds),
    supabase
      .from("events")
      .select("id, external_id, title, event_date, venue_id, sold_out")
      .eq("source_id", source.id),
  ]);

  if (existingError) {
    console.error(`Could not load existing drafts for ${source.name}:`, existingError);
    return;
  }

  if (liveEventsError) {
    console.error(`Could not load live events for ${source.name}:`, liveEventsError);
    return;
  }

  const existingByExternalId = new Map<string, ExistingDraftRow>(
    ((existingRows ?? []) as ExistingDraftRow[]).map((row) => [row.external_id, row])
  );

  const liveRows = (liveEvents ?? []) as LiveEventRow[];
  const liveByExternalId = new Map<string, LiveEventRow>();
  const liveByIdentity = new Map<string, LiveEventRow>();
  for (const row of liveRows) {
    if (row.external_id) liveByExternalId.set(row.external_id, row);
    liveByIdentity.set(
      buildEventIdentityKey(row.venue_id, row.title, row.event_date),
      row
    );
  }

  const rowsToUpsert: ReturnType<typeof buildDraftRow>[] = [];
  const soldOutPatches: SoldOutPatch[] = [];
  let skippedProtected = 0;
  let skippedAlreadyLive = 0;
  let skippedNonPending = 0;
  let keptManualSoldOut = 0;

  for (const event of upcomingEvents) {
    const existing = existingByExternalId.get(event.external_id);
    const identityKey = buildEventIdentityKey(
      source.venue_id,
      event.title,
      event.event_date
    );
    const live =
      liveByExternalId.get(event.external_id) ?? liveByIdentity.get(identityKey);

    if (live) {
      const manual = isSoldOutManuallySet(existing?.raw_data);
      const patch = planPublishedSoldOutUpdate({
        eventId: live.id,
        scrapedSoldOut: event.sold_out === true,
        currentSoldOut: live.sold_out,
        draftRawData: existing?.raw_data,
      });
      if (patch) {
        soldOutPatches.push({
          eventId: patch.id,
          draftExternalId: existing?.external_id ?? null,
          sold_out: patch.sold_out,
        });
      } else if (manual) {
        keptManualSoldOut += 1;
      }
    }

    if (existing && PROTECTED_DRAFT_STATUSES.has(existing.status)) {
      skippedProtected += 1;
      continue;
    }

    if (live) {
      skippedAlreadyLive += 1;
      continue;
    }

    if (existing && existing.status !== "pending") {
      skippedNonPending += 1;
      continue;
    }

    rowsToUpsert.push(buildDraftRow(source, event, existing));
  }

  for (const patch of soldOutPatches) {
    const { error: eventSoldOutError } = await supabase
      .from("events")
      .update({ sold_out: patch.sold_out })
      .eq("id", patch.eventId);

    if (eventSoldOutError) {
      console.error(
        `Could not update sold_out for live event ${patch.eventId}:`,
        eventSoldOutError
      );
      continue;
    }

    if (!patch.draftExternalId) continue;

    const { error: draftSoldOutError } = await supabase
      .from("draft_events")
      .update({ sold_out: patch.sold_out })
      .eq("source_id", source.id)
      .eq("external_id", patch.draftExternalId);

    if (draftSoldOutError) {
      console.error(
        `Could not update sold_out for draft ${patch.draftExternalId}:`,
        draftSoldOutError
      );
    }
  }

  if (rowsToUpsert.length === 0) {
    console.log(
      `No draft changes for ${source.name} (protected ${skippedProtected}, already live ${skippedAlreadyLive}, other status ${skippedNonPending}, manual sold out kept ${keptManualSoldOut}, sold out updated ${soldOutPatches.length})`
    );
    return;
  }

  const { error } = await supabase.from("draft_events").upsert(rowsToUpsert, {
    onConflict: "source_id,external_id",
  });

  if (error) {
    console.error(`Upsert failed for ${source.name}:`, error);
    return;
  }

  const inserted = rowsToUpsert.filter(
    (row) => !existingByExternalId.has(row.external_id)
  ).length;
  const updated = rowsToUpsert.length - inserted;

  console.log(
    `Draft sync for ${source.name}: ${inserted} new, ${updated} pending updated (past skipped ${skippedPast}, protected ${skippedProtected}, already live ${skippedAlreadyLive}, other status ${skippedNonPending}, manual sold out kept ${keptManualSoldOut}, sold out updated ${soldOutPatches.length})`
  );
}

async function main() {
  const { data: sources, error } = await supabase
    .from("event_sources")
    .select("*")
    .eq("is_active", true)
    .eq("source_type", "website");

  if (error) {
    throw error;
  }

  for (const source of sources ?? []) {
    console.log(`Scraping ${source.name}...`);

    const scrape = scrapers[source.name];

    if (!scrape) {
      console.log(`No scraper implemented yet for ${source.name}`);
      continue;
    }

    const events = await scrape(source);

    await upsertDraftEvents(source, events);

    await supabase
      .from("event_sources")
      .update({ last_checked_at: new Date().toISOString() })
      .eq("id", source.id);
  }
}

export async function runScrape(): Promise<void> {
  await main();
}
