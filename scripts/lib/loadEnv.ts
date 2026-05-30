import { config as loadEnvFile } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ENV_FILES = [
  ".env.scripts",
  ".env",
  ".env.local",
  "scraper/.env",
];

/** Load server-side env for CLI scripts (service role, Spotify, etc.). */
export function loadScriptEnv(cwd = process.cwd()): void {
  if (!process.env.VERCEL) {
    for (const name of ENV_FILES) {
      const path = join(cwd, name);
      if (existsSync(path)) {
        loadEnvFile({ path, override: true });
      }
    }
  }

  if (!process.env.SUPABASE_URL?.trim()) {
    const fromVite = process.env.VITE_SUPABASE_URL?.trim();
    if (fromVite) {
      process.env.SUPABASE_URL = fromVite;
    }
  }
}
