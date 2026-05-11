#!/usr/bin/env tsx
import { generateSeedsForSeason } from "../src/lib/pointstreak-archive";

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error("Usage: seeds-generate-single-season.ts <seasonId> [outDir]");
    process.exit(2);
  }
  const seasonId = Number(argv[0]);
  const outDir = argv[1] || undefined;

  await generateSeedsForSeason(seasonId, outDir ?? process.cwd() + "/data", (l) =>
    console.log(`[${l.level}] ${l.message}`),
  );
  console.log("Seeds generated");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
