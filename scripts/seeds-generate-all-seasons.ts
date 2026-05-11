#!/usr/bin/env tsx
import path from "path";
import { generateSeedsForSeason } from "../src/lib/pointstreak-archive";
import { listRawSeasonIds } from "./lib/raw-seasons";

type CliOptions = {
  outDir: string;
  seasonIds: number[];
};

function usage() {
  console.error("Usage: seeds-generate-all-seasons.ts [--outDir <dir>] [--season <seasonId>]...");
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
  const seasonIds = options.seasonIds.length > 0 ? options.seasonIds : await listRawSeasonIds(options.outDir);
  if (seasonIds.length === 0) {
    throw new Error(`No raw season directories found under ${options.outDir}`);
  }

  for (const seasonId of seasonIds) {
    await generateSeedsForSeason(seasonId, options.outDir, (log) =>
      console.log(`[${seasonId}] [${log.level}] ${log.message}`),
    );
  }

  console.log(`Generated season seeds for ${seasonIds.length} seasons.`);
}

main().catch((err) => {
  console.error(err);
  usage();
  process.exit(1);
});
