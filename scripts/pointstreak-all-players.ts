#!/usr/bin/env tsx
import path from "path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadArchiveEnv } from "../src/lib/env";
import { archiveAllPointstreakPlayers } from "../src/lib/pointstreak-player-archive";
import { createExistingRawXmlFilePrompt } from "./lib/existing-file-prompts";

loadArchiveEnv();

type CliOptions = {
  outDir: string;
  pointstreakUsername?: string;
  pointstreakPassword?: string;
};

function usage() {
  console.error(
    "Usage: pointstreak-all-players.ts [--outDir <dir>] [--pointstreakUsername <value>] [--pointstreakPassword <value>]",
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  applyPointstreakCredentials(options);
  const rl = input.isTTY && output.isTTY ? createInterface({ input, output }) : null;

  try {
    console.log(`Running Pointstreak player profile archive into ${options.outDir}`);
    const result = await archiveAllPointstreakPlayers({
      outDir: options.outDir,
      onExistingFile: rl ? createExistingRawXmlFilePrompt(rl) : undefined,
      onLog: (log) => console.log(`[${log.level}] ${log.message}`),
    });

    console.log(
      `Player profile archive complete: ${result.playerIds.length} unique player ids discovered from ${result.rosterFileCount} roster files; ${result.fetched} fetched, ${result.skipped} skipped, ${result.failed} failed.`,
    );
    if (result.skippedSeasonOnlyEntries > 0) {
      console.log(
        `Skipped ${result.skippedSeasonOnlyEntries} roster entries that did not expose a cross-season playerlinkid.`,
      );
    }
  } finally {
    rl?.close();
  }
}

main().catch((err) => {
  console.error(err);
  usage();
  process.exit(1);
});
