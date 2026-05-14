import fs from "fs/promises";
import path from "path";
import type { ArchiveSeedRow, ArchiveSeedTable } from "./archive-seed-merge";
import { archiveEntityIdForCompetition, isArchiveCompetitionId, type ArchiveCompetitionId } from "./constants";

export type EntityMergeGroup = {
  competitionId: ArchiveCompetitionId;
  canonicalSourceId: number;
  aliasSourceIds: number[];
  reason?: string;
  notes?: string;
};

export type EntityMergeRejectionGroup = {
  competitionId: ArchiveCompetitionId;
  sourceIds: number[];
  reason?: string;
  notes?: string;
};

export type EntityMergeConfig = {
  version?: number;
  merges?: EntityMergeGroup[];
};

export type EntityMergeRejectionConfig = {
  version?: number;
  rejections?: EntityMergeRejectionGroup[];
};

export type PersonLinkMember = {
  competitionId: ArchiveCompetitionId;
  canonicalSourcePlayerId: number;
};

export type PersonLinkGroup = {
  personId: number;
  displayName?: string;
  members: PersonLinkMember[];
  reason?: string;
  notes?: string;
};

export type PersonLinkConfig = {
  version?: number;
  people?: PersonLinkGroup[];
};

export type PersonLinkRejectionGroup = {
  members: PersonLinkMember[];
  reason?: string;
  notes?: string;
};

export type PersonLinkRejectionConfig = {
  version?: number;
  rejections?: PersonLinkRejectionGroup[];
};

export type EntityMergeMaps = {
  players: Map<number, number>;
  teams: Map<number, number>;
};

export type EntityMergeSummary = {
  playerConfigPath: string;
  teamConfigPath: string;
  playerAliasCount: number;
  teamAliasCount: number;
  replacedValues: Record<ArchiveSeedTable, number>;
  warnings: string[];
};

export const DEFAULT_PLAYER_MERGES_FILE = "player-merge-approvals.json";
export const DEFAULT_TEAM_MERGES_FILE = "team-merge-approvals.json";
export const DEFAULT_PLAYER_MERGE_REJECTIONS_FILE = "player-merge-rejections.json";
export const DEFAULT_TEAM_MERGE_REJECTIONS_FILE = "team-merge-rejections.json";
export const DEFAULT_PERSON_LINKS_FILE = "person-link-approvals.json";
export const DEFAULT_PERSON_LINK_REJECTIONS_FILE = "person-link-rejections.json";

const PLAYER_ID_FIELDS = new Set(["player_id"]);

const TEAM_ID_FIELDS = new Set([
  "team_id",
  "team_id",
  "home_team_id",
  "away_team_id",
  "winner_team_id",
  "loser_team_id",
]);

function requireCompetitionId(value: unknown, context: string): ArchiveCompetitionId {
  if (!isArchiveCompetitionId(value)) {
    throw new Error(`${context}: invalid competitionId ${JSON.stringify(value)}`);
  }
  return value;
}

function requireSourceId(value: unknown, context: string) {
  const numericValue = integerOrNull(value);
  if (numericValue == null || numericValue <= 0) {
    throw new Error(`${context}: invalid source id ${JSON.stringify(value)}`);
  }
  return numericValue;
}

function configuredArchiveId(competitionId: ArchiveCompetitionId, sourceId: number, context: string) {
  const archiveId = archiveEntityIdForCompetition(competitionId, sourceId);
  if (archiveId == null) {
    throw new Error(`${context}: could not scope ${competitionId} source id ${sourceId}`);
  }
  return archiveId;
}

function validateMergeGroups(groups: EntityMergeGroup[] | undefined, entityType: "players" | "teams") {
  const configuredIds = new Map<number, string>();

  for (const [groupIndex, group] of (groups ?? []).entries()) {
    const groupLabel = `${entityType}: merge group ${groupIndex + 1}`;
    const competitionId = requireCompetitionId(group.competitionId, groupLabel);
    const canonicalSourceId = requireSourceId(group.canonicalSourceId, `${groupLabel} canonicalSourceId`);
    const canonicalId = configuredArchiveId(competitionId, canonicalSourceId, `${groupLabel} canonicalSourceId`);
    const groupIds = new Set<number>();

    const registerId = (archiveId: number, sourceId: number, role: string) => {
      if (groupIds.has(archiveId)) {
        throw new Error(`${groupLabel}: duplicate ${competitionId} source id ${sourceId} in ${role}`);
      }
      groupIds.add(archiveId);

      const existingGroup = configuredIds.get(archiveId);
      if (existingGroup) {
        throw new Error(
          `${entityType}: ${competitionId} source id ${sourceId} appears in both ${existingGroup} and merge group ${groupIndex + 1}`,
        );
      }
      configuredIds.set(archiveId, `merge group ${groupIndex + 1}`);
    };

    registerId(canonicalId, canonicalSourceId, "canonicalSourceId");

    for (const aliasValue of group.aliasSourceIds ?? []) {
      const aliasSourceId = requireSourceId(aliasValue, `${groupLabel} aliasSourceIds`);
      if (aliasSourceId === canonicalSourceId) {
        throw new Error(`${groupLabel}: aliasSourceIds must not repeat canonicalSourceId ${canonicalSourceId}`);
      }

      const aliasId = configuredArchiveId(competitionId, aliasSourceId, `${groupLabel} aliasSourceIds`);
      registerId(aliasId, aliasSourceId, "aliasSourceIds");
    }
  }
}

function validateConfiguredMergeTargets(
  groups: EntityMergeGroup[] | undefined,
  entityType: "players" | "teams",
  existingIds: Set<number>,
) {
  for (const group of groups ?? []) {
    const competitionId = requireCompetitionId(group.competitionId, `${entityType}: merge group`);
    const configuredSourceIds = [group.canonicalSourceId, ...(group.aliasSourceIds ?? [])];

    for (const sourceIdValue of configuredSourceIds) {
      const sourceId = requireSourceId(sourceIdValue, `${entityType}: configured source id`);
      const archiveId = configuredArchiveId(competitionId, sourceId, `${entityType}: configured source id`);
      if (!existingIds.has(archiveId)) {
        throw new Error(
          `${entityType}: ${competitionId} source id ${sourceId} does not exist in scoped ${entityType} rows; possible cross-competition or stale reviewed merge input`,
        );
      }
    }
  }
}

function integerOrNull(value: unknown) {
  if (value == null || value === "") {
    return null;
  }

  const numericValue = Number(value);
  return Number.isInteger(numericValue) ? numericValue : null;
}

async function readJsonConfigFile<T>(outDir: string, fileName: string, emptyConfig: T) {
  const configPath = path.join(outDir, fileName);
  try {
    const text = await fs.readFile(configPath, "utf8");
    return { config: JSON.parse(text) as T, configPath };
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return { config: emptyConfig, configPath };
    }
    throw err;
  }
}

function buildAliasMap(groups: EntityMergeGroup[] | undefined, entityType: "players" | "teams", warnings: string[]) {
  const map = new Map<number, number>();

  for (const group of groups ?? []) {
    const competitionId = requireCompetitionId(group.competitionId, `${entityType}: merge group`);
    const canonicalSourceId = requireSourceId(group.canonicalSourceId, `${entityType}: canonicalSourceId`);
    const canonicalId = configuredArchiveId(competitionId, canonicalSourceId, `${entityType}: canonicalSourceId`);

    for (const aliasValue of group.aliasSourceIds ?? []) {
      const aliasSourceId = requireSourceId(aliasValue, `${entityType}: aliasSourceIds`);
      const aliasId = configuredArchiveId(competitionId, aliasSourceId, `${entityType}: aliasSourceIds`);
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

export async function readPlayerMergeConfig(outDir: string, fileName = DEFAULT_PLAYER_MERGES_FILE) {
  return readJsonConfigFile<EntityMergeConfig>(outDir, fileName, {} as EntityMergeConfig);
}

export async function readTeamMergeConfig(outDir: string, fileName = DEFAULT_TEAM_MERGES_FILE) {
  return readJsonConfigFile<EntityMergeConfig>(outDir, fileName, {} as EntityMergeConfig);
}

export async function readPlayerMergeRejectionConfig(outDir: string, fileName = DEFAULT_PLAYER_MERGE_REJECTIONS_FILE) {
  return readJsonConfigFile<EntityMergeRejectionConfig>(outDir, fileName, {} as EntityMergeRejectionConfig);
}

export async function readTeamMergeRejectionConfig(outDir: string, fileName = DEFAULT_TEAM_MERGE_REJECTIONS_FILE) {
  return readJsonConfigFile<EntityMergeRejectionConfig>(outDir, fileName, {} as EntityMergeRejectionConfig);
}

export async function readPersonLinkConfig(outDir: string, fileName = DEFAULT_PERSON_LINKS_FILE) {
  return readJsonConfigFile<PersonLinkConfig>(outDir, fileName, {} as PersonLinkConfig);
}

export async function readPersonLinkRejectionConfig(outDir: string, fileName = DEFAULT_PERSON_LINK_REJECTIONS_FILE) {
  return readJsonConfigFile<PersonLinkRejectionConfig>(outDir, fileName, {} as PersonLinkRejectionConfig);
}

export function buildEntityMergeMaps(playerConfig: EntityMergeConfig, teamConfig: EntityMergeConfig) {
  validateMergeGroups(playerConfig.merges, "players");
  validateMergeGroups(teamConfig.merges, "teams");
  const warnings: string[] = [];
  const players = buildAliasMap(playerConfig.merges, "players", warnings);
  const teams = buildAliasMap(teamConfig.merges, "teams", warnings);
  return { maps: { players, teams }, warnings };
}

export function validateEntityMergeTargetsAgainstRows(
  playerRows: ArchiveSeedRow[],
  teamRows: ArchiveSeedRow[],
  playerConfig: EntityMergeConfig,
  teamConfig: EntityMergeConfig,
) {
  const playerIds = new Set<number>();
  for (const row of playerRows) {
    const playerId = integerOrNull(row.player_id);
    if (playerId != null) {
      playerIds.add(playerId);
    }
  }

  const teamIds = new Set<number>();
  for (const row of teamRows) {
    const teamId = integerOrNull(row.team_id);
    if (teamId != null) {
      teamIds.add(teamId);
    }
  }

  validateConfiguredMergeTargets(playerConfig.merges, "players", playerIds);
  validateConfiguredMergeTargets(teamConfig.merges, "teams", teamIds);
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
  configPaths: Pick<EntityMergeSummary, "playerConfigPath" | "teamConfigPath">,
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
    playerConfigPath: configPaths.playerConfigPath,
    teamConfigPath: configPaths.teamConfigPath,
    playerAliasCount: maps.players.size,
    teamAliasCount: maps.teams.size,
    replacedValues,
    warnings,
  };
}
