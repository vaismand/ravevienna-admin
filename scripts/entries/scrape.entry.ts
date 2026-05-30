import { runScrape } from "../../scraper/scripts/scrape.ts";

runScrape().catch((error) => {
  console.error(error);
  process.exit(1);
});
