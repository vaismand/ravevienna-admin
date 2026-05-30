import { runEnrichDjsSpotify } from "../enrich-djs-spotify.ts";

const args = process.argv.slice(2);

runEnrichDjsSpotify(args).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
