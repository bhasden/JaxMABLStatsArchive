import fs from "fs/promises";
import path from "path";
import { ARCHIVE_SEED_FILES, ARCHIVE_SEED_TABLES, type ArchiveSeedTable } from "./archive-seed-merge";
import {
  formatLegacyLineupCleanupStats,
  normalizeLegacyLineupRows,
  type LegacyLineupCleanupStats,
} from "./legacy-lineup-cleanups";
import {
  loadLegacyMablDump,
  type LegacyMablBatting,
  type LegacyMablDump,
  type LegacyMablPitching,
  type LegacyMablPlayer,
  type LegacyMablSchedule,
  type LegacyMablTeam,
  type LegacyMablTeamSeason,
} from "./legacy-mabl-sql-dump";

const LEGACY_MABL_SEASONS = [2008, 2009, 2010] as const;
const LEGACY_SOURCE_FILE = "raw/jaxmabl.sql";

type LegacyMablSeedLog = {
  level: "info" | "warn";
  message: string;
};

type SeedRow = Record<string, unknown>;
type SeedTables = Record<ArchiveSeedTable, SeedRow[]>;
type ImportedLegacyMablBatting = LegacyMablBatting & { teamid: number };
type ImportedLegacyMablPitching = LegacyMablPitching & { teamid: number };

type GenerateLegacyMablSeedsOptions = {
  sqlPath?: string;
};

type ImportContext = {
  dump: LegacyMablDump;
  schedulesByGameId: Map<number, LegacyMablSchedule>;
  teamsById: Map<number, LegacyMablTeam>;
  teamSeasonsBySeasonTeamId: Map<string, LegacyMablTeamSeason>;
  playersById: Map<number, LegacyMablPlayer>;
  positionsById: Map<number, string>;
  importedSchedules: LegacyMablSchedule[];
  importedGameIds: Set<number>;
  battingByImportedGame: ImportedLegacyMablBatting[];
  pitchingByImportedGame: ImportedLegacyMablPitching[];
  battingRowsWithLineup: ReturnType<typeof normalizeLegacyLineupRows<ImportedLegacyMablBatting>>["rows"];
  warnings: string[];
};

type BattingAggregate = {
  scope: "league" | "team";
  seasonId: number;
  teamId: number | null;
  sourceTeamName: string | null;
  playerId: number;
  playerName: string;
  jersey: string | null;
  atBats: number;
  runs: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  runsBattedIn: number;
  walks: number;
  hitByPitch: number;
  strikeouts: number;
  sacrificeFlies: number;
  sacrificeBunts: number;
  stolenBases: number;
  caughtStealing: number;
};

type PitchingAggregate = {
  scope: "league" | "team";
  seasonId: number;
  teamId: number | null;
  sourceTeamName: string | null;
  playerId: number;
  playerName: string;
  jersey: string | null;
  wins: number;
  losses: number;
  outs: number;
  runs: number;
  earnedRuns: number;
  hits: number;
  walks: number;
  strikeouts: number;
  battersFaced: number;
  games: number;
  gamesStarted: number;
  completeGames: number;
  completeGameLosses: number;
  saves: number;
  blownSaves: number;
  hitByPitch: number;
};

export async function generateLegacyMablSeeds(
  outDir: string,
  onLog: (log: LegacyMablSeedLog) => void,
  options: GenerateLegacyMablSeedsOptions = {},
) {
  const sqlPath = options.sqlPath ?? path.join(outDir, LEGACY_SOURCE_FILE);
  if (!(await pathExists(sqlPath))) {
    onLog({ level: "info", message: `No legacy MABL SQL dump found at ${sqlPath}; skipping legacy seed generation.` });
    return;
  }

  const dump = await loadLegacyMablDump(sqlPath);
  const context = buildContext(dump);
  const tablesBySeason = new Map<number, SeedTables>();

  for (const seasonId of LEGACY_MABL_SEASONS) {
    const tables = buildEmptySeedTables();
    tables.players.push(...buildPlayerRows(context, seasonId));
    tables.teams.push(...buildTeamRows(context, seasonId));
    tables.rosters.push(...buildRosterRows(context, seasonId));
    tables.games.push(...buildGameRows(context, seasonId));
    tables.lineups.push(...buildLineupRows(context, seasonId));
    tables.batting_stats.push(...buildBattingRows(context, seasonId));
    tables.pitching_stats.push(...buildPitchingRows(context, seasonId));
    tables.innings.push(...buildInningRows(context, seasonId));
    tables.standings.push(...buildStandingRows(context, seasonId));

    const seasonBattingStats = buildSeasonBattingStats(context, seasonId);
    const seasonPitchingStats = buildSeasonPitchingStats(context, seasonId);
    tables.season_batting_stats.push(...seasonBattingStats);
    tables.season_pitching_stats.push(...seasonPitchingStats);
    tables.season_batting_leaders.push(...buildSeasonBattingLeaders(seasonBattingStats, tables.standings));
    tables.season_pitching_leaders.push(...buildSeasonPitchingLeaders(seasonPitchingStats, tables.standings));

    await writeSeasonSeedTables(outDir, seasonId, tables);
    tablesBySeason.set(seasonId, tables);
  }

  onLog({
    level: "info",
    message: `Generated legacy MABL seed bundles for ${LEGACY_MABL_SEASONS.join(", ")} from ${path.relative(outDir, sqlPath)}.`,
  });
  onLog({
    level: "info",
    message: formatLegacyLineupCleanupStats(context.lineupCleanupStats),
  });
  for (const warning of context.warnings) {
    onLog({ level: "warn", message: warning });
  }

  return { seasons: [...tablesBySeason.keys()], tablesBySeason };
}

function buildContext(dump: LegacyMablDump): ImportContext & { lineupCleanupStats: LegacyLineupCleanupStats } {
  const schedulesByGameId = mapBy(dump.schedules, (row) => row.gameid);
  const teamsById = mapBy(dump.teams, (row) => row.teamid);
  const playersById = mapBy(dump.players, (row) => row.id);
  const positionsById = new Map(
    dump.positions.map((position) => [position.id, position.abbr === "__" ? "" : (position.abbr ?? "")]),
  );
  const teamSeasonsBySeasonTeamId = new Map(
    dump.teamSeasons.map((teamSeason) => [seasonTeamKey(teamSeason.season, teamSeason.teamid), teamSeason]),
  );
  const importedSchedules = dump.schedules
    .filter((schedule) => LEGACY_MABL_SEASONS.includes(schedule.season as (typeof LEGACY_MABL_SEASONS)[number]))
    .sort((left, right) => left.season - right.season || left.gameid - right.gameid);
  const importedGameIds = new Set(importedSchedules.map((schedule) => schedule.gameid));
  const battingByImportedGame = dump.batting.filter(
    (row): row is ImportedLegacyMablBatting => importedGameIds.has(row.gameid) && row.teamid != null,
  );
  const pitchingByImportedGame = dump.pitching.filter(
    (row): row is ImportedLegacyMablPitching => importedGameIds.has(row.gameid) && row.teamid != null,
  );
  const normalizedLineups = normalizeLegacyLineupRows(battingByImportedGame);
  const warnings: string[] = [];

  const skippedBatting = dump.batting.length - battingByImportedGame.length;
  const skippedPitching = dump.pitching.length - pitchingByImportedGame.length;
  if (skippedBatting > 0) {
    warnings.push(`Skipped ${skippedBatting} legacy batting rows whose games are not in imported regular seasons.`);
  }
  if (skippedPitching > 0) {
    warnings.push(`Skipped ${skippedPitching} legacy pitching rows whose games are not in imported regular seasons.`);
  }

  return {
    dump,
    schedulesByGameId,
    teamsById,
    teamSeasonsBySeasonTeamId,
    playersById,
    positionsById,
    importedSchedules,
    importedGameIds,
    battingByImportedGame,
    pitchingByImportedGame,
    battingRowsWithLineup: normalizedLineups.rows,
    lineupCleanupStats: normalizedLineups.stats,
    warnings,
  };
}

function buildEmptySeedTables(): SeedTables {
  return Object.fromEntries(ARCHIVE_SEED_TABLES.map((table) => [table, []])) as unknown as SeedTables;
}

function buildPlayerRows(context: ImportContext, seasonId: number): SeedRow[] {
  const playerIds = new Set<number>();
  for (const roster of context.dump.playerTeams) {
    if (roster.season === seasonId && roster.deleted !== 1) {
      playerIds.add(roster.playerid);
    }
  }
  for (const row of context.battingByImportedGame) {
    if (context.schedulesByGameId.get(row.gameid)?.season === seasonId) {
      playerIds.add(row.playerid);
    }
  }
  for (const row of context.pitchingByImportedGame) {
    if (context.schedulesByGameId.get(row.gameid)?.season === seasonId) {
      playerIds.add(row.playerid);
    }
  }

  return [...playerIds]
    .sort((left, right) => left - right)
    .map((playerId) => ({
      player_id: playerId,
      name: playerName(context.playersById.get(playerId), playerId),
    }));
}

function buildTeamRows(context: ImportContext, seasonId: number): SeedRow[] {
  const teamIds = new Set<number>();
  for (const teamSeason of context.dump.teamSeasons) {
    if (teamSeason.season === seasonId) {
      teamIds.add(teamSeason.teamid);
    }
  }
  for (const schedule of context.importedSchedules) {
    if (schedule.season === seasonId) {
      if (schedule.home_team != null) teamIds.add(schedule.home_team);
      if (schedule.away_team != null) teamIds.add(schedule.away_team);
    }
  }

  return [...teamIds]
    .sort((left, right) => left - right)
    .map((teamId) => {
      const team = context.teamsById.get(teamId);
      const seasonNames = uniqueStrings(
        context.dump.teamSeasons.filter((row) => row.teamid === teamId).map((row) => row.teamname),
      );
      const currentName = team?.name ?? seasonNames[seasonNames.length - 1] ?? `Team ${teamId}`;
      return {
        team_id: teamId,
        season_team_id: teamId,
        league_id: null,
        name: currentName,
        short_name: team?.abbr ?? null,
        former_names: seasonNames.filter((name) => name !== currentName),
        season_season_team_ids: [teamId],
      };
    });
}

function buildRosterRows(context: ImportContext, seasonId: number): SeedRow[] {
  return context.dump.playerTeams
    .filter((row) => row.season === seasonId && row.deleted !== 1)
    .sort((left, right) => left.teamid - right.teamid || left.playerid - right.playerid)
    .map((row) => {
      const player = context.playersById.get(row.playerid);
      return {
        league_id: null,
        season_id: seasonId,
        team_id: row.teamid,
        season_team_id: row.teamid,
        team_name: teamSeasonName(context, seasonId, row.teamid),
        player_id: row.playerid,
        player_season_id: null,
        first_name: player?.firstname ?? null,
        last_name: player?.lastname ?? null,
        name: playerName(player, row.playerid),
        position: player?.position ?? null,
        jersey: player?.number ?? null,
        height: null,
        weight: null,
        birthdate: player?.dob ?? null,
        bats: player?.bats ?? null,
        throws: player?.throws ?? null,
        status: null,
        hometown: player?.hometown ?? null,
        photo_url: player?.pic ?? null,
      };
    });
}

function buildGameRows(context: ImportContext, seasonId: number): SeedRow[] {
  return context.importedSchedules
    .filter((schedule) => schedule.season === seasonId)
    .map((schedule) => {
      const result = gameResult(schedule);
      return {
        game_id: schedule.gameid,
        league_id: null,
        season_id: seasonId,
        scheduled_at: schedule.date,
        status: gameStatus(schedule),
        home_team_id: schedule.home_team,
        away_team_id: schedule.away_team,
        home_season_team_id: schedule.home_team,
        away_season_team_id: schedule.away_team,
        home_score: schedule.home_score,
        away_score: schedule.away_score,
        is_tie: result.isTie,
        winner_team_id: result.winnerTeamId,
        loser_team_id: result.loserTeamId,
        winner_season_team_id: result.winnerTeamId,
        loser_season_team_id: result.loserTeamId,
        raw_xml_file: `raw/jaxmabl.sql:mabl_Schedule:${schedule.gameid}`,
      };
    });
}

function buildLineupRows(context: ImportContext, seasonId: number): SeedRow[] {
  return context.battingRowsWithLineup
    .filter((row) => context.schedulesByGameId.get(row.gameid)?.season === seasonId)
    .map((row) => {
      const schedule = context.schedulesByGameId.get(row.gameid);
      const player = context.playersById.get(row.playerid);
      return {
        game_id: row.gameid,
        season_id: seasonId,
        team_id: row.teamid,
        season_team_id: row.teamid,
        is_home: schedule?.home_team === row.teamid,
        player_id: row.playerid,
        name: playerName(player, row.playerid),
        jersey: player?.number ?? null,
        position: positionName(context, row.position),
        order_idx: row.batting_order,
        source_batting_order: row.source_batting_order,
        source_batting_order_slot: row.source_batting_order_slot,
        batting_order: row.batting_order,
        batting_order_modifier: row.batting_order_modifier,
      };
    });
}

function buildBattingRows(context: ImportContext, seasonId: number): SeedRow[] {
  return context.battingRowsWithLineup
    .filter((row) => context.schedulesByGameId.get(row.gameid)?.season === seasonId)
    .map((row) => {
      const schedule = context.schedulesByGameId.get(row.gameid);
      return {
        game_id: row.gameid,
        season_id: seasonId,
        team_id: row.teamid,
        season_team_id: row.teamid,
        is_home: schedule?.home_team === row.teamid,
        player_id: row.playerid,
        jersey: context.playersById.get(row.playerid)?.number ?? null,
        position: positionName(context, row.position),
        ab: stat(row.ab),
        runs: stat(row.runs),
        hits: stat(row.hits),
        doubles: stat(row.doubles),
        triples: stat(row.triples),
        hr: stat(row.hr),
        rbi: stat(row.rbi),
        bb: stat(row.bb),
        so: stat(row.so),
        sb: stat(row.sb),
        caught_stealing: stat(row.cs),
        hit_by_pitch: stat(row.hbp),
        sacrifice_flies: stat(row.sacfly),
        sacrifice_bunts: stat(row.sacbunt),
        avg: battingAverage(stat(row.hits), stat(row.ab)),
        source_batting_order: row.source_batting_order,
        source_batting_order_slot: row.source_batting_order_slot,
        batting_order: row.batting_order,
        batting_order_modifier: row.batting_order_modifier,
      };
    });
}

function buildPitchingRows(context: ImportContext, seasonId: number): SeedRow[] {
  return context.pitchingByImportedGame
    .filter((row) => context.schedulesByGameId.get(row.gameid)?.season === seasonId)
    .sort(
      (left, right) => left.gameid - right.gameid || stat(left.ord) - stat(right.ord) || left.playerid - right.playerid,
    )
    .map((row) => {
      const schedule = context.schedulesByGameId.get(row.gameid);
      const outs = pitchingOuts(row);
      return {
        game_id: row.gameid,
        season_id: seasonId,
        team_id: row.teamid,
        season_team_id: row.teamid,
        is_home: schedule?.home_team === row.teamid,
        player_id: row.playerid,
        jersey: context.playersById.get(row.playerid)?.number ?? null,
        pitching_order: row.ord,
        ip: inningsDisplay(outs),
        hits: stat(row.hits),
        runs: stat(row.runs),
        earned_runs: stat(row.earned),
        doubles_allowed: stat(row.doubles),
        triples_allowed: stat(row.triples),
        home_runs_allowed: stat(row.hr),
        bb: stat(row.bb),
        so: stat(row.so),
        hit_by_pitch: stat(row.hbp),
        win: row.win === 1,
        loss: row.loss === 1,
        save: row.sv === 1,
        blown_save: row.blown === 1,
        complete_game: row.complete === 1,
        batters_faced: stat(row.atbats) + stat(row.bb) + stat(row.hbp),
        pitches: row.pitches,
        era: era(stat(row.earned), outs),
      };
    });
}

function buildInningRows(context: ImportContext, seasonId: number): SeedRow[] {
  const battingHitsByGameTeam = new Map<string, number>();
  for (const row of context.battingByImportedGame) {
    const schedule = context.schedulesByGameId.get(row.gameid);
    if (schedule?.season !== seasonId || row.teamid == null) continue;
    const key = gameTeamKey(row.gameid, row.teamid);
    battingHitsByGameTeam.set(key, (battingHitsByGameTeam.get(key) ?? 0) + stat(row.hits));
  }

  return context.dump.innings
    .filter((row) => context.schedulesByGameId.get(row.gameid)?.season === seasonId)
    .flatMap((row) => {
      const schedule = context.schedulesByGameId.get(row.gameid);
      if (!schedule) return [];
      return [
        {
          game_id: row.gameid,
          season_id: seasonId,
          team_id: schedule.away_team,
          season_team_id: schedule.away_team,
          is_home: false,
          inning_number: row.inning,
          runs: row.away_score,
          total_runs: schedule.away_score,
          total_hits:
            schedule.away_team == null
              ? null
              : (battingHitsByGameTeam.get(gameTeamKey(row.gameid, schedule.away_team)) ?? 0),
          total_errors: schedule.away_errors,
        },
        {
          game_id: row.gameid,
          season_id: seasonId,
          team_id: schedule.home_team,
          season_team_id: schedule.home_team,
          is_home: true,
          inning_number: row.inning,
          runs: row.home_score,
          total_runs: schedule.home_score,
          total_hits:
            schedule.home_team == null
              ? null
              : (battingHitsByGameTeam.get(gameTeamKey(row.gameid, schedule.home_team)) ?? 0),
          total_errors: schedule.home_errors,
        },
      ];
    });
}

function buildStandingRows(context: ImportContext, seasonId: number): SeedRow[] {
  const standings = new Map<number, { wins: number; losses: number; ties: number }>();
  for (const teamSeason of context.dump.teamSeasons) {
    if (teamSeason.season === seasonId) {
      standings.set(teamSeason.teamid, { wins: 0, losses: 0, ties: 0 });
    }
  }

  for (const schedule of context.importedSchedules) {
    if (schedule.season !== seasonId || !hasScore(schedule) || schedule.cancelled === 1 || schedule.ppt === 1) {
      continue;
    }
    if (schedule.home_team == null || schedule.away_team == null) {
      continue;
    }
    const home = standings.get(schedule.home_team) ?? { wins: 0, losses: 0, ties: 0 };
    const away = standings.get(schedule.away_team) ?? { wins: 0, losses: 0, ties: 0 };
    standings.set(schedule.home_team, home);
    standings.set(schedule.away_team, away);

    if (schedule.home_score === schedule.away_score) {
      home.ties += 1;
      away.ties += 1;
    } else if ((schedule.home_score ?? 0) > (schedule.away_score ?? 0)) {
      home.wins += 1;
      away.losses += 1;
    } else {
      away.wins += 1;
      home.losses += 1;
    }
  }

  return [...standings.entries()]
    .sort(([left], [right]) => left - right)
    .map(([teamId, record]) => {
      const gamesPlayed = record.wins + record.losses + record.ties;
      return {
        league_id: null,
        season_id: seasonId,
        team_id: teamId,
        season_team_id: teamId,
        name: teamSeasonName(context, seasonId, teamId),
        games_played: gamesPlayed,
        wins: record.wins,
        losses: record.losses,
        ties: record.ties,
        pct: gamesPlayed === 0 ? ".000" : baseballDecimal((record.wins + record.ties * 0.5) / gamesPlayed),
      };
    });
}

function buildSeasonBattingStats(context: ImportContext, seasonId: number): SeedRow[] {
  const aggregates = new Map<string, BattingAggregate>();
  for (const row of context.battingByImportedGame) {
    const schedule = context.schedulesByGameId.get(row.gameid);
    if (schedule?.season !== seasonId || row.teamid == null) continue;
    addBattingAggregate(context, aggregates, "team", seasonId, row.teamid, row);
    addBattingAggregate(context, aggregates, "league", seasonId, null, row);
  }
  return [...aggregates.values()].sort(compareAggregateRows).map(battingAggregateToSeedRow);
}

function buildSeasonPitchingStats(context: ImportContext, seasonId: number): SeedRow[] {
  const aggregates = new Map<string, PitchingAggregate>();
  for (const row of context.pitchingByImportedGame) {
    const schedule = context.schedulesByGameId.get(row.gameid);
    if (schedule?.season !== seasonId || row.teamid == null) continue;
    addPitchingAggregate(context, aggregates, "team", seasonId, row.teamid, row);
    addPitchingAggregate(context, aggregates, "league", seasonId, null, row);
  }
  return [...aggregates.values()].sort(compareAggregateRows).map(pitchingAggregateToSeedRow);
}

function buildSeasonBattingLeaders(seasonBattingStats: SeedRow[], standingsRows: SeedRow[]): SeedRow[] {
  const standingGames = standingGamesMap(standingsRows);
  const output: SeedRow[] = [];
  for (const scope of ["league", "team"] as const) {
    const teamIds = scope === "league" ? [null] : uniqueNumbers(seasonBattingStats.map((row) => row.team_id));
    for (const teamId of teamIds) {
      const rows = seasonBattingStats.filter(
        (row) => row.scope === scope && (scope === "league" || row.team_id === teamId),
      );
      addLeaderRows(output, rows, "avr", "batting_average", "desc", (row) => {
        const games =
          scope === "team" && typeof teamId === "number"
            ? (standingGames.get(teamId) ?? 0)
            : maxStandingGames(standingGames);
        return plateAppearances(row) >= games * 2.7 && stat(row.at_bats) > 0;
      });
      addLeaderRows(output, rows, "hr", "home_runs", "desc");
      addLeaderRows(output, rows, "rbi", "runs_batted_in", "desc");
      addLeaderRows(output, rows, "hits", "hits", "desc");
    }
  }
  return output;
}

function buildSeasonPitchingLeaders(seasonPitchingStats: SeedRow[], standingsRows: SeedRow[]): SeedRow[] {
  const standingGames = standingGamesMap(standingsRows);
  const output: SeedRow[] = [];
  for (const scope of ["league", "team"] as const) {
    const teamIds = scope === "league" ? [null] : uniqueNumbers(seasonPitchingStats.map((row) => row.team_id));
    for (const teamId of teamIds) {
      const rows = seasonPitchingStats.filter(
        (row) => row.scope === scope && (scope === "league" || row.team_id === teamId),
      );
      addLeaderRows(output, rows, "wins", "wins", "desc");
      addLeaderRows(output, rows, "so", "strikeouts", "desc");
      addLeaderRows(output, rows, "era", "era", "asc", (row) => {
        const games =
          scope === "team" && typeof teamId === "number"
            ? (standingGames.get(teamId) ?? 0)
            : maxStandingGames(standingGames);
        return inningsTextToOuts(row.innings_pitched) >= games * 0.8 * 3;
      });
    }
  }
  return output;
}

function addLeaderRows(
  output: SeedRow[],
  rows: SeedRow[],
  category: string,
  column: string,
  direction: "asc" | "desc",
  qualifies: (row: SeedRow) => boolean = () => true,
) {
  rows
    .filter((row) => row.player_id != null && qualifies(row))
    .sort((left, right) => {
      const valueDifference =
        direction === "asc"
          ? numericLeaderValue(left, column) - numericLeaderValue(right, column)
          : numericLeaderValue(right, column) - numericLeaderValue(left, column);
      return valueDifference || String(left.player_name ?? "").localeCompare(String(right.player_name ?? ""));
    })
    .forEach((row, index) => {
      output.push({ ...row, leader_category: category, rank: index + 1 });
    });
}

function addBattingAggregate(
  context: ImportContext,
  aggregates: Map<string, BattingAggregate>,
  scope: "league" | "team",
  seasonId: number,
  teamId: number | null,
  row: LegacyMablBatting,
) {
  const aggregate = getBattingAggregate(context, aggregates, scope, seasonId, teamId, row.playerid);
  aggregate.atBats += stat(row.ab);
  aggregate.runs += stat(row.runs);
  aggregate.hits += stat(row.hits);
  aggregate.doubles += stat(row.doubles);
  aggregate.triples += stat(row.triples);
  aggregate.homeRuns += stat(row.hr);
  aggregate.runsBattedIn += stat(row.rbi);
  aggregate.walks += stat(row.bb);
  aggregate.hitByPitch += stat(row.hbp);
  aggregate.strikeouts += stat(row.so);
  aggregate.sacrificeFlies += stat(row.sacfly);
  aggregate.sacrificeBunts += stat(row.sacbunt);
  aggregate.stolenBases += stat(row.sb);
  aggregate.caughtStealing += stat(row.cs);
}

function addPitchingAggregate(
  context: ImportContext,
  aggregates: Map<string, PitchingAggregate>,
  scope: "league" | "team",
  seasonId: number,
  teamId: number | null,
  row: LegacyMablPitching,
) {
  const aggregate = getPitchingAggregate(context, aggregates, scope, seasonId, teamId, row.playerid);
  const outs = pitchingOuts(row);
  aggregate.wins += row.win === 1 ? 1 : 0;
  aggregate.losses += row.loss === 1 ? 1 : 0;
  aggregate.outs += outs;
  aggregate.runs += stat(row.runs);
  aggregate.earnedRuns += stat(row.earned);
  aggregate.hits += stat(row.hits);
  aggregate.walks += stat(row.bb);
  aggregate.strikeouts += stat(row.so);
  aggregate.battersFaced += stat(row.atbats) + stat(row.bb) + stat(row.hbp);
  aggregate.games += 1;
  aggregate.gamesStarted += row.ord === 1 ? 1 : 0;
  aggregate.completeGames += row.complete === 1 ? 1 : 0;
  aggregate.completeGameLosses += row.complete === 1 && row.loss === 1 ? 1 : 0;
  aggregate.saves += row.sv === 1 ? 1 : 0;
  aggregate.blownSaves += row.blown === 1 ? 1 : 0;
  aggregate.hitByPitch += stat(row.hbp);
}

function getBattingAggregate(
  context: ImportContext,
  aggregates: Map<string, BattingAggregate>,
  scope: "league" | "team",
  seasonId: number,
  teamId: number | null,
  playerId: number,
) {
  const key = [scope, seasonId, teamId ?? "league", playerId].join(":");
  const existing = aggregates.get(key);
  if (existing) return existing;
  const player = context.playersById.get(playerId);
  const aggregate: BattingAggregate = {
    scope,
    seasonId,
    teamId,
    sourceTeamName: teamId == null ? null : teamSeasonName(context, seasonId, teamId),
    playerId,
    playerName: playerName(player, playerId),
    jersey: player?.number ?? null,
    atBats: 0,
    runs: 0,
    hits: 0,
    doubles: 0,
    triples: 0,
    homeRuns: 0,
    runsBattedIn: 0,
    walks: 0,
    hitByPitch: 0,
    strikeouts: 0,
    sacrificeFlies: 0,
    sacrificeBunts: 0,
    stolenBases: 0,
    caughtStealing: 0,
  };
  aggregates.set(key, aggregate);
  return aggregate;
}

function getPitchingAggregate(
  context: ImportContext,
  aggregates: Map<string, PitchingAggregate>,
  scope: "league" | "team",
  seasonId: number,
  teamId: number | null,
  playerId: number,
) {
  const key = [scope, seasonId, teamId ?? "league", playerId].join(":");
  const existing = aggregates.get(key);
  if (existing) return existing;
  const player = context.playersById.get(playerId);
  const aggregate: PitchingAggregate = {
    scope,
    seasonId,
    teamId,
    sourceTeamName: teamId == null ? null : teamSeasonName(context, seasonId, teamId),
    playerId,
    playerName: playerName(player, playerId),
    jersey: player?.number ?? null,
    wins: 0,
    losses: 0,
    outs: 0,
    runs: 0,
    earnedRuns: 0,
    hits: 0,
    walks: 0,
    strikeouts: 0,
    battersFaced: 0,
    games: 0,
    gamesStarted: 0,
    completeGames: 0,
    completeGameLosses: 0,
    saves: 0,
    blownSaves: 0,
    hitByPitch: 0,
  };
  aggregates.set(key, aggregate);
  return aggregate;
}

function battingAggregateToSeedRow(row: BattingAggregate): SeedRow {
  const totalBases = row.hits + row.doubles + row.triples * 2 + row.homeRuns * 3;
  const onBaseDenominator = row.atBats + row.walks + row.hitByPitch + row.sacrificeFlies;
  return {
    scope: row.scope,
    league_id: null,
    season_id: row.seasonId,
    team_id: row.teamId,
    season_team_id: row.teamId,
    source_team_name: row.sourceTeamName,
    player_id: row.playerId,
    player_season_id: null,
    player_name: row.playerName,
    jersey: row.jersey,
    at_bats: row.atBats,
    runs: row.runs,
    hits: row.hits,
    doubles: row.doubles,
    triples: row.triples,
    home_runs: row.homeRuns,
    runs_batted_in: row.runsBattedIn,
    walks: row.walks,
    hit_by_pitch: row.hitByPitch,
    strikeouts: row.strikeouts,
    sacrifice_flies: row.sacrificeFlies,
    sacrifice_bunts: row.sacrificeBunts,
    stolen_bases: row.stolenBases,
    caught_stealing: row.caughtStealing,
    double_plays: null,
    on_base_percentage:
      onBaseDenominator === 0 ? null : baseballDecimal((row.hits + row.walks + row.hitByPitch) / onBaseDenominator),
    slugging_percentage: row.atBats === 0 ? null : baseballDecimal(totalBases / row.atBats),
    batting_average: battingAverage(row.hits, row.atBats),
  };
}

function pitchingAggregateToSeedRow(row: PitchingAggregate): SeedRow {
  return {
    scope: row.scope,
    league_id: null,
    season_id: row.seasonId,
    team_id: row.teamId,
    season_team_id: row.teamId,
    source_team_name: row.sourceTeamName,
    player_id: row.playerId,
    player_season_id: null,
    player_name: row.playerName,
    jersey: row.jersey,
    wins: row.wins,
    losses: row.losses,
    innings_pitched: inningsDisplay(row.outs),
    runs: row.runs,
    earned_runs: row.earnedRuns,
    hits: row.hits,
    walks: row.walks,
    strikeouts: row.strikeouts,
    hit_by_pitch: row.hitByPitch,
    batters_faced: row.battersFaced,
    games: row.games,
    games_started: row.gamesStarted,
    complete_games: row.completeGames,
    complete_game_losses: row.completeGameLosses,
    shutouts: null,
    saves: row.saves,
    blown_saves: row.blownSaves,
    opponent_on_base_percentage: null,
    opponent_slugging_percentage: null,
    opponent_average: null,
    era: era(row.earnedRuns, row.outs),
  };
}

async function writeSeasonSeedTables(outDir: string, seasonId: number, tables: SeedTables) {
  const seasonDir = path.join(outDir, "seeds", String(seasonId));
  await fs.mkdir(seasonDir, { recursive: true });
  for (const table of ARCHIVE_SEED_TABLES) {
    await writeNdjsonFile(path.join(seasonDir, ARCHIVE_SEED_FILES[table]), tables[table]);
  }
}

async function writeNdjsonFile(filePath: string, rows: SeedRow[]) {
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(filePath, body ? `${body}\n` : "");
}

function mapBy<T, K>(values: T[], key: (value: T) => K) {
  return new Map(values.map((value) => [key(value), value]));
}

function teamSeasonName(context: ImportContext, seasonId: number, teamId: number) {
  return (
    context.teamSeasonsBySeasonTeamId.get(seasonTeamKey(seasonId, teamId))?.teamname ??
    context.teamsById.get(teamId)?.name ??
    `Team ${teamId}`
  );
}

function seasonTeamKey(seasonId: number, teamId: number) {
  return `${seasonId}:${teamId}`;
}

function gameTeamKey(gameId: number, teamId: number) {
  return `${gameId}:${teamId}`;
}

function playerName(player: LegacyMablPlayer | undefined, playerId: number) {
  const name = [player?.firstname, player?.lastname].filter(Boolean).join(" ").trim();
  return name || `Player ${playerId}`;
}

function positionName(context: ImportContext, positionId: number | null) {
  if (positionId == null) return null;
  return context.positionsById.get(positionId) || null;
}

function stat(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function hasScore(schedule: LegacyMablSchedule) {
  return schedule.home_score != null && schedule.away_score != null;
}

function gameStatus(schedule: LegacyMablSchedule) {
  if (schedule.cancelled === 1) return "Cancelled";
  if (schedule.ppt === 1) return "Postponed";
  if (hasScore(schedule)) return "Final";
  return "Scheduled";
}

function gameResult(schedule: LegacyMablSchedule) {
  if (
    !hasScore(schedule) ||
    schedule.home_team == null ||
    schedule.away_team == null ||
    schedule.home_score === schedule.away_score
  ) {
    return {
      isTie: hasScore(schedule) && schedule.home_score === schedule.away_score,
      winnerTeamId: null,
      loserTeamId: null,
    };
  }

  const winnerTeamId =
    schedule.winning_team ??
    ((schedule.home_score ?? 0) > (schedule.away_score ?? 0) ? schedule.home_team : schedule.away_team);
  const loserTeamId = winnerTeamId === schedule.home_team ? schedule.away_team : schedule.home_team;
  return { isTie: false, winnerTeamId, loserTeamId };
}

function pitchingOuts(row: LegacyMablPitching) {
  const innings = stat(row.innings);
  const thirds = stat(row.thirdinnings);
  return innings * 3 + (thirds >= 0 && thirds <= 2 ? thirds : 0);
}

function inningsDisplay(outs: number) {
  const whole = Math.trunc(outs / 3);
  const thirds = outs % 3;
  return `${whole}.${thirds}`;
}

function inningsTextToOuts(value: unknown) {
  if (typeof value !== "string") return 0;
  const [whole, thirds = "0"] = value.split(".");
  return stat(Number(whole)) * 3 + stat(Number(thirds));
}

function era(earnedRuns: number, outs: number) {
  return outs <= 0 ? null : ((earnedRuns * 27) / outs).toFixed(2);
}

function battingAverage(hits: number, atBats: number) {
  return atBats <= 0 ? null : baseballDecimal(hits / atBats);
}

function baseballDecimal(value: number) {
  return value.toFixed(3).replace(/^0/, "");
}

function uniqueStrings(values: Array<string | null>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function uniqueNumbers(values: unknown[]) {
  return Array.from(new Set(values.filter((value): value is number => typeof value === "number"))).sort(
    (left, right) => left - right,
  );
}

function compareAggregateRows(left: BattingAggregate | PitchingAggregate, right: BattingAggregate | PitchingAggregate) {
  return (
    left.seasonId - right.seasonId ||
    left.scope.localeCompare(right.scope) ||
    (left.teamId ?? 0) - (right.teamId ?? 0) ||
    left.playerName.localeCompare(right.playerName) ||
    left.playerId - right.playerId
  );
}

function standingGamesMap(standingsRows: SeedRow[]) {
  return new Map(standingsRows.map((row) => [stat(row.team_id), stat(row.games_played)]));
}

function maxStandingGames(standingGames: Map<number, number>) {
  return Math.max(0, ...standingGames.values());
}

function plateAppearances(row: SeedRow) {
  return stat(row.at_bats) + stat(row.walks) + stat(row.hit_by_pitch) + stat(row.sacrifice_flies);
}

function numericLeaderValue(row: SeedRow, column: string) {
  const value = row[column];
  return typeof value === "number" ? value : Number(value ?? 0);
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
