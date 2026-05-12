#!/usr/bin/env tsx
import path from "path";
import { generateLegacyMablSeeds } from "../src/lib/legacy-mabl-seeds";

function parseArgs(argv: string[]) {
  const options: { outDir?: string; sqlPath?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--outDir") {
      options.outDir = argv[index + 1];
      index += 1;
    } else if (arg === "--sql") {
      options.sqlPath = argv[index + 1];
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: npm run archive:seeds-generate-mabl -- [--outDir data] [--sql data/raw/jaxmabl.sql]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(options.outDir ?? path.join(process.cwd(), "data"));
  const sqlPath = options.sqlPath ? path.resolve(options.sqlPath) : undefined;

  await generateLegacyMablSeeds(
    outDir,
    (log) => {
      const writer = log.level === "warn" ? console.warn : console.log;
      writer(`[legacy-mabl] [${log.level}] ${log.message}`);
    },
    { sqlPath },
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
