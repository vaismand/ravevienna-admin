import { supabase } from './supabase';
import { slugFromName } from './djUtils';
import { formatPostgrestError } from './supabaseErrors';
import {
  escapeIlikePattern,
  lineupNamesMatch,
  normalizeLineupArtistName,
  prepareLineupForDjImport,
} from '../../scripts/lib/lineupArtists';

export interface EnsureLineupDjsResult {
  created: string[];
  existing: string[];
}

function isUniqueViolation(error: { code?: string }): boolean {
  return error.code === '23505';
}

async function findDjIdBySlug(slug: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('djs')
    .select('id')
    .eq('slug', slug)
    .limit(1);

  if (error) throw new Error(formatPostgrestError(error));
  return data?.[0]?.id ?? null;
}

async function findDjIdByName(name: string): Promise<string | null> {
  const normalized = normalizeLineupArtistName(name);
  if (!normalized) return null;

  const { data, error } = await supabase
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
  baseSlug: string,
  normalizedName: string,
): Promise<string | null> {
  const { data, error } = await supabase
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

async function findDjByNameOrSlug(name: string): Promise<string | null> {
  const normalized = normalizeLineupArtistName(name);
  if (!normalized) return null;

  const baseSlug = slugFromName(normalized);
  if (baseSlug) {
    const byExactSlug = await findDjIdBySlug(baseSlug);
    if (byExactSlug) return byExactSlug;

    const bySlugFamily = await findDjIdBySlugFamily(baseSlug, normalized);
    if (bySlugFamily) return bySlugFamily;
  }

  return findDjIdByName(normalized);
}

async function ensureUniqueSlug(baseSlug: string): Promise<string> {
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    const taken = await findDjIdBySlug(candidate);
    if (!taken) return candidate;

    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

/**
 * Ensure every lineup artist exists in `djs`. Missing names are inserted as
 * inactive drafts (`is_active: false`) so they can be edited before publishing.
 */
export async function ensureDjsFromLineup(
  lineup: string[] | null | undefined,
): Promise<EnsureLineupDjsResult> {
  const names = prepareLineupForDjImport(lineup ?? []);
  const created: string[] = [];
  const existing: string[] = [];
  const resolvedNames = new Set<string>();

  for (const name of names) {
    const dedupeKey = name.toLowerCase();
    if (resolvedNames.has(dedupeKey)) {
      existing.push(name);
      continue;
    }

    const existingId = await findDjByNameOrSlug(name);
    if (existingId) {
      existing.push(name);
      resolvedNames.add(dedupeKey);
      continue;
    }

    const baseSlug = slugFromName(name);
    if (!baseSlug) continue;

    const slug = await ensureUniqueSlug(baseSlug);
    const now = new Date().toISOString();

    const { error } = await supabase.from('djs').insert({
      name,
      slug,
      bio: null,
      genres: [],
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

  return { created, existing };
}

export async function ensureDjsFromDraftLineups(
  draftIds: string[],
): Promise<EnsureLineupDjsResult> {
  if (draftIds.length === 0) return { created: [], existing: [] };

  const { data, error } = await supabase
    .from('draft_events')
    .select('lineup')
    .in('id', draftIds);

  if (error) throw new Error(formatPostgrestError(error));

  const allNames: string[] = [];
  for (const row of data ?? []) {
    if (Array.isArray(row.lineup)) {
      allNames.push(...row.lineup);
    }
  }

  return ensureDjsFromLineup(allNames);
}
