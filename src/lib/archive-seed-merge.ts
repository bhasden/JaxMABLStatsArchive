import fs from "fs/promises";
import path from "path";
import {
  applyEntityMergesToTables,
  buildEntityMergeMaps,
  readPlayerMergeConfig,
  readPersonLinkConfig,
  readTeamMergeConfig,
  validateEntityMergeTargetsAgainstRows,
  type EntityMergeSummary,
  type PersonLinkConfig,
} from "./entity-merges";
import { archiveEntityIdForCompetition, competitionIdForSeasonId, isArchiveCompetitionId } from "./constants";

export const ARCHIVE_SEED_TABLES = [
  "games",
  "players",
  "teams",
  "rosters",
  "lineups",
  "batting_stats",
  "pitching_stats",
  "season_batting_stats",
  "season_pitching_stats",
  "season_batting_leaders",
  "season_pitching_leaders",
  "innings",
  "standings",
] as const;

export type ArchiveSeedTable = (typeof ARCHIVE_SEED_TABLES)[number];
export type ArchiveSeedRow = Record<string, unknown>;

export const ARCHIVE_SEED_FILES: Record<ArchiveSeedTable, string> = {
  games: "games.ndjson",
  players: "players.ndjson",
  teams: "teams.ndjson",
  rosters: "rosters.ndjson",
  lineups: "lineups.ndjson",
  batting_stats: "batting_stats.ndjson",
  pitching_stats: "pitching_stats.ndjson",
  season_batting_stats: "season_batting_stats.ndjson",
  season_pitching_stats: "season_pitching_stats.ndjson",
  season_batting_leaders: "season_batting_leaders.ndjson",
  season_pitching_leaders: "season_pitching_leaders.ndjson",
  innings: "innings.ndjson",
  standings: "standings.ndjson",
};

type TableStats = {
  inputRows: number;
  outputRows: number;
  collapsedRows: number;
};

export type ArchiveSeedManifest = {
  generatedAt: string;
  seasonIds: number[];
  tableStats: Record<ArchiveSeedTable, TableStats>;
  entityMerges?: EntityMergeSummary;
  personLinks?: PersonLinkSummary;
  warnings: string[];
};

export type ArchiveSeasonSeedBundle = {
  seasonId: number;
  dir: string;
  tables: Record<ArchiveSeedTable, ArchiveSeedRow[]>;
  warnings: string[];
};

export type ArchiveMergedSeedBundle = {
  seasonIds: number[];
  tables: Record<ArchiveSeedTable, ArchiveSeedRow[]>;
  manifest: ArchiveSeedManifest;
};

export type BuildMergedSeedBundleOptions = {
  seasonIds?: number[];
  mergedDirName?: string;
};

export type PersonLinkSummary = {
  configPath: string;
  explicitPersonCount: number;
  linkedPlayerCount: number;
  generatedSingletonCount: number;
  warnings: string[];
};

const GENERATED_SINGLETON_PERSON_ID_BASE = 10_000_000_000;

const DIMENSION_KEYS: Partial<Record<ArchiveSeedTable, string>> = {
  players: "player_id",
  teams: "team_id",
};

const TABLE_SORT_FIELDS: Record<ArchiveSeedTable, string[]> = {
  games: ["season_id", "game_id"],
  players: ["player_id"],
  teams: ["team_id", "season_team_id"],
  rosters: ["season_id", "team_id", "season_team_id", "player_id", "player_season_id"],
  lineups: [
    "season_id",
    "game_id",
    "is_home",
    "team_id",
    "season_team_id",
    "batting_order",
    "batting_order_modifier",
    "order_idx",
    "player_id",
  ],
  batting_stats: [
    "season_id",
    "game_id",
    "is_home",
    "team_id",
    "season_team_id",
    "batting_order",
    "batting_order_modifier",
    "player_id",
    "position",
    "jersey",
  ],
  pitching_stats: [
    "season_id",
    "game_id",
    "is_home",
    "team_id",
    "season_team_id",
    "pitching_order",
    "player_id",
    "jersey",
  ],
  season_batting_stats: ["season_id", "scope", "team_id", "season_team_id", "player_id", "player_season_id", "jersey"],
  season_pitching_stats: ["season_id", "scope", "team_id", "season_team_id", "player_id", "player_season_id", "jersey"],
  season_batting_leaders: [
    "season_id",
    "scope",
    "leader_category",
    "rank",
    "team_id",
    "season_team_id",
    "player_id",
    "player_season_id",
    "jersey",
  ],
  season_pitching_leaders: [
    "season_id",
    "scope",
    "leader_category",
    "rank",
    "team_id",
    "season_team_id",
    "player_id",
    "player_season_id",
    "jersey",
  ],
  innings: ["season_id", "game_id", "is_home", "inning_number", "team_id", "season_team_id"],
  standings: ["season_id", "team_id", "season_team_id"],
};

const TABLES_REQUIRING_SEASON_ID = new Set<ArchiveSeedTable>([
  "games",
  "rosters",
  "lineups",
  "batting_stats",
  "pitching_stats",
  "season_batting_stats",
  "season_pitching_stats",
  "season_batting_leaders",
  "season_pitching_leaders",
  "innings",
  "standings",
]);

const PLAYER_ID_FIELDS = ["player_id"];
const TEAM_ID_FIELDS = ["team_id", "home_team_id", "away_team_id", "winner_team_id", "loser_team_id"];

function buildTableRecord<T>(factory: (table: ArchiveSeedTable) => T): Record<ArchiveSeedTable, T> {
  return Object.fromEntries(ARCHIVE_SEED_TABLES.map((table) => [table, factory(table)])) as Record<ArchiveSeedTable, T>;
}

function normalizeSortValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed && /^-?\d+(\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }
    return trimmed;
  }
  if (value == null) return "";
  return JSON.stringify(value);
}

function compareValues(left: unknown, right: unknown) {
  const a = normalizeSortValue(left);
  const b = normalizeSortValue(right);
  if (a === b) return 0;
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  return String(a).localeCompare(String(b));
}

function isBlank(value: unknown) {
  return value == null || value === "";
}

function normalizeKey(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function collectUniqueSortedValues(...values: unknown[]) {
  const unique = new Map<string, number | string>();

  const collect = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (isBlank(value)) {
      return;
    }

    const normalized = normalizeSortValue(value);
    if (typeof normalized === "number") {
      unique.set(String(normalized), normalized);
      return;
    }

    const numericValue = Number(normalized);
    unique.set(String(normalized), Number.isNaN(numericValue) ? String(normalized) : numericValue);
  };

  values.forEach(collect);
  return Array.from(unique.values()).sort(compareValues);
}

function collectUniqueValuesInEncounterOrder(...values: unknown[]) {
  const unique = new Map<string, string>();

  const collect = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (isBlank(value)) {
      return;
    }

    const normalized = String(value).trim();
    if (!normalized) {
      return;
    }

    if (!unique.has(normalized)) {
      unique.set(normalized, normalized);
    }
  };

  values.forEach(collect);
  return Array.from(unique.values());
}

function finalizeMergedTeamRow(row: ArchiveSeedRow) {
  const merged = { ...row };
  const seasonTeamIds = collectUniqueSortedValues(row.season_team_id, row.season_season_team_ids);
  const teamNames = collectUniqueValuesInEncounterOrder(row.former_names, row.team_names, row.name);
  const shortNames = collectUniqueValuesInEncounterOrder(row.short_names, row.short_name);

  if (seasonTeamIds.length > 0) {
    merged.season_season_team_ids = seasonTeamIds;
  }

  if (teamNames.length > 0) {
    merged.name = teamNames[teamNames.length - 1];
    const formerNames = teamNames.slice(0, -1);
    if (formerNames.length > 0) {
      merged.former_names = formerNames;
    } else {
      delete merged.former_names;
    }
  }

  if (shortNames.length > 0) {
    merged.short_name = shortNames[shortNames.length - 1];
    delete merged.short_names;
  }

  delete merged.team_names;
  delete merged.logo;
  delete merged.team_logo_urls;
  delete merged.season_team_id;
  return merged;
}

function finalizeMergedRows(table: ArchiveSeedTable, rows: ArchiveSeedRow[]) {
  if (table === "teams") {
    return rows.map(finalizeMergedTeamRow);
  }

  return rows;
}

function uniqueWarnings(warnings: string[]) {
  return Array.from(new Set(warnings)).sort((left, right) => left.localeCompare(right));
}

function sortRows(table: ArchiveSeedTable, rows: ArchiveSeedRow[]) {
  const fields = TABLE_SORT_FIELDS[table];
  return [...rows].sort((left, right) => {
    for (const field of fields) {
      const cmp = compareValues(left[field], right[field]);
      if (cmp !== 0) return cmp;
    }
    return JSON.stringify(left).localeCompare(JSON.stringify(right));
  });
}

function mergeDimensionRow(
  table: ArchiveSeedTable,
  keyField: string,
  key: string,
  existing: ArchiveSeedRow,
  candidate: ArchiveSeedRow,
  warnings: string[],
) {
  if (table === "teams") {
    const merged = { ...existing };
    const seasonTeamIds = collectUniqueSortedValues(
      existing.season_team_id,
      existing.season_season_team_ids,
      candidate.season_team_id,
      candidate.season_season_team_ids,
    );

    if (seasonTeamIds.length > 0) {
      merged.season_season_team_ids = seasonTeamIds;
    }

    const teamNames = collectUniqueValuesInEncounterOrder(
      existing.former_names,
      existing.team_names,
      existing.name,
      candidate.former_names,
      candidate.team_names,
      candidate.name,
    );
    if (teamNames.length > 0) {
      merged.name = teamNames[teamNames.length - 1];
      const formerNames = teamNames.slice(0, -1);
      if (formerNames.length > 0) {
        merged.former_names = formerNames;
      } else {
        delete merged.former_names;
      }
    }

    const shortNames = collectUniqueValuesInEncounterOrder(
      existing.short_names,
      existing.short_name,
      candidate.short_names,
      candidate.short_name,
    );
    if (shortNames.length > 0) {
      merged.short_name = shortNames[shortNames.length - 1];
      if (shortNames.length > 1) {
        merged.short_names = shortNames.slice(0, -1);
      } else {
        delete merged.short_names;
      }
    }

    for (const [field, value] of Object.entries(candidate)) {
      if (
        field === keyField ||
        field === "season_team_id" ||
        field === "season_season_team_ids" ||
        field === "name" ||
        field === "former_names" ||
        field === "team_names" ||
        field === "short_name" ||
        field === "short_names" ||
        field === "logo" ||
        field === "team_logo_urls"
      ) {
        continue;
      }
      const current = merged[field];
      if (isBlank(current) && !isBlank(value)) {
        merged[field] = value;
        continue;
      }
      if (!isBlank(current) && !isBlank(value) && JSON.stringify(current) !== JSON.stringify(value)) {
        warnings.push(`${table}:${key} conflicting ${field}; keeping earliest non-empty value`);
      }
    }

    return merged;
  }

  const merged = { ...existing };
  for (const [field, value] of Object.entries(candidate)) {
    if (field === keyField) continue;
    const current = merged[field];
    if (isBlank(current) && !isBlank(value)) {
      merged[field] = value;
      continue;
    }
    if (!isBlank(current) && !isBlank(value) && JSON.stringify(current) !== JSON.stringify(value)) {
      warnings.push(`${table}:${key} conflicting ${field}; keeping earliest non-empty value`);
    }
  }
  return merged;
}

function mergeDimensionTable(table: ArchiveSeedTable, rows: ArchiveSeedRow[], warnings: string[]) {
  const keyField = DIMENSION_KEYS[table];
  if (!keyField) {
    return { rows: sortRows(table, rows), collapsedRows: 0 };
  }

  const merged = new Map<string, ArchiveSeedRow>();
  let collapsedRows = 0;

  for (const row of sortRows(table, rows)) {
    const key = normalizeKey(row[keyField]);
    if (!key) {
      warnings.push(`${table}: skipped row missing ${keyField}`);
      continue;
    }

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, row);
      continue;
    }

    collapsedRows += 1;
    merged.set(key, mergeDimensionRow(table, keyField, key, existing, row, warnings));
  }

  return { rows: sortRows(table, Array.from(merged.values())), collapsedRows };
}

function validateSeasonRows(table: ArchiveSeedTable, seasonId: number, rows: ArchiveSeedRow[], warnings: string[]) {
  if (!TABLES_REQUIRING_SEASON_ID.has(table)) {
    return;
  }

  rows.forEach((row, index) => {
    const rowSeasonId = row.season_id;
    if (rowSeasonId == null) {
      warnings.push(`${table}: row ${index + 1} missing season_id for season ${seasonId}`);
      return;
    }
    if (Number(rowSeasonId) !== seasonId) {
      warnings.push(`${table}: row ${index + 1} has season_id=${rowSeasonId} but expected ${seasonId}`);
    }
  });
}

function scopeEntityId(row: ArchiveSeedRow, field: string, competitionId: string) {
  const value = row[field];
  if (value === 0 || value === "0") {
    row[field] = null;
    return;
  }
  const scopedId = archiveEntityIdForCompetition(
    competitionId,
    typeof value === "string" || typeof value === "number" ? value : null,
  );
  if (scopedId != null) {
    row[field] = scopedId;
  }
}

function scopeSeasonSeedTables(tables: Record<ArchiveSeedTable, ArchiveSeedRow[]>, seasonId: number) {
  const competitionId = competitionIdForSeasonId(seasonId);

  for (const [table, rows] of Object.entries(tables) as Array<[ArchiveSeedTable, ArchiveSeedRow[]]>) {
    for (const row of rows) {
      row.competition_id = competitionId;

      if (table === "players") {
        row.source_player_id = row.player_id;
      }
      if (table === "teams") {
        row.source_team_id = row.team_id;
      }

      for (const field of PLAYER_ID_FIELDS) {
        scopeEntityId(row, field, competitionId);
      }
      for (const field of TEAM_ID_FIELDS) {
        scopeEntityId(row, field, competitionId);
      }
    }
  }
}

export function getSeasonSeedDir(outDir: string, seasonId: number) {
  return path.join(outDir, "seeds", String(seasonId));
}

export function getAllSeasonsSeedDir(outDir: string, mergedDirName = "all") {
  return path.join(outDir, "seeds", mergedDirName);
}

export async function listSeasonSeedIds(outDir: string) {
  const seedsRoot = path.join(outDir, "seeds");
  let entries;
  try {
    entries = await fs.readdir(seedsRoot, { withFileTypes: true });
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return [];
    }
    throw err;
  }

  return entries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .sort((left, right) => left - right);
}

function normalizeRequestedSeasonIds(seasonIds: number[]) {
  const normalized = [...new Set(seasonIds.map((seasonId) => Number(seasonId)))].sort((left, right) => left - right);
  const invalid = normalized.filter((seasonId) => !Number.isInteger(seasonId) || seasonId <= 0);
  if (invalid.length > 0) {
    throw new Error(`Invalid season ids: ${invalid.join(", ")}`);
  }
  return normalized;
}

async function resolveSeasonSeedIds(outDir: string, seasonIds?: number[]) {
  const availableSeasonIds = await listSeasonSeedIds(outDir);
  if (availableSeasonIds.length === 0) {
    throw new Error(`No season seed folders found under ${path.join(outDir, "seeds")}`);
  }

  if (!seasonIds || seasonIds.length === 0) {
    return availableSeasonIds;
  }

  const requestedSeasonIds = normalizeRequestedSeasonIds(seasonIds);
  const missingSeasonIds = requestedSeasonIds.filter((seasonId) => !availableSeasonIds.includes(seasonId));
  if (missingSeasonIds.length > 0) {
    throw new Error(`Season seed folders not found for: ${missingSeasonIds.join(", ")}`);
  }

  return requestedSeasonIds;
}

function stringifyNdjsonRows(rows: ArchiveSeedRow[]) {
  if (rows.length === 0) {
    return "";
  }

  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

export async function readNdjsonRows(filePath: string) {
  const text = await fs.readFile(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as ArchiveSeedRow;
    } catch (err: any) {
      throw new Error(`Failed parsing ${path.basename(filePath)} line ${index + 1}: ${err?.message ?? String(err)}`, {
        cause: err,
      });
    }
  });
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
  return normalized.length > 0 ? normalized : null;
}

function applyPersonLinksToPlayers(
  playerRows: ArchiveSeedRow[],
  personLinkConfig: PersonLinkConfig,
  configPath: string,
): PersonLinkSummary {
  const warnings: string[] = [];
  const playersById = new Map<number, ArchiveSeedRow>();

  for (const row of playerRows) {
    const playerId = integerOrNull(row.player_id);
    if (playerId == null) {
      throw new Error(
        `players: encountered row without canonical player_id while applying person links from ${configPath}`,
      );
    }
    playersById.set(playerId, row);
  }

  const assignedPersonIds = new Map<number, number>();
  const personNamesById = new Map<number, string | null>();
  const explicitPersonIds = new Set<number>();

  for (const group of personLinkConfig.people ?? []) {
    const personId = integerOrNull(group.personId);
    if (personId == null || personId <= 0) {
      throw new Error(`person-links: invalid personId ${JSON.stringify(group.personId)} in ${configPath}`);
    }
    if (personId >= GENERATED_SINGLETON_PERSON_ID_BASE) {
      throw new Error(
        `person-links: personId ${personId} is in the reserved singleton namespace >= ${GENERATED_SINGLETON_PERSON_ID_BASE}`,
      );
    }
    if (explicitPersonIds.has(personId)) {
      throw new Error(`person-links: duplicate personId ${personId} in ${configPath}`);
    }
    explicitPersonIds.add(personId);

    const members = group.members ?? [];
    if (members.length === 0) {
      throw new Error(`person-links: personId ${personId} has no members in ${configPath}`);
    }

    const seenCompetitions = new Set<string>();
    const displayName = textOrNull(group.displayName);
    if (displayName) {
      personNamesById.set(personId, displayName);
    }

    for (const member of members) {
      if (!isArchiveCompetitionId(member.competitionId)) {
        throw new Error(
          `person-links: personId ${personId} has invalid competitionId ${JSON.stringify(member.competitionId)}`,
        );
      }

      if (seenCompetitions.has(member.competitionId)) {
        throw new Error(
          `person-links: personId ${personId} contains multiple canonical players for competition ${member.competitionId}`,
        );
      }
      seenCompetitions.add(member.competitionId);

      const playerId = archiveEntityIdForCompetition(member.competitionId, member.canonicalSourcePlayerId);
      if (playerId == null) {
        throw new Error(
          `person-links: personId ${personId} has invalid canonicalSourcePlayerId ${JSON.stringify(member.canonicalSourcePlayerId)}`,
        );
      }

      if (!playersById.has(playerId)) {
        throw new Error(
          `person-links: personId ${personId} references canonical player ${member.competitionId}:${member.canonicalSourcePlayerId} that does not exist after competition-local merges`,
        );
      }

      const existingPersonId = assignedPersonIds.get(playerId);
      if (existingPersonId != null && existingPersonId !== personId) {
        throw new Error(
          `person-links: canonical player ${playerId} is linked to both personId ${existingPersonId} and ${personId}`,
        );
      }

      assignedPersonIds.set(playerId, personId);
    }
  }

  let generatedSingletonCount = 0;

  for (const row of playerRows) {
    const playerId = integerOrNull(row.player_id);
    if (playerId == null) {
      continue;
    }

    const explicitPersonId = assignedPersonIds.get(playerId);
    const personId = explicitPersonId ?? GENERATED_SINGLETON_PERSON_ID_BASE + playerId;
    if (!explicitPersonId && explicitPersonIds.has(personId)) {
      throw new Error(`person-links: generated singleton personId ${personId} collides with an explicit personId`);
    }

    row.person_id = personId;
    const personName = personNamesById.get(personId) ?? textOrNull(row.name);
    if (personName) {
      row.person_name = personName;
    } else {
      delete row.person_name;
      warnings.push(`players:${playerId} has no person_name after person-link assignment`);
    }

    if (!explicitPersonId) {
      generatedSingletonCount += 1;
    }
  }

  return {
    configPath,
    explicitPersonCount: explicitPersonIds.size,
    linkedPlayerCount: assignedPersonIds.size,
    generatedSingletonCount,
    warnings,
  };
}

export async function loadSeasonSeedBundle(outDir: string, seasonId: number): Promise<ArchiveSeasonSeedBundle> {
  const dir = getSeasonSeedDir(outDir, seasonId);
  const tables = buildTableRecord<ArchiveSeedRow[]>(() => []);
  const warnings: string[] = [];

  for (const table of ARCHIVE_SEED_TABLES) {
    const filePath = path.join(dir, ARCHIVE_SEED_FILES[table]);
    const rows = await readNdjsonRows(filePath);
    tables[table] = rows;
    validateSeasonRows(table, seasonId, rows, warnings);
  }

  return { seasonId, dir, tables, warnings };
}

export async function loadSeasonSeedBundles(outDir: string, seasonIds?: number[]) {
  const resolvedSeasonIds = await resolveSeasonSeedIds(outDir, seasonIds);
  return Promise.all(resolvedSeasonIds.map((seasonId) => loadSeasonSeedBundle(outDir, seasonId)));
}

export function mergeSeasonSeedBundles(
  bundles: ArchiveSeasonSeedBundle[],
  entityMerges?: EntityMergeSummary,
): ArchiveMergedSeedBundle {
  const orderedBundles = [...bundles].sort((left, right) => left.seasonId - right.seasonId);
  const seasonIds = [...new Set(orderedBundles.map((bundle) => bundle.seasonId))].sort((left, right) => left - right);
  const warnings = orderedBundles.flatMap((bundle) =>
    bundle.warnings.map((warning) => `season ${bundle.seasonId}: ${warning}`),
  );
  const mergedTables = buildTableRecord<ArchiveSeedRow[]>(() => []);
  const tableStats = buildTableRecord<TableStats>(() => ({ inputRows: 0, outputRows: 0, collapsedRows: 0 }));

  for (const table of ARCHIVE_SEED_TABLES) {
    const allRows = orderedBundles.flatMap((bundle) => bundle.tables[table]);
    const dimensionResult = mergeDimensionTable(table, allRows, warnings);
    const outputRows = finalizeMergedRows(table, dimensionResult.rows);

    mergedTables[table] = outputRows;
    tableStats[table] = {
      inputRows: allRows.length,
      outputRows: outputRows.length,
      collapsedRows: dimensionResult.collapsedRows,
    };
  }

  return {
    seasonIds,
    tables: mergedTables,
    manifest: {
      generatedAt: new Date().toISOString(),
      seasonIds,
      tableStats,
      entityMerges,
      warnings: uniqueWarnings(warnings),
    },
  };
}

export async function buildMergedSeedBundle(outDir: string, seasonIds?: number[]) {
  const bundles = await loadSeasonSeedBundles(outDir, seasonIds);
  const { config: playerConfig, configPath: playerConfigPath } = await readPlayerMergeConfig(outDir);
  const { config: teamConfig, configPath: teamConfigPath } = await readTeamMergeConfig(outDir);
  const { config: personLinkConfig, configPath: personLinkConfigPath } = await readPersonLinkConfig(outDir);
  const { maps, warnings } = buildEntityMergeMaps(playerConfig, teamConfig);
  const entityMerges: EntityMergeSummary = {
    playerConfigPath,
    teamConfigPath,
    playerAliasCount: maps.players.size,
    teamAliasCount: maps.teams.size,
    replacedValues: buildTableRecord(() => 0),
    warnings,
  };

  const mergedBundles = bundles.map((bundle) => {
    const tables = buildTableRecord<ArchiveSeedRow[]>((table) => bundle.tables[table].map((row) => ({ ...row })));
    scopeSeasonSeedTables(tables, bundle.seasonId);
    return { ...bundle, tables };
  });

  validateEntityMergeTargetsAgainstRows(
    mergedBundles.flatMap((bundle) => bundle.tables.players),
    mergedBundles.flatMap((bundle) => bundle.tables.teams),
    playerConfig,
    teamConfig,
  );

  for (const bundle of mergedBundles) {
    const summary = applyEntityMergesToTables(bundle.tables, maps, { playerConfigPath, teamConfigPath }, []);
    for (const table of ARCHIVE_SEED_TABLES) {
      entityMerges.replacedValues[table] += summary.replacedValues[table];
    }
  }

  const mergedBundle = mergeSeasonSeedBundles(mergedBundles, entityMerges);
  const personLinks = applyPersonLinksToPlayers(mergedBundle.tables.players, personLinkConfig, personLinkConfigPath);
  mergedBundle.manifest.personLinks = personLinks;
  mergedBundle.manifest.warnings = uniqueWarnings([...mergedBundle.manifest.warnings, ...personLinks.warnings]);
  return mergedBundle;
}

export async function writeMergedSeedBundle(bundle: ArchiveMergedSeedBundle, outDir: string, mergedDirName = "all") {
  const mergedSeedDir = getAllSeasonsSeedDir(outDir, mergedDirName);
  await fs.rm(mergedSeedDir, { recursive: true, force: true });
  await fs.mkdir(mergedSeedDir, { recursive: true });

  for (const table of ARCHIVE_SEED_TABLES) {
    const filePath = path.join(mergedSeedDir, ARCHIVE_SEED_FILES[table]);
    await fs.writeFile(filePath, stringifyNdjsonRows(bundle.tables[table]), "utf8");
  }

  await fs.writeFile(
    path.join(mergedSeedDir, "manifest.json"),
    JSON.stringify(bundle.manifest, null, 2) + "\n",
    "utf8",
  );

  return mergedSeedDir;
}

export async function buildAndWriteMergedSeedBundle(outDir: string, options: BuildMergedSeedBundleOptions = {}) {
  const bundle = await buildMergedSeedBundle(outDir, options.seasonIds);
  const dir = await writeMergedSeedBundle(bundle, outDir, options.mergedDirName);
  return { dir, bundle };
}
