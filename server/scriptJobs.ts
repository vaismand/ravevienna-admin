import { createClient } from "@supabase/supabase-js";

import { loadScriptEnv } from "../scripts/lib/loadEnv.ts";

loadScriptEnv();

export type ScriptId =
  | "scrape"
  | "enrich-spotify"
  | "enrich-ra"
  | "enrich-soundcloud";

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

export function isScriptApiConfigured(): boolean {
  const url =
    process.env.SUPABASE_URL?.trim() ||
    process.env.VITE_SUPABASE_URL?.trim();
  return Boolean(url && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

export function scriptApiConfigMessage(): string {
  if (process.env.VERCEL) {
    return "Script runner is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel → Project → Settings → Environment Variables, then redeploy.";
  }

  return "Script runner is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.scripts and restart npm run dev.";
}

export async function verifyAdminToken(
  authorizationHeader: string | undefined
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (!isScriptApiConfigured()) {
    return {
      ok: false,
      status: 503,
      message: scriptApiConfigMessage(),
    };
  }

  const match = authorizationHeader?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) {
    return { ok: false, status: 401, message: "Missing authorization token." };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL?.trim() ||
      process.env.VITE_SUPABASE_URL!.trim(),
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
