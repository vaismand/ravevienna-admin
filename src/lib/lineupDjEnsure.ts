import type { SupabaseClient } from '@supabase/supabase-js';
import { djNamesMatch, slugFromName } from './djUtils';
import { formatPostgrestError } from './supabaseErrors';
import {
  escapeIlikePattern,
  genresForNewLineupDj,
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

async function findDjIdByExactSlugAndName(
  client: SupabaseClient,
  slug: string,
  normalizedName: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('djs')
    .select('id, name')
    .eq('slug', slug)
    .limit(1);

  if (error) throw new Error(formatPostgrestError(error));

  const row = data?.[0];
  if (!row?.id) return null;
  if (!djNamesMatch(String(row.name ?? ''), normalizedName)) return null;
  return row.id as string;
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
    if (djNamesMatch(row.name ?? '', normalizedName)) {
      return row.id as string;
    }
  }

  return null;
}

async function findDjIdByFoldedName(
  client: SupabaseClient,
  normalizedName: string,
): Promise<string | null> {
  const folded = slugFromName(normalizedName).replace(/-/g, ' ');
  const patterns = [normalizedName];
  if (folded && folded !== normalizedName.toLowerCase()) {
    patterns.push(folded);
  }

  for (const pattern of patterns) {
    const { data, error } = await client
      .from('djs')
      .select('id, name')
      .ilike('name', escapeIlikePattern(pattern))
      .limit(10);

    if (error) throw new Error(formatPostgrestError(error));

    for (const row of data ?? []) {
      if (djNamesMatch(row.name ?? '', normalizedName)) {
        return row.id as string;
      }
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
    const byExactSlug = await findDjIdByExactSlugAndName(
      client,
      baseSlug,
      normalized,
    );
    if (byExactSlug) return byExactSlug;

    const bySlugFamily = await findDjIdBySlugFamily(
      client,
      baseSlug,
      normalized,
    );
    if (bySlugFamily) return bySlugFamily;
  }

  return findDjIdByFoldedName(client, normalized);
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
      const dedupeKey = slugFromName(name) || name.toLowerCase();
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
 * DJ ids for the same names `ensureDjsFromLineup` creates, in that order.
 * Floor labels are dropped and b2b / f2f / vs / & sets are split first.
 * The same DJ is linked once; names that do not resolve are skipped.
 */
export async function resolveLineupDjIds(
  client: SupabaseClient,
  lineup: string[],
): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const name of prepareLineupForDjImport(lineup)) {
    const id = await findDjIdForLineupName(client, name);
    if (!id || seen.has(id)) continue;

    seen.add(id);
    ids.push(id);
  }

  return ids;
}
