import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type CacheEntry = {
  savedAt: number;
  body: string;
};

export class ResponseCache {
  constructor(
    private readonly dir: string,
    private readonly ttlMs: number
  ) {}

  private filePath(key: string): string {
    const hash = createHash("sha256").update(key).digest("hex");
    return join(this.dir, `${hash}.json`);
  }

  async get(key: string): Promise<string | null> {
    try {
      const raw = await readFile(this.filePath(key), "utf8");
      const parsed = JSON.parse(raw) as CacheEntry;
      if (!parsed?.body || Date.now() - parsed.savedAt > this.ttlMs) {
        return null;
      }
      return parsed.body;
    } catch {
      return null;
    }
  }

  async set(key: string, body: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const entry: CacheEntry = { savedAt: Date.now(), body };
    await writeFile(this.filePath(key), JSON.stringify(entry), "utf8");
  }
}

/** Wait between outbound requests. Cache hits should not call this. */
export class RequestPacer {
  private nextAt = 0;

  constructor(private readonly minIntervalMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const delay = Math.max(0, this.nextAt - now);
    this.nextAt = (delay > 0 ? this.nextAt : now) + this.minIntervalMs;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
