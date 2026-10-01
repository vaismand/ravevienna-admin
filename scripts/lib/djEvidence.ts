import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProfileEvidence } from "./matchDjProfiles.ts";
import { extractProfileLinks } from "./profileLinks.ts";

type EvidenceRow = {
  title?: string | null;
  description?: string | null;
  external_url?: string | null;
  ticket_url?: string | null;
  lineup?: string[] | null;
  raw_data?: unknown;
};

const PAGE_LIMIT = 3;
const SKIP_HOSTS = [
  "soundcloud.com",
  "instagram.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "spotify.com",
  "youtube.com",
  "youtu.be",
  "ra.co",
];

function isSocialHost(hostname: string): boolean {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  return SKIP_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function collectRow(row: EvidenceRow, texts: string[], pages: string[]) {
  const chunks: string[] = [];
  for (const value of [row.title, row.description, row.external_url, row.ticket_url]) {
    if (value?.trim()) {
      chunks.push(value);
    }
  }
  if (Array.isArray(row.lineup)) {
    chunks.push(row.lineup.join("\n"));
  }
  if (row.raw_data != null) {
    try {
      chunks.push(JSON.stringify(row.raw_data));
    } catch {
      // ignore unserializable scraper payloads
    }
  }
  if (chunks.length > 0) {
    texts.push(chunks.join("\n"));
  }

  for (const url of [row.external_url, row.ticket_url]) {
    if (!url || !/^https?:\/\//i.test(url)) {
      continue;
    }
    try {
      if (isSocialHost(new URL(url).hostname)) {
        continue;
      }
    } catch {
      continue;
    }
    if (!pages.includes(url)) {
      pages.push(url);
    }
  }
}

async function rowsFrom(
  label: string,
  warnings: string[],
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<EvidenceRow[]> {
  try {
    const { data, error } = await query;
    if (error) {
      warnings.push(`${label}: ${error.message}`);
      return [];
    }
    return Array.isArray(data) ? (data as EvidenceRow[]) : [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`${label}: ${message}`);
    return [];
  }
}

export async function loadDjProfileEvidence(
  supabase: SupabaseClient,
  dj: { id: string; name: string },
  fetchText: (url: string) => Promise<string | null>
): Promise<{ evidence: ProfileEvidence; warnings: string[] }> {
  const warnings: string[] = [];
  const texts: string[] = [];
  const pages: string[] = [];

  const links = await rowsFrom(
    "event_djs",
    warnings,
    supabase.from("event_djs").select("event_id").eq("dj_id", dj.id).limit(30)
  );
  const eventIds = links
    .map((row) => {
      const record = row as { event_id?: unknown };
      return typeof record.event_id === "string" ? record.event_id : null;
    })
    .filter((id): id is string => Boolean(id));

  if (eventIds.length > 0) {
    const events = await rowsFrom(
      "events",
      warnings,
      supabase
        .from("events")
        .select("title, description, external_url, ticket_url, lineup")
        .in("id", eventIds)
    );
    for (const event of events) {
      collectRow(event, texts, pages);
    }
  }

  const lineupEvents = await rowsFrom(
    "events lineup",
    warnings,
    supabase
      .from("events")
      .select("title, description, external_url, ticket_url, lineup")
      .contains("lineup", [dj.name])
      .limit(20)
  );
  for (const event of lineupEvents) {
    collectRow(event, texts, pages);
  }

  const drafts = await rowsFrom(
    "draft_events",
    warnings,
    supabase
      .from("draft_events")
      .select("title, description, external_url, ticket_url, lineup, raw_data")
      .contains("lineup", [dj.name])
      .limit(20)
  );
  for (const draft of drafts) {
    collectRow(draft, texts, pages);
  }

  const combined = extractProfileLinks(texts.join("\n"));
  const soundcloudUrls = new Set(combined.soundcloudUrls);
  const instagramUrls = new Set(combined.instagramUrls);

  for (const url of pages.slice(0, PAGE_LIMIT)) {
    const html = await fetchText(url);
    if (!html) {
      continue;
    }
    const found = extractProfileLinks(html);
    for (const link of found.soundcloudUrls) {
      soundcloudUrls.add(link);
    }
    for (const link of found.instagramUrls) {
      instagramUrls.add(link);
    }
  }

  return {
    evidence: {
      soundcloudUrls: [...soundcloudUrls],
      instagramUrls: [...instagramUrls],
    },
    warnings,
  };
}
