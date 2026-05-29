import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";

import {
  handleScriptHealth,
  parseRunScriptRequest,
  sendJson,
} from "./apiHandlers.ts";
import { spawnScriptJob } from "./spawnScript.ts";

export function createScriptRunnerMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (!req.url?.startsWith("/api/scripts")) {
      next();
      return;
    }

    void handleScriptRoute(req, res).catch((error) => {
      sendJson(res, 500, {
        error:
          error instanceof Error ? error.message : "Unexpected server error.",
      });
    });
  };
}

async function handleScriptRoute(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/api/scripts/health") {
    await handleScriptHealth(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/scripts/run") {
    const parsed = await parseRunScriptRequest(req, res);
    if (!parsed.ok) {
      return;
    }

    const job = await spawnScriptJob(parsed.scriptId, parsed.args);
    sendJson(res, 200, { job });
    return;
  }

  sendJson(res, 404, { error: "Not found." });
}
