import { createClient } from "@supabase/supabase-js";

import { loadScriptEnv } from "../../scripts/lib/loadEnv.ts";
import { isPastViennaDate } from "../../scripts/lib/dates.ts";
import { isSoldOutManuallySet } from "../../src/lib/soldOutManual.ts";
import {
  buildDraftRow,
  EXISTING_DRAFT_COLUMNS,
  venueIdForDraft,
  type ExistingDraftRow,
} from "./draftRefresh.ts";
import { isSameEvent, type EventIdentity } from "./scrapers/eventMatch.ts";
import { planPublishedSoldOutUpdate } from "./soldOutSync.ts";
import { scrapers } from "./scrapers";
import { scrapeResidentAdvisor } from "./scrapers/residentAdvisor.ts";
import type { VenueRow } from "./scrapers/eventMatch.ts";
import type { ScrapedEvent, ScrapeSource } from "./scrapers/types";

loadScriptEnv();

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

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
  return isPastViennaDate(eventDate);
}

type KnownEvent = EventIdentity & {
  source_id: string | null;
  external_id: string | null;
};

const DRY_RUN_SOURCES: ScrapeSource[] = [
  { id: "dry-arena", name: "Arena Wien", url: "https://arena.wien", venue_id: "dry-arena" },
  {
    id: "dry-das-werk",
    name: "Das Werk",
    url: "https://www.daswerk.org/program",
    venue_id: "dry-das-werk",
  },
  { id: "dry-flex", name: "Flex", url: "https://flex.at/", venue_id: "dry-flex" },
  { id: "dry-flucc", name: "FLUCC", url: "https://flucc.at/", venue_id: "dry-flucc" },
  {
    id: "dry-grelle",
    name: "Grelle Forelle",
    url: "https://www.grelleforelle.com/",
    venue_id: "dry-grelle",
  },
  {
    id: "dry-ra",
    name: "Resident Advisor",
    url: "https://ra.co/events/at/vienna",
    venue_id: "",
  },
  {
    id: "dry-sass",
    name: "SASS Music Club",
    url: "https://sassvienna.com/en/events",
    venue_id: "dry-sass",
  },
  {
    id: "dry-loft",
    name: "The Loft",
    url: "https://www.theloft.at/programm/",
    venue_id: "dry-loft",
  },
];

function isDryRun(argv: string[]): boolean {
  return argv.includes("--dry-run");
}

function eventIdentity(source: ScrapeSource, event: ScrapedEvent): KnownEvent {
  const venueName =
    typeof event.raw_data.venue_name === "string"
      ? event.raw_data.venue_name
      : source.name === "Resident Advisor"
        ? null
        : source.name;
  return {
    title: event.title,
    event_date: event.event_date,
    venue_id: venueIdForDraft(source, event),
    venue_name: venueName,
    source_id: source.id,
    external_id: event.external_id,
  };
}

function findCrossSourceDuplicate(
  identity: KnownEvent,
  known: KnownEvent[],
): KnownEvent | null {
  for (const other of known) {
    if (
      other.source_id === identity.source_id &&
      other.external_id === identity.external_id
    ) {
      continue;
    }
    if (isSameEvent(identity, other)) return other;
  }
  return null;
}

function printDryRunEvent(action: string, source: ScrapeSource, event: ScrapedEvent) {
  const row = buildDraftRow(source, event, undefined);
  const lineup = Array.isArray(row.lineup) ? row.lineup.join(", ") : "";
  const venue =
    (typeof event.raw_data.venue_name === "string" && event.raw_data.venue_name) ||
    source.name;
  console.log(
    `[dry-run] ${action} | ${source.name} | ${row.event_date ?? "no-date"} ${row.start_time ?? ""} | ${venue} | ${row.title} | price ${row.price ?? "—"} | lineup ${lineup || "—"} | image ${row.image_url ? "yes" : "no"}`,
  );
}

async function upsertDraftEvents(
  source: ScrapeSource,
  events: ScrapedEvent[],
  options: {
    dryRun: boolean;
    known: KnownEvent[];
    supabase: ReturnType<typeof createClient> | null;
  },
) {
  const upcomingEvents = events.filter(
    (event) => !isPastEventDate(event.event_date)
  );
  const skippedPast = events.length - upcomingEvents.length;
  const supabase = options.supabase;

  if (upcomingEvents.length === 0) {
    console.log(
      `No upcoming events for ${source.name}${skippedPast > 0 ? ` (${skippedPast} past skipped)` : ""}`
    );
    return;
  }

  const externalIds = upcomingEvents.map((event) => event.external_id);

  const existingRowsResult = supabase
    ? await supabase
        .from("draft_events")
        .select(EXISTING_DRAFT_COLUMNS)
        .eq("source_id", source.id)
        .in("external_id", externalIds)
    : { data: [], error: null };
  const liveEventsResult = supabase
    ? await supabase
        .from("events")
        .select("id, external_id, title, event_date, venue_id, sold_out")
        .eq("source_id", source.id)
    : { data: [], error: null };
  const { data: existingRows, error: existingError } = existingRowsResult;
  const { data: liveEvents, error: liveEventsError } = liveEventsResult;

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
  let skippedDuplicate = 0;

  for (const event of upcomingEvents) {
    const identity = eventIdentity(source, event);
    const duplicate =
      source.name === "Resident Advisor"
        ? findCrossSourceDuplicate(identity, options.known)
        : null;
    if (duplicate) {
      skippedDuplicate += 1;
      if (options.dryRun) {
        printDryRunEvent(
          `SKIP duplicate of "${duplicate.title}"`,
          source,
          event,
        );
      }
      continue;
    }

    const existing = existingByExternalId.get(event.external_id);
    const identityKey = buildEventIdentityKey(
      identity.venue_id ?? source.venue_id,
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

    const row = buildDraftRow(source, event, existing);
    rowsToUpsert.push(row);
    options.known.push(identity);
    if (options.dryRun) {
      printDryRunEvent(existing ? "UPDATE" : "CREATE", source, event);
    }
  }

  if (options.dryRun) {
    console.log(
      `[dry-run] ${source.name}: ${rowsToUpsert.length} would write (past skipped ${skippedPast}, duplicate ${skippedDuplicate}, protected ${skippedProtected}, already live ${skippedAlreadyLive})`,
    );
    return;
  }

  if (!supabase) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required unless --dry-run is set.");
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
    `Draft sync for ${source.name}: ${inserted} new, ${updated} pending updated (past skipped ${skippedPast}, duplicate ${skippedDuplicate}, protected ${skippedProtected}, already live ${skippedAlreadyLive}, other status ${skippedNonPending}, manual sold out kept ${keptManualSoldOut}, sold out updated ${soldOutPatches.length})`
  );
}

async function loadKnownEvents(
  supabase: ReturnType<typeof createClient>,
  venues: VenueRow[],
): Promise<KnownEvent[]> {
  const venueName = new Map(venues.map((venue) => [venue.id, venue.name]));
  const [drafts, events] = await Promise.all([
    supabase
      .from("draft_events")
      .select("source_id, external_id, title, event_date, venue_id"),
    supabase.from("events").select("source_id, external_id, title, event_date, venue_id"),
  ]);

  if (drafts.error) throw drafts.error;
  if (events.error) throw events.error;

  const rows = [
    ...((drafts.data ?? []) as Array<Record<string, unknown>>),
    ...((events.data ?? []) as Array<Record<string, unknown>>),
  ];

  return rows
    .filter((row) => !isPastEventDate(typeof row.event_date === "string" ? row.event_date : null))
    .map((row) => {
      const venueId = typeof row.venue_id === "string" ? row.venue_id : null;
      return {
        title: String(row.title ?? ""),
        event_date: typeof row.event_date === "string" ? row.event_date : null,
        venue_id: venueId,
        venue_name: venueId ? (venueName.get(venueId) ?? null) : null,
        source_id: typeof row.source_id === "string" ? row.source_id : null,
        external_id: typeof row.external_id === "string" ? row.external_id : null,
      };
    });
}

async function main() {
  const dryRun = isDryRun(process.argv);
  const supabase = getSupabase();
  if (!supabase && !dryRun) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required unless --dry-run is set.",
    );
  }

  let sources: ScrapeSource[] = DRY_RUN_SOURCES;
  let venues: VenueRow[] = [];
  const known: KnownEvent[] = [];

  if (supabase) {
    const [{ data, error }, venueResult] = await Promise.all([
      supabase
        .from("event_sources")
        .select("*")
        .eq("is_active", true)
        .eq("source_type", "website"),
      supabase.from("venues").select("id, name"),
    ]);
    if (error) throw error;
    if (venueResult.error) throw venueResult.error;

    venues = ((venueResult.data ?? []) as VenueRow[]).filter(
      (venue) => venue.id && venue.name,
    );
    sources = (data ?? []) as ScrapeSource[];
    known.push(...(await loadKnownEvents(supabase, venues)));

    if (!sources.some((source) => source.name === "Resident Advisor")) {
      const { data: raSource, error: raError } = await supabase
        .from("event_sources")
        .select("*")
        .eq("name", "Resident Advisor")
        .maybeSingle();
      if (raError) throw raError;
      if (raSource) {
        sources.push(raSource as ScrapeSource);
      } else if (dryRun) {
        sources.push(DRY_RUN_SOURCES.find((source) => source.name === "Resident Advisor")!);
      } else {
        console.log(
          "No event_sources row named \"Resident Advisor\". Add one (source_type website, is_active true) to store RA drafts. Skipping RA writes.",
        );
      }
    }
  }

  if (dryRun) {
    console.log("[dry-run] No database writes. Showing what each source would create or update.");
  }

  sources.sort((left, right) => {
    if (left.name === "Resident Advisor") return 1;
    if (right.name === "Resident Advisor") return -1;
    return left.name.localeCompare(right.name);
  });

  for (const source of sources) {
    console.log(`Scraping ${source.name}...`);

    const scrape = scrapers[source.name];
    if (!scrape) {
      console.log(`No scraper implemented yet for ${source.name}`);
      continue;
    }

    const events =
      source.name === "Resident Advisor"
        ? await scrapeResidentAdvisor(source, venues)
        : await scrape(source);

    await upsertDraftEvents(source, events, { dryRun, known, supabase });

    if (!dryRun && supabase && !source.id.startsWith("dry-")) {
      await supabase
        .from("event_sources")
        .update({ last_checked_at: new Date().toISOString() })
        .eq("id", source.id);
    }
  }
}

export async function runScrape(): Promise<void> {
  await main();
}
