import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";

const scripts = [
  {
    entry: "scripts/entries/scrape.entry.ts",
    outfile: "dist/scripts/scrape.cjs",
  },
  {
    entry: "scripts/entries/enrich-spotify.entry.ts",
    outfile: "dist/scripts/enrich-spotify.cjs",
  },
  {
    entry: "scripts/entries/enrich-ra.entry.ts",
    outfile: "dist/scripts/enrich-ra.cjs",
  },
  {
    entry: "scripts/entries/enrich-soundcloud.entry.ts",
    outfile: "dist/scripts/enrich-soundcloud.cjs",
  },
] as const;

mkdirSync("dist/scripts", { recursive: true });

for (const script of scripts) {
  await esbuild.build({
    entryPoints: [script.entry],
    outfile: script.outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    logLevel: "info",
    packages: "external",
  });
  console.log(`Bundled ${script.entry} → ${script.outfile}`);
}
