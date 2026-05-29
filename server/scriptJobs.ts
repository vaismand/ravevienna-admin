import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { loadScriptEnv } from "../scripts/lib/loadEnv.ts";

loadScriptEnv();

export type ScriptId = "scrape" | "enrich-spotify" | "enrich-ra";

export type JobStatus = "running" | "completed" | "failed";

export type ScriptJob = {
  id: string;
  scriptId: ScriptId;
  status: JobStatus;
  output: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
};

const SCRIPT_COMMANDS: Record<
  ScriptId,
  { file: string; defaultArgs?: string[] }
> = {
  scrape: { file: "scraper/scripts/scrape.ts" },
  "enrich-spotify": { file: "scripts/enrich-djs-spotify.ts" },
  "enrich-ra": { file: "scripts/enrich-dj-ra.ts" },
};

const jobs = new Map<string, ScriptJob>();
let activeJobId: string | null = null;

const MAX_OUTPUT_CHARS = 200_000;

function appendOutput(job: ScriptJob, chunk: string): void {
  job.output = `${job.output}${chunk}`.slice(-MAX_OUTPUT_CHARS);
}

function finishJob(job: ScriptJob, exitCode: number): void {
  job.exitCode = exitCode;
  job.finishedAt = new Date().toISOString();
  job.status = exitCode === 0 ? "completed" : "failed";
  if (activeJobId === job.id) {
    activeJobId = null;
  }
}

export function getJob(jobId: string): ScriptJob | undefined {
  return jobs.get(jobId);
}

export function getActiveJob(): ScriptJob | null {
  return activeJobId ? (jobs.get(activeJobId) ?? null) : null;
}

export function isScriptApiConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  );
}

export async function verifyAdminToken(
  authorizationHeader: string | undefined
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (!isScriptApiConfigured()) {
    return {
      ok: false,
      status: 503,
      message:
        "Script runner is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.scripts and restart the dev server.",
    };
  }

  const match = authorizationHeader?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) {
    return { ok: false, status: 401, message: "Missing authorization token." };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return { ok: false, status: 401, message: "Invalid or expired session." };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError) {
    return {
      ok: false,
      status: 500,
      message: "Could not verify admin role.",
    };
  }

  if (profile?.role?.trim().toLowerCase() !== "admin") {
    return { ok: false, status: 403, message: "Admin access required." };
  }

  return { ok: true };
}

export function startScriptJob(
  scriptId: ScriptId,
  args: string[] = []
): ScriptJob | { error: string } {
  if (activeJobId) {
    return { error: "Another script is already running." };
  }

  const command = SCRIPT_COMMANDS[scriptId];
  if (!command) {
    return { error: `Unknown script: ${scriptId}` };
  }

  const job: ScriptJob = {
    id: randomUUID(),
    scriptId,
    status: "running",
    output: "",
    exitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  jobs.set(job.id, job);
  activeJobId = job.id;

  const scriptPath = join(process.cwd(), command.file);
  const scriptArgs = [...(command.defaultArgs ?? []), ...args];
  appendOutput(
    job,
    `$ tsx ${command.file}${scriptArgs.length ? ` ${scriptArgs.join(" ")}` : ""}\n\n`
  );

  const child = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsx", scriptPath, ...scriptArgs],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  child.stdout.on("data", (chunk: Buffer) => {
    appendOutput(job, chunk.toString("utf8"));
  });

  child.stderr.on("data", (chunk: Buffer) => {
    appendOutput(job, chunk.toString("utf8"));
  });

  child.on("error", (error) => {
    appendOutput(job, `\n[process error] ${error.message}\n`);
    finishJob(job, 1);
  });

  child.on("close", (code) => {
    finishJob(job, code ?? 1);
  });

  return job;
}
