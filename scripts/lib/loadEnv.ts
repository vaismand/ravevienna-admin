import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ENV_FILES = [
  ".env.scripts",
  ".env",
  ".env.local",
  "scraper/.env",
];

function applyEnvFile(path: string): void {
  const content = readFileSync(path, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

/** Load server-side env for CLI scripts (service role, Spotify, etc.). */
export function loadScriptEnv(cwd = process.cwd()): void {
  if (!process.env.VERCEL) {
    for (const name of ENV_FILES) {
      const path = join(cwd, name);
      if (existsSync(path)) {
        applyEnvFile(path);
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
