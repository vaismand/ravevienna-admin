import { createClient } from "@supabase/supabase-js";

import { loadScriptEnv } from "../scripts/lib/loadEnv.ts";
import { publishDraftRecord } from "../src/lib/publishDraft.ts";
import type { DraftEvent } from "../src/types/database.ts";

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

  const failed: string[] = [];
  let published = 0;

  for (const draft of drafts as DraftEvent[]) {
    try {
      const { eventId, djs } = await publishDraftRecord(supabase, draft);
      published += 1;
      const created =
        djs.created.length > 0 ? ` (new DJs: ${djs.created.join(", ")})` : "";
      console.log(`- ${draft.title} [${eventId}]${created}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push(`${draft.title}: ${message}`);
      console.error(`Failed to publish ${draft.title}: ${message}`);
    }
  }

  console.log(`Published ${published} event(s).`);

  if (failed.length > 0) {
    console.error(`${failed.length} event(s) failed.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
