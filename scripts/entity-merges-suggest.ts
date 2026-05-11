#!/usr/bin/env tsx
import fs from "fs/promises";
import path from "path";
import { ARCHIVE_SEED_TABLES, loadSeasonSeedBundles } from "../src/lib/archive-seed-merge";
import type { EntityMergeConfig, EntityMergeGroup, EntityNonMergeGroup } from "../src/lib/entity-merges";

type EntityRecord = {
  id: number;
  names: Set<string>;
  seasons: Set<number>;
};

type Candidate = {
  entityType: "player" | "team";
  matchType: string;
  canonicalId: number;
  aliasIds: number[];
  entities: Array<{
    id: number;
    names: string[];
    seasons: number[];
  }>;
};

type CliOptions = {
  outDir: string;
  outputPath: string;
  mergeConfigPath: string;
  seasonIds: number[];
};

function usage() {
  console.error(
    "Usage: entity-merges-suggest.ts [--outDir <dir>] [--output <file>] [--mergeConfig <file>] [--season <seasonId>]...",
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
    outputPath: path.join(process.cwd(), "data", "entity-merge-candidates.json"),
    mergeConfigPath: path.join(process.cwd(), "data", "entity-merges.json"),
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
    if (arg === "--output") {
      options.outputPath = path.resolve(readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--mergeConfig" || arg === "--merge-config") {
      options.mergeConfigPath = path.resolve(readOptionValue(argv, index, arg));
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

async function readEntityMergeReviewConfig(configPath: string) {
  try {
    const text = await fs.readFile(configPath, "utf8");
    return JSON.parse(text) as EntityMergeConfig;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return {} as EntityMergeConfig;
    }
    throw err;
  }
}

function integerOrNull(value: unknown) {
  if (value == null || value === "") {
    return null;
  }
  const numericValue = Number(value);
  return Number.isInteger(numericValue) ? numericValue : null;
}

function textOrNull(value: unknown) {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function addEntity(records: Map<number, EntityRecord>, id: unknown, seasonId: unknown, ...names: unknown[]) {
  const numericId = integerOrNull(id);
  if (numericId == null) {
    return;
  }

  let record = records.get(numericId);
  if (!record) {
    record = { id: numericId, names: new Set(), seasons: new Set() };
    records.set(numericId, record);
  }

  const numericSeasonId = integerOrNull(seasonId);
  if (numericSeasonId != null) {
    record.seasons.add(numericSeasonId);
  }

  const addName = (name: unknown) => {
    if (Array.isArray(name)) {
      name.forEach(addName);
      return;
    }
    const normalized = textOrNull(name);
    if (normalized) {
      record.names.add(normalized);
    }
  };

  names.forEach(addName);
}

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function playerSimilarityKeys(record: EntityRecord) {
  const keys = new Set<string>();
  for (const name of record.names) {
    const normalized = normalizeName(name);
    if (!normalized) {
      continue;
    }
    keys.add(`exact:${normalized}`);
    const parts = normalized.split(" ");
    if (parts.length >= 2) {
      keys.add(`last-first-initial:${parts[parts.length - 1]}:${parts[0][0]}`);
    }
  }
  return keys;
}

function teamSimilarityKeys(record: EntityRecord) {
  const keys = new Set<string>();
  for (const name of record.names) {
    const normalized = normalizeName(name);
    if (!normalized) {
      continue;
    }
    keys.add(`team:${normalized}`);
    const parts = normalized.split(" ");
    if (parts.length > 1) {
      keys.add(`team-short:${parts[parts.length - 1]}`);
    }
  }
  return keys;
}

function hasSeasonOverlap(records: EntityRecord[]) {
  const seen = new Set<number>();
  for (const record of records) {
    for (const season of record.seasons) {
      if (seen.has(season)) {
        return true;
      }
      seen.add(season);
    }
  }
  return false;
}

function candidateFromGroup(
  entityType: "player" | "team",
  matchType: string,
  records: EntityRecord[],
): Candidate | null {
  const uniqueRecords = [...new Map(records.map((record) => [record.id, record])).values()].sort(
    (left, right) => left.id - right.id,
  );
  if (uniqueRecords.length < 2 || hasSeasonOverlap(uniqueRecords)) {
    return null;
  }

  return {
    entityType,
    matchType,
    canonicalId: uniqueRecords[0].id,
    aliasIds: uniqueRecords.slice(1).map((record) => record.id),
    entities: uniqueRecords.map((record) => ({
      id: record.id,
      names: Array.from(record.names).sort((left, right) => left.localeCompare(right)),
      seasons: Array.from(record.seasons).sort((left, right) => left - right),
    })),
  };
}

function candidateReviewKey(entityType: "player" | "team", ids: number[]) {
  return `${entityType}:${[...new Set(ids)].sort((left, right) => left - right).join(",")}`;
}

function addConfirmedMergeReviewKeys(
  reviewedKeys: Set<string>,
  entityType: "player" | "team",
  groups: EntityMergeGroup[] | undefined,
) {
  for (const group of groups ?? []) {
    reviewedKeys.add(candidateReviewKey(entityType, [group.canonicalId, ...(group.aliasIds ?? [])]));
  }
}

function addNonMergeReviewKeys(
  reviewedKeys: Set<string>,
  entityType: "player" | "team",
  groups: EntityNonMergeGroup[] | undefined,
) {
  for (const group of groups ?? []) {
    reviewedKeys.add(candidateReviewKey(entityType, group.ids ?? []));
  }
}

function buildReviewedCandidateKeys(config: EntityMergeConfig) {
  const reviewedKeys = new Set<string>();
  addConfirmedMergeReviewKeys(reviewedKeys, "player", config.players);
  addConfirmedMergeReviewKeys(reviewedKeys, "team", config.teams);
  addNonMergeReviewKeys(reviewedKeys, "player", config.nonMerges?.players);
  addNonMergeReviewKeys(reviewedKeys, "team", config.nonMerges?.teams);
  return reviewedKeys;
}

function buildCandidates(
  entityType: "player" | "team",
  records: EntityRecord[],
  keyBuilder: (record: EntityRecord) => Set<string>,
  reviewedCandidateKeys: Set<string>,
) {
  const groups = new Map<string, EntityRecord[]>();
  for (const record of records) {
    for (const key of keyBuilder(record)) {
      const group = groups.get(key) ?? [];
      group.push(record);
      groups.set(key, group);
    }
  }

  const candidates = new Map<string, Candidate>();
  for (const [key, recordsForKey] of groups) {
    const candidate = candidateFromGroup(entityType, key, recordsForKey);
    if (!candidate) {
      continue;
    }
    const candidateKey = candidateReviewKey(
      entityType,
      candidate.entities.map((entity) => entity.id),
    );
    if (reviewedCandidateKeys.has(candidateKey)) {
      continue;
    }
    const existing = candidates.get(candidateKey);
    if (!existing || candidate.matchType.startsWith("exact:") || candidate.matchType.startsWith("team:")) {
      candidates.set(candidateKey, candidate);
    }
  }

  return Array.from(candidates.values()).sort((left, right) => {
    if (left.entityType !== right.entityType) {
      return left.entityType.localeCompare(right.entityType);
    }
    return left.canonicalId - right.canonicalId;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const bundles = await loadSeasonSeedBundles(options.outDir, options.seasonIds);
  const reviewConfig = await readEntityMergeReviewConfig(options.mergeConfigPath);
  const reviewedCandidateKeys = buildReviewedCandidateKeys(reviewConfig);
  const players = new Map<number, EntityRecord>();
  const teams = new Map<number, EntityRecord>();

  for (const bundle of bundles) {
    for (const row of bundle.tables.players) {
      addEntity(players, row.pointstreak_player_id, null, row.name);
    }

    for (const row of bundle.tables.teams) {
      addEntity(teams, row.pointstreak_team_link_id, null, row.name, row.short_name, row.former_names);
    }

    for (const table of ARCHIVE_SEED_TABLES) {
      for (const row of bundle.tables[table]) {
        addEntity(
          players,
          row.pointstreak_player_id,
          row.season_id,
          row.player_name,
          row.name,
          row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : null,
        );
        addEntity(teams, row.team_pointstreak_link_id, row.season_id, row.team_name, row.source_team_name);
        addEntity(teams, row.home_team_pointstreak_link_id, row.season_id);
        addEntity(teams, row.away_team_pointstreak_link_id, row.season_id);
      }
    }
  }

  const playerCandidates = buildCandidates(
    "player",
    Array.from(players.values()),
    playerSimilarityKeys,
    reviewedCandidateKeys,
  );
  const teamCandidates = buildCandidates("team", Array.from(teams.values()), teamSimilarityKeys, reviewedCandidateKeys);
  const output = {
    generatedAt: new Date().toISOString(),
    description:
      "Review these candidates manually. Confirmed groups should be copied into data/entity-merges.json. Rejected groups should be copied into data/entity-merges.json under nonMerges.",
    reviewConfigPath: options.mergeConfigPath,
    skippedReviewedCandidateCount: reviewedCandidateKeys.size,
    candidates: [...playerCandidates, ...teamCandidates],
    suggestedMergeConfig: {
      players: playerCandidates.map((candidate) => ({
        canonicalId: candidate.canonicalId,
        aliasIds: candidate.aliasIds,
        reason: `Candidate from ${candidate.matchType}`,
      })),
      teams: teamCandidates.map((candidate) => ({
        canonicalId: candidate.canonicalId,
        aliasIds: candidate.aliasIds,
        reason: `Candidate from ${candidate.matchType}`,
      })),
    },
  };

  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
  await fs.writeFile(options.outputPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(
    `Wrote ${playerCandidates.length} player candidates and ${teamCandidates.length} team candidates to ${options.outputPath}`,
  );
}

main().catch((err) => {
  console.error(err);
  usage();
  process.exit(1);
});
