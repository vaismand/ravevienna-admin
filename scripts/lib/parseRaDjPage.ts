/**
 * Parse a single Resident Advisor DJ profile HTML page (manual admin use only).
 * Prefers __NEXT_DATA__ JSON; falls back to meta tags and stable DOM patterns.
 */

export type ParsedRaDj = {
  name: string | null;
  raSlug: string | null;
  raUrl: string | null;
  location: string | null;
  country: string | null;
  instagramUrl: string | null;
  soundcloudUrl: string | null;
  imageUrl: string | null;
  followers: number | null;
  bioPreview: string | null;
  upcomingEventLinks: string[];
};

const INSTAGRAM_RE =
  /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)\/?/gi;
const SOUNDCLOUD_RE =
  /https?:\/\/(?:www\.)?soundcloud\.com\/([A-Za-z0-9_-]+)\/?/gi;
const PROFILE_IMAGE_RE =
  /https?:\/\/[^"'\\s]+?\/images\/profiles\/[^"'\\s]+/gi;
const FOLLOWER_TEXT_RE =
  /(\d[\d.,\s]*)\s*(?:Followers?|Follower|Follower\s*innen)/i;
const H1_RE = /<h1[^>]*>([\s\S]*?)<\/h1>/i;
const OG = (prop: string) =>
  new RegExp(
    `<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
const OG_ALT = (prop: string) =>
  new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`,
    "i"
  );

export function parseRaSlugFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    const match = parsed.pathname.match(/\/dj\/([^/?#]+)/i);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

export function normalizeRaDjUrl(url: string): string {
  const parsed = new URL(url.trim());
  const slug = parseRaSlugFromUrl(url);
  if (!slug) {
    throw new Error(`Not a RA DJ URL (expected /dj/<slug>): ${url}`);
  }
  return `https://ra.co/dj/${slug}`;
}

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractMeta(html: string, prop: string): string | null {
  const re1 = OG(prop);
  const re2 = OG_ALT(prop);
  const m = html.match(re1) ?? html.match(re2);
  return m?.[1]?.trim() ? decodeHtmlEntities(m[1].trim()) : null;
}

function extractNextData(html: string): unknown | null {
  const match = html.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!match?.[1]) {
    return null;
  }
  try {
    return JSON.parse(match[1]) as unknown;
  } catch {
    return null;
  }
}

function firstMatch(re: RegExp, text: string): string | null {
  const flags = re.flags.replace("g", "");
  const single = new RegExp(re.source, flags);
  const m = text.match(single);
  return m?.[0]?.trim() || null;
}

function normalizeInstagramUrl(raw: string): string | null {
  const m = raw.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (!m?.[1] || m[1].toLowerCase() === "p") {
    return null;
  }
  return `https://instagram.com/${m[1]}`;
}

function normalizeSoundcloudUrl(raw: string): string | null {
  const m = raw.match(/soundcloud\.com\/([A-Za-z0-9_-]+)/i);
  if (!m?.[1]) {
    return null;
  }
  return `https://soundcloud.com/${m[1]}`;
}

function parseFollowerNumber(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) {
    return null;
  }
  const n = Number(digits);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function splitLocation(location: string): { location: string; country: string | null } {
  const trimmed = location.trim();
  if (!trimmed) {
    return { location: trimmed, country: null };
  }
  const parts = trimmed.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      location: trimmed,
      country: parts[parts.length - 1] ?? null,
    };
  }
  return { location: trimmed, country: null };
}

function walkJson(
  value: unknown,
  visit: (path: string[], key: string | null, value: unknown) => void,
  path: string[] = []
): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    visit(path, path[path.length - 1] ?? null, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkJson(item, visit, [...path, String(index)]));
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      walkJson(child, visit, [...path, key]);
    }
  }
}

function collectFromJson(nextData: unknown, raSlug: string | null): Partial<ParsedRaDj> {
  const instagram = new Set<string>();
  const soundcloud = new Set<string>();
  const images = new Set<string>();
  const eventLinks = new Set<string>();
  let name: string | null = null;
  let bio: string | null = null;
  let location: string | null = null;
  let country: string | null = null;
  let followers: number | null = null;

  const bioKeys = new Set([
    "bio",
    "biography",
    "about",
    "blurb",
    "description",
    "intro",
  ]);
  const locationKeys = new Set([
    "location",
    "area",
    "city",
    "country",
    "standort",
    "home",
  ]);
  const followerKeys = new Set([
    "followers",
    "followercount",
    "follower_count",
    "nbfollowers",
    "followerstotal",
  ]);
  const nameKeys = new Set(["name", "title", "artistname", "displayname"]);

  walkJson(nextData, (_path, key, value) => {
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) {
        return;
      }

      let ig: RegExpExecArray | null;
      const igRe = new RegExp(INSTAGRAM_RE.source, "gi");
      while ((ig = igRe.exec(text)) !== null) {
        const url = normalizeInstagramUrl(ig[0]);
        if (url) {
          instagram.add(url);
        }
      }

      let sc: RegExpExecArray | null;
      const scRe = new RegExp(SOUNDCLOUD_RE.source, "gi");
      while ((sc = scRe.exec(text)) !== null) {
        const url = normalizeSoundcloudUrl(sc[0]);
        if (url) {
          soundcloud.add(url);
        }
      }

      if (text.includes("/images/profiles/")) {
        const img = firstMatch(PROFILE_IMAGE_RE, text);
        if (img) {
          images.add(img);
        }
      }

      if (text.includes("/events/") && text.includes("ra.co")) {
        eventLinks.add(text.split(/[,\s]/)[0] ?? text);
      }

      const keyLower = key?.toLowerCase() ?? "";
      if (bioKeys.has(keyLower) && text.length > (bio?.length ?? 0) && text.length <= 4000) {
        if (!text.startsWith("http") && !text.includes("__NEXT")) {
          bio = text;
        }
      }

      if (locationKeys.has(keyLower) && text.length < 120 && !text.startsWith("http")) {
        if (!location || keyLower === "country") {
          if (keyLower === "country") {
            country = text;
          } else {
            location = location ? location : text;
            if (keyLower === "location" || keyLower === "area") {
              location = text;
            }
          }
        }
      }

      if (nameKeys.has(keyLower) && text.length <= 120 && !text.startsWith("http")) {
        if (!name || (raSlug && text.toLowerCase().includes(raSlug.replace(/\./g, "")))) {
          name = text;
        }
      }

      const followerMatch = text.match(FOLLOWER_TEXT_RE);
      if (followerMatch?.[1]) {
        const n = parseFollowerNumber(followerMatch[1]);
        if (n !== null) {
          followers = n;
        }
      }
    }

    if (typeof value === "number" && key) {
      const keyLower = key.toLowerCase();
      if (followerKeys.has(keyLower) && value >= 0 && value < 50_000_000) {
        followers = Math.max(followers ?? 0, Math.round(value));
      }
    }
  });

  // Prefer artist object with contentUrl /dj/
  walkJson(nextData, (_path, _key, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }
    const obj = value as Record<string, unknown>;
    const contentUrl = typeof obj.contentUrl === "string" ? obj.contentUrl : "";
    const urlSafeName = typeof obj.urlSafeName === "string" ? obj.urlSafeName : "";
    if (
      (contentUrl.includes("/dj/") || urlSafeName) &&
      typeof obj.name === "string" &&
      obj.name.trim()
    ) {
      if (!raSlug || contentUrl.includes(raSlug) || urlSafeName === raSlug) {
        name = obj.name.trim();
      }
    }
  });

  if (location && !country) {
    const split = splitLocation(location);
    location = split.location;
    country = split.country;
  }

  return {
    name,
    location,
    country,
    instagramUrl: [...instagram][0] ?? null,
    soundcloudUrl: [...soundcloud][0] ?? null,
    imageUrl: [...images][0] ?? null,
    followers,
    bioPreview: bio,
    upcomingEventLinks: [...eventLinks].slice(0, 20),
  };
}

function walkProfileAltFromHtml(html: string): string | null {
  const altMatch = html.match(
    /<img[^>]+alt=["'][^"']*profile image[^"']*["'][^>]+src=["']([^"']+)["']/i
  );
  if (altMatch?.[1]) {
    return altMatch[1];
  }
  const altMatch2 = html.match(
    /<img[^>]+src=["']([^"']+)["'][^>]+alt=["'][^"']*profile image[^"']*["']/i
  );
  return altMatch2?.[1] ?? null;
}

function collectAnchorsFromHtml(html: string): {
  instagramUrl: string | null;
  soundcloudUrl: string | null;
  eventLinks: string[];
} {
  const instagram = new Set<string>();
  const soundcloud = new Set<string>();
  const eventLinks = new Set<string>();

  const hrefRe = /href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const href = decodeHtmlEntities(m[1] ?? "");
    if (href.includes("instagram.com")) {
      const url = normalizeInstagramUrl(href);
      if (url) {
        instagram.add(url);
      }
    }
    if (href.includes("soundcloud.com")) {
      const url = normalizeSoundcloudUrl(href);
      if (url) {
        soundcloud.add(url);
      }
    }
    if (/\/events\/\d+/.test(href)) {
      const full = href.startsWith("http")
        ? href
        : `https://ra.co${href.startsWith("/") ? href : `/${href}`}`;
      eventLinks.add(full);
    }
  }

  return {
    instagramUrl: [...instagram][0] ?? null,
    soundcloudUrl: [...soundcloud][0] ?? null,
    eventLinks: [...eventLinks],
  };
}

function extractLocationFromHtml(html: string): string | null {
  const labelRe =
    /(?:Standort|Location|Based in|Home)\s*<\/[^>]+>\s*<[^>]+>([^<]{2,120})</i;
  const m = html.match(labelRe);
  if (m?.[1]) {
    return stripHtml(m[1]);
  }
  const plain = html.match(
    /(?:Standort|Location|Based in)\s*:?\s*([A-Za-zÀ-ÿ0-9.,\s-]{2,80})/i
  );
  return plain?.[1]?.trim() ?? null;
}

export function isRaBotChallengeHtml(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes("captcha-delivery.com") ||
    lower.includes("please enable js") ||
    html.length < 1500
  );
}

export function parseRaDjPage(html: string, sourceUrl: string): ParsedRaDj {
  const raUrl = normalizeRaDjUrl(sourceUrl);
  const raSlug = parseRaSlugFromUrl(raUrl);

  const nextData = extractNextData(html);
  const jsonExtras = nextData ? collectFromJson(nextData, raSlug) : {};

  const anchors = collectAnchorsFromHtml(html);
  const ogTitle = extractMeta(html, "title");
  const ogImage = extractMeta(html, "image");
  const ogDescription = extractMeta(html, "description");

  const h1Match = html.match(H1_RE);
  const h1Name = h1Match?.[1] ? stripHtml(h1Match[1]) : null;

  const htmlImages = [...(html.match(new RegExp(PROFILE_IMAGE_RE.source, "gi")) ?? [])];
  const altImage = walkProfileAltFromHtml(html);

  let name =
    jsonExtras.name ??
    h1Name ??
    (ogTitle ? ogTitle.replace(/\s*\|\s*Resident Advisor.*$/i, "").trim() : null);

  if (name && /resident advisor/i.test(name)) {
    name = name.replace(/\s*\|\s*Resident Advisor.*$/i, "").trim() || null;
  }

  let location = jsonExtras.location ?? extractLocationFromHtml(html);
  let country = jsonExtras.country ?? null;
  if (location && !country) {
    const split = splitLocation(location);
    location = split.location;
    country = split.country;
  }

  let followers = jsonExtras.followers ?? null;
  if (followers === null) {
    const textSample = stripHtml(html).slice(0, 50_000);
    const fm = textSample.match(FOLLOWER_TEXT_RE);
    if (fm?.[1]) {
      followers = parseFollowerNumber(fm[1]);
    }
  }

  const imageUrl =
    jsonExtras.imageUrl ??
    altImage ??
    (ogImage && ogImage.includes("/images/profiles/") ? ogImage : null) ??
    htmlImages[0] ??
    null;

  const bioPreview =
    jsonExtras.bioPreview ??
    (ogDescription && ogDescription.length > 20 ? ogDescription : null);

  const upcomingEventLinks = [
    ...new Set([
      ...(jsonExtras.upcomingEventLinks ?? []),
      ...anchors.eventLinks,
    ]),
  ].slice(0, 20);

  return {
    name: name || null,
    raSlug,
    raUrl,
    location,
    country,
    instagramUrl: jsonExtras.instagramUrl ?? anchors.instagramUrl,
    soundcloudUrl: jsonExtras.soundcloudUrl ?? anchors.soundcloudUrl,
    imageUrl,
    followers,
    bioPreview,
    upcomingEventLinks,
  };
}
