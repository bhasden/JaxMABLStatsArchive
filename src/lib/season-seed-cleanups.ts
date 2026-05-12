type SeasonPitchingStatsRow = {
  scope?: unknown;
  season_id?: unknown;
  player_id?: unknown;
  hits?: unknown;
};

export type SeasonSeedCleanupStats = {
  leaguePitchingHitsFromTeamStats: {
    rowsUpdated: number;
    playerSeasonsUpdated: number;
    sourcedHits: number;
  };
};

export function createSeasonSeedCleanupStats(): SeasonSeedCleanupStats {
  return {
    leaguePitchingHitsFromTeamStats: {
      rowsUpdated: 0,
      playerSeasonsUpdated: 0,
      sourcedHits: 0,
    },
  };
}

export function applySeasonSeedCleanups({ seasonPitchingStats }: { seasonPitchingStats: SeasonPitchingStatsRow[] }) {
  const stats = createSeasonSeedCleanupStats();

  sourceBlankLeaguePitchingHitsFromTeamStats(seasonPitchingStats, stats);

  return { seasonPitchingStats, stats };
}

export function formatSeasonSeedCleanupStats(stats: SeasonSeedCleanupStats) {
  const pitchingHits = stats.leaguePitchingHitsFromTeamStats;
  if (pitchingHits.rowsUpdated === 0) {
    return "Applied season seed cleanups: no rows updated";
  }

  return [
    "Applied season seed cleanups:",
    `sourced league pitching hits from team stats for ${pitchingHits.playerSeasonsUpdated} player-seasons`,
    `(${pitchingHits.rowsUpdated} rows updated, ${pitchingHits.sourcedHits} hits)`,
  ].join(" ");
}

function sourceBlankLeaguePitchingHitsFromTeamStats(rows: SeasonPitchingStatsRow[], stats: SeasonSeedCleanupStats) {
  const teamHitsByPlayerSeason = new Map<string, number>();

  for (const row of rows) {
    if (row.scope !== "team") {
      continue;
    }

    const seasonId = numberOrNull(row.season_id);
    const playerId = numberOrNull(row.player_id);
    const hits = numberOrNull(row.hits);
    if (seasonId == null || playerId == null || hits == null) {
      continue;
    }

    const key = playerSeasonKey(seasonId, playerId);
    teamHitsByPlayerSeason.set(key, (teamHitsByPlayerSeason.get(key) ?? 0) + hits);
  }

  const updatedPlayerSeasons = new Set<string>();
  for (const row of rows) {
    if (row.scope !== "league" || numberOrNull(row.hits) != null) {
      continue;
    }

    const seasonId = numberOrNull(row.season_id);
    const playerId = numberOrNull(row.player_id);
    if (seasonId == null || playerId == null) {
      continue;
    }

    const key = playerSeasonKey(seasonId, playerId);
    const teamHits = teamHitsByPlayerSeason.get(key);
    if (teamHits == null) {
      continue;
    }

    row.hits = teamHits;
    stats.leaguePitchingHitsFromTeamStats.rowsUpdated += 1;
    stats.leaguePitchingHitsFromTeamStats.sourcedHits += teamHits;
    updatedPlayerSeasons.add(key);
  }

  stats.leaguePitchingHitsFromTeamStats.playerSeasonsUpdated = updatedPlayerSeasons.size;
}

function playerSeasonKey(seasonId: number, playerId: number) {
  return `${seasonId}:${playerId}`;
}

function numberOrNull(value: unknown) {
  if (value == null || value === "") {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}
