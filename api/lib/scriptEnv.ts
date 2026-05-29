export function getSupabaseUrl(): string | undefined {
  return (
    process.env.SUPABASE_URL?.trim() ||
    process.env.VITE_SUPABASE_URL?.trim() ||
    undefined
  );
}

export function getMissingScriptEnvVars(): string[] {
  const missing: string[] = [];
  if (!getSupabaseUrl()) {
    missing.push("SUPABASE_URL (or reuse VITE_SUPABASE_URL)");
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }
  return missing;
}

export function isScriptApiConfigured(): boolean {
  return getMissingScriptEnvVars().length === 0;
}
