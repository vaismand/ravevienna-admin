import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
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

const BUNDLED_FILES: Record<ScriptId, string> = {
  scrape: "dist/scripts/scrape.cjs",
  "enrich-spotify": "dist/scripts/enrich-spotify.cjs",
  "enrich-ra": "dist/scripts/enrich-ra.cjs",
};

const SOURCE_FILES: Record<ScriptId, string> = {
  scrape: "scraper/scripts/scrape.ts",
  "enrich-spotify": "scripts/enrich-djs-spotify.ts",
  "enrich-ra": "scripts/enrich-dj-ra.ts",
};

const require = createRequire(import.meta.url);

function getTsxCliPath(): string {
  return require.resolve("tsx/cli");
}

function resolveScriptCommand(
  scriptId: ScriptId,
  args: string[]
): { label: string; command: string; commandArgs: string[] } {
  const bundledPath = join(process.cwd(), BUNDLED_FILES[scriptId]);
  const useBundled = process.env.VERCEL === "1" || existsSync(bundledPath);

  if (useBundled) {
    if (!existsSync(bundledPath)) {
      throw new Error(
        `Bundled script missing: ${BUNDLED_FILES[scriptId]}. Run npm run build before deploying.`
      );
    }

    return {
      label: `node ${BUNDLED_FILES[scriptId]}${args.length ? ` ${args.join(" ")}` : ""}`,
      command: process.execPath,
      commandArgs: [bundledPath, ...args],
    };
  }

  const sourcePath = join(process.cwd(), SOURCE_FILES[scriptId]);
  return {
    label: `tsx ${SOURCE_FILES[scriptId]}${args.length ? ` ${args.join(" ")}` : ""}`,
    command: process.execPath,
    commandArgs: [getTsxCliPath(), sourcePath, ...args],
  };
}

export async function runScriptSpawn(
  scriptId: ScriptId,
  args: string[] = []
): Promise<ScriptJob> {
  const { label, command, commandArgs } = resolveScriptCommand(scriptId, args);
  const startedAt = new Date().toISOString();
  let output = `$ ${label}\n\n`;

  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(command, commandArgs, {
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
