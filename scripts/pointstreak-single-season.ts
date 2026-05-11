#!/usr/bin/env tsx
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadArchiveEnv } from "../src/lib/env";
import { archiveSeason } from "../src/lib/pointstreak-archive";
import { createExistingRawXmlFilePrompt } from "./lib/existing-file-prompts";

loadArchiveEnv();

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error("Usage: pointstreak-single-season.ts <seasonId> [leagueId]");
    process.exit(2);
  }
  const seasonId = Number(argv[0]);
  const leagueId = argv[1] ? Number(argv[1]) : undefined;
  const rl = input.isTTY && output.isTTY ? createInterface({ input, output }) : null;

  try {
    const res = await archiveSeason({
      seasonId,
      leagueId,
      onExistingFile: rl ? createExistingRawXmlFilePrompt(rl) : undefined,
      onLog: (l) => console.log(`[${l.level}] ${l.message}`),
    });
    console.log("Done", res);
    // Do not auto-commit generated data; leave commits to the operator.
  } finally {
    rl?.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
