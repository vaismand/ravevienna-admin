import { createClient } from "@supabase/supabase-js";

import { loadScriptEnv } from "../../scripts/lib/loadEnv.ts";
import { normalizeEventGenres } from "../../scripts/lib/genres.ts";
import { parseLineupNames } from "../../scripts/lib/lineupArtists.ts";
import { getTodayDateKey, parseDateKey, toDateKey } from "../../scripts/lib/dates.ts";

loadScriptEnv();
import {
  classifyEdmEvent,
  confidenceForEdmDecision,
  draftStatusForEdmDecision,
} from "./scrapers/edmFilter";
import { enrichEventText } from "./scrapers/lineup";
import { scrapers } from "./scrapers";
import type { ScrapedEvent, ScrapeSource } from "./scrapers/types";
import { runScrapersIsolated } from "./scrapeRun";

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
};

type LiveEventRow = {
  external_id: string | null;
  title: string;
  event_date: string;
  venue_id: string;
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
  existingLineup: string[]
) {
  const enriched = enrichEventText(event.description);
  const parsedLineup = parseLineupNames(
    [...(event.lineup ?? []), ...enriched.lineup].join("\n"),
  );
  const lineup = parsedLineup.length > 0 ? parsedLineup : existingLineup;
  const edm = classifyEdmEvent({
    title: event.title,
    description: enriched.description ?? event.description,
    genres: event.genres,
  });

  return {
    source_id: source.id,
    venue_id: source.venue_id,
    title: event.title,
    event_date: event.event_date,
    start_time: event.start_time,
    price: event.price,
    genres: normalizeEventGenres(event.genres),
    description: enriched.description,
    lineup,
    ticket_url: event.ticket_url,
    image_url: event.image_url,
    external_url: event.external_url,
    external_id: event.external_id,
    status: draftStatusForEdmDecision(edm.decision),
    confidence: confidenceForEdmDecision(edm.decision, event.event_date),
    raw_data: {
      ...event.raw_data,
      extracted_lineup: lineup,
      edm_decision: edm.decision,
      edm_matches: {
        edm: edm.edmMatches,
        non_edm: edm.nonEdmMatches,
        borderline: edm.borderlineMatches,
      },
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
      .select("external_id, lineup, status")
      .eq("source_id", source.id)
      .in("external_id", externalIds),
    supabase
      .from("events")
      .select("external_id, title, event_date, venue_id")
      .eq("source_id", source.id),
  ]);

  if (existingError) {
    throw new Error(
      `Could not load existing drafts for ${source.name}: ${existingError.message}`,
    );
  }

  if (liveEventsError) {
    throw new Error(
      `Could not load live events for ${source.name}: ${liveEventsError.message}`,
    );
  }

  const existingByExternalId = new Map<string, ExistingDraftRow>(
    ((existingRows ?? []) as ExistingDraftRow[]).map((row) => [row.external_id, row])
  );

  const liveExternalIds = new Set(
    ((liveEvents ?? []) as LiveEventRow[])
      .map((row) => row.external_id)
      .filter((id): id is string => Boolean(id))
  );

  const liveIdentityKeys = new Set(
    ((liveEvents ?? []) as LiveEventRow[]).map((row) =>
      buildEventIdentityKey(row.venue_id, row.title, row.event_date)
    )
  );

  const rowsToUpsert: ReturnType<typeof buildDraftRow>[] = [];
  let skippedProtected = 0;
  let skippedAlreadyLive = 0;
  let skippedNonPending = 0;

  for (const event of upcomingEvents) {
    const existing = existingByExternalId.get(event.external_id);
    const identityKey = buildEventIdentityKey(
      source.venue_id,
      event.title,
      event.event_date
    );

    if (existing && PROTECTED_DRAFT_STATUSES.has(existing.status)) {
      skippedProtected += 1;
      continue;
    }

    if (
      liveExternalIds.has(event.external_id) ||
      liveIdentityKeys.has(identityKey)
    ) {
      skippedAlreadyLive += 1;
      continue;
    }

    if (existing && existing.status !== "pending") {
      skippedNonPending += 1;
      continue;
    }

    const existingLineup = Array.isArray(existing?.lineup) ? existing.lineup : [];
    rowsToUpsert.push(buildDraftRow(source, event, existingLineup));
  }

  if (rowsToUpsert.length === 0) {
    console.log(
      `No draft changes for ${source.name} (protected ${skippedProtected}, already live ${skippedAlreadyLive}, other status ${skippedNonPending})`
    );
    return;
  }

  const { error } = await supabase.from("draft_events").upsert(rowsToUpsert, {
    onConflict: "source_id,external_id",
  });

  if (error) {
    throw new Error(`Upsert failed for ${source.name}: ${error.message}`);
  }

  const inserted = rowsToUpsert.filter(
    (row) => !existingByExternalId.has(row.external_id)
  ).length;
  const updated = rowsToUpsert.length - inserted;

  console.log(
    `Draft sync for ${source.name}: ${inserted} new, ${updated} updated (past skipped ${skippedPast}, protected ${skippedProtected}, already live ${skippedAlreadyLive}, other status ${skippedNonPending})`
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

  const results = await runScrapersIsolated((sources ?? []) as ScrapeSource[], scrapers, {
    afterScrape: async (source, events) => {
      await upsertDraftEvents(source, events as ScrapedEvent[]);

      const { error: updateError } = await supabase
        .from("event_sources")
        .update({ last_checked_at: new Date().toISOString() })
        .eq("id", source.id);

      if (updateError) {
        throw updateError;
      }
    },
  });

  const failed = results.filter((result) => result.status === "failed");
  if (failed.length > 0) {
    throw new Error(
      `Scrape finished with ${failed.length} failing source(s): ${failed
        .map((result) => result.sourceName)
        .join(", ")}`,
    );
  }
}

export async function runScrape(): Promise<void> {
  await main();
}
