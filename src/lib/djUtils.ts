import type { Dj, DjFormData } from '../types/database';

export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function djInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function validateOptionalUrl(
  value: string,
  label: string,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) {
    return `${label} must start with http:// or https://`;
  }
  return null;
}

export function validateDjForm(data: DjFormData): string | null {
  if (!data.name.trim()) return 'Name is required.';
  if (!data.slug.trim()) return 'Slug is required.';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug.trim())) {
    return 'Slug must be lowercase letters, numbers, and hyphens only.';
  }

  for (const [value, label] of [
    [data.instagram_url, 'Instagram URL'],
    [data.soundcloud_url, 'SoundCloud URL'],
    [data.spotify_url, 'Spotify URL'],
    [data.website_url, 'Website URL'],
    [data.image_url, 'Image URL'],
  ] as const) {
    const err = validateOptionalUrl(value, label);
    if (err) return err;
  }

  return null;
}

export function matchesDjSearch(dj: Dj, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    dj.name,
    dj.slug,
    dj.city,
    dj.country,
    ...(dj.genres ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

export function djFormToPayload(data: DjFormData) {
  const trimOrNull = (v: string) => v.trim() || null;
  return {
    name: data.name.trim(),
    slug: data.slug.trim(),
    bio: trimOrNull(data.bio),
    genres: data.genres,
    instagram_url: trimOrNull(data.instagram_url),
    soundcloud_url: trimOrNull(data.soundcloud_url),
    spotify_url: trimOrNull(data.spotify_url),
    website_url: trimOrNull(data.website_url),
    image_url: trimOrNull(data.image_url),
    city: trimOrNull(data.city) ?? 'Vienna',
    country: trimOrNull(data.country) ?? 'Austria',
    is_active: data.is_active,
    updated_at: new Date().toISOString(),
  };
}

export function djToFormData(dj: Dj): DjFormData {
  return {
    name: dj.name ?? '',
    slug: dj.slug ?? '',
    bio: dj.bio ?? '',
    genres: dj.genres ?? [],
    instagram_url: dj.instagram_url ?? '',
    soundcloud_url: dj.soundcloud_url ?? '',
    spotify_url: dj.spotify_url ?? '',
    website_url: dj.website_url ?? '',
    image_url: dj.image_url ?? '',
    city: dj.city ?? 'Vienna',
    country: dj.country ?? 'Austria',
    is_active: dj.is_active ?? true,
  };
}
