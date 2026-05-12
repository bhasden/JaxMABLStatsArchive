type BoxscoreLineupRow = {
  game_id: number;
  season_id: number;
  team_id: number | null;
  is_home: boolean;
  player_id: number | null;
  position: string | null;
  order_idx: number | null;
};

type BoxscoreBattingRow = {
  game_id: number;
  season_id: number;
  team_id: number | null;
  is_home: boolean;
  player_id: number | null;
  ab: number | null;
  runs: number | null;
  hits: number | null;
  hr: number | null;
  rbi: number | null;
  bb: number | null;
  so: number | null;
  sb: number | null;
};

export type BoxscoreSeedCleanupStats = {
  pitcherOnlyBattingArtifacts: {
    removedLineupRows: number;
    removedBattingRows: number;
    affectedGameIds: Set<number>;
  };
};

export function createBoxscoreSeedCleanupStats(): BoxscoreSeedCleanupStats {
  return {
    pitcherOnlyBattingArtifacts: {
      removedLineupRows: 0,
      removedBattingRows: 0,
      affectedGameIds: new Set<number>(),
    },
  };
}

export function mergeBoxscoreSeedCleanupStats(target: BoxscoreSeedCleanupStats, source: BoxscoreSeedCleanupStats) {
  target.pitcherOnlyBattingArtifacts.removedLineupRows += source.pitcherOnlyBattingArtifacts.removedLineupRows;
  target.pitcherOnlyBattingArtifacts.removedBattingRows += source.pitcherOnlyBattingArtifacts.removedBattingRows;
  for (const gameId of source.pitcherOnlyBattingArtifacts.affectedGameIds) {
    target.pitcherOnlyBattingArtifacts.affectedGameIds.add(gameId);
  }
}

export function formatBoxscoreSeedCleanupStats(stats: BoxscoreSeedCleanupStats) {
  const artifactStats = stats.pitcherOnlyBattingArtifacts;
  const removedArtifacts = Math.max(artifactStats.removedLineupRows, artifactStats.removedBattingRows);

  if (removedArtifacts === 0) {
    return "Applied boxscore seed cleanups: no rows removed";
  }

  return [
    "Applied boxscore seed cleanups:",
    `removed ${removedArtifacts} pitcher-only batting artifacts`,
    `from ${artifactStats.affectedGameIds.size} games`,
    `(${artifactStats.removedLineupRows} lineup rows, ${artifactStats.removedBattingRows} batting stat rows)`,
  ].join(" ");
}

export function applyBoxscoreSeedCleanups({
  gameId,
  seasonId,
  lineups,
  batting,
}: {
  gameId: number;
  seasonId: number;
  lineups: BoxscoreLineupRow[];
  batting: BoxscoreBattingRow[];
}) {
  void seasonId;
  const stats = createBoxscoreSeedCleanupStats();
  const cleaned = removePitcherOnlyBattingArtifacts({ gameId, lineups, batting, stats });

  return {
    ...cleaned,
    stats,
  };
}

function removePitcherOnlyBattingArtifacts({
  gameId,
  lineups,
  batting,
  stats,
}: {
  gameId: number;
  lineups: BoxscoreLineupRow[];
  batting: BoxscoreBattingRow[];
  stats: BoxscoreSeedCleanupStats;
}) {
  const orderOneCounts = new Map<string, number>();
  for (const lineup of lineups) {
    if (lineup.order_idx !== 1) {
      continue;
    }
    const key = teamSideKey(lineup);
    orderOneCounts.set(key, (orderOneCounts.get(key) ?? 0) + 1);
  }

  const playersToRemove = new Set<string>();
  for (const lineup of lineups) {
    if (
      lineup.position !== "P" ||
      lineup.order_idx !== 1 ||
      lineup.player_id == null ||
      (orderOneCounts.get(teamSideKey(lineup)) ?? 0) < 2
    ) {
      continue;
    }

    const playerKey = playerTeamSideKey(lineup);
    if (batting.some((row) => playerTeamSideKey(row) === playerKey && hasZeroCountedBattingStats(row))) {
      playersToRemove.add(playerKey);
    }
  }

  if (playersToRemove.size === 0) {
    return { lineups, batting };
  }

  const cleanedLineups = lineups.filter((lineup) => {
    const shouldRemove = playersToRemove.has(playerTeamSideKey(lineup));
    if (shouldRemove) {
      stats.pitcherOnlyBattingArtifacts.removedLineupRows += 1;
    }
    return !shouldRemove;
  });

  const cleanedBatting = batting.filter((row) => {
    const shouldRemove = playersToRemove.has(playerTeamSideKey(row)) && hasZeroCountedBattingStats(row);
    if (shouldRemove) {
      stats.pitcherOnlyBattingArtifacts.removedBattingRows += 1;
    }
    return !shouldRemove;
  });

  if (
    stats.pitcherOnlyBattingArtifacts.removedLineupRows > 0 ||
    stats.pitcherOnlyBattingArtifacts.removedBattingRows > 0
  ) {
    stats.pitcherOnlyBattingArtifacts.affectedGameIds.add(gameId);
  }

  return {
    lineups: cleanedLineups,
    batting: cleanedBatting,
  };
}

function teamSideKey(row: Pick<BoxscoreLineupRow, "game_id" | "season_id" | "team_id" | "is_home">) {
  return [row.game_id, row.season_id, row.team_id ?? "", row.is_home ? 1 : 0].join(":");
}

function playerTeamSideKey(
  row: Pick<BoxscoreLineupRow, "game_id" | "season_id" | "team_id" | "is_home" | "player_id">,
) {
  return [teamSideKey(row), row.player_id ?? ""].join(":");
}

function hasZeroCountedBattingStats(row: BoxscoreBattingRow) {
  return (
    Number(row.ab ?? 0) === 0 &&
    Number(row.runs ?? 0) === 0 &&
    Number(row.hits ?? 0) === 0 &&
    Number(row.hr ?? 0) === 0 &&
    Number(row.rbi ?? 0) === 0 &&
    Number(row.bb ?? 0) === 0 &&
    Number(row.so ?? 0) === 0 &&
    Number(row.sb ?? 0) === 0
  );
}
