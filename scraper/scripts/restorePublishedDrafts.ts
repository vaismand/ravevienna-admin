/**
 * One-off recovery: set draft_events back to "published" when a matching
 * live row exists in events (same source_id + external_id).
 *
 * Use after a scrape run that incorrectly reset published drafts to pending.
 *
 *   npm run scrape:restore-drafts
 */
import { createClient } from "@supabase/supabase-js";

import { loadScriptEnv } from "../../scripts/lib/loadEnv.ts";

loadScriptEnv();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data: liveEvents, error: liveError } = await supabase
    .from("events")
    .select("id, title, source_id, external_id");

  if (liveError) {
    console.error("Could not load events:", liveError);
    process.exit(1);
  }

  if (!liveEvents?.length) {
    console.log("No live events found.");
    return;
  }

  const keys = liveEvents.filter(
    (row) => row.source_id && row.external_id
  );

  let restored = 0;

  for (const event of keys) {
    const { data, error } = await supabase
      .from("draft_events")
      .update({
        status: "published",
        updated_at: new Date().toISOString(),
      })
      .eq("source_id", event.source_id!)
      .eq("external_id", event.external_id!)
      .neq("status", "published")
      .select("id, title, status");

    if (error) {
      console.error(`Failed for ${event.title}:`, error.message);
      continue;
    }

    if (data?.length) {
      restored += data.length;
      for (const row of data) {
        console.log(`Restored → published: ${row.title} (was ${row.status})`);
      }
    }
  }

  console.log(`\nDone. Restored ${restored} draft(s) to published.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
