import type { IncomingMessage, ServerResponse } from "node:http";

import { handleScriptHealth } from "../../server/apiHandlers.ts";

export const config = {
  maxDuration: 300,
};

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed." }));
    return;
  }

  await handleScriptHealth(req, res);
}
