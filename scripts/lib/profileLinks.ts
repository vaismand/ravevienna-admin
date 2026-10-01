const SOUNDCLOUD_RE =
  /https?:\/\/(?:www\.|m\.)?soundcloud\.com\/([A-Za-z0-9_-]+)/gi;
const INSTAGRAM_RE =
  /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)/gi;

const IGNORED_IG = new Set([
  "p",
  "reel",
  "reels",
  "stories",
  "explore",
  "accounts",
]);

export function soundcloudPermalink(value: string | null | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }

  const trimmed = value.trim();
  const fromUrl = trimmed.match(
    /soundcloud\.com\/([A-Za-z0-9_-]+)/i
  );
  if (fromUrl?.[1]) {
    return fromUrl[1].toLowerCase();
  }

  if (/^[A-Za-z0-9_-]+$/.test(trimmed) && !trimmed.includes(".")) {
    return trimmed.toLowerCase();
  }

  return null;
}

export function instagramHandle(value: string | null | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }

  const trimmed = value.trim().replace(/^@/, "");
  const fromUrl = trimmed.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  const handle = (fromUrl?.[1] ?? trimmed).replace(/\/+$/, "");
  if (!/^[A-Za-z0-9._]+$/.test(handle)) {
    return null;
  }
  if (IGNORED_IG.has(handle.toLowerCase())) {
    return null;
  }
  return handle.toLowerCase();
}

export function canonicalSoundCloudUrl(
  value: string | null | undefined
): string | null {
  const permalink = soundcloudPermalink(value);
  return permalink ? `https://soundcloud.com/${permalink}` : null;
}

export function canonicalInstagramUrl(
  value: string | null | undefined
): string | null {
  const handle = instagramHandle(value);
  return handle ? `https://instagram.com/${handle}` : null;
}

export function extractProfileLinks(text: string | null | undefined): {
  soundcloudUrls: string[];
  instagramUrls: string[];
} {
  if (!text) {
    return { soundcloudUrls: [], instagramUrls: [] };
  }

  const soundcloud = new Set<string>();
  const instagram = new Set<string>();

  for (const match of text.matchAll(SOUNDCLOUD_RE)) {
    const url = canonicalSoundCloudUrl(match[0]);
    if (url) {
      soundcloud.add(url);
    }
  }

  for (const match of text.matchAll(INSTAGRAM_RE)) {
    const url = canonicalInstagramUrl(match[0]);
    if (url) {
      instagram.add(url);
    }
  }

  return {
    soundcloudUrls: [...soundcloud],
    instagramUrls: [...instagram],
  };
}

export function sameSoundCloud(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const left = soundcloudPermalink(a);
  const right = soundcloudPermalink(b);
  return Boolean(left && right && left === right);
}

export function sameInstagram(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const left = instagramHandle(a);
  const right = instagramHandle(b);
  return Boolean(left && right && left === right);
}
