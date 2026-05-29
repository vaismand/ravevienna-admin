import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";

import {
  getActiveJob,
  getJob,
  isScriptApiConfigured,
  startScriptJob,
  verifyAdminToken,
  type ScriptId,
} from "./scriptJobs.ts";

const SCRIPT_IDS = new Set<ScriptId>([
  "scrape",
  "enrich-spotify",
  "enrich-ra",
]);

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw) as unknown;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function createScriptRunnerMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (!req.url?.startsWith("/api/scripts")) {
      next();
      return;
    }

    void handleScriptRequest(req, res).catch((error) => {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Unexpected server error.",
      });
    });
  };
}

async function handleScriptRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/api/scripts/health") {
    sendJson(res, 200, {
      configured: isScriptApiConfigured(),
      activeJob: getActiveJob(),
    });
    return;
  }

  const jobMatch = url.pathname.match(/^\/api\/scripts\/jobs\/([^/]+)$/);
  if (req.method === "GET" && jobMatch) {
    const auth = await verifyAdminToken(req.headers.authorization);
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.message });
      return;
    }

    const job = getJob(jobMatch[1]!);
    if (!job) {
      sendJson(res, 404, { error: "Job not found." });
      return;
    }

    sendJson(res, 200, { job });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/scripts/run") {
    const auth = await verifyAdminToken(req.headers.authorization);
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.message });
      return;
    }

    const body = (await readJsonBody(req)) as {
      scriptId?: unknown;
      args?: unknown;
    };

    const scriptId = body.scriptId;
    if (typeof scriptId !== "string" || !SCRIPT_IDS.has(scriptId as ScriptId)) {
      sendJson(res, 400, { error: "Invalid scriptId." });
      return;
    }

    const args = body.args;
    if (args !== undefined && !isStringArray(args)) {
      sendJson(res, 400, { error: "args must be an array of strings." });
      return;
    }

    const result = startScriptJob(scriptId as ScriptId, args ?? []);
    if ("error" in result) {
      sendJson(res, 409, { error: result.error });
      return;
    }

    sendJson(res, 202, { job: result });
    return;
  }

  sendJson(res, 404, { error: "Not found." });
}
