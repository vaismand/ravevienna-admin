import { runEnrichDjRa } from "../enrich-dj-ra.ts";

const args = process.argv.slice(2);

runEnrichDjRa(args).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
