#!/usr/bin/env tsx
import fs from "fs/promises";
import path from "path";
import { buildAndWriteMergedSeedBundle } from "../src/lib/archive-seed-merge";
import { importMergedSeedsToArchiveDb } from "../src/lib/archive-db";
import { generateSeedsForSeason } from "../src/lib/pointstreak-archive";
import { listRawSeasonIds } from "./lib/raw-seasons";

async function main() {
  const dataDir = path.join(process.cwd(), "data");
  const publicDir = path.join(process.cwd(), "public");

  await fs.mkdir(publicDir, { recursive: true });

  const seasonIds = await listRawSeasonIds(dataDir);
  if (seasonIds.length === 0) {
    throw new Error(`No raw season directories found under ${dataDir}`);
  }

  console.log(`Step 1/3: Generating season seed bundles for ${seasonIds.length} seasons.`);
  for (const seasonId of seasonIds) {
    await generateSeedsForSeason(seasonId, dataDir, (log) =>
      console.log(`[${seasonId}] [${log.level}] ${log.message}`),
    );
  }

  console.log("Step 2/3: Merging season seed bundles and applying reviewed entity merges.");
  const { bundle, dir } = await buildAndWriteMergedSeedBundle(dataDir);
  if (bundle.manifest.entityMerges) {
    const entityMerges = bundle.manifest.entityMerges;
    console.log(
      `Applied entity merge config ${entityMerges.configPath}: ${entityMerges.playerAliasCount} player aliases, ${entityMerges.teamAliasCount} team aliases.`,
    );
  }

  console.log("Step 3/3: Importing merged seed bundle into static SQLite database.");
  const summary = await importMergedSeedsToArchiveDb({
    outDir: publicDir,
    seedsDir: dir,
    dbFileName: "archive.sqlite",
  });

  console.log(`Static archive database written to ${summary.dbPath}`);
  console.log(`Merged ${bundle.seasonIds.length} seasons with ${bundle.manifest.warnings.length} warnings.`);
  if (bundle.manifest.warnings.length > 0) {
    console.log(`Warnings are listed in ${path.join(dir, "manifest.json")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
