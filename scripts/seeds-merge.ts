#!/usr/bin/env tsx
import path from "path";
import { ARCHIVE_SEED_TABLES, buildAndWriteMergedSeedBundle } from "../src/lib/archive-seed-merge";

type CliOptions = {
  outDir: string;
  mergedDirName: string;
  seasonIds: number[];
};

function usage() {
  console.error("Usage: seeds-merge.ts [--outDir <dir>] [--mergedDir <name>] [--season <seasonId>]...");
}

function readOptionValue(args: string[], index: number, option: string) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    outDir: path.join(process.cwd(), "data"),
    mergedDirName: "all",
    seasonIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }

    if (arg === "--outDir" || arg === "--out-dir") {
      options.outDir = path.resolve(readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--mergedDir" || arg === "--merged-dir") {
      options.mergedDirName = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--season") {
      const seasonId = Number(readOptionValue(argv, index, arg));
      if (!Number.isInteger(seasonId) || seasonId <= 0) {
        throw new Error(`Invalid season id: ${argv[index + 1]}`);
      }
      options.seasonIds.push(seasonId);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { dir, bundle } = await buildAndWriteMergedSeedBundle(options.outDir, {
    mergedDirName: options.mergedDirName,
    seasonIds: options.seasonIds,
  });

  console.log(`Merged ${bundle.seasonIds.length} seasons into ${dir}`);
  console.log(`Seasons: ${bundle.seasonIds.join(", ")}`);
  if (bundle.manifest.entityMerges) {
    const entityMerges = bundle.manifest.entityMerges;
    console.log(
      `Entity merges: ${entityMerges.playerAliasCount} player aliases from ${entityMerges.playerConfigPath} and ${entityMerges.teamAliasCount} team aliases from ${entityMerges.teamConfigPath}`,
    );
  }
  for (const table of ARCHIVE_SEED_TABLES) {
    const stats = bundle.manifest.tableStats[table];
    console.log(`${table}: ${stats.outputRows} rows (${stats.inputRows} input, ${stats.collapsedRows} collapsed)`);
  }
  console.log(`Warnings: ${bundle.manifest.warnings.length}`);
}

main().catch((err) => {
  console.error(err);
  usage();
  process.exit(1);
});
