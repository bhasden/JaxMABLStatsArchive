const LEAGUE_LEADER_LIMIT = 10;

const gamePitcherOutsExpression = `
  CASE
    WHEN ip IS NULL OR ip = '' THEN 0
    WHEN instr(ip, '.') > 0 THEN
      CAST(substr(ip, 1, instr(ip, '.') - 1) AS INTEGER) * 3
      + CAST(substr(ip, instr(ip, '.') + 1) AS INTEGER)
    ELSE CAST(ip AS INTEGER) * 3
  END
`;

const officialPlayerGamesCte = `
official_player_games AS (
  SELECT pointstreak_player_id, pointstreak_game_id, season_id
  FROM batting_stats
  WHERE pointstreak_player_id IS NOT NULL
    AND (
      COALESCE(ab, 0) <> 0
      OR COALESCE(runs, 0) <> 0
      OR COALESCE(hits, 0) <> 0
      OR COALESCE(hr, 0) <> 0
      OR COALESCE(rbi, 0) <> 0
      OR COALESCE(bb, 0) <> 0
      OR COALESCE(so, 0) <> 0
      OR COALESCE(sb, 0) <> 0
    )
  UNION
  SELECT pointstreak_player_id, pointstreak_game_id, season_id
  FROM pitching_stats
  WHERE pointstreak_player_id IS NOT NULL
    AND (
      ${gamePitcherOutsExpression} > 0
      OR COALESCE(hits, 0) <> 0
      OR COALESCE(runs, 0) <> 0
      OR COALESCE(earned_runs, 0) <> 0
      OR COALESCE(bb, 0) <> 0
      OR COALESCE(so, 0) <> 0
    )
)
`;

const PLAYER_GAMES_SQL = `
WITH ${officialPlayerGamesCte},
totals AS (
  SELECT
    official_player_games.pointstreak_player_id,
    COALESCE(players.name, official_player_games.pointstreak_player_id) AS player_name,
    COUNT(DISTINCT official_player_games.pointstreak_game_id) AS games_played,
    COUNT(DISTINCT official_player_games.season_id) AS seasons
  FROM official_player_games
  LEFT JOIN players ON players.pointstreak_player_id = official_player_games.pointstreak_player_id
  GROUP BY official_player_games.pointstreak_player_id
)
SELECT
  ROW_NUMBER() OVER (ORDER BY games_played DESC, seasons DESC, player_name) AS rank,
  player_name,
  games_played,
  seasons,
  pointstreak_player_id
FROM totals
ORDER BY rank
LIMIT ${LEAGUE_LEADER_LIMIT};
`;

const PLAYER_SEASONS_SQL = `
WITH ${officialPlayerGamesCte},
totals AS (
  SELECT
    official_player_games.pointstreak_player_id,
    COALESCE(players.name, official_player_games.pointstreak_player_id) AS player_name,
    COUNT(DISTINCT official_player_games.season_id) AS seasons,
    COUNT(DISTINCT official_player_games.pointstreak_game_id) AS games_played
  FROM official_player_games
  LEFT JOIN players ON players.pointstreak_player_id = official_player_games.pointstreak_player_id
  GROUP BY official_player_games.pointstreak_player_id
)
SELECT
  ROW_NUMBER() OVER (ORDER BY seasons DESC, games_played DESC, player_name) AS rank,
  player_name,
  seasons,
  games_played,
  pointstreak_player_id
FROM totals
ORDER BY rank
LIMIT ${LEAGUE_LEADER_LIMIT};
`;

function battingLeaderSql(statColumn: "hits" | "home_runs" | "runs_batted_in" | "stolen_bases" | "walks") {
  return `
WITH season_rows AS (
  SELECT
    season_batting_stats.pointstreak_player_id,
    COALESCE(players.name, season_batting_stats.player_name) AS player_name,
    season_batting_stats.season_id,
    COALESCE(${statColumn}, 0) AS ${statColumn}
  FROM season_batting_stats
  LEFT JOIN players ON players.pointstreak_player_id = season_batting_stats.pointstreak_player_id
  WHERE season_batting_stats.scope = 'league'
    AND season_batting_stats.pointstreak_player_id IS NOT NULL
  UNION ALL
  SELECT
    stats.pointstreak_player_id,
    COALESCE(MAX(players.name), MAX(stats.player_name)) AS player_name,
    stats.season_id,
    SUM(COALESCE(stats.${statColumn}, 0)) AS ${statColumn}
  FROM season_batting_stats stats
  LEFT JOIN players ON players.pointstreak_player_id = stats.pointstreak_player_id
  WHERE stats.scope = 'team'
    AND stats.pointstreak_player_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM season_batting_stats league_stats
      WHERE league_stats.pointstreak_player_id = stats.pointstreak_player_id
        AND league_stats.season_id = stats.season_id
        AND league_stats.scope = 'league'
    )
  GROUP BY stats.pointstreak_player_id, stats.season_id
),
totals AS (
  SELECT
    pointstreak_player_id,
    MAX(player_name) AS player_name,
    SUM(${statColumn}) AS ${statColumn}
  FROM season_rows
  GROUP BY pointstreak_player_id
)
SELECT
  ROW_NUMBER() OVER (ORDER BY ${statColumn} DESC, player_name) AS rank,
  player_name,
  ${statColumn},
  pointstreak_player_id
FROM totals
ORDER BY rank
LIMIT ${LEAGUE_LEADER_LIMIT};
`;
}

const BATTING_AVERAGE_SQL = `
WITH season_rows AS (
  SELECT
    season_batting_stats.pointstreak_player_id,
    COALESCE(players.name, season_batting_stats.player_name) AS player_name,
    season_batting_stats.season_id,
    COALESCE(season_batting_stats.hits, 0) AS hits,
    COALESCE(season_batting_stats.at_bats, 0) AS at_bats
  FROM season_batting_stats
  LEFT JOIN players ON players.pointstreak_player_id = season_batting_stats.pointstreak_player_id
  WHERE season_batting_stats.scope = 'league'
    AND season_batting_stats.pointstreak_player_id IS NOT NULL
  UNION ALL
  SELECT
    stats.pointstreak_player_id,
    COALESCE(MAX(players.name), MAX(stats.player_name)) AS player_name,
    stats.season_id,
    SUM(COALESCE(stats.hits, 0)) AS hits,
    SUM(COALESCE(stats.at_bats, 0)) AS at_bats
  FROM season_batting_stats stats
  LEFT JOIN players ON players.pointstreak_player_id = stats.pointstreak_player_id
  WHERE stats.scope = 'team'
    AND stats.pointstreak_player_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM season_batting_stats league_stats
      WHERE league_stats.pointstreak_player_id = stats.pointstreak_player_id
        AND league_stats.season_id = stats.season_id
        AND league_stats.scope = 'league'
    )
  GROUP BY stats.pointstreak_player_id, stats.season_id
),
totals AS (
  SELECT
    season_rows.pointstreak_player_id,
    MAX(season_rows.player_name) AS player_name,
    SUM(season_rows.hits) AS hits,
    SUM(season_rows.at_bats) AS at_bats
  FROM season_rows
  GROUP BY season_rows.pointstreak_player_id
),
qualified AS (
  SELECT
    pointstreak_player_id,
    player_name,
    hits,
    at_bats,
    printf('%.3f', CAST(hits AS REAL) / at_bats) AS batting_average
  FROM totals
  WHERE at_bats >= 300
)
SELECT
  ROW_NUMBER() OVER (ORDER BY CAST(hits AS REAL) / at_bats DESC, at_bats DESC, player_name) AS rank,
  player_name,
  batting_average,
  at_bats,
  pointstreak_player_id
FROM qualified
ORDER BY rank
LIMIT ${LEAGUE_LEADER_LIMIT};
`;

const pitcherOutsExpression = `
  CASE
    WHEN innings_pitched IS NULL OR innings_pitched = '' THEN 0
    WHEN instr(innings_pitched, '.') > 0 THEN
      CAST(substr(innings_pitched, 1, instr(innings_pitched, '.') - 1) AS INTEGER) * 3
      + CAST(substr(innings_pitched, instr(innings_pitched, '.') + 1) AS INTEGER)
    ELSE CAST(innings_pitched AS INTEGER) * 3
  END
`;

function pitchingLeaderSql(statColumn: "wins" | "strikeouts" | "saves" | "complete_games") {
  return `
WITH team_rows AS (
  SELECT
    stats.pointstreak_player_id,
    stats.season_id,
    COALESCE(MAX(players.name), MAX(stats.player_name)) AS player_name,
    SUM(COALESCE(stats.${statColumn}, 0)) AS ${statColumn}
  FROM season_pitching_stats stats
  LEFT JOIN players ON players.pointstreak_player_id = stats.pointstreak_player_id
  WHERE stats.scope = 'team'
    AND stats.pointstreak_player_id IS NOT NULL
  GROUP BY stats.pointstreak_player_id, stats.season_id
),
league_rows AS (
  SELECT
    season_pitching_stats.pointstreak_player_id,
    season_pitching_stats.season_id,
    COALESCE(players.name, season_pitching_stats.player_name) AS player_name,
    COALESCE(${statColumn}, 0) AS ${statColumn}
  FROM season_pitching_stats
  LEFT JOIN players ON players.pointstreak_player_id = season_pitching_stats.pointstreak_player_id
  WHERE season_pitching_stats.scope = 'league'
    AND season_pitching_stats.pointstreak_player_id IS NOT NULL
),
season_keys AS (
  SELECT pointstreak_player_id, season_id FROM league_rows
  UNION
  SELECT pointstreak_player_id, season_id FROM team_rows
),
season_totals AS (
  SELECT
    season_keys.pointstreak_player_id,
    COALESCE(league_rows.player_name, team_rows.player_name) AS player_name,
    COALESCE(league_rows.${statColumn}, team_rows.${statColumn}, 0) AS ${statColumn}
  FROM season_keys
  LEFT JOIN league_rows
    ON league_rows.pointstreak_player_id = season_keys.pointstreak_player_id
   AND league_rows.season_id = season_keys.season_id
  LEFT JOIN team_rows
    ON team_rows.pointstreak_player_id = season_keys.pointstreak_player_id
   AND team_rows.season_id = season_keys.season_id
),
totals AS (
  SELECT
    pointstreak_player_id,
    MAX(player_name) AS player_name,
    SUM(${statColumn}) AS ${statColumn}
  FROM season_totals
  GROUP BY pointstreak_player_id
)
SELECT
  ROW_NUMBER() OVER (ORDER BY ${statColumn} DESC, player_name) AS rank,
  player_name,
  ${statColumn},
  pointstreak_player_id
FROM totals
ORDER BY rank
LIMIT ${LEAGUE_LEADER_LIMIT};
`;
}

const PITCHING_ERA_SQL = `
WITH team_rows AS (
  SELECT
    stats.pointstreak_player_id,
    stats.season_id,
    COALESCE(MAX(players.name), MAX(stats.player_name)) AS player_name,
    SUM(COALESCE(stats.earned_runs, 0)) AS earned_runs,
    SUM(${pitcherOutsExpression}) AS outs
  FROM season_pitching_stats stats
  LEFT JOIN players ON players.pointstreak_player_id = stats.pointstreak_player_id
  WHERE stats.scope = 'team'
    AND stats.pointstreak_player_id IS NOT NULL
  GROUP BY stats.pointstreak_player_id, stats.season_id
),
league_rows AS (
  SELECT
    season_pitching_stats.pointstreak_player_id,
    season_pitching_stats.season_id,
    COALESCE(players.name, season_pitching_stats.player_name) AS player_name,
    COALESCE(season_pitching_stats.earned_runs, 0) AS earned_runs,
    ${pitcherOutsExpression} AS outs
  FROM season_pitching_stats
  LEFT JOIN players ON players.pointstreak_player_id = season_pitching_stats.pointstreak_player_id
  WHERE season_pitching_stats.scope = 'league'
    AND season_pitching_stats.pointstreak_player_id IS NOT NULL
),
season_keys AS (
  SELECT pointstreak_player_id, season_id FROM league_rows
  UNION
  SELECT pointstreak_player_id, season_id FROM team_rows
),
season_totals AS (
  SELECT
    season_keys.pointstreak_player_id,
    season_keys.season_id,
    COALESCE(league_rows.player_name, team_rows.player_name) AS player_name,
    COALESCE(league_rows.earned_runs, team_rows.earned_runs, 0) AS earned_runs,
    COALESCE(league_rows.outs, team_rows.outs, 0) AS outs
  FROM season_keys
  LEFT JOIN league_rows
    ON league_rows.pointstreak_player_id = season_keys.pointstreak_player_id
   AND league_rows.season_id = season_keys.season_id
  LEFT JOIN team_rows
    ON team_rows.pointstreak_player_id = season_keys.pointstreak_player_id
   AND team_rows.season_id = season_keys.season_id
),
totals AS (
  SELECT
    season_totals.pointstreak_player_id,
    MAX(season_totals.player_name) AS player_name,
    SUM(season_totals.earned_runs) AS earned_runs,
    SUM(season_totals.outs) AS outs
  FROM season_totals
  GROUP BY season_totals.pointstreak_player_id
),
qualified AS (
  SELECT
    pointstreak_player_id,
    player_name,
    earned_runs,
    outs,
    printf('%.2f', earned_runs * 27.0 / outs) AS era,
    CAST(outs / 3 AS INTEGER) || '.' || (outs % 3) AS innings_pitched
  FROM totals
  WHERE outs >= 300
)
SELECT
  ROW_NUMBER() OVER (ORDER BY earned_runs * 27.0 / outs ASC, outs DESC, player_name) AS rank,
  player_name,
  era,
  innings_pitched,
  pointstreak_player_id
FROM qualified
ORDER BY rank
LIMIT ${LEAGUE_LEADER_LIMIT};
`;

const PITCHING_INNINGS_SQL = `
WITH team_rows AS (
  SELECT
    stats.pointstreak_player_id,
    stats.season_id,
    COALESCE(MAX(players.name), MAX(stats.player_name)) AS player_name,
    SUM(${pitcherOutsExpression}) AS outs
  FROM season_pitching_stats stats
  LEFT JOIN players ON players.pointstreak_player_id = stats.pointstreak_player_id
  WHERE stats.scope = 'team'
    AND stats.pointstreak_player_id IS NOT NULL
  GROUP BY stats.pointstreak_player_id, stats.season_id
),
league_rows AS (
  SELECT
    season_pitching_stats.pointstreak_player_id,
    season_pitching_stats.season_id,
    COALESCE(players.name, season_pitching_stats.player_name) AS player_name,
    ${pitcherOutsExpression} AS outs
  FROM season_pitching_stats
  LEFT JOIN players ON players.pointstreak_player_id = season_pitching_stats.pointstreak_player_id
  WHERE season_pitching_stats.scope = 'league'
    AND season_pitching_stats.pointstreak_player_id IS NOT NULL
),
season_keys AS (
  SELECT pointstreak_player_id, season_id FROM league_rows
  UNION
  SELECT pointstreak_player_id, season_id FROM team_rows
),
season_totals AS (
  SELECT
    season_keys.pointstreak_player_id,
    COALESCE(league_rows.player_name, team_rows.player_name) AS player_name,
    COALESCE(league_rows.outs, team_rows.outs, 0) AS outs
  FROM season_keys
  LEFT JOIN league_rows
    ON league_rows.pointstreak_player_id = season_keys.pointstreak_player_id
   AND league_rows.season_id = season_keys.season_id
  LEFT JOIN team_rows
    ON team_rows.pointstreak_player_id = season_keys.pointstreak_player_id
   AND team_rows.season_id = season_keys.season_id
),
totals AS (
  SELECT
    pointstreak_player_id,
    MAX(player_name) AS player_name,
    SUM(outs) AS outs
  FROM season_totals
  GROUP BY pointstreak_player_id
)
SELECT
  ROW_NUMBER() OVER (ORDER BY outs DESC, player_name) AS rank,
  player_name,
  CAST(outs / 3 AS INTEGER) || '.' || (outs % 3) AS innings_pitched,
  pointstreak_player_id
FROM totals
ORDER BY rank
LIMIT ${LEAGUE_LEADER_LIMIT};
`;

export type LeagueLeaderTableDefinition = {
  title: string;
  label: string;
  sql: string;
};

export const LEAGUE_LONGEVITY_LEADER_TABLES: LeagueLeaderTableDefinition[] = [
  { title: "Games Played", label: "League games played leaders", sql: PLAYER_GAMES_SQL },
  { title: "Seasons Played", label: "League seasons played leaders", sql: PLAYER_SEASONS_SQL },
];

export const LEAGUE_BATTING_LEADER_TABLES: LeagueLeaderTableDefinition[] = [
  { title: "Average", label: "League career batting average leaders", sql: BATTING_AVERAGE_SQL },
  { title: "Hits", label: "League hits leaders", sql: battingLeaderSql("hits") },
  { title: "Home Runs", label: "League home run leaders", sql: battingLeaderSql("home_runs") },
  { title: "RBI", label: "League RBI leaders", sql: battingLeaderSql("runs_batted_in") },
  { title: "Stolen Bases", label: "League stolen base leaders", sql: battingLeaderSql("stolen_bases") },
  { title: "Walks", label: "League walks leaders", sql: battingLeaderSql("walks") },
];

export const LEAGUE_PITCHING_LEADER_TABLES: LeagueLeaderTableDefinition[] = [
  { title: "ERA", label: "League career ERA leaders", sql: PITCHING_ERA_SQL },
  { title: "Pitching Wins", label: "League pitching wins leaders", sql: pitchingLeaderSql("wins") },
  { title: "Pitching Strikeouts", label: "League pitching strikeout leaders", sql: pitchingLeaderSql("strikeouts") },
  { title: "Innings Pitched", label: "League innings pitched leaders", sql: PITCHING_INNINGS_SQL },
  { title: "Complete Games", label: "League complete game leaders", sql: pitchingLeaderSql("complete_games") },
  { title: "Saves", label: "League saves leaders", sql: pitchingLeaderSql("saves") },
];

export const PLAYER_LOOKUP_SQL = `
SELECT
  players.pointstreak_player_id,
  players.name AS player_name
FROM players
WHERE players.pointstreak_player_id IN (
  SELECT pointstreak_player_id FROM lineups WHERE pointstreak_player_id IS NOT NULL
  UNION
  SELECT pointstreak_player_id FROM batting_stats WHERE pointstreak_player_id IS NOT NULL
  UNION
  SELECT pointstreak_player_id FROM pitching_stats WHERE pointstreak_player_id IS NOT NULL
  UNION
  SELECT pointstreak_player_id FROM season_batting_stats WHERE pointstreak_player_id IS NOT NULL
  UNION
  SELECT pointstreak_player_id FROM season_pitching_stats WHERE pointstreak_player_id IS NOT NULL
)
ORDER BY player_name, pointstreak_player_id;
`;

export function buildLeaguePlayerRankSql(playerId?: number | null) {
  if (playerId == null) {
    return `
SELECT
  NULL AS leader_group,
  NULL AS category,
  NULL AS rank,
  NULL AS value,
  NULL AS qualified,
  NULL AS qualification
WHERE 0;
`;
  }

  return `
WITH selected_player AS (
  SELECT ${playerId} AS pointstreak_player_id
),
${officialPlayerGamesCte},
game_totals AS (
  SELECT
    official_player_games.pointstreak_player_id,
    COALESCE(players.name, official_player_games.pointstreak_player_id) AS player_name,
    COUNT(DISTINCT official_player_games.pointstreak_game_id) AS games_played,
    COUNT(DISTINCT official_player_games.season_id) AS seasons
  FROM official_player_games
  LEFT JOIN players ON players.pointstreak_player_id = official_player_games.pointstreak_player_id
  GROUP BY official_player_games.pointstreak_player_id
),
batting_season_rows AS (
  SELECT
    season_batting_stats.pointstreak_player_id,
    COALESCE(players.name, season_batting_stats.player_name) AS player_name,
    season_batting_stats.season_id,
    COALESCE(season_batting_stats.hits, 0) AS hits,
    COALESCE(season_batting_stats.home_runs, 0) AS home_runs,
    COALESCE(season_batting_stats.runs_batted_in, 0) AS runs_batted_in,
    COALESCE(season_batting_stats.stolen_bases, 0) AS stolen_bases,
    COALESCE(season_batting_stats.walks, 0) AS walks,
    COALESCE(season_batting_stats.at_bats, 0) AS at_bats
  FROM season_batting_stats
  LEFT JOIN players ON players.pointstreak_player_id = season_batting_stats.pointstreak_player_id
  WHERE season_batting_stats.scope = 'league'
    AND season_batting_stats.pointstreak_player_id IS NOT NULL
  UNION ALL
  SELECT
    stats.pointstreak_player_id,
    COALESCE(MAX(players.name), MAX(stats.player_name)) AS player_name,
    stats.season_id,
    SUM(COALESCE(stats.hits, 0)) AS hits,
    SUM(COALESCE(stats.home_runs, 0)) AS home_runs,
    SUM(COALESCE(stats.runs_batted_in, 0)) AS runs_batted_in,
    SUM(COALESCE(stats.stolen_bases, 0)) AS stolen_bases,
    SUM(COALESCE(stats.walks, 0)) AS walks,
    SUM(COALESCE(stats.at_bats, 0)) AS at_bats
  FROM season_batting_stats stats
  LEFT JOIN players ON players.pointstreak_player_id = stats.pointstreak_player_id
  WHERE stats.scope = 'team'
    AND stats.pointstreak_player_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM season_batting_stats league_stats
      WHERE league_stats.pointstreak_player_id = stats.pointstreak_player_id
        AND league_stats.season_id = stats.season_id
        AND league_stats.scope = 'league'
    )
  GROUP BY stats.pointstreak_player_id, stats.season_id
),
batting_totals AS (
  SELECT
    batting_season_rows.pointstreak_player_id,
    MAX(batting_season_rows.player_name) AS player_name,
    SUM(batting_season_rows.hits) AS hits,
    SUM(batting_season_rows.home_runs) AS home_runs,
    SUM(batting_season_rows.runs_batted_in) AS runs_batted_in,
    SUM(batting_season_rows.stolen_bases) AS stolen_bases,
    SUM(batting_season_rows.walks) AS walks,
    SUM(batting_season_rows.at_bats) AS at_bats
  FROM batting_season_rows
  GROUP BY batting_season_rows.pointstreak_player_id
),
pitching_team_rows AS (
  SELECT
    stats.pointstreak_player_id,
    stats.season_id,
    COALESCE(MAX(players.name), MAX(stats.player_name)) AS player_name,
    SUM(COALESCE(stats.wins, 0)) AS wins,
    SUM(COALESCE(stats.strikeouts, 0)) AS strikeouts,
    SUM(COALESCE(stats.saves, 0)) AS saves,
    SUM(COALESCE(stats.complete_games, 0)) AS complete_games,
    SUM(COALESCE(stats.earned_runs, 0)) AS earned_runs,
    SUM(${pitcherOutsExpression}) AS outs
  FROM season_pitching_stats stats
  LEFT JOIN players ON players.pointstreak_player_id = stats.pointstreak_player_id
  WHERE stats.scope = 'team'
    AND stats.pointstreak_player_id IS NOT NULL
  GROUP BY stats.pointstreak_player_id, stats.season_id
),
pitching_league_rows AS (
  SELECT
    season_pitching_stats.pointstreak_player_id,
    season_pitching_stats.season_id,
    COALESCE(players.name, season_pitching_stats.player_name) AS player_name,
    COALESCE(season_pitching_stats.wins, 0) AS wins,
    COALESCE(season_pitching_stats.strikeouts, 0) AS strikeouts,
    COALESCE(season_pitching_stats.saves, 0) AS saves,
    COALESCE(season_pitching_stats.complete_games, 0) AS complete_games,
    COALESCE(season_pitching_stats.earned_runs, 0) AS earned_runs,
    ${pitcherOutsExpression} AS outs
  FROM season_pitching_stats
  LEFT JOIN players ON players.pointstreak_player_id = season_pitching_stats.pointstreak_player_id
  WHERE season_pitching_stats.scope = 'league'
    AND season_pitching_stats.pointstreak_player_id IS NOT NULL
),
pitching_season_keys AS (
  SELECT pointstreak_player_id, season_id FROM pitching_league_rows
  UNION
  SELECT pointstreak_player_id, season_id FROM pitching_team_rows
),
pitching_season_totals AS (
  SELECT
    pitching_season_keys.pointstreak_player_id,
    pitching_season_keys.season_id,
    COALESCE(pitching_league_rows.player_name, pitching_team_rows.player_name) AS player_name,
    COALESCE(pitching_league_rows.wins, pitching_team_rows.wins, 0) AS wins,
    COALESCE(pitching_league_rows.strikeouts, pitching_team_rows.strikeouts, 0) AS strikeouts,
    COALESCE(pitching_league_rows.saves, pitching_team_rows.saves, 0) AS saves,
    COALESCE(pitching_league_rows.complete_games, pitching_team_rows.complete_games, 0) AS complete_games,
    COALESCE(pitching_league_rows.earned_runs, pitching_team_rows.earned_runs, 0) AS earned_runs,
    COALESCE(pitching_league_rows.outs, pitching_team_rows.outs, 0) AS outs
  FROM pitching_season_keys
  LEFT JOIN pitching_league_rows
    ON pitching_league_rows.pointstreak_player_id = pitching_season_keys.pointstreak_player_id
   AND pitching_league_rows.season_id = pitching_season_keys.season_id
  LEFT JOIN pitching_team_rows
    ON pitching_team_rows.pointstreak_player_id = pitching_season_keys.pointstreak_player_id
   AND pitching_team_rows.season_id = pitching_season_keys.season_id
),
pitching_totals AS (
  SELECT
    pitching_season_totals.pointstreak_player_id,
    MAX(pitching_season_totals.player_name) AS player_name,
    SUM(pitching_season_totals.wins) AS wins,
    SUM(pitching_season_totals.strikeouts) AS strikeouts,
    SUM(pitching_season_totals.saves) AS saves,
    SUM(pitching_season_totals.complete_games) AS complete_games,
    SUM(pitching_season_totals.earned_runs) AS earned_runs,
    SUM(pitching_season_totals.outs) AS outs
  FROM pitching_season_totals
  GROUP BY pitching_season_totals.pointstreak_player_id
),
ranked_games AS (
  SELECT pointstreak_player_id, ROW_NUMBER() OVER (ORDER BY games_played DESC, seasons DESC, player_name) AS rank
  FROM game_totals
),
ranked_seasons AS (
  SELECT pointstreak_player_id, ROW_NUMBER() OVER (ORDER BY seasons DESC, games_played DESC, player_name) AS rank
  FROM game_totals
),
ranked_average AS (
  SELECT pointstreak_player_id, ROW_NUMBER() OVER (ORDER BY CAST(hits AS REAL) / at_bats DESC, at_bats DESC, player_name) AS rank
  FROM batting_totals
  WHERE at_bats >= 300
),
ranked_hits AS (
  SELECT pointstreak_player_id, ROW_NUMBER() OVER (ORDER BY hits DESC, player_name) AS rank
  FROM batting_totals
),
ranked_home_runs AS (
  SELECT pointstreak_player_id, ROW_NUMBER() OVER (ORDER BY home_runs DESC, player_name) AS rank
  FROM batting_totals
),
ranked_rbi AS (
  SELECT pointstreak_player_id, ROW_NUMBER() OVER (ORDER BY runs_batted_in DESC, player_name) AS rank
  FROM batting_totals
),
ranked_stolen_bases AS (
  SELECT pointstreak_player_id, ROW_NUMBER() OVER (ORDER BY stolen_bases DESC, player_name) AS rank
  FROM batting_totals
),
ranked_walks AS (
  SELECT pointstreak_player_id, ROW_NUMBER() OVER (ORDER BY walks DESC, player_name) AS rank
  FROM batting_totals
),
ranked_era AS (
  SELECT pointstreak_player_id, ROW_NUMBER() OVER (ORDER BY earned_runs * 27.0 / outs ASC, outs DESC, player_name) AS rank
  FROM pitching_totals
  WHERE outs >= 300
),
ranked_wins AS (
  SELECT pointstreak_player_id, ROW_NUMBER() OVER (ORDER BY wins DESC, player_name) AS rank
  FROM pitching_totals
),
ranked_pitching_strikeouts AS (
  SELECT pointstreak_player_id, ROW_NUMBER() OVER (ORDER BY strikeouts DESC, player_name) AS rank
  FROM pitching_totals
),
ranked_innings AS (
  SELECT pointstreak_player_id, ROW_NUMBER() OVER (ORDER BY outs DESC, player_name) AS rank
  FROM pitching_totals
),
ranked_complete_games AS (
  SELECT pointstreak_player_id, ROW_NUMBER() OVER (ORDER BY complete_games DESC, player_name) AS rank
  FROM pitching_totals
),
ranked_saves AS (
  SELECT pointstreak_player_id, ROW_NUMBER() OVER (ORDER BY saves DESC, player_name) AS rank
  FROM pitching_totals
)
SELECT 'Longevity' AS leader_group, 'Games Played' AS category, ranked_games.rank, game_totals.games_played AS value, 'Qualified' AS qualified, NULL AS qualification
FROM selected_player
LEFT JOIN game_totals ON game_totals.pointstreak_player_id = selected_player.pointstreak_player_id
LEFT JOIN ranked_games ON ranked_games.pointstreak_player_id = selected_player.pointstreak_player_id
UNION ALL
SELECT 'Longevity', 'Seasons Played', ranked_seasons.rank, game_totals.seasons, 'Qualified', NULL
FROM selected_player
LEFT JOIN game_totals ON game_totals.pointstreak_player_id = selected_player.pointstreak_player_id
LEFT JOIN ranked_seasons ON ranked_seasons.pointstreak_player_id = selected_player.pointstreak_player_id
UNION ALL
SELECT
  'Batting',
  'Average',
  ranked_average.rank,
  CASE WHEN batting_totals.at_bats > 0 THEN printf('%.3f', CAST(batting_totals.hits AS REAL) / batting_totals.at_bats) END,
  CASE
    WHEN batting_totals.pointstreak_player_id IS NULL OR batting_totals.at_bats <= 0 THEN 'No Data'
    WHEN batting_totals.at_bats >= 300 THEN 'Qualified'
    ELSE 'Not Qualified'
  END,
  CASE
    WHEN batting_totals.at_bats < 300 THEN
      'Needs 300 AB; has ' || batting_totals.at_bats
    ELSE NULL
  END
FROM selected_player
LEFT JOIN batting_totals ON batting_totals.pointstreak_player_id = selected_player.pointstreak_player_id
LEFT JOIN ranked_average ON ranked_average.pointstreak_player_id = selected_player.pointstreak_player_id
UNION ALL
SELECT 'Batting', 'Hits', ranked_hits.rank, batting_totals.hits, CASE WHEN batting_totals.pointstreak_player_id IS NULL THEN 'No Data' ELSE 'Qualified' END, NULL
FROM selected_player
LEFT JOIN batting_totals ON batting_totals.pointstreak_player_id = selected_player.pointstreak_player_id
LEFT JOIN ranked_hits ON ranked_hits.pointstreak_player_id = selected_player.pointstreak_player_id
UNION ALL
SELECT 'Batting', 'Home Runs', ranked_home_runs.rank, batting_totals.home_runs, CASE WHEN batting_totals.pointstreak_player_id IS NULL THEN 'No Data' ELSE 'Qualified' END, NULL
FROM selected_player
LEFT JOIN batting_totals ON batting_totals.pointstreak_player_id = selected_player.pointstreak_player_id
LEFT JOIN ranked_home_runs ON ranked_home_runs.pointstreak_player_id = selected_player.pointstreak_player_id
UNION ALL
SELECT 'Batting', 'RBI', ranked_rbi.rank, batting_totals.runs_batted_in, CASE WHEN batting_totals.pointstreak_player_id IS NULL THEN 'No Data' ELSE 'Qualified' END, NULL
FROM selected_player
LEFT JOIN batting_totals ON batting_totals.pointstreak_player_id = selected_player.pointstreak_player_id
LEFT JOIN ranked_rbi ON ranked_rbi.pointstreak_player_id = selected_player.pointstreak_player_id
UNION ALL
SELECT 'Batting', 'Stolen Bases', ranked_stolen_bases.rank, batting_totals.stolen_bases, CASE WHEN batting_totals.pointstreak_player_id IS NULL THEN 'No Data' ELSE 'Qualified' END, NULL
FROM selected_player
LEFT JOIN batting_totals ON batting_totals.pointstreak_player_id = selected_player.pointstreak_player_id
LEFT JOIN ranked_stolen_bases ON ranked_stolen_bases.pointstreak_player_id = selected_player.pointstreak_player_id
UNION ALL
SELECT 'Batting', 'Walks', ranked_walks.rank, batting_totals.walks, CASE WHEN batting_totals.pointstreak_player_id IS NULL THEN 'No Data' ELSE 'Qualified' END, NULL
FROM selected_player
LEFT JOIN batting_totals ON batting_totals.pointstreak_player_id = selected_player.pointstreak_player_id
LEFT JOIN ranked_walks ON ranked_walks.pointstreak_player_id = selected_player.pointstreak_player_id
UNION ALL
SELECT
  'Pitching',
  'ERA',
  ranked_era.rank,
  CASE WHEN pitching_totals.outs > 0 THEN printf('%.2f', pitching_totals.earned_runs * 27.0 / pitching_totals.outs) END,
  CASE
    WHEN pitching_totals.pointstreak_player_id IS NULL OR pitching_totals.outs <= 0 THEN 'No Data'
    WHEN pitching_totals.outs >= 300 THEN 'Qualified'
    ELSE 'Not Qualified'
  END,
  CASE
    WHEN pitching_totals.outs < 300 THEN
      'Needs 100.0 IP; has ' || (CAST(pitching_totals.outs / 3 AS INTEGER) || '.' || (pitching_totals.outs % 3))
    ELSE NULL
  END
FROM selected_player
LEFT JOIN pitching_totals ON pitching_totals.pointstreak_player_id = selected_player.pointstreak_player_id
LEFT JOIN ranked_era ON ranked_era.pointstreak_player_id = selected_player.pointstreak_player_id
UNION ALL
SELECT 'Pitching', 'Wins', ranked_wins.rank, pitching_totals.wins, CASE WHEN pitching_totals.pointstreak_player_id IS NULL THEN 'No Data' ELSE 'Qualified' END, NULL
FROM selected_player
LEFT JOIN pitching_totals ON pitching_totals.pointstreak_player_id = selected_player.pointstreak_player_id
LEFT JOIN ranked_wins ON ranked_wins.pointstreak_player_id = selected_player.pointstreak_player_id
UNION ALL
SELECT 'Pitching', 'Strikeouts', ranked_pitching_strikeouts.rank, pitching_totals.strikeouts, CASE WHEN pitching_totals.pointstreak_player_id IS NULL THEN 'No Data' ELSE 'Qualified' END, NULL
FROM selected_player
LEFT JOIN pitching_totals ON pitching_totals.pointstreak_player_id = selected_player.pointstreak_player_id
LEFT JOIN ranked_pitching_strikeouts ON ranked_pitching_strikeouts.pointstreak_player_id = selected_player.pointstreak_player_id
UNION ALL
SELECT 'Pitching', 'Innings Pitched', ranked_innings.rank, CASE WHEN pitching_totals.pointstreak_player_id IS NOT NULL THEN CAST(pitching_totals.outs / 3 AS INTEGER) || '.' || (pitching_totals.outs % 3) END, CASE WHEN pitching_totals.pointstreak_player_id IS NULL THEN 'No Data' ELSE 'Qualified' END, NULL
FROM selected_player
LEFT JOIN pitching_totals ON pitching_totals.pointstreak_player_id = selected_player.pointstreak_player_id
LEFT JOIN ranked_innings ON ranked_innings.pointstreak_player_id = selected_player.pointstreak_player_id
UNION ALL
SELECT 'Pitching', 'Complete Games', ranked_complete_games.rank, pitching_totals.complete_games, CASE WHEN pitching_totals.pointstreak_player_id IS NULL THEN 'No Data' ELSE 'Qualified' END, NULL
FROM selected_player
LEFT JOIN pitching_totals ON pitching_totals.pointstreak_player_id = selected_player.pointstreak_player_id
LEFT JOIN ranked_complete_games ON ranked_complete_games.pointstreak_player_id = selected_player.pointstreak_player_id
UNION ALL
SELECT 'Pitching', 'Saves', ranked_saves.rank, pitching_totals.saves, CASE WHEN pitching_totals.pointstreak_player_id IS NULL THEN 'No Data' ELSE 'Qualified' END, NULL
FROM selected_player
LEFT JOIN pitching_totals ON pitching_totals.pointstreak_player_id = selected_player.pointstreak_player_id
LEFT JOIN ranked_saves ON ranked_saves.pointstreak_player_id = selected_player.pointstreak_player_id;
`;
}
