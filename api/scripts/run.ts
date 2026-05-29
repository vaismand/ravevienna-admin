import type { IncomingMessage, ServerResponse } from "node:http";

import {
  parseRunScriptRequest,
  sendJson,
} from "../../server/apiHandlers.ts";
import { runScriptDirect } from "../../server/runScriptDirect.ts";

export const config = {
  maxDuration: 300,
};

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  const parsed = await parseRunScriptRequest(req, res);
  if (!parsed.ok) {
    return;
  }

  const job = await runScriptDirect(parsed.scriptId, parsed.args);
  sendJson(res, 200, { job });
}
