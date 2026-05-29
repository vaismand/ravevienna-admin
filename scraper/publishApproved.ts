import { createClient } from "@supabase/supabase-js";

import { loadScriptEnv } from "../scripts/lib/loadEnv.ts";
import { normalizeEventGenres } from "../scripts/lib/genres.ts";

loadScriptEnv();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data: drafts, error: draftsError } = await supabase
    .from("draft_events")
    .select("*")
    .eq("status", "approved")
    .order("event_date", { ascending: true });

  if (draftsError) {
    console.error("Could not fetch approved drafts:", draftsError);
    process.exit(1);
  }

  if (!drafts || drafts.length === 0) {
    console.log("No approved draft events found.");
    return;
  }

  const rows = drafts.map((draft) => ({
    title: draft.title,

    venue_id: draft.venue_id,

    event_date: draft.event_date,
    start_time: draft.start_time,

    price: draft.price,
    genres: normalizeEventGenres(draft.genres ?? []),

    description: draft.description,
    lineup: Array.isArray(draft.lineup) ? draft.lineup : [],
    ticket_url: draft.ticket_url,
    image_url: draft.image_url,

    source_id: draft.source_id,
    draft_event_id: draft.id,
    external_id: draft.external_id,
    external_url: draft.external_url,
  }));

  const { data: insertedEvents, error: upsertError } = await supabase
    .from("events")
    .upsert(rows, {
      onConflict: "source_id,external_id",
    })
    .select("id, title");

  if (upsertError) {
    console.error("Could not publish events:", upsertError);
    process.exit(1);
  }

  const publishedDraftIds = drafts.map((draft) => draft.id);

  const { error: updateDraftsError } = await supabase
    .from("draft_events")
    .update({
      status: "published",
      updated_at: new Date().toISOString(),
    })
    .in("id", publishedDraftIds);

  if (updateDraftsError) {
    console.error("Events were inserted, but draft status update failed:");
    console.error(updateDraftsError);
    process.exit(1);
  }

  console.log(`Published ${insertedEvents?.length ?? 0} events:`);
  insertedEvents?.forEach((event) => {
    console.log(`- ${event.title}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});