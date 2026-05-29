import { randomUUID } from "node:crypto";

import { runEnrichDjRa } from "../scripts/enrich-dj-ra.ts";
import { runEnrichDjsSpotify } from "../scripts/enrich-djs-spotify.ts";
import { runScrape } from "../scraper/scripts/scrape.ts";
import { captureOutput } from "./captureOutput.ts";
import type { ScriptId, ScriptJob } from "./scriptJobs.ts";

function formatCommand(scriptId: ScriptId, args: string[]): string {
  const files: Record<ScriptId, string> = {
    scrape: "scraper/scripts/scrape.ts",
    "enrich-spotify": "scripts/enrich-djs-spotify.ts",
    "enrich-ra": "scripts/enrich-dj-ra.ts",
  };

  const file = files[scriptId];
  return `$ tsx ${file}${args.length ? ` ${args.join(" ")}` : ""}`;
}

export async function runScriptDirect(
  scriptId: ScriptId,
  args: string[] = []
): Promise<ScriptJob> {
  const startedAt = new Date().toISOString();
  const header = `${formatCommand(scriptId, args)}\n\n`;

  const { output, exitCode } = await captureOutput(async () => {
    switch (scriptId) {
      case "scrape":
        await runScrape();
        break;
      case "enrich-spotify":
        await runEnrichDjsSpotify(args);
        break;
      case "enrich-ra":
        await runEnrichDjRa(args);
        break;
    }
  });

  const finishedAt = new Date().toISOString();

  return {
    id: randomUUID(),
    scriptId,
    status: exitCode === 0 ? "completed" : "failed",
    output: `${header}${output}`,
    exitCode,
    startedAt,
    finishedAt,
  };
}
