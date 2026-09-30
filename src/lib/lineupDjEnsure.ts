import type { SupabaseClient } from '@supabase/supabase-js';
import { slugFromName } from './djUtils';
import { formatPostgrestError } from './supabaseErrors';
import {
  escapeIlikePattern,
  genresForNewLineupDj,
  lineupNamesMatch,
  normalizeLineupArtistName,
  prepareLineupForDjImport,
} from '../../scripts/lib/lineupArtists';

export interface EnsureLineupDjsResult {
  created: string[];
  existing: string[];
}

export type LineupDjSource = {
  lineup: string[] | null | undefined;
  eventGenres?: string[] | null;
};

export type LineupDjContext = {
  lineup?: string[];
  eventGenres?: string[] | null;
};

function isUniqueViolation(error: { code?: string }): boolean {
  return error.code === '23505';
}

async function findDjIdBySlug(
  client: SupabaseClient,
  slug: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('djs')
    .select('id')
    .eq('slug', slug)
    .limit(1);

  if (error) throw new Error(formatPostgrestError(error));
  return data?.[0]?.id ?? null;
}

async function findDjIdByName(
  client: SupabaseClient,
  name: string,
): Promise<string | null> {
  const normalized = normalizeLineupArtistName(name);
  if (!normalized) return null;

  const { data, error } = await client
    .from('djs')
    .select('id, name')
    .ilike('name', escapeIlikePattern(normalized))
    .limit(10);

  if (error) throw new Error(formatPostgrestError(error));

  for (const row of data ?? []) {
    if (lineupNamesMatch(row.name ?? '', normalized)) {
      return row.id as string;
    }
  }

  return null;
}

async function findDjIdBySlugFamily(
  client: SupabaseClient,
  baseSlug: string,
  normalizedName: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('djs')
    .select('id, name, slug')
    .or(`slug.eq.${baseSlug},slug.like.${baseSlug}-%`)
    .limit(25);

  if (error) throw new Error(formatPostgrestError(error));

  for (const row of data ?? []) {
    if (lineupNamesMatch(row.name ?? '', normalizedName)) {
      return row.id as string;
    }
  }

  return null;
}

export async function findDjIdForLineupName(
  client: SupabaseClient,
  name: string,
): Promise<string | null> {
  const normalized = normalizeLineupArtistName(name);
  if (!normalized) return null;

  const baseSlug = slugFromName(normalized);
  if (baseSlug) {
    const byExactSlug = await findDjIdBySlug(client, baseSlug);
    if (byExactSlug) return byExactSlug;

    const bySlugFamily = await findDjIdBySlugFamily(
      client,
      baseSlug,
      normalized,
    );
    if (bySlugFamily) return bySlugFamily;
  }

  return findDjIdByName(client, normalized);
}

async function ensureUniqueSlug(
  client: SupabaseClient,
  baseSlug: string,
): Promise<string> {
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    const taken = await findDjIdBySlug(client, candidate);
    if (!taken) return candidate;

    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

/**
 * Ensure every lineup artist exists in `djs`. Missing names are inserted as
 * inactive drafts (`is_active: false`) so they can be edited before publishing.
 */
export async function ensureDjsFromLineupSources(
  client: SupabaseClient,
  sources: LineupDjSource[],
): Promise<EnsureLineupDjsResult> {
  const created: string[] = [];
  const existing: string[] = [];
  const resolvedNames = new Set<string>();

  for (const source of sources) {
    const names = prepareLineupForDjImport(source.lineup ?? []);
    const genres = genresForNewLineupDj(source.eventGenres);

    for (const name of names) {
      const dedupeKey = name.toLowerCase();
      if (resolvedNames.has(dedupeKey)) {
        existing.push(name);
        continue;
      }

      const existingId = await findDjIdForLineupName(client, name);
      if (existingId) {
        existing.push(name);
        resolvedNames.add(dedupeKey);
        continue;
      }

      const baseSlug = slugFromName(name);
      if (!baseSlug) continue;

      const slug = await ensureUniqueSlug(client, baseSlug);
      const now = new Date().toISOString();

      const { error } = await client.from('djs').insert({
        name,
        slug,
        bio: null,
        genres,
        instagram_url: null,
        soundcloud_url: null,
        spotify_url: null,
        website_url: null,
        image_url: null,
        city: 'Vienna',
        country: 'Austria',
        is_active: false,
        created_at: now,
        updated_at: now,
      });

      if (error) {
        if (isUniqueViolation(error)) {
          existing.push(name);
          resolvedNames.add(dedupeKey);
          continue;
        }
        throw new Error(formatPostgrestError(error));
      }

      created.push(name);
      resolvedNames.add(dedupeKey);
    }
  }

  return { created, existing };
}

export async function ensureDjsFromLineup(
  client: SupabaseClient,
  lineup: string[] | null | undefined,
  eventGenres?: string[] | null,
): Promise<EnsureLineupDjsResult> {
  return ensureDjsFromLineupSources(client, [{ lineup, eventGenres }]);
}

export async function ensureDjsFromDraftLineups(
  client: SupabaseClient,
  draftIds: string[],
): Promise<EnsureLineupDjsResult> {
  if (draftIds.length === 0) return { created: [], existing: [] };

  const { data, error } = await client
    .from('draft_events')
    .select('lineup, genres')
    .in('id', draftIds);

  if (error) throw new Error(formatPostgrestError(error));

  return ensureDjsFromLineupSources(
    client,
    (data ?? []).map((row) => ({
      lineup: Array.isArray(row.lineup) ? row.lineup : [],
      eventGenres: Array.isArray(row.genres) ? row.genres : null,
    })),
  );
}

/**
 * DJ ids for each lineup entry, in lineup order.
 * The same DJ is linked once; names that do not resolve are skipped.
 */
export async function resolveLineupDjIds(
  client: SupabaseClient,
  lineup: string[],
): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const raw of lineup) {
    const name = normalizeLineupArtistName(raw);
    if (!name) continue;

    const id = await findDjIdForLineupName(client, name);
    if (!id || seen.has(id)) continue;

    seen.add(id);
    ids.push(id);
  }

  return ids;
}
