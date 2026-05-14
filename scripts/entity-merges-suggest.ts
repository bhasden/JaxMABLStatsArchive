#!/usr/bin/env tsx
import fs from "fs/promises";
import path from "path";
import { ARCHIVE_SEED_TABLES, loadSeasonSeedBundles } from "../src/lib/archive-seed-merge";
import {
  DEFAULT_PERSON_LINKS_FILE,
  DEFAULT_PERSON_LINK_REJECTIONS_FILE,
  DEFAULT_PLAYER_MERGES_FILE,
  DEFAULT_PLAYER_MERGE_REJECTIONS_FILE,
  DEFAULT_TEAM_MERGES_FILE,
  DEFAULT_TEAM_MERGE_REJECTIONS_FILE,
  buildEntityMergeMaps,
  type EntityMergeConfig,
  type EntityMergeGroup,
  type EntityMergeRejectionConfig,
  type EntityMergeRejectionGroup,
  type PersonLinkConfig,
  type PersonLinkGroup,
  type PersonLinkMember,
  type PersonLinkRejectionConfig,
} from "../src/lib/entity-merges";
import {
  archiveEntityIdForCompetition,
  competitionIdForSeasonId,
  sourceEntityIdFromArchiveId,
  type ArchiveCompetitionId,
} from "../src/lib/constants";

type EntityRecord = {
  id: number;
  competitionId?: ArchiveCompetitionId;
  names: Set<string>;
  seasons: Set<number>;
};

type Candidate = {
  entityType: "player" | "team";
  matchType: string;
  matchTypes: string[];
  competitionId?: ArchiveCompetitionId;
  canonicalId: number;
  aliasIds: number[];
  entities: Array<{
    id: number;
    sourceId: number | null;
    names: string[];
    seasons: number[];
  }>;
};

type CandidateOutput = Candidate & {
  candidateKey: string;
  acceptedEntry: EntityMergeGroup;
  rejectedEntry: EntityMergeRejectionGroup;
};

type PersonCandidateMember = {
  id: number;
  sourceId: number | null;
  competitionId: ArchiveCompetitionId;
  names: string[];
  seasons: number[];
};

type PersonCandidate = {
  entityType: "person";
  matchType: string;
  matchTypes: string[];
  members: PersonCandidateMember[];
};

type PersonCandidateOutputMember = PersonCandidateMember & {
  playerHref: string;
  personHref: string;
};

type PersonCandidateOutput = Omit<PersonCandidate, "members"> & {
  members: PersonCandidateOutputMember[];
  candidateKey: string;
  suggestedPersonId: number;
  suggestedDisplayName?: string;
  acceptedEntry: PersonLinkGroup;
  rejectedEntry: {
    members: PersonLinkMember[];
    reason: string;
  };
};

type CliOptions = {
  outDir: string;
  outputTarget: string;
  playerMergeConfigPath: string;
  teamMergeConfigPath: string;
  personLinkConfigPath: string;
  personLinkRejectionConfigPath: string;
  playerRejectionConfigPath: string;
  teamRejectionConfigPath: string;
  seasonIds: number[];
};

type SuggestionOutputPaths = {
  player: string;
  team: string;
  person: string;
};

const PLAYER_CANDIDATES_FILE = "player-merge-candidates.json";
const TEAM_CANDIDATES_FILE = "team-merge-candidates.json";
const PERSON_CANDIDATES_FILE = "person-link-candidates.json";

function usage() {
  console.error(
    "Usage: entity-merges-suggest.ts [--outDir <dir>] [--output <dir-or-file>] [--playerMergeConfig <file>] [--teamMergeConfig <file>] [--personLinkConfig <file>] [--personLinkRejectionConfig <file>] [--playerRejectionConfig <file>] [--teamRejectionConfig <file>] [--season <seasonId>]...",
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
    outputTarget: path.join(process.cwd(), "data"),
    playerMergeConfigPath: path.join(process.cwd(), "data", DEFAULT_PLAYER_MERGES_FILE),
    teamMergeConfigPath: path.join(process.cwd(), "data", DEFAULT_TEAM_MERGES_FILE),
    personLinkConfigPath: path.join(process.cwd(), "data", DEFAULT_PERSON_LINKS_FILE),
    personLinkRejectionConfigPath: path.join(process.cwd(), "data", DEFAULT_PERSON_LINK_REJECTIONS_FILE),
    playerRejectionConfigPath: path.join(process.cwd(), "data", DEFAULT_PLAYER_MERGE_REJECTIONS_FILE),
    teamRejectionConfigPath: path.join(process.cwd(), "data", DEFAULT_TEAM_MERGE_REJECTIONS_FILE),
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
      options.outputTarget = path.resolve(readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--playerMergeConfig" || arg === "--player-merge-config") {
      options.playerMergeConfigPath = path.resolve(readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--teamMergeConfig" || arg === "--team-merge-config") {
      options.teamMergeConfigPath = path.resolve(readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--personLinkConfig" || arg === "--person-link-config") {
      options.personLinkConfigPath = path.resolve(readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--personLinkRejectionConfig" || arg === "--person-link-rejection-config") {
      options.personLinkRejectionConfigPath = path.resolve(readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--playerRejectionConfig" || arg === "--player-rejection-config") {
      options.playerRejectionConfigPath = path.resolve(readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--teamRejectionConfig" || arg === "--team-rejection-config") {
      options.teamRejectionConfigPath = path.resolve(readOptionValue(argv, index, arg));
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

async function readJsonConfigFile<T>(configPath: string, emptyConfig: T) {
  try {
    const text = await fs.readFile(configPath, "utf8");
    return JSON.parse(text) as T;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return emptyConfig;
    }
    throw err;
  }
}

async function readEntityMergeReviewConfig(configPath: string) {
  return readJsonConfigFile<EntityMergeConfig>(configPath, {} as EntityMergeConfig);
}

async function readEntityMergeRejectionReviewConfig(configPath: string) {
  return readJsonConfigFile<EntityMergeRejectionConfig>(configPath, {} as EntityMergeRejectionConfig);
}

async function readPersonLinkReviewConfig(configPath: string) {
  return readJsonConfigFile<PersonLinkConfig>(configPath, {} as PersonLinkConfig);
}

async function readPersonLinkRejectionReviewConfig(configPath: string) {
  return readJsonConfigFile<PersonLinkRejectionConfig>(configPath, {} as PersonLinkRejectionConfig);
}

function resolveOutputPaths(outputTarget: string): SuggestionOutputPaths {
  const resolvedTarget = path.resolve(outputTarget);
  const outputDir =
    path.extname(resolvedTarget).toLowerCase() === ".json" ? path.dirname(resolvedTarget) : resolvedTarget;
  return {
    player: path.join(outputDir, PLAYER_CANDIDATES_FILE),
    team: path.join(outputDir, TEAM_CANDIDATES_FILE),
    person: path.join(outputDir, PERSON_CANDIDATES_FILE),
  };
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

function addEntity(
  records: Map<number, EntityRecord>,
  competitionId: ArchiveCompetitionId,
  id: unknown,
  seasonId: unknown,
  ...names: unknown[]
) {
  const numericId = archiveEntityIdForCompetition(competitionId, integerOrNull(id));
  if (numericId == null) {
    return;
  }

  let record = records.get(numericId);
  if (!record) {
    record = { id: numericId, competitionId, names: new Set(), seasons: new Set() };
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

function mergeEntityRecords(records: Map<number, EntityRecord>, aliasMap: Map<number, number>) {
  if (aliasMap.size === 0) {
    return records;
  }

  const mergedRecords = new Map<number, EntityRecord>();

  for (const record of records.values()) {
    const canonicalId = aliasMap.get(record.id) ?? record.id;
    let mergedRecord = mergedRecords.get(canonicalId);
    if (!mergedRecord) {
      mergedRecord = { id: canonicalId, competitionId: record.competitionId, names: new Set(), seasons: new Set() };
      mergedRecords.set(canonicalId, mergedRecord);
    }

    if (record.competitionId && mergedRecord.competitionId && record.competitionId !== mergedRecord.competitionId) {
      throw new Error(
        `mergeEntityRecords: canonical id ${canonicalId} received records from both ${mergedRecord.competitionId} and ${record.competitionId}`,
      );
    }
    if (!mergedRecord.competitionId && record.competitionId) {
      mergedRecord.competitionId = record.competitionId;
    }

    for (const name of record.names) {
      mergedRecord.names.add(name);
    }
    for (const season of record.seasons) {
      mergedRecord.seasons.add(season);
    }
  }

  return mergedRecords;
}

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

type ParsedPlayerName = {
  firstName: string;
  lastName: string;
  firstNameIsInitial: boolean;
  lastNameIsInitial: boolean;
};

const suffixes = new Set(["jr", "sr", "ii", "iii", "iv"]);

function normalizeNamePart(part: string) {
  return part
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function trimSuffixes(parts: string[]) {
  const normalizedParts = [...parts];
  while (normalizedParts.length > 0 && suffixes.has(normalizedParts[normalizedParts.length - 1])) {
    normalizedParts.pop();
  }
  return normalizedParts;
}

function parsePlayerName(name: string): ParsedPlayerName | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.includes(",")) {
    const [lastNamePart, ...firstNameParts] = trimmed.split(",");
    const lastName = trimSuffixes(normalizeNamePart(lastNamePart).split(" ").filter(Boolean)).join(" ");
    const firstName = trimSuffixes(normalizeNamePart(firstNameParts.join(" ")).split(" ").filter(Boolean))[0];
    if (!firstName || !lastName) {
      return null;
    }
    return {
      firstName,
      lastName,
      firstNameIsInitial: firstName.length === 1,
      lastNameIsInitial: lastName.length === 1,
    };
  }

  const parts = trimSuffixes(normalizeName(trimmed).split(" ").filter(Boolean));
  if (parts.length < 2) {
    return null;
  }

  const firstName = parts[0];
  const lastName = parts[parts.length - 1];
  return {
    firstName,
    lastName,
    firstNameIsInitial: firstName.length === 1,
    lastNameIsInitial: lastName.length === 1,
  };
}

function playerSimilarityKeys(record: EntityRecord) {
  const keys = new Set<string>();
  for (const name of record.names) {
    const parsedName = parsePlayerName(name);
    if (!parsedName || parsedName.lastNameIsInitial) {
      continue;
    }

    if (!parsedName.firstNameIsInitial) {
      keys.add(`exact:${parsedName.lastName}:${parsedName.firstName}`);
    }
    keys.add(`last-first-initial:${parsedName.lastName}:${parsedName.firstName[0]}`);
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

function canAddRecordToSeasons(record: EntityRecord, seasons: Set<number>) {
  for (const season of record.seasons) {
    if (seasons.has(season)) {
      return false;
    }
  }
  return true;
}

function addRecordSeasons(record: EntityRecord, seasons: Set<number>) {
  for (const season of record.seasons) {
    seasons.add(season);
  }
}

function removeRecordSeasons(record: EntityRecord, seasons: Set<number>) {
  for (const season of record.seasons) {
    seasons.delete(season);
  }
}

function recordsKey(records: EntityRecord[]) {
  return records
    .map((record) => record.id)
    .sort((left, right) => left - right)
    .join(",");
}

function isMaximalNonOverlappingSubset(subset: EntityRecord[], allRecords: EntityRecord[]) {
  const subsetIds = new Set(subset.map((record) => record.id));
  const subsetSeasons = new Set<number>();
  subset.forEach((record) => addRecordSeasons(record, subsetSeasons));

  return allRecords.every((record) => subsetIds.has(record.id) || !canAddRecordToSeasons(record, subsetSeasons));
}

const MAX_EXHAUSTIVE_OVERLAP_GROUP_SIZE = 14;
const MAX_NON_OVERLAPPING_SUBSETS = 250;

function greedyNonOverlappingSubsets(records: EntityRecord[]) {
  const subsets = new Map<string, EntityRecord[]>();
  const sortedRecords = [...records].sort((left, right) => left.id - right.id);

  for (const seed of sortedRecords) {
    const seasons = new Set<number>();
    const subset: EntityRecord[] = [];
    for (const record of [seed, ...sortedRecords.filter((candidate) => candidate.id !== seed.id)]) {
      if (canAddRecordToSeasons(record, seasons)) {
        subset.push(record);
        addRecordSeasons(record, seasons);
      }
    }

    if (subset.length >= 2 && isMaximalNonOverlappingSubset(subset, sortedRecords)) {
      subsets.set(recordsKey(subset), subset);
    }
  }

  return Array.from(subsets.values());
}

function exhaustiveNonOverlappingSubsets(records: EntityRecord[]) {
  const subsets = new Map<string, EntityRecord[]>();
  const sortedRecords = [...records].sort((left, right) => left.id - right.id);

  function visit(index: number, chosen: EntityRecord[], seasons: Set<number>) {
    if (subsets.size >= MAX_NON_OVERLAPPING_SUBSETS) {
      return;
    }
    if (index >= sortedRecords.length) {
      if (chosen.length >= 2 && isMaximalNonOverlappingSubset(chosen, sortedRecords)) {
        subsets.set(recordsKey(chosen), [...chosen]);
      }
      return;
    }

    const record = sortedRecords[index];
    if (canAddRecordToSeasons(record, seasons)) {
      chosen.push(record);
      addRecordSeasons(record, seasons);
      visit(index + 1, chosen, seasons);
      removeRecordSeasons(record, seasons);
      chosen.pop();
    }

    visit(index + 1, chosen, seasons);
  }

  visit(0, [], new Set());
  return Array.from(subsets.values());
}

function nonOverlappingCandidateRecordGroups(records: EntityRecord[]) {
  const uniqueRecords = [...new Map(records.map((record) => [record.id, record])).values()].sort(
    (left, right) => left.id - right.id,
  );

  if (uniqueRecords.length < 2) {
    return [];
  }

  if (!hasSeasonOverlap(uniqueRecords)) {
    return [uniqueRecords];
  }

  return uniqueRecords.length <= MAX_EXHAUSTIVE_OVERLAP_GROUP_SIZE
    ? exhaustiveNonOverlappingSubsets(uniqueRecords)
    : greedyNonOverlappingSubsets(uniqueRecords);
}

function candidatesFromGroup(entityType: "player" | "team", matchType: string, records: EntityRecord[]) {
  return nonOverlappingCandidateRecordGroups(records)
    .map((recordGroup) => candidateFromGroup(entityType, matchType, recordGroup))
    .filter((candidate): candidate is Candidate => !!candidate);
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
    matchTypes: [matchType],
    competitionId: uniqueRecords[0].competitionId,
    canonicalId: uniqueRecords[0].id,
    aliasIds: uniqueRecords.slice(1).map((record) => record.id),
    entities: uniqueRecords.map((record) => ({
      id: record.id,
      sourceId: sourceEntityIdFromArchiveId(record.id),
      names: Array.from(record.names).sort((left, right) => left.localeCompare(right)),
      seasons: Array.from(record.seasons).sort((left, right) => left - right),
    })),
  };
}

function candidateReviewKey(entityType: "player" | "team", ids: number[]) {
  return `${entityType}:${[...new Set(ids)].sort((left, right) => left - right).join(",")}`;
}

function personCandidateReviewKey(ids: number[]) {
  return `person:${[...new Set(ids)].sort((left, right) => left - right).join(",")}`;
}

function candidateIds(candidate: Candidate) {
  return candidate.entities.map((entity) => entity.id).sort((left, right) => left - right);
}

function sourceEntityIdForArchiveIdOrThrow(archiveId: number, context: string) {
  const sourceId = sourceEntityIdFromArchiveId(archiveId);
  if (sourceId == null) {
    throw new Error(`${context}: could not derive source id from archive id ${archiveId}`);
  }
  return sourceId;
}

function candidateCompetitionIdOrThrow(candidate: Candidate) {
  if (!candidate.competitionId) {
    throw new Error(`Candidate ${candidate.entityType}:${candidate.canonicalId} is missing a competition id`);
  }
  return candidate.competitionId;
}

function candidateSourceIds(candidate: Candidate) {
  return [candidate.canonicalId, ...candidate.aliasIds].map((archiveId) =>
    sourceEntityIdForArchiveIdOrThrow(archiveId, `${candidate.entityType} candidate`),
  );
}

function candidateSourceKey(candidate: Candidate) {
  return `${candidateCompetitionIdOrThrow(candidate)}:${candidateSourceIds(candidate).join("|")}`;
}

function matchTypePriority(matchType: string) {
  if (matchType.startsWith("exact:") || matchType.startsWith("team:")) {
    return 0;
  }
  if (matchType.startsWith("last-first-initial:")) {
    return 1;
  }
  return 2;
}

function bestMatchType(matchTypes: Iterable<string>) {
  return Array.from(new Set(matchTypes)).sort((left, right) => {
    const priorityDiff = matchTypePriority(left) - matchTypePriority(right);
    return priorityDiff || left.localeCompare(right);
  })[0];
}

function sortedMatchTypes(matchTypes: Iterable<string>) {
  return Array.from(new Set(matchTypes)).sort((left, right) => {
    const priorityDiff = matchTypePriority(left) - matchTypePriority(right);
    return priorityDiff || left.localeCompare(right);
  });
}

function hasCompetitionOverlap(records: EntityRecord[]) {
  const seen = new Set<ArchiveCompetitionId>();
  for (const record of records) {
    if (!record.competitionId) {
      return true;
    }
    if (seen.has(record.competitionId)) {
      return true;
    }
    seen.add(record.competitionId);
  }
  return false;
}

function canAddRecordToCompetitions(record: EntityRecord, competitions: Set<ArchiveCompetitionId>) {
  return !!record.competitionId && !competitions.has(record.competitionId);
}

function addRecordCompetition(record: EntityRecord, competitions: Set<ArchiveCompetitionId>) {
  if (record.competitionId) {
    competitions.add(record.competitionId);
  }
}

function removeRecordCompetition(record: EntityRecord, competitions: Set<ArchiveCompetitionId>) {
  if (record.competitionId) {
    competitions.delete(record.competitionId);
  }
}

function isMaximalUniqueCompetitionSubset(subset: EntityRecord[], allRecords: EntityRecord[]) {
  const subsetIds = new Set(subset.map((record) => record.id));
  const competitions = new Set<ArchiveCompetitionId>();
  subset.forEach((record) => addRecordCompetition(record, competitions));

  return allRecords.every((record) => subsetIds.has(record.id) || !canAddRecordToCompetitions(record, competitions));
}

function greedyUniqueCompetitionSubsets(records: EntityRecord[]) {
  const subsets = new Map<string, EntityRecord[]>();
  const sortedRecords = [...records].sort((left, right) => left.id - right.id);

  for (const seed of sortedRecords) {
    const competitions = new Set<ArchiveCompetitionId>();
    const subset: EntityRecord[] = [];
    for (const record of [seed, ...sortedRecords.filter((candidate) => candidate.id !== seed.id)]) {
      if (canAddRecordToCompetitions(record, competitions)) {
        subset.push(record);
        addRecordCompetition(record, competitions);
      }
    }

    if (subset.length >= 2 && isMaximalUniqueCompetitionSubset(subset, sortedRecords)) {
      subsets.set(recordsKey(subset), subset);
    }
  }

  return Array.from(subsets.values());
}

function exhaustiveUniqueCompetitionSubsets(records: EntityRecord[]) {
  const subsets = new Map<string, EntityRecord[]>();
  const sortedRecords = [...records].sort((left, right) => left.id - right.id);

  function visit(index: number, chosen: EntityRecord[], competitions: Set<ArchiveCompetitionId>) {
    if (subsets.size >= MAX_NON_OVERLAPPING_SUBSETS) {
      return;
    }
    if (index >= sortedRecords.length) {
      if (chosen.length >= 2 && isMaximalUniqueCompetitionSubset(chosen, sortedRecords)) {
        subsets.set(recordsKey(chosen), [...chosen]);
      }
      return;
    }

    const record = sortedRecords[index];
    if (canAddRecordToCompetitions(record, competitions)) {
      chosen.push(record);
      addRecordCompetition(record, competitions);
      visit(index + 1, chosen, competitions);
      removeRecordCompetition(record, competitions);
      chosen.pop();
    }

    visit(index + 1, chosen, competitions);
  }

  visit(0, [], new Set());
  return Array.from(subsets.values());
}

function uniqueCompetitionCandidateRecordGroups(records: EntityRecord[]) {
  const uniqueRecords = [...new Map(records.map((record) => [record.id, record])).values()].sort(
    (left, right) => left.id - right.id,
  );

  if (uniqueRecords.length < 2) {
    return [];
  }

  if (!hasCompetitionOverlap(uniqueRecords)) {
    return [uniqueRecords];
  }

  return uniqueRecords.length <= MAX_EXHAUSTIVE_OVERLAP_GROUP_SIZE
    ? exhaustiveUniqueCompetitionSubsets(uniqueRecords)
    : greedyUniqueCompetitionSubsets(uniqueRecords);
}

function mergeMatchTypes(candidate: Candidate, matchTypes: Iterable<string>) {
  candidate.matchTypes = sortedMatchTypes([...candidate.matchTypes, ...matchTypes]);
  candidate.matchType = bestMatchType(candidate.matchTypes);
}

function mergePersonMatchTypes(candidate: PersonCandidate, matchTypes: Iterable<string>) {
  candidate.matchTypes = sortedMatchTypes([...candidate.matchTypes, ...matchTypes]);
  candidate.matchType = bestMatchType(candidate.matchTypes);
}

function isStrictSubset(left: number[], right: number[]) {
  if (left.length >= right.length) {
    return false;
  }
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

class DisjointSet {
  private parents = new Map<number, number>();

  find(id: number): number {
    const parent = this.parents.get(id);
    if (parent == null) {
      this.parents.set(id, id);
      return id;
    }
    if (parent === id) {
      return id;
    }
    const root = this.find(parent);
    this.parents.set(id, root);
    return root;
  }

  union(left: number, right: number) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      this.parents.set(rightRoot, leftRoot);
    }
  }
}

function addConfirmedMergeReviewKeys(
  reviewedKeys: Set<string>,
  entityType: "player" | "team",
  groups: EntityMergeGroup[] | undefined,
) {
  for (const group of groups ?? []) {
    const competitionId = group.competitionId;
    reviewedKeys.add(
      candidateReviewKey(
        entityType,
        [group.canonicalSourceId, ...(group.aliasSourceIds ?? [])]
          .map((id) => archiveEntityIdForCompetition(competitionId, id))
          .filter((id): id is number => id != null),
      ),
    );
  }
}

function addRejectedReviewKeys(
  reviewedKeys: Set<string>,
  entityType: "player" | "team",
  groups: EntityMergeRejectionGroup[] | undefined,
) {
  for (const group of groups ?? []) {
    const competitionId = group.competitionId;
    const ids = group.sourceIds ?? [];
    if (ids.length >= 2) {
      reviewedKeys.add(
        candidateReviewKey(
          entityType,
          ids.map((id) => archiveEntityIdForCompetition(competitionId, id)).filter((id): id is number => id != null),
        ),
      );
    }
  }
}

function buildReviewedCandidateKeys(mergeConfig: EntityMergeConfig, rejectionConfig: EntityMergeRejectionConfig) {
  const reviewedKeys = new Set<string>();
  addConfirmedMergeReviewKeys(reviewedKeys, "player", mergeConfig.merges);
  addRejectedReviewKeys(reviewedKeys, "player", rejectionConfig.rejections);
  return reviewedKeys;
}

function addReviewedTeamCandidateKeys(
  reviewedKeys: Set<string>,
  teamConfig: EntityMergeConfig,
  rejectionConfig: EntityMergeRejectionConfig,
) {
  addConfirmedMergeReviewKeys(reviewedKeys, "team", teamConfig.merges);
  addRejectedReviewKeys(reviewedKeys, "team", rejectionConfig.rejections);
}

function combinationsOfIds(ids: number[], minimumSize: number) {
  const combinations: number[][] = [];
  const sortedIds = [...new Set(ids)].sort((left, right) => left - right);

  function visit(index: number, chosen: number[]) {
    if (chosen.length >= minimumSize) {
      combinations.push([...chosen]);
    }
    for (let currentIndex = index; currentIndex < sortedIds.length; currentIndex += 1) {
      chosen.push(sortedIds[currentIndex]);
      visit(currentIndex + 1, chosen);
      chosen.pop();
    }
  }

  visit(0, []);
  return combinations;
}

function personLinkMemberArchiveIds(members: PersonLinkMember[] | undefined, context: string) {
  return (members ?? []).map((member) => {
    const archiveId = archiveEntityIdForCompetition(member.competitionId, member.canonicalSourcePlayerId);
    if (archiveId == null) {
      throw new Error(
        `${context}: invalid member ${JSON.stringify(member.competitionId)}:${JSON.stringify(member.canonicalSourcePlayerId)}`,
      );
    }
    return archiveId;
  });
}

function buildReviewedPersonCandidateKeys(
  personLinkConfig: PersonLinkConfig,
  personLinkRejectionConfig: PersonLinkRejectionConfig,
) {
  const reviewedKeys = new Set<string>();

  for (const [groupIndex, group] of (personLinkConfig.people ?? []).entries()) {
    const memberIds = personLinkMemberArchiveIds(group.members, `person-link config ${groupIndex + 1}`);

    for (const ids of combinationsOfIds(memberIds, 2)) {
      reviewedKeys.add(personCandidateReviewKey(ids));
    }
  }

  for (const [groupIndex, group] of (personLinkRejectionConfig.rejections ?? []).entries()) {
    const memberIds = personLinkMemberArchiveIds(group.members, `person-link rejection config ${groupIndex + 1}`);
    if (memberIds.length >= 2) {
      reviewedKeys.add(personCandidateReviewKey(memberIds));
    }
  }

  return reviewedKeys;
}

function personCandidateFromGroup(matchType: string, records: EntityRecord[]): PersonCandidate | null {
  const uniqueRecords = [...new Map(records.map((record) => [record.id, record])).values()].sort(
    (left, right) => left.id - right.id,
  );
  if (uniqueRecords.length < 2 || hasCompetitionOverlap(uniqueRecords)) {
    return null;
  }

  return {
    entityType: "person",
    matchType,
    matchTypes: [matchType],
    members: uniqueRecords
      .filter((record): record is EntityRecord & { competitionId: ArchiveCompetitionId } => !!record.competitionId)
      .map((record) => ({
        id: record.id,
        sourceId: sourceEntityIdFromArchiveId(record.id),
        competitionId: record.competitionId,
        names: Array.from(record.names).sort((left, right) => left.localeCompare(right)),
        seasons: Array.from(record.seasons).sort((left, right) => left - right),
      })),
  };
}

function personCandidateIds(candidate: PersonCandidate) {
  return candidate.members.map((member) => member.id).sort((left, right) => left - right);
}

function personCandidateMemberSourceId(member: PersonCandidate["members"][number]) {
  return member.sourceId ?? sourceEntityIdFromArchiveId(member.id) ?? member.id;
}

function playerHrefForArchiveId(playerId: number) {
  return `#/players/${playerId}`;
}

function personHrefForPersonId(personId: number) {
  return `#/people/${personId}`;
}

function sortedPersonCandidateMembers(members: PersonCandidate["members"]) {
  return [...members].sort((left, right) => {
    const competitionDifference = left.competitionId.localeCompare(right.competitionId);
    if (competitionDifference !== 0) {
      return competitionDifference;
    }
    return personCandidateMemberSourceId(left) - personCandidateMemberSourceId(right);
  });
}

function personCandidateKey(candidate: PersonCandidate) {
  return sortedPersonCandidateMembers(candidate.members)
    .map((member) => `${member.competitionId}:${personCandidateMemberSourceId(member)}`)
    .join("|");
}

function nextSuggestedPersonIdBase(personLinkConfig: PersonLinkConfig) {
  const explicitIds = (personLinkConfig.people ?? [])
    .map((group) => integerOrNull(group.personId))
    .filter((personId): personId is number => personId != null && personId > 0);

  return explicitIds.length > 0 ? Math.max(...explicitIds) + 1 : 1;
}

function bestPersonCandidateDisplayName(candidate: PersonCandidate) {
  const names = Array.from(
    new Set(
      candidate.members
        .flatMap((member) => member.names)
        .map((name) => textOrNull(name))
        .filter((name): name is string => name != null),
    ),
  );

  if (names.length === 0) {
    return undefined;
  }

  const preferredNames = names.filter((name) => !name.includes(",") && name.split(/\s+/).length >= 2);
  const namePool = preferredNames.length > 0 ? preferredNames : names;

  return [...namePool].sort((left, right) => right.length - left.length || left.localeCompare(right))[0];
}

function personCandidatesFromGroup(matchType: string, records: EntityRecord[]) {
  return uniqueCompetitionCandidateRecordGroups(records)
    .map((recordGroup) => personCandidateFromGroup(matchType, recordGroup))
    .filter((candidate): candidate is PersonCandidate => !!candidate);
}

function buildPersonCandidates(records: EntityRecord[], reviewedCandidateKeys: Set<string>) {
  const groups = new Map<string, EntityRecord[]>();
  for (const record of records) {
    for (const key of playerSimilarityKeys(record)) {
      const group = groups.get(key) ?? [];
      group.push(record);
      groups.set(key, group);
    }
  }

  const rawCandidates = new Map<string, PersonCandidate>();
  for (const [key, recordsForKey] of groups) {
    for (const candidate of personCandidatesFromGroup(key, recordsForKey)) {
      const candidateKey = personCandidateReviewKey(personCandidateIds(candidate));
      const existing = rawCandidates.get(candidateKey);
      if (existing) {
        mergePersonMatchTypes(existing, candidate.matchTypes);
      } else {
        rawCandidates.set(candidateKey, candidate);
      }
    }
  }

  const recordsById = new Map(records.map((record) => [record.id, record]));
  const disjointSet = new DisjointSet();
  for (const candidate of rawCandidates.values()) {
    const ids = personCandidateIds(candidate);
    for (const id of ids) {
      disjointSet.find(id);
      disjointSet.union(ids[0], id);
    }
  }

  const candidatesByRoot = new Map<number, PersonCandidate[]>();
  for (const candidate of rawCandidates.values()) {
    const root = disjointSet.find(candidate.members[0].id);
    const candidatesForRoot = candidatesByRoot.get(root) ?? [];
    candidatesForRoot.push(candidate);
    candidatesByRoot.set(root, candidatesForRoot);
  }

  const candidates: PersonCandidate[] = [];
  for (const candidatesForRoot of candidatesByRoot.values()) {
    const componentIds = Array.from(new Set(candidatesForRoot.flatMap(personCandidateIds))).sort(
      (left, right) => left - right,
    );
    const componentRecords = componentIds
      .map((id) => recordsById.get(id))
      .filter((record): record is EntityRecord => !!record);
    const componentKey = personCandidateReviewKey(componentIds);

    if (
      componentRecords.length >= 2 &&
      !hasCompetitionOverlap(componentRecords) &&
      !reviewedCandidateKeys.has(componentKey)
    ) {
      const componentMatchTypes = sortedMatchTypes(candidatesForRoot.flatMap((candidate) => candidate.matchTypes));
      const componentCandidate = personCandidateFromGroup(bestMatchType(componentMatchTypes), componentRecords);
      if (componentCandidate) {
        componentCandidate.matchTypes = componentMatchTypes;
        candidates.push(componentCandidate);
      }
      continue;
    }

    const fallbackCandidates = candidatesForRoot.filter(
      (candidate) => !reviewedCandidateKeys.has(personCandidateReviewKey(personCandidateIds(candidate))),
    );
    for (const candidate of fallbackCandidates) {
      const ids = personCandidateIds(candidate);
      const isRedundantSubset = fallbackCandidates.some((other) => {
        if (candidate === other) {
          return false;
        }
        return isStrictSubset(ids, personCandidateIds(other));
      });
      if (!isRedundantSubset) {
        candidates.push(candidate);
      }
    }
  }

  return candidates.sort((left, right) => left.members[0].id - right.members[0].id);
}

function buildSuggestedPersonLinkGroup(candidate: PersonCandidate, personId: number): PersonLinkGroup {
  const displayName = bestPersonCandidateDisplayName(candidate);

  return {
    personId,
    displayName,
    members: sortedPersonCandidateMembers(candidate.members).map((member) => ({
      competitionId: member.competitionId,
      canonicalSourcePlayerId: personCandidateMemberSourceId(member),
    })),
    reason: `Candidate from ${candidate.matchTypes.join(", ")}`,
  };
}

function buildSuggestedPersonLinkRejectionGroup(candidate: PersonCandidate) {
  return {
    members: sortedPersonCandidateMembers(candidate.members).map((member) => ({
      competitionId: member.competitionId,
      canonicalSourcePlayerId: personCandidateMemberSourceId(member),
    })),
    reason: `Reviewed candidate ${personCandidateKey(candidate)} rejected`,
  };
}

function buildPersonCandidateOutput(candidate: PersonCandidate, suggestedPersonId: number): PersonCandidateOutput {
  const acceptedEntry = buildSuggestedPersonLinkGroup(candidate, suggestedPersonId);
  const rejectedEntry = buildSuggestedPersonLinkRejectionGroup(candidate);
  const personHref = personHrefForPersonId(suggestedPersonId);

  return {
    ...candidate,
    members: sortedPersonCandidateMembers(candidate.members).map((member) => ({
      ...member,
      playerHref: playerHrefForArchiveId(member.id),
      personHref,
    })),
    candidateKey: personCandidateKey(candidate),
    suggestedPersonId,
    suggestedDisplayName: acceptedEntry.displayName,
    acceptedEntry,
    rejectedEntry,
  };
}

function buildSuggestedEntityMergeGroup(candidate: Candidate): EntityMergeGroup {
  const [canonicalSourceId, ...aliasSourceIds] = candidateSourceIds(candidate);

  return {
    competitionId: candidateCompetitionIdOrThrow(candidate),
    canonicalSourceId,
    aliasSourceIds,
    reason: `Candidate from ${candidate.matchTypes.join(", ")}`,
  };
}

function buildSuggestedEntityMergeRejectionGroup(candidate: Candidate): EntityMergeRejectionGroup {
  return {
    competitionId: candidateCompetitionIdOrThrow(candidate),
    sourceIds: candidateSourceIds(candidate),
    reason: `Reviewed candidate ${candidateSourceKey(candidate)} rejected`,
  };
}

function buildEntityCandidateOutput(candidate: Candidate): CandidateOutput {
  const acceptedEntry = buildSuggestedEntityMergeGroup(candidate);
  const rejectedEntry = buildSuggestedEntityMergeRejectionGroup(candidate);

  return {
    ...candidate,
    candidateKey: candidateSourceKey(candidate),
    acceptedEntry,
    rejectedEntry,
  };
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
      const scopedKey = `${record.competitionId}|${key}`;
      const group = groups.get(scopedKey) ?? [];
      group.push(record);
      groups.set(scopedKey, group);
    }
  }

  const rawCandidates = new Map<string, Candidate>();
  for (const [key, recordsForKey] of groups) {
    const matchKey = key.slice(key.indexOf("|") + 1);
    for (const candidate of candidatesFromGroup(entityType, matchKey, recordsForKey)) {
      const candidateKey = candidateReviewKey(
        entityType,
        candidate.entities.map((entity) => entity.id),
      );
      const existing = rawCandidates.get(candidateKey);
      if (existing) {
        mergeMatchTypes(existing, candidate.matchTypes);
      } else {
        rawCandidates.set(candidateKey, candidate);
      }
    }
  }

  const recordsById = new Map(records.map((record) => [record.id, record]));
  const disjointSet = new DisjointSet();
  for (const candidate of rawCandidates.values()) {
    const ids = candidateIds(candidate);
    for (const id of ids) {
      disjointSet.find(id);
      disjointSet.union(ids[0], id);
    }
  }

  const candidatesByRoot = new Map<number, Candidate[]>();
  for (const candidate of rawCandidates.values()) {
    const root = disjointSet.find(candidate.canonicalId);
    const candidatesForRoot = candidatesByRoot.get(root) ?? [];
    candidatesForRoot.push(candidate);
    candidatesByRoot.set(root, candidatesForRoot);
  }

  const candidates: Candidate[] = [];
  for (const candidatesForRoot of candidatesByRoot.values()) {
    const componentIds = Array.from(new Set(candidatesForRoot.flatMap(candidateIds))).sort(
      (left, right) => left - right,
    );
    const componentRecords = componentIds
      .map((id) => recordsById.get(id))
      .filter((record): record is EntityRecord => !!record);
    const componentKey = candidateReviewKey(entityType, componentIds);

    if (
      componentRecords.length >= 2 &&
      !hasSeasonOverlap(componentRecords) &&
      !reviewedCandidateKeys.has(componentKey)
    ) {
      const componentMatchTypes = sortedMatchTypes(candidatesForRoot.flatMap((candidate) => candidate.matchTypes));
      const componentCandidate = candidateFromGroup(entityType, bestMatchType(componentMatchTypes), componentRecords);
      if (componentCandidate) {
        componentCandidate.matchTypes = componentMatchTypes;
        candidates.push(componentCandidate);
      }
      continue;
    }

    const fallbackCandidates = candidatesForRoot.filter(
      (candidate) => !reviewedCandidateKeys.has(candidateReviewKey(entityType, candidateIds(candidate))),
    );
    for (const candidate of fallbackCandidates) {
      const ids = candidateIds(candidate);
      const isRedundantSubset = fallbackCandidates.some((other) => {
        if (candidate === other) {
          return false;
        }
        return isStrictSubset(ids, candidateIds(other));
      });
      if (!isRedundantSubset) {
        candidates.push(candidate);
      }
    }
  }

  return candidates.sort((left, right) => {
    if (left.entityType !== right.entityType) {
      return left.entityType.localeCompare(right.entityType);
    }
    return left.canonicalId - right.canonicalId;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputPaths = resolveOutputPaths(options.outputTarget);
  const bundles = await loadSeasonSeedBundles(options.outDir, options.seasonIds);
  const playerReviewConfig = await readEntityMergeReviewConfig(options.playerMergeConfigPath);
  const teamReviewConfig = await readEntityMergeReviewConfig(options.teamMergeConfigPath);
  const personLinkReviewConfig = await readPersonLinkReviewConfig(options.personLinkConfigPath);
  const personLinkRejectionConfig = await readPersonLinkRejectionReviewConfig(options.personLinkRejectionConfigPath);
  const playerRejectionConfig = await readEntityMergeRejectionReviewConfig(options.playerRejectionConfigPath);
  const teamRejectionConfig = await readEntityMergeRejectionReviewConfig(options.teamRejectionConfigPath);
  const { maps: reviewedMergeMaps } = buildEntityMergeMaps(playerReviewConfig, teamReviewConfig);
  const reviewedPlayerCandidateKeys = buildReviewedCandidateKeys(playerReviewConfig, playerRejectionConfig);
  const reviewedTeamCandidateKeys = new Set<string>();
  const reviewedPersonCandidateKeys = buildReviewedPersonCandidateKeys(
    personLinkReviewConfig,
    personLinkRejectionConfig,
  );
  addReviewedTeamCandidateKeys(reviewedTeamCandidateKeys, teamReviewConfig, teamRejectionConfig);
  const players = new Map<number, EntityRecord>();
  const teams = new Map<number, EntityRecord>();

  for (const bundle of bundles) {
    const competitionId = competitionIdForSeasonId(bundle.seasonId);
    for (const row of bundle.tables.players) {
      addEntity(players, competitionId, row.player_id, null, row.name);
    }

    for (const row of bundle.tables.teams) {
      addEntity(teams, competitionId, row.team_id, null, row.name, row.short_name, row.former_names);
    }

    for (const table of ARCHIVE_SEED_TABLES) {
      for (const row of bundle.tables[table]) {
        addEntity(
          players,
          competitionId,
          row.player_id,
          row.season_id,
          row.player_name,
          row.name,
          row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : null,
        );
        addEntity(teams, competitionId, row.team_id, row.season_id, row.team_name, row.source_team_name);
        addEntity(teams, competitionId, row.home_team_id, row.season_id);
        addEntity(teams, competitionId, row.away_team_id, row.season_id);
      }
    }
  }

  const canonicalPlayers = mergeEntityRecords(players, reviewedMergeMaps.players);
  const canonicalTeams = mergeEntityRecords(teams, reviewedMergeMaps.teams);
  const playerCandidates = buildCandidates(
    "player",
    Array.from(canonicalPlayers.values()),
    playerSimilarityKeys,
    reviewedPlayerCandidateKeys,
  );
  const teamCandidates = buildCandidates(
    "team",
    Array.from(canonicalTeams.values()),
    teamSimilarityKeys,
    reviewedTeamCandidateKeys,
  );
  const personCandidates = buildPersonCandidates(Array.from(canonicalPlayers.values()), reviewedPersonCandidateKeys);
  const suggestedPersonIdBase = nextSuggestedPersonIdBase(personLinkReviewConfig);
  const playerCandidateOutputs = playerCandidates.map(buildEntityCandidateOutput);
  const teamCandidateOutputs = teamCandidates.map(buildEntityCandidateOutput);
  const personCandidateOutputs = personCandidates.map((candidate, index) =>
    buildPersonCandidateOutput(candidate, suggestedPersonIdBase + index),
  );
  const generatedAt = new Date().toISOString();
  const playerOutput = {
    generatedAt,
    entityType: "player-merge",
    description:
      "Review these player merge candidates manually. Confirmed groups should be copied into data/player-merge-approvals.json and rejected groups into data/player-merge-rejections.json.",
    playerMergeApprovalConfigPath: options.playerMergeConfigPath,
    playerMergeRejectionConfigPath: options.playerRejectionConfigPath,
    skippedReviewedPlayerCandidateCount: reviewedPlayerCandidateKeys.size,
    candidates: playerCandidateOutputs,
    suggestedPlayerMergeConfig: {
      version: 1,
      merges: playerCandidateOutputs.map((candidate) => candidate.acceptedEntry),
    },
    suggestedPlayerMergeRejectionConfig: {
      version: 1,
      rejections: playerCandidateOutputs.map((candidate) => candidate.rejectedEntry),
    },
  };
  const teamOutput = {
    generatedAt,
    entityType: "team-merge",
    description:
      "Review these team merge candidates manually. Confirmed groups should be copied into data/team-merge-approvals.json and rejected groups into data/team-merge-rejections.json.",
    teamMergeApprovalConfigPath: options.teamMergeConfigPath,
    teamMergeRejectionConfigPath: options.teamRejectionConfigPath,
    skippedReviewedTeamCandidateCount: reviewedTeamCandidateKeys.size,
    candidates: teamCandidateOutputs,
    suggestedTeamMergeConfig: {
      version: 1,
      merges: teamCandidateOutputs.map((candidate) => candidate.acceptedEntry),
    },
    suggestedTeamMergeRejectionConfig: {
      version: 1,
      rejections: teamCandidateOutputs.map((candidate) => candidate.rejectedEntry),
    },
  };
  const personOutput = {
    generatedAt,
    entityType: "person-link",
    description:
      "Review these person-link candidates manually. Confirmed groups should be copied into data/person-link-approvals.json and rejected groups into data/person-link-rejections.json. These suggestions must never be used to merge stats or history across competition levels.",
    personLinkApprovalConfigPath: options.personLinkConfigPath,
    personLinkRejectionConfigPath: options.personLinkRejectionConfigPath,
    skippedReviewedPersonCandidateCount: reviewedPersonCandidateKeys.size,
    suggestedPersonIdBase,
    candidates: personCandidateOutputs,
    suggestedPersonLinkConfig: {
      version: 1,
      people: personCandidateOutputs.map((candidate) => candidate.acceptedEntry),
    },
    suggestedPersonLinkRejectionConfig: {
      version: 1,
      rejections: personCandidateOutputs.map((candidate) => candidate.rejectedEntry),
    },
  };

  await fs.mkdir(path.dirname(outputPaths.player), { recursive: true });
  await Promise.all([
    fs.writeFile(outputPaths.player, JSON.stringify(playerOutput, null, 2) + "\n", "utf8"),
    fs.writeFile(outputPaths.team, JSON.stringify(teamOutput, null, 2) + "\n", "utf8"),
    fs.writeFile(outputPaths.person, JSON.stringify(personOutput, null, 2) + "\n", "utf8"),
  ]);
  console.log(`Wrote ${playerCandidates.length} player merge candidates to ${outputPaths.player}`);
  console.log(`Wrote ${teamCandidates.length} team merge candidates to ${outputPaths.team}`);
  console.log(`Wrote ${personCandidates.length} person-link candidates to ${outputPaths.person}`);
}

main().catch((err) => {
  console.error(err);
  usage();
  process.exit(1);
});
