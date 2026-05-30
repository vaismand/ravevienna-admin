import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";

export type ScriptId = "scrape" | "enrich-spotify" | "enrich-ra";

export type ScriptJob = {
  id: string;
  scriptId: ScriptId;
  status: "running" | "completed" | "failed";
  output: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
};

const SCRIPT_FILES: Record<ScriptId, string> = {
  scrape: "scraper/scripts/scrape.ts",
  "enrich-spotify": "scripts/enrich-djs-spotify.ts",
  "enrich-ra": "scripts/enrich-dj-ra.ts",
};

const require = createRequire(import.meta.url);

function getTsxCliPath(): string {
  return require.resolve("tsx/cli");
}

export async function runScriptSpawn(
  scriptId: ScriptId,
  args: string[] = []
): Promise<ScriptJob> {
  const file = SCRIPT_FILES[scriptId];
  const scriptPath = join(process.cwd(), file);
  const startedAt = new Date().toISOString();
  let output = `$ tsx ${file}${args.length ? ` ${args.join(" ")}` : ""}\n\n`;

  const tsxCli = getTsxCliPath();

  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, scriptPath, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: Buffer) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-200_000);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-200_000);
    });

    child.on("error", (error) => {
      output = `${output}\n[spawn error] ${error.message}\n`;
      reject(error);
    });

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
