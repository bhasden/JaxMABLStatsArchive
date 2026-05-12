#!/usr/bin/env tsx
import path from "path";
import {
  ARCHIVE_DB_IMPORTED_TABLES,
  DEFAULT_ARCHIVE_DB_FILE_NAME,
  importMergedSeedsToArchiveDb,
} from "../src/lib/archive-db";

type CliOptions = {
  outDir: string;
  mergedDirName: string;
  dbFileName: string;
  seedsDir?: string;
};

function usage() {
  console.error("Usage: db-build.ts [--outDir <dir>] [--mergedDir <name>] [--dbFile <name>] [--seedsDir <dir>]");
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
    dbFileName: DEFAULT_ARCHIVE_DB_FILE_NAME,
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

    if (arg === "--dbFile" || arg === "--db-file") {
      options.dbFileName = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--seedsDir" || arg === "--seeds-dir") {
      options.seedsDir = path.resolve(readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = await importMergedSeedsToArchiveDb(options);

  console.log(`Imported merged archive seeds from ${summary.seedsDir}`);
  console.log(`Archive DB written to ${summary.dbPath}`);
  console.log(`Seasons: ${summary.seasonCount}`);
  console.log(`Source warnings: ${summary.warnings}`);
  for (const table of ARCHIVE_DB_IMPORTED_TABLES) {
    console.log(`${table}: ${summary.importedCounts[table]} rows`);
  }
}

main().catch((err) => {
  console.error(err);
  usage();
  process.exit(1);
});
