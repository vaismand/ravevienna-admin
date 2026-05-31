import { supabase } from './supabase';
import { slugFromName } from './djUtils';
import { formatPostgrestError } from './supabaseErrors';

export interface EnsureLineupDjsResult {
  created: string[];
  existing: string[];
}

async function ensureUniqueSlug(baseSlug: string): Promise<string> {
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    const { data, error } = await supabase
      .from('djs')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();

    if (error) throw new Error(formatPostgrestError(error));
    if (!data) return candidate;

    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

async function findDjByNameOrSlug(name: string): Promise<{ id: string } | null> {
  const slug = slugFromName(name);
  if (slug) {
    const { data, error } = await supabase
      .from('djs')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    if (error) throw new Error(formatPostgrestError(error));
    if (data) return data;
  }

  const { data, error } = await supabase
    .from('djs')
    .select('id')
    .ilike('name', name.trim())
    .maybeSingle();

  if (error) throw new Error(formatPostgrestError(error));
  return data;
}

function uniqueLineupNames(lineup: string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const raw of lineup) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

/**
 * Ensure every lineup artist exists in `djs`. Missing names are inserted as
 * inactive drafts (`is_active: false`) so they can be edited before publishing.
 */
export async function ensureDjsFromLineup(
  lineup: string[] | null | undefined,
): Promise<EnsureLineupDjsResult> {
  const names = uniqueLineupNames(lineup ?? []);
  const created: string[] = [];
  const existing: string[] = [];

  for (const name of names) {
    const found = await findDjByNameOrSlug(name);
    if (found) {
      existing.push(name);
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

    if (error) throw new Error(formatPostgrestError(error));
    created.push(name);
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
