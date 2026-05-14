export const LEAGUE_ID = "1552";

export type ArchiveSeasonOption = {
  id: string;
  name: string;
  competitionId: ArchiveCompetitionId;
};

export const DEFAULT_COMPETITION_ID = "18-plus";

export type ArchiveCompetitionId = "18-plus" | "30-plus" | "40-plus";

export type ArchiveCompetition = {
  id: ArchiveCompetitionId;
  name: string;
  shortName: string;
  sortOrder: number;
  minimumAge: number;
};

export const ARCHIVE_COMPETITIONS: ArchiveCompetition[] = [
  { id: "18-plus", name: "18+ Competition", shortName: "18+", sortOrder: 1, minimumAge: 18 },
  { id: "30-plus", name: "30+ Competition", shortName: "30+", sortOrder: 2, minimumAge: 30 },
  { id: "40-plus", name: "40+ Competition", shortName: "40+", sortOrder: 3, minimumAge: 40 },
];

const ARCHIVE_COMPETITION_ID_SET = new Set<ArchiveCompetitionId>(
  ARCHIVE_COMPETITIONS.map((competition) => competition.id),
);

export const ARCHIVE_SEASONS: ArchiveSeasonOption[] = [
  { id: "34360", name: "18+ Summer 2026", competitionId: "18-plus" },
  { id: "34359", name: "40+ Summer 2026", competitionId: "40-plus" },
  { id: "34286", name: "40+ Summer 2025", competitionId: "40-plus" },
  { id: "34201", name: "JAX MABL Summer 2025", competitionId: "18-plus" },
  { id: "33936", name: "JAX MABL Summer 2024", competitionId: "18-plus" },
  { id: "33711", name: "JAX MABL Summer 2023", competitionId: "18-plus" },
  { id: "33391", name: "JAX MABL Summer 2022", competitionId: "18-plus" },
  { id: "33023", name: "18+ Summer 2021", competitionId: "18-plus" },
  { id: "32757", name: "JAX MABL Summer 2020", competitionId: "18-plus" },
  { id: "32185", name: "30+ Summer 2019", competitionId: "30-plus" },
  { id: "32179", name: "18+ Summer 2019", competitionId: "18-plus" },
  { id: "31506", name: "JAX MABL Summer 2018", competitionId: "18-plus" },
  { id: "30879", name: "JAX MABL Summer 2017", competitionId: "18-plus" },
  { id: "30232", name: "JAX MABL Summer 2016", competitionId: "18-plus" },
  { id: "29373", name: "JAX MABL Summer 2015", competitionId: "18-plus" },
  { id: "28308", name: "JAX MABL Summer 2014", competitionId: "18-plus" },
  { id: "2010", name: "JAX MABL Summer 2010", competitionId: "18-plus" },
  { id: "2009", name: "JAX MABL Summer 2009", competitionId: "18-plus" },
  { id: "2008", name: "JAX MABL Summer 2008", competitionId: "18-plus" },
];

export const SEASONS = [
  { id: 28308, teamId: 70342, name: "JAX MABL Summer 2014", year: 2014 },
  { id: 29373, teamId: 92342, name: "JAX MABL Summer 2015", year: 2015 },
  { id: 30232, teamId: 92342, name: "JAX MABL Summer 2016", year: 2016 },
  { id: 30879, teamId: 92342, name: "JAX MABL Summer 2017", year: 2017 },
  { id: 31506, teamId: 92342, name: "JAX MABL Summer 2018", year: 2018 },
  { id: 32179, teamId: 92342, name: "18+ Summer 2019", year: 2019 },
  { id: 32757, teamId: 92342, name: "JAX MABL Summer 2020", year: 2020 },
  { id: 33023, teamId: 92342, name: "18+ Summer 2021", year: 2021 },
  { id: 33391, teamId: 92342, name: "JAX MABL Summer 2022", year: 2022 },
  { id: 33711, teamId: 92342, name: "JAX MABL Summer 2023", year: 2023 },
  { id: 33936, teamId: 92342, name: "JAX MABL Summer 2024", year: 2024 },
  { id: 34201, teamId: 92342, name: "JAX MABL Summer 2025", year: 2025 },
  { id: 34360, teamId: 92342, name: "18+ Summer 2026", year: 2026 },
];

const COMPETITION_BY_SEASON_ID = new Map(ARCHIVE_SEASONS.map((season) => [Number(season.id), season.competitionId]));
const COMPETITION_ID_OFFSETS: Record<ArchiveCompetitionId, number> = {
  "18-plus": 2_000_000_000,
  "30-plus": 3_000_000_000,
  "40-plus": 4_000_000_000,
};

export function competitionIdForSeasonId(seasonId: number | string | null | undefined): ArchiveCompetitionId {
  const numericSeasonId = Number(seasonId);
  if (!Number.isFinite(numericSeasonId)) {
    return DEFAULT_COMPETITION_ID;
  }
  return COMPETITION_BY_SEASON_ID.get(numericSeasonId) ?? DEFAULT_COMPETITION_ID;
}

export function isArchiveCompetitionId(value: unknown): value is ArchiveCompetitionId {
  return typeof value === "string" && ARCHIVE_COMPETITION_ID_SET.has(value as ArchiveCompetitionId);
}

export function archiveEntityIdForCompetition(
  competitionId: string | null | undefined,
  sourceId: number | string | null | undefined,
) {
  const numericSourceId = Number(sourceId);
  if (!Number.isInteger(numericSourceId) || numericSourceId <= 0) {
    return null;
  }
  const normalizedCompetitionId = competitionId == null ? DEFAULT_COMPETITION_ID : competitionId;
  if (!isArchiveCompetitionId(normalizedCompetitionId)) {
    return null;
  }
  return (COMPETITION_ID_OFFSETS[normalizedCompetitionId] ?? 0) + numericSourceId;
}

export function sourceEntityIdFromArchiveId(archiveId: number | string | null | undefined) {
  const numericArchiveId = Number(archiveId);
  if (!Number.isInteger(numericArchiveId)) {
    return null;
  }
  const competition = [...ARCHIVE_COMPETITIONS]
    .sort((left, right) => COMPETITION_ID_OFFSETS[right.id] - COMPETITION_ID_OFFSETS[left.id])
    .find((entry) => numericArchiveId >= COMPETITION_ID_OFFSETS[entry.id]);
  if (!competition) {
    return numericArchiveId;
  }
  return numericArchiveId - COMPETITION_ID_OFFSETS[competition.id];
}
