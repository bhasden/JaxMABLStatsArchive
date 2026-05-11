#!/usr/bin/env tsx
import path from "path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ARCHIVE_SEASONS } from "../src/lib/constants";
import { loadArchiveEnv } from "../src/lib/env";
import { archiveSeasonRaw } from "../src/lib/pointstreak-archive";
import { createExistingRawXmlFilePrompt } from "./lib/existing-file-prompts";

loadArchiveEnv();

type CliOptions = {
  outDir: string;
  leagueId?: number;
  pointstreakUsername?: string;
  pointstreakPassword?: string;
};

type SeasonTarget = {
  id: number;
  name: string;
};

function usage() {
  console.error(
    "Usage: pointstreak-all-seasons.ts [--outDir <dir>] [--leagueId <id>] [--pointstreakUsername <value>] [--pointstreakPassword <value>]",
  );
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

    if (arg === "--leagueId" || arg === "--league-id") {
      const leagueId = Number(readOptionValue(argv, index, arg));
      if (!Number.isInteger(leagueId) || leagueId <= 0) {
        throw new Error(`Invalid league id: ${argv[index + 1]}`);
      }
      options.leagueId = leagueId;
      index += 1;
      continue;
    }

    if (arg === "--pointstreakUsername" || arg === "--pointstreak-username") {
      options.pointstreakUsername = readOptionValue(argv, index, arg).trim();
      index += 1;
      continue;
    }

    if (arg === "--pointstreakPassword" || arg === "--pointstreak-password") {
      options.pointstreakPassword = readOptionValue(argv, index, arg).trim();
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function applyPointstreakCredentials(options: CliOptions) {
  const username = options.pointstreakUsername || process.env.POINTSTREAK_USERNAME?.trim();
  const password = options.pointstreakPassword || process.env.POINTSTREAK_PASSWORD?.trim();

  if (!username || !password) {
    throw new Error(
      "Missing Pointstreak credentials. Set POINTSTREAK_USERNAME and POINTSTREAK_PASSWORD in your shell or .env.local, or pass --pointstreakUsername and --pointstreakPassword.",
    );
  }

  process.env.POINTSTREAK_USERNAME = username;
  process.env.POINTSTREAK_PASSWORD = password;
}

function getArchiveSeasonTargets(): SeasonTarget[] {
  const seen = new Set<number>();
  const seasons: SeasonTarget[] = [];

  for (const season of ARCHIVE_SEASONS) {
    const seasonId = Number(season.id);
    if (!Number.isInteger(seasonId) || seasonId <= 0 || seen.has(seasonId)) {
      continue;
    }
    seen.add(seasonId);
    seasons.push({
      id: seasonId,
      name: season.name,
    });
  }

  return seasons;
}

function isAffirmative(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "" || normalized === "y" || normalized === "yes";
}

function isExplicitAffirmative(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  applyPointstreakCredentials(options);

  const seasons = getArchiveSeasonTargets();

  if (seasons.length === 0) {
    throw new Error("No archive seasons configured.");
  }

  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      "pointstreak-all-seasons.ts requires an interactive terminal because it prompts after each season.",
    );
  }

  const rl = createInterface({ input, output });
  const onExistingFile = createExistingRawXmlFilePrompt(rl);
  let completedSeasons = 0;

  console.log(`Running raw archive import for ${seasons.length} seasons into ${options.outDir}`);
  if (options.leagueId != null) {
    console.log(`Using league id ${options.leagueId}`);
  }

  try {
    for (const [index, season] of seasons.entries()) {
      console.log("");
      console.log(`=== [${index + 1}/${seasons.length}] ${season.name} (${season.id}) ===`);

      try {
        const result = await archiveSeasonRaw({
          seasonId: season.id,
          leagueId: options.leagueId,
          outDir: options.outDir,
          onExistingFile,
          onLog: (log) => console.log(`[${log.level}] ${log.message}`),
        });
        completedSeasons += 1;
        console.log(
          `Season ${season.id} raw import complete: ${result.fetched} boxscores fetched, ${result.skipped} skipped, ${result.failed} failed; ${result.supplementalFetched} supplemental fetched, ${result.supplementalSkipped} skipped, ${result.supplementalFailed} failed.`,
        );
      } catch (err) {
        console.error(`Season ${season.id} failed:`, err);
        if (index >= seasons.length - 1) {
          break;
        }

        const retryAnswer = await rl.question(`Continue to the next season after this failure? [y/N] `);
        if (!isExplicitAffirmative(retryAnswer)) {
          console.log("Stopping at operator request.");
          break;
        }
        continue;
      }

      if (index >= seasons.length - 1) {
        break;
      }

      const nextSeason = seasons[index + 1];
      const answer = await rl.question(`Continue to ${nextSeason.name} (${nextSeason.id})? [Y/n] `);
      if (!isAffirmative(answer)) {
        console.log("Stopping at operator request.");
        break;
      }
    }
  } finally {
    rl.close();
  }

  console.log("");
  console.log(`Completed raw import for ${completedSeasons} season${completedSeasons === 1 ? "" : "s"}.`);
}

main().catch((err) => {
  console.error(err);
  usage();
  process.exit(1);
});
