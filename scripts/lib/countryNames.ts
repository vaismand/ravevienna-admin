/**
 * Country values on `djs.country` are mixed (`AT` and `Austria`).
 * New writes use English short names (Intl / ISO), e.g. "Austria", "Czechia".
 * Existing non-empty values are left untouched by the enrichment plan.
 */

const ALIASES: Record<string, string> = {
  at: "Austria",
  aut: "Austria",
  austria: "Austria",
  osterreich: "Austria",
  österreich: "Austria",
  de: "Germany",
  deu: "Germany",
  germany: "Germany",
  deutschland: "Germany",
  ch: "Switzerland",
  che: "Switzerland",
  switzerland: "Switzerland",
  schweiz: "Switzerland",
  suisse: "Switzerland",
  svizzera: "Switzerland",
  cz: "Czechia",
  cze: "Czechia",
  czechia: "Czechia",
  "czech republic": "Czechia",
  tschechien: "Czechia",
  sk: "Slovakia",
  svk: "Slovakia",
  slovakia: "Slovakia",
  slowakei: "Slovakia",
  hu: "Hungary",
  hun: "Hungary",
  hungary: "Hungary",
  ungarn: "Hungary",
  si: "Slovenia",
  svn: "Slovenia",
  slovenia: "Slovenia",
  slowenien: "Slovenia",
  it: "Italy",
  ita: "Italy",
  italy: "Italy",
  italia: "Italy",
  uk: "United Kingdom",
  gb: "United Kingdom",
  gbr: "United Kingdom",
  "united kingdom": "United Kingdom",
  "great britain": "United Kingdom",
  us: "United States",
  usa: "United States",
  "united states": "United States",
  "united states of america": "United States",
  nl: "Netherlands",
  nld: "Netherlands",
  netherlands: "Netherlands",
  holland: "Netherlands",
  fr: "France",
  fra: "France",
  france: "France",
  be: "Belgium",
  bel: "Belgium",
  belgium: "Belgium",
  pl: "Poland",
  pol: "Poland",
  poland: "Poland",
  es: "Spain",
  esp: "Spain",
  spain: "Spain",
};

const NEIGHBOURS = new Set([
  "Germany",
  "Switzerland",
  "Czechia",
  "Slovakia",
  "Hungary",
  "Slovenia",
  "Italy",
]);

const regionDisplay = new Intl.DisplayNames(["en"], { type: "region" });

function foldKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function regionName(code: string): string | null {
  try {
    const name = regionDisplay.of(code);
    if (!name || name.toUpperCase() === code.toUpperCase()) {
      return null;
    }
    return name;
  } catch {
    return null;
  }
}

/** English short country name, or null when the value is not a country. */
export function normalizeCountryName(
  input: string | null | undefined
): string | null {
  if (!input?.trim()) {
    return null;
  }

  const trimmed = input.trim();
  const key = foldKey(trimmed);
  const alias = ALIASES[key];
  if (alias) {
    return alias;
  }

  if (/^[a-z]{2}$/i.test(trimmed)) {
    return regionName(trimmed.toUpperCase());
  }

  if (/^[a-zA-Z][a-zA-Z .'-]{1,}$/.test(trimmed)) {
    return trimmed.replace(/\s+/g, " ");
  }

  return null;
}

export type CountryTier = "austria" | "neighbour" | "other" | "unknown";

export function isViennaCity(city: string | null | undefined): boolean {
  if (!city?.trim()) {
    return false;
  }
  return /\b(vienna|wien)\b/i.test(city);
}

export function countryTier(
  country: string | null | undefined,
  city?: string | null
): CountryTier {
  if (isViennaCity(city)) {
    return "austria";
  }

  const name = normalizeCountryName(country);
  if (!name) {
    return "unknown";
  }
  if (name === "Austria") {
    return "austria";
  }
  if (NEIGHBOURS.has(name)) {
    return "neighbour";
  }
  return "other";
}

export function countriesMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const left = normalizeCountryName(a);
  const right = normalizeCountryName(b);
  return Boolean(left && right && left === right);
}
