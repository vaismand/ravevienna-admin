import { createClient } from "@supabase/supabase-js";

import {
  getMissingScriptEnvVars,
  getSupabaseUrl,
  isScriptApiConfigured,
} from "./scriptEnv.js";

export async function verifyAdminToken(
  authorizationHeader: string | undefined
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (!isScriptApiConfigured()) {
    const missing = getMissingScriptEnvVars().join(", ");
    return {
      ok: false,
      status: 503,
      message: `Script runner is not configured. Missing: ${missing}. Add them in Vercel → Settings → Environment Variables, then redeploy.`,
    };
  }

  const match = authorizationHeader?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) {
    return { ok: false, status: 401, message: "Missing authorization token." };
  }

  const supabase = createClient(
    getSupabaseUrl()!,
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
