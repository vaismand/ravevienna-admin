import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type { ScriptId, ScriptJob } from "./scriptJobs.ts";

const SCRIPT_FILES: Record<ScriptId, string> = {
  scrape: "scraper/scripts/scrape.ts",
  "enrich-spotify": "scripts/enrich-djs-spotify.ts",
  "enrich-ra": "scripts/enrich-dj-ra.ts",
};

export async function spawnScriptJob(
  scriptId: ScriptId,
  args: string[] = []
): Promise<ScriptJob> {
  const file = SCRIPT_FILES[scriptId];
  const scriptPath = join(process.cwd(), file);
  const startedAt = new Date().toISOString();
  let output = `$ tsx ${file}${args.length ? ` ${args.join(" ")}` : ""}\n\n`;

  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["tsx", scriptPath, ...args],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    child.stdout.on("data", (chunk: Buffer) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-200_000);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-200_000);
    });

    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });

  const finishedAt = new Date().toISOString();

  return {
    id: randomUUID(),
    scriptId,
    status: exitCode === 0 ? "completed" : "failed",
    output,
    exitCode,
    startedAt,
    finishedAt,
  };
}
