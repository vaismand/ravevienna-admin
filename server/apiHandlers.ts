import type { IncomingMessage, ServerResponse } from "node:http";

import {
  isScriptApiConfigured,
  verifyAdminToken,
  type ScriptId,
} from "./scriptJobs.ts";

const SCRIPT_IDS = new Set<ScriptId>([
  "scrape",
  "enrich-spotify",
  "enrich-ra",
]);

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
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

export async function handleScriptHealth(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  sendJson(res, 200, {
    configured: isScriptApiConfigured(),
    activeJob: null,
  });
}

export async function parseRunScriptRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<
  | { ok: true; scriptId: ScriptId; args: string[] }
  | { ok: false }
> {
  const auth = await verifyAdminToken(req.headers.authorization);
  if (!auth.ok) {
    sendJson(res, auth.status, { error: auth.message });
    return { ok: false };
  }

  const body = (await readJsonBody(req)) as {
    scriptId?: unknown;
    args?: unknown;
  };

  const scriptId = body.scriptId;
  if (typeof scriptId !== "string" || !SCRIPT_IDS.has(scriptId as ScriptId)) {
    sendJson(res, 400, { error: "Invalid scriptId." });
    return { ok: false };
  }

  const args = body.args;
  if (args !== undefined && !isStringArray(args)) {
    sendJson(res, 400, { error: "args must be an array of strings." });
    return { ok: false };
  }

  return {
    ok: true,
    scriptId: scriptId as ScriptId,
    args: args ?? [],
  };
}
