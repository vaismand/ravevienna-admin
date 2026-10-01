import type { ScrapeSource, ScraperFn } from "./scrapers/types";

export type SourceRunStatus = "ok" | "failed" | "skipped";

export type SourceRunResult = {
  sourceName: string;
  status: SourceRunStatus;
  eventCount: number;
  error?: string;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return String(error);
}

export function formatScrapeSummary(results: readonly SourceRunResult[]): string {
  const ok = results.filter((result) => result.status === "ok").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const lines = [
    `Scrape summary: ${ok} ok, ${failed} failed, ${skipped} skipped`,
  ];

  for (const result of results) {
    if (result.status === "ok") {
      lines.push(`  OK      ${result.sourceName} — ${result.eventCount} events`);
    } else if (result.status === "skipped") {
      lines.push(`  SKIPPED ${result.sourceName} — no scraper implemented`);
    } else {
      lines.push(`  FAILED  ${result.sourceName} — ${result.error ?? "unknown error"}`);
    }
  }

  return lines.join("\n");
}

/**
 * Run every source even when one throws. Failures are logged and included
 * in the summary printed after the last source.
 */
export async function runScrapersIsolated(
  sources: readonly ScrapeSource[],
  scrapers: Record<string, ScraperFn>,
  options?: {
    afterScrape?: (source: ScrapeSource, events: unknown[]) => Promise<void>;
    log?: (line: string) => void;
    errorLog?: (line: string) => void;
  },
): Promise<SourceRunResult[]> {
  const log = options?.log ?? ((line: string) => console.log(line));
  const errorLog = options?.errorLog ?? ((line: string) => console.error(line));
  const results: SourceRunResult[] = [];

  for (const source of sources) {
    const scrape = scrapers[source.name];
    if (!scrape) {
      log(`No scraper implemented yet for ${source.name}`);
      results.push({
        sourceName: source.name,
        status: "skipped",
        eventCount: 0,
      });
      continue;
    }

    log(`Scraping ${source.name}...`);

    try {
      const events = await scrape(source);
      await options?.afterScrape?.(source, events);
      results.push({
        sourceName: source.name,
        status: "ok",
        eventCount: events.length,
      });
    } catch (error) {
      const message = errorMessage(error);
      errorLog(`Scrape failed for ${source.name}: ${message}`);
      if (error instanceof Error && error.stack) errorLog(error.stack);
      results.push({
        sourceName: source.name,
        status: "failed",
        eventCount: 0,
        error: message,
      });
    }
  }

  log(formatScrapeSummary(results));
  return results;
}
