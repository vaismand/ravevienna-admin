import { scrapeArena } from "./arena";
import { scrapeDasWerk } from "./dasWerk";
import { scrapeFlex } from "./flex";
import { scrapeFlucc } from "./flucc";
import { scrapeGrelleForelle } from "./grelleForelle";
import { scrapeSass } from "./sass";
import { scrapeTheLoft } from "./theLoft";
import type { ScraperFn } from "./types";

export { scrapeArena } from "./arena";
export { scrapeDasWerk } from "./dasWerk";
export { scrapeFlex } from "./flex";
export { scrapeFlucc } from "./flucc";
export { scrapeGrelleForelle } from "./grelleForelle";
export { scrapeSass } from "./sass";
export { scrapeTheLoft } from "./theLoft";
export type { ScrapedEvent, ScrapeSource, ScraperFn } from "./types";

export const scrapers: Record<string, ScraperFn> = {
  "Arena Wien": scrapeArena,
  "Das Werk": scrapeDasWerk,
  Flex: scrapeFlex,
  FLUCC: scrapeFlucc,
  "Grelle Forelle": scrapeGrelleForelle,
  "SASS Music Club": scrapeSass,
  "The Loft": scrapeTheLoft,
};
