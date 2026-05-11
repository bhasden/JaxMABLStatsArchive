import fs from "fs/promises";
import path from "path";
import type { ArchiveSeedRow, ArchiveSeedTable } from "./archive-seed-merge";

export type EntityMergeGroup = {
  canonicalId: number;
  aliasIds: number[];
  reason?: string;
};

export type EntityNonMergeGroup = {
  ids: number[];
  reason?: string;
};

export type EntityMergeConfig = {
  players?: EntityMergeGroup[];
  teams?: EntityMergeGroup[];
  nonMerges?: {
    players?: EntityNonMergeGroup[];
    teams?: EntityNonMergeGroup[];
  };
};

export type EntityMergeMaps = {
  players: Map<number, number>;
  teams: Map<number, number>;
};

export type EntityMergeSummary = {
  configPath: string;
  playerAliasCount: number;
  teamAliasCount: number;
  replacedValues: Record<ArchiveSeedTable, number>;
  warnings: string[];
};

const DEFAULT_ENTITY_MERGES_FILE = "entity-merges.json";

const PLAYER_ID_FIELDS = new Set(["pointstreak_player_id"]);

const TEAM_ID_FIELDS = new Set([
  "pointstreak_team_link_id",
  "team_pointstreak_link_id",
  "home_team_pointstreak_link_id",
  "away_team_pointstreak_link_id",
  "winner_team_pointstreak_link_id",
  "loser_team_pointstreak_link_id",
]);

function integerOrNull(value: unknown) {
  if (value == null || value === "") {
    return null;
  }

  const numericValue = Number(value);
  return Number.isInteger(numericValue) ? numericValue : null;
}

function buildAliasMap(groups: EntityMergeGroup[] | undefined, entityType: "players" | "teams", warnings: string[]) {
  const map = new Map<number, number>();

  for (const group of groups ?? []) {
    const canonicalId = integerOrNull(group.canonicalId);
    if (canonicalId == null) {
      warnings.push(`${entityType}: skipped merge group with invalid canonicalId ${JSON.stringify(group.canonicalId)}`);
      continue;
    }

    for (const aliasValue of group.aliasIds ?? []) {
      const aliasId = integerOrNull(aliasValue);
      if (aliasId == null) {
        warnings.push(
          `${entityType}: skipped invalid aliasId ${JSON.stringify(aliasValue)} for canonicalId ${canonicalId}`,
        );
        continue;
      }
      if (aliasId === canonicalId) {
        continue;
      }

      const existingCanonicalId = map.get(aliasId);
      if (existingCanonicalId != null && existingCanonicalId !== canonicalId) {
        warnings.push(
          `${entityType}: aliasId ${aliasId} is mapped to both ${existingCanonicalId} and ${canonicalId}; keeping ${existingCanonicalId}`,
        );
        continue;
      }

      map.set(aliasId, canonicalId);
    }
  }

  for (const [aliasId, canonicalId] of map) {
    let resolvedCanonicalId = canonicalId;
    const seen = new Set([aliasId]);
    while (map.has(resolvedCanonicalId) && !seen.has(resolvedCanonicalId)) {
      seen.add(resolvedCanonicalId);
      resolvedCanonicalId = map.get(resolvedCanonicalId)!;
    }
    if (seen.has(resolvedCanonicalId)) {
      warnings.push(
        `${entityType}: cyclic merge mapping involving ${aliasId}; keeping direct canonicalId ${canonicalId}`,
      );
      continue;
    }
    map.set(aliasId, resolvedCanonicalId);
  }

  return map;
}

export async function readEntityMergeConfig(outDir: string, fileName = DEFAULT_ENTITY_MERGES_FILE) {
  const configPath = path.join(outDir, fileName);
  try {
    const text = await fs.readFile(configPath, "utf8");
    return { config: JSON.parse(text) as EntityMergeConfig, configPath };
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return { config: {} as EntityMergeConfig, configPath };
    }
    throw err;
  }
}

export function buildEntityMergeMaps(config: EntityMergeConfig) {
  const warnings: string[] = [];
  const players = buildAliasMap(config.players, "players", warnings);
  const teams = buildAliasMap(config.teams, "teams", warnings);
  return { maps: { players, teams }, warnings };
}

function remapField(row: ArchiveSeedRow, field: string, map: Map<number, number>) {
  const currentId = integerOrNull(row[field]);
  if (currentId == null) {
    return 0;
  }

  const canonicalId = map.get(currentId);
  if (canonicalId == null || canonicalId === currentId) {
    return 0;
  }

  row[field] = canonicalId;
  return 1;
}

export function applyEntityMergesToTables(
  tables: Record<ArchiveSeedTable, ArchiveSeedRow[]>,
  maps: EntityMergeMaps,
  configPath: string,
  warnings: string[] = [],
): EntityMergeSummary {
  const replacedValues = Object.fromEntries(Object.keys(tables).map((table) => [table, 0])) as Record<
    ArchiveSeedTable,
    number
  >;

  for (const [table, rows] of Object.entries(tables) as Array<[ArchiveSeedTable, ArchiveSeedRow[]]>) {
    for (const row of rows) {
      for (const field of PLAYER_ID_FIELDS) {
        replacedValues[table] += remapField(row, field, maps.players);
      }
      for (const field of TEAM_ID_FIELDS) {
        replacedValues[table] += remapField(row, field, maps.teams);
      }
    }
  }

  return {
    configPath,
    playerAliasCount: maps.players.size,
    teamAliasCount: maps.teams.size,
    replacedValues,
    warnings,
  };
}
