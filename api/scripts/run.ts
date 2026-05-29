import { verifyAdminToken } from "../lib/scriptAuth.js";

type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

export const maxDuration = 300;

const SCRIPT_IDS = new Set(["scrape", "enrich-spotify", "enrich-ra"]);

export default async function handler(
  req: ApiRequest,
  res: ApiResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const authHeader = req.headers.authorization;
  const authorization =
    typeof authHeader === "string" ? authHeader : authHeader?.[0];

  const auth = await verifyAdminToken(authorization);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.message });
    return;
  }

  const body = (req.body ?? {}) as { scriptId?: unknown; args?: unknown };
  const scriptId = body.scriptId;

  if (typeof scriptId !== "string" || !SCRIPT_IDS.has(scriptId)) {
    res.status(400).json({ error: "Invalid scriptId." });
    return;
  }

  const args = body.args;
  if (args !== undefined && !Array.isArray(args)) {
    res.status(400).json({ error: "args must be an array of strings." });
    return;
  }

  if (
    args !== undefined &&
    !args.every((item) => typeof item === "string")
  ) {
    res.status(400).json({ error: "args must be an array of strings." });
    return;
  }

  try {
    const { runScriptDirect } = await import("../../server/runScriptDirect.js");
    const job = await runScriptDirect(
      scriptId as "scrape" | "enrich-spotify" | "enrich-ra",
      args ?? []
    );
    res.status(200).json({ job });
  } catch (error) {
    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Script execution failed.",
    });
  }
}
