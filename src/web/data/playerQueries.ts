const pitcherOutsExpression = `
  CASE
    WHEN innings_pitched IS NULL OR innings_pitched = '' THEN 0
    WHEN instr(innings_pitched, '.') > 0 THEN
      CAST(substr(innings_pitched, 1, instr(innings_pitched, '.') - 1) AS INTEGER) * 3
      + CAST(substr(innings_pitched, instr(innings_pitched, '.') + 1) AS INTEGER)
    ELSE CAST(innings_pitched AS INTEGER) * 3
  END
`;

const teamPitcherOutsExpression = `
  CASE
    WHEN stats.innings_pitched IS NULL OR stats.innings_pitched = '' THEN 0
    WHEN instr(stats.innings_pitched, '.') > 0 THEN
      CAST(substr(stats.innings_pitched, 1, instr(stats.innings_pitched, '.') - 1) AS INTEGER) * 3
      + CAST(substr(stats.innings_pitched, instr(stats.innings_pitched, '.') + 1) AS INTEGER)
    ELSE CAST(stats.innings_pitched AS INTEGER) * 3
  END
`;

export function buildPlayerProfileSql(playerId: number) {
  return `
WITH target AS (
  SELECT ${playerId} AS player_id
),
roster_profile AS (
  SELECT
    rosters.player_id,
    MIN(NULLIF(rosters.birthdate, '')) AS birthdate,
    MAX(NULLIF(rosters.bats, '')) AS bats,
    MAX(NULLIF(rosters.throws, '')) AS throws,
    MAX(NULLIF(rosters.height, '')) AS height,
    MAX(NULLIF(rosters.weight, '')) AS weight,
    MAX(NULLIF(rosters.hometown, '')) AS hometown,
    GROUP_CONCAT(DISTINCT NULLIF(rosters.position, '')) AS positions,
    COUNT(DISTINCT rosters.season_id) AS seasons,
    COUNT(DISTINCT rosters.team_id) AS teams
  FROM rosters
  WHERE rosters.player_id = ${playerId}
  GROUP BY rosters.player_id
)
SELECT
  target.player_id,
  COALESCE(
    players.name,
    (SELECT name FROM rosters WHERE player_id = target.player_id AND name IS NOT NULL LIMIT 1),
    (SELECT player_name FROM season_batting_stats WHERE player_id = target.player_id AND player_name IS NOT NULL LIMIT 1),
    (SELECT player_name FROM season_pitching_stats WHERE player_id = target.player_id AND player_name IS NOT NULL LIMIT 1)
  ) AS player_name,
  roster_profile.birthdate,
  roster_profile.bats,
  roster_profile.throws,
  roster_profile.height,
  roster_profile.weight,
  roster_profile.hometown,
  roster_profile.positions,
  roster_profile.seasons,
  roster_profile.teams
FROM target
LEFT JOIN players ON players.player_id = target.player_id
LEFT JOIN roster_profile ON roster_profile.player_id = target.player_id;
`;
}

export function buildPlayerSeasonInfoSql(seasonId?: number) {
  return `
SELECT
  season_id,
  name AS season_name
FROM seasons
WHERE season_id = ${seasonId ?? -1};
`;
}

export function buildPlayerLifetimeBattingSql(playerId: number) {
  return `
WITH season_rows AS (
  SELECT
    season_batting_stats.player_id,
    COALESCE(players.name, season_batting_stats.player_name) AS player_name,
    season_batting_stats.season_id,
    COALESCE(at_bats, 0) AS at_bats,
    COALESCE(runs, 0) AS runs,
    COALESCE(hits, 0) AS hits,
    COALESCE(doubles, 0) AS doubles,
    COALESCE(triples, 0) AS triples,
    COALESCE(home_runs, 0) AS home_runs,
    COALESCE(runs_batted_in, 0) AS runs_batted_in,
    COALESCE(walks, 0) AS walks,
    COALESCE(hit_by_pitch, 0) AS hit_by_pitch,
    COALESCE(strikeouts, 0) AS strikeouts,
    COALESCE(sacrifice_flies, 0) AS sacrifice_flies,
    COALESCE(sacrifice_bunts, 0) AS sacrifice_bunts,
    COALESCE(stolen_bases, 0) AS stolen_bases,
    COALESCE(caught_stealing, 0) AS caught_stealing,
    COALESCE(double_plays, 0) AS double_plays
  FROM season_batting_stats
  LEFT JOIN players ON players.player_id = season_batting_stats.player_id
  WHERE season_batting_stats.player_id = ${playerId}
    AND scope = 'league'
  UNION ALL
  SELECT
    stats.player_id,
    COALESCE(MAX(players.name), MAX(stats.player_name)) AS player_name,
    stats.season_id,
    SUM(COALESCE(stats.at_bats, 0)) AS at_bats,
    SUM(COALESCE(stats.runs, 0)) AS runs,
    SUM(COALESCE(stats.hits, 0)) AS hits,
    SUM(COALESCE(stats.doubles, 0)) AS doubles,
    SUM(COALESCE(stats.triples, 0)) AS triples,
    SUM(COALESCE(stats.home_runs, 0)) AS home_runs,
    SUM(COALESCE(stats.runs_batted_in, 0)) AS runs_batted_in,
    SUM(COALESCE(stats.walks, 0)) AS walks,
    SUM(COALESCE(stats.hit_by_pitch, 0)) AS hit_by_pitch,
    SUM(COALESCE(stats.strikeouts, 0)) AS strikeouts,
    SUM(COALESCE(stats.sacrifice_flies, 0)) AS sacrifice_flies,
    SUM(COALESCE(stats.sacrifice_bunts, 0)) AS sacrifice_bunts,
    SUM(COALESCE(stats.stolen_bases, 0)) AS stolen_bases,
    SUM(COALESCE(stats.caught_stealing, 0)) AS caught_stealing,
    SUM(COALESCE(stats.double_plays, 0)) AS double_plays
  FROM season_batting_stats stats
  LEFT JOIN players ON players.player_id = stats.player_id
  WHERE stats.player_id = ${playerId}
    AND stats.scope = 'team'
    AND NOT EXISTS (
      SELECT 1
      FROM season_batting_stats league_stats
      WHERE league_stats.player_id = stats.player_id
        AND league_stats.season_id = stats.season_id
        AND league_stats.scope = 'league'
    )
  GROUP BY stats.player_id, stats.season_id
)
SELECT
  player_id,
  MAX(player_name) AS player_name,
  COUNT(DISTINCT season_id) AS seasons,
  (
    SELECT COUNT(DISTINCT game_id)
    FROM batting_stats
    WHERE batting_stats.player_id = season_rows.player_id
  ) AS games_played,
  SUM(at_bats) AS at_bats,
  SUM(runs) AS runs,
  SUM(hits) AS hits,
  SUM(doubles) AS doubles,
  SUM(triples) AS triples,
  SUM(home_runs) AS home_runs,
  SUM(runs_batted_in) AS runs_batted_in,
  SUM(walks) AS walks,
  SUM(hit_by_pitch) AS hit_by_pitch,
  SUM(strikeouts) AS strikeouts,
  SUM(sacrifice_flies) AS sacrifice_flies,
  SUM(sacrifice_bunts) AS sacrifice_bunts,
  SUM(stolen_bases) AS stolen_bases,
  SUM(caught_stealing) AS caught_stealing,
  SUM(double_plays) AS double_plays,
  CASE
    WHEN SUM(at_bats + walks + hit_by_pitch + sacrifice_flies) = 0 THEN NULL
    ELSE printf('%.3f', CAST(SUM(hits + walks + hit_by_pitch) AS REAL) / SUM(at_bats + walks + hit_by_pitch + sacrifice_flies))
  END AS on_base_percentage,
  CASE
    WHEN SUM(at_bats) = 0 THEN NULL
    ELSE printf('%.3f', CAST(SUM(hits + doubles + (triples * 2) + (home_runs * 3)) AS REAL) / SUM(at_bats))
  END AS slugging_percentage,
  CASE
    WHEN SUM(at_bats) = 0 THEN NULL
    ELSE printf('%.3f', CAST(SUM(hits) AS REAL) / SUM(at_bats))
  END AS batting_average
FROM season_rows
GROUP BY player_id;
`;
}

export function buildPlayerLifetimePitchingSql(playerId: number) {
  return `
WITH team_rows AS (
  SELECT
    stats.player_id,
    stats.season_id,
    COALESCE(MAX(players.name), MAX(stats.player_name)) AS player_name,
    SUM(COALESCE(stats.wins, 0)) AS wins,
    SUM(COALESCE(stats.losses, 0)) AS losses,
    SUM(${teamPitcherOutsExpression}) AS outs,
    SUM(COALESCE(stats.runs, 0)) AS runs,
    SUM(COALESCE(stats.earned_runs, 0)) AS earned_runs,
    SUM(COALESCE(stats.hits, 0)) AS hits,
    SUM(COALESCE(stats.walks, 0)) AS walks,
    SUM(COALESCE(stats.strikeouts, 0)) AS strikeouts,
    SUM(COALESCE(stats.hit_by_pitch, 0)) AS hit_by_pitch,
    SUM(COALESCE(stats.batters_faced, 0)) AS batters_faced,
    SUM(COALESCE(stats.games, 0)) AS games,
    SUM(COALESCE(stats.games_started, 0)) AS games_started,
    SUM(COALESCE(stats.complete_games, 0)) AS complete_games,
    SUM(COALESCE(stats.complete_game_losses, 0)) AS complete_game_losses,
    SUM(COALESCE(stats.shutouts, 0)) AS shutouts,
    SUM(COALESCE(stats.saves, 0)) AS saves,
    SUM(COALESCE(stats.blown_saves, 0)) AS blown_saves
  FROM season_pitching_stats stats
  LEFT JOIN players ON players.player_id = stats.player_id
  WHERE stats.player_id = ${playerId}
    AND stats.scope = 'team'
  GROUP BY stats.player_id, stats.season_id
),
league_rows AS (
  SELECT
    season_pitching_stats.player_id,
    season_pitching_stats.season_id,
    COALESCE(players.name, season_pitching_stats.player_name) AS player_name,
    wins,
    losses,
    ${pitcherOutsExpression} AS outs,
    runs,
    earned_runs,
    hits,
    walks,
    strikeouts,
    hit_by_pitch,
    batters_faced,
    games,
    games_started,
    complete_games,
    complete_game_losses,
    shutouts,
    saves,
    blown_saves
  FROM season_pitching_stats
  LEFT JOIN players ON players.player_id = season_pitching_stats.player_id
  WHERE season_pitching_stats.player_id = ${playerId}
    AND scope = 'league'
),
season_keys AS (
  SELECT player_id, season_id FROM league_rows
  UNION
  SELECT player_id, season_id FROM team_rows
),
pitcher_seasons AS (
  SELECT
    season_keys.player_id,
    season_keys.season_id,
    COALESCE(league_rows.player_name, team_rows.player_name) AS player_name,
    COALESCE(league_rows.wins, team_rows.wins, 0) AS wins,
    COALESCE(league_rows.losses, team_rows.losses, 0) AS losses,
    COALESCE(league_rows.outs, team_rows.outs, 0) AS outs,
    COALESCE(league_rows.runs, team_rows.runs, 0) AS runs,
    COALESCE(league_rows.earned_runs, team_rows.earned_runs, 0) AS earned_runs,
    COALESCE(league_rows.hits, team_rows.hits, 0) AS hits,
    COALESCE(league_rows.walks, team_rows.walks, 0) AS walks,
    COALESCE(league_rows.strikeouts, team_rows.strikeouts, 0) AS strikeouts,
    COALESCE(league_rows.hit_by_pitch, team_rows.hit_by_pitch, 0) AS hit_by_pitch,
    COALESCE(league_rows.batters_faced, team_rows.batters_faced, 0) AS batters_faced,
    COALESCE(league_rows.games, team_rows.games, 0) AS games,
    COALESCE(league_rows.games_started, team_rows.games_started, 0) AS games_started,
    COALESCE(league_rows.complete_games, team_rows.complete_games, 0) AS complete_games,
    COALESCE(league_rows.complete_game_losses, team_rows.complete_game_losses, 0) AS complete_game_losses,
    COALESCE(league_rows.shutouts, team_rows.shutouts, 0) AS shutouts,
    COALESCE(league_rows.saves, team_rows.saves, 0) AS saves,
    COALESCE(league_rows.blown_saves, team_rows.blown_saves, 0) AS blown_saves
  FROM season_keys
  LEFT JOIN league_rows
    ON league_rows.player_id = season_keys.player_id
   AND league_rows.season_id = season_keys.season_id
  LEFT JOIN team_rows
    ON team_rows.player_id = season_keys.player_id
   AND team_rows.season_id = season_keys.season_id
)
SELECT
  player_id,
  MAX(player_name) AS player_name,
  COUNT(DISTINCT season_id) AS seasons,
  SUM(games) AS games,
  SUM(games_started) AS games_started,
  SUM(wins) AS wins,
  SUM(losses) AS losses,
  CAST(SUM(outs) / 3 AS INTEGER) || '.' || (SUM(outs) % 3) AS innings_pitched,
  SUM(runs) AS runs,
  SUM(earned_runs) AS earned_runs,
  SUM(hits) AS hits,
  SUM(walks) AS walks,
  SUM(strikeouts) AS strikeouts,
  SUM(hit_by_pitch) AS hit_by_pitch,
  SUM(batters_faced) AS batters_faced,
  SUM(complete_games) AS complete_games,
  SUM(complete_game_losses) AS complete_game_losses,
  SUM(shutouts) AS shutouts,
  SUM(saves) AS saves,
  SUM(blown_saves) AS blown_saves,
  CASE
    WHEN SUM(outs) = 0 THEN NULL
    ELSE printf('%.2f', SUM(earned_runs) * 27.0 / SUM(outs))
  END AS era
FROM pitcher_seasons
GROUP BY player_id;
`;
}

export function buildPlayerSeasonBattingSql(playerId: number, seasonId?: number) {
  const rankedSeasonFilter = seasonId != null ? `AND ranked_stats.season_id = ${seasonId}` : "";

  return `
WITH ranked_stats AS (
  SELECT
    season_batting_stats.*,
    seasons.name AS season_name,
    COALESCE(
      season_batting_stats.team_id,
      (
        SELECT rosters.team_id
        FROM rosters
        WHERE rosters.player_id = season_batting_stats.player_id
          AND rosters.season_id = season_batting_stats.season_id
          AND rosters.team_id IS NOT NULL
        LIMIT 1
      ),
      (
        SELECT batting_stats.team_id
        FROM batting_stats
        WHERE batting_stats.player_id = season_batting_stats.player_id
          AND batting_stats.season_id = season_batting_stats.season_id
          AND batting_stats.team_id IS NOT NULL
        LIMIT 1
      )
    ) AS display_team_id,
    COALESCE(
      teams.name,
      (
        SELECT roster_team.name
        FROM rosters
        LEFT JOIN teams roster_team ON roster_team.team_id = rosters.team_id
        WHERE rosters.player_id = season_batting_stats.player_id
          AND rosters.season_id = season_batting_stats.season_id
          AND roster_team.name IS NOT NULL
        LIMIT 1
      ),
      (
        SELECT batting_team.name
        FROM batting_stats
        LEFT JOIN teams batting_team ON batting_team.team_id = batting_stats.team_id
        WHERE batting_stats.player_id = season_batting_stats.player_id
          AND batting_stats.season_id = season_batting_stats.season_id
          AND batting_team.name IS NOT NULL
        LIMIT 1
      ),
      (
        SELECT pitching_team.name
        FROM pitching_stats
        LEFT JOIN teams pitching_team ON pitching_team.team_id = pitching_stats.team_id
        WHERE pitching_stats.player_id = season_batting_stats.player_id
          AND pitching_stats.season_id = season_batting_stats.season_id
          AND pitching_team.name IS NOT NULL
        LIMIT 1
      ),
      season_batting_stats.source_team_name
    ) AS team,
    ROW_NUMBER() OVER (
      PARTITION BY season_batting_stats.season_id, season_batting_stats.player_id
      ORDER BY CASE WHEN scope = 'league' THEN 0 ELSE 1 END
    ) AS source_rank
  FROM season_batting_stats
  LEFT JOIN seasons ON seasons.season_id = season_batting_stats.season_id
  LEFT JOIN teams ON teams.team_id = season_batting_stats.team_id
  WHERE player_id = ${playerId}
)
SELECT
  ranked_stats.season_id,
  ranked_stats.season_name,
  ranked_stats.team,
  ranked_stats.display_team_id AS team_id,
  (
    SELECT COUNT(DISTINCT game_id)
    FROM batting_stats
    WHERE batting_stats.player_id = ranked_stats.player_id
      AND batting_stats.season_id = ranked_stats.season_id
  ) AS games_played,
  at_bats,
  runs,
  hits,
  doubles,
  triples,
  home_runs,
  runs_batted_in,
  walks,
  hit_by_pitch,
  strikeouts,
  sacrifice_flies,
  sacrifice_bunts,
  stolen_bases,
  caught_stealing,
  double_plays,
  on_base_percentage,
  slugging_percentage,
  batting_average
FROM ranked_stats
WHERE source_rank = 1
  ${rankedSeasonFilter}
ORDER BY ranked_stats.season_id DESC;
`;
}

export function buildPlayerSeasonPitchingSql(playerId: number, seasonId?: number) {
  const rankedSeasonFilter = seasonId != null ? `AND combined_stats.season_id = ${seasonId}` : "";

  return `
WITH team_rows AS (
  SELECT
    stats.player_id,
    stats.season_id,
    COALESCE(
      MAX(players.name),
      MAX(stats.player_name)
    ) AS player_name,
    COALESCE(
      MAX(stats.team_id),
      (
        SELECT rosters.team_id
        FROM rosters
        WHERE rosters.player_id = stats.player_id
          AND rosters.season_id = stats.season_id
          AND rosters.team_id IS NOT NULL
        LIMIT 1
      ),
      (
        SELECT pitching_stats.team_id
        FROM pitching_stats
        WHERE pitching_stats.player_id = stats.player_id
          AND pitching_stats.season_id = stats.season_id
          AND pitching_stats.team_id IS NOT NULL
        LIMIT 1
      )
    ) AS team_id,
    COALESCE(
      MAX(teams.name),
      (
        SELECT roster_team.name
        FROM rosters
        LEFT JOIN teams roster_team ON roster_team.team_id = rosters.team_id
        WHERE rosters.player_id = stats.player_id
          AND rosters.season_id = stats.season_id
          AND roster_team.name IS NOT NULL
        LIMIT 1
      ),
      (
        SELECT pitching_team.name
        FROM pitching_stats
        LEFT JOIN teams pitching_team ON pitching_team.team_id = pitching_stats.team_id
        WHERE pitching_stats.player_id = stats.player_id
          AND pitching_stats.season_id = stats.season_id
          AND pitching_team.name IS NOT NULL
        LIMIT 1
      ),
      MAX(stats.source_team_name)
    ) AS team,
    SUM(COALESCE(stats.wins, 0)) AS wins,
    SUM(COALESCE(stats.losses, 0)) AS losses,
    SUM(${teamPitcherOutsExpression}) AS outs,
    SUM(COALESCE(stats.runs, 0)) AS runs,
    SUM(COALESCE(stats.earned_runs, 0)) AS earned_runs,
    SUM(COALESCE(stats.hits, 0)) AS hits,
    SUM(COALESCE(stats.walks, 0)) AS walks,
    SUM(COALESCE(stats.strikeouts, 0)) AS strikeouts,
    SUM(COALESCE(stats.hit_by_pitch, 0)) AS hit_by_pitch,
    SUM(COALESCE(stats.batters_faced, 0)) AS batters_faced,
    SUM(COALESCE(stats.games, 0)) AS games,
    SUM(COALESCE(stats.games_started, 0)) AS games_started,
    SUM(COALESCE(stats.complete_games, 0)) AS complete_games,
    SUM(COALESCE(stats.complete_game_losses, 0)) AS complete_game_losses,
    SUM(COALESCE(stats.shutouts, 0)) AS shutouts,
    SUM(COALESCE(stats.saves, 0)) AS saves,
    SUM(COALESCE(stats.blown_saves, 0)) AS blown_saves,
    MAX(stats.opponent_on_base_percentage) AS opponent_on_base_percentage,
    MAX(stats.opponent_slugging_percentage) AS opponent_slugging_percentage,
    MAX(stats.opponent_average) AS opponent_average,
    MAX(stats.era) AS era
  FROM season_pitching_stats stats
  LEFT JOIN players ON players.player_id = stats.player_id
  LEFT JOIN teams ON teams.team_id = stats.team_id
  WHERE stats.player_id = ${playerId}
    AND stats.scope = 'team'
  GROUP BY stats.player_id, stats.season_id
),
league_rows AS (
  SELECT
    season_pitching_stats.player_id,
    season_pitching_stats.season_id,
    seasons.name AS season_name,
    COALESCE(players.name, season_pitching_stats.player_name) AS player_name,
    COALESCE(
      season_pitching_stats.team_id,
      (
        SELECT rosters.team_id
        FROM rosters
        WHERE rosters.player_id = season_pitching_stats.player_id
          AND rosters.season_id = season_pitching_stats.season_id
          AND rosters.team_id IS NOT NULL
        LIMIT 1
      ),
      (
        SELECT pitching_stats.team_id
        FROM pitching_stats
        WHERE pitching_stats.player_id = season_pitching_stats.player_id
          AND pitching_stats.season_id = season_pitching_stats.season_id
          AND pitching_stats.team_id IS NOT NULL
        LIMIT 1
      )
    ) AS team_id,
    COALESCE(
      (
        SELECT roster_team.name
        FROM rosters
        LEFT JOIN teams roster_team ON roster_team.team_id = rosters.team_id
        WHERE rosters.player_id = season_pitching_stats.player_id
          AND rosters.season_id = season_pitching_stats.season_id
          AND roster_team.name IS NOT NULL
        LIMIT 1
      ),
      (
        SELECT pitching_team.name
        FROM pitching_stats
        LEFT JOIN teams pitching_team ON pitching_team.team_id = pitching_stats.team_id
        WHERE pitching_stats.player_id = season_pitching_stats.player_id
          AND pitching_stats.season_id = season_pitching_stats.season_id
          AND pitching_team.name IS NOT NULL
        LIMIT 1
      ),
      season_pitching_stats.source_team_name
    ) AS team,
    wins,
    losses,
    ${pitcherOutsExpression} AS outs,
    runs,
    earned_runs,
    hits,
    walks,
    strikeouts,
    hit_by_pitch,
    batters_faced,
    games,
    games_started,
    complete_games,
    complete_game_losses,
    shutouts,
    saves,
    blown_saves,
    opponent_on_base_percentage,
    opponent_slugging_percentage,
    opponent_average,
    era
  FROM season_pitching_stats
  LEFT JOIN seasons ON seasons.season_id = season_pitching_stats.season_id
  LEFT JOIN players ON players.player_id = season_pitching_stats.player_id
  WHERE season_pitching_stats.player_id = ${playerId}
    AND scope = 'league'
),
season_keys AS (
  SELECT player_id, season_id FROM league_rows
  UNION
  SELECT player_id, season_id FROM team_rows
),
combined_stats AS (
  SELECT
    season_keys.player_id,
    season_keys.season_id,
    COALESCE(league_rows.season_name, seasons.name) AS season_name,
    COALESCE(league_rows.team, team_rows.team) AS team,
    COALESCE(league_rows.team_id, team_rows.team_id) AS team_id,
    COALESCE(league_rows.games, team_rows.games, 0) AS games,
    COALESCE(league_rows.games_started, team_rows.games_started, 0) AS games_started,
    COALESCE(league_rows.wins, team_rows.wins, 0) AS wins,
    COALESCE(league_rows.losses, team_rows.losses, 0) AS losses,
    COALESCE(league_rows.outs, team_rows.outs, 0) AS outs,
    COALESCE(league_rows.runs, team_rows.runs, 0) AS runs,
    COALESCE(league_rows.earned_runs, team_rows.earned_runs, 0) AS earned_runs,
    COALESCE(league_rows.hits, team_rows.hits, 0) AS hits,
    COALESCE(league_rows.walks, team_rows.walks, 0) AS walks,
    COALESCE(league_rows.strikeouts, team_rows.strikeouts, 0) AS strikeouts,
    COALESCE(league_rows.hit_by_pitch, team_rows.hit_by_pitch, 0) AS hit_by_pitch,
    COALESCE(league_rows.batters_faced, team_rows.batters_faced, 0) AS batters_faced,
    COALESCE(league_rows.complete_games, team_rows.complete_games, 0) AS complete_games,
    COALESCE(league_rows.complete_game_losses, team_rows.complete_game_losses, 0) AS complete_game_losses,
    COALESCE(league_rows.shutouts, team_rows.shutouts, 0) AS shutouts,
    COALESCE(league_rows.saves, team_rows.saves, 0) AS saves,
    COALESCE(league_rows.blown_saves, team_rows.blown_saves, 0) AS blown_saves,
    COALESCE(league_rows.opponent_on_base_percentage, team_rows.opponent_on_base_percentage) AS opponent_on_base_percentage,
    COALESCE(league_rows.opponent_slugging_percentage, team_rows.opponent_slugging_percentage) AS opponent_slugging_percentage,
    COALESCE(league_rows.opponent_average, team_rows.opponent_average) AS opponent_average,
    COALESCE(league_rows.era, team_rows.era) AS source_era
  FROM season_keys
  LEFT JOIN league_rows
    ON league_rows.player_id = season_keys.player_id
   AND league_rows.season_id = season_keys.season_id
  LEFT JOIN team_rows
    ON team_rows.player_id = season_keys.player_id
   AND team_rows.season_id = season_keys.season_id
  LEFT JOIN seasons ON seasons.season_id = season_keys.season_id
)
SELECT
  season_id,
  season_name,
  team,
  team_id,
  games,
  games_started,
  wins,
  losses,
  CAST(outs / 3 AS INTEGER) || '.' || (outs % 3) AS innings_pitched,
  runs,
  earned_runs,
  hits,
  walks,
  strikeouts,
  hit_by_pitch,
  batters_faced,
  complete_games,
  complete_game_losses,
  shutouts,
  saves,
  blown_saves,
  opponent_on_base_percentage,
  opponent_slugging_percentage,
  opponent_average,
  CASE
    WHEN outs = 0 THEN source_era
    ELSE printf('%.2f', earned_runs * 27.0 / outs)
  END AS era
FROM combined_stats
WHERE 1 = 1
  ${rankedSeasonFilter}
ORDER BY season_id DESC;
`;
}

export function buildPlayerBattingGameLogSql(playerId: number, seasonId?: number) {
  return buildPlayerBattingGameLogPageSql(playerId, seasonId, 100, 0);
}

export function buildPlayerBattingGameLogPageSql(
  playerId: number,
  seasonId: number | undefined,
  limit: number,
  offset: number,
) {
  const battingGameLogSeasonFilter = seasonId != null ? `AND batting_stats.season_id = ${seasonId}` : "";

  return `
SELECT
  batting_stats.season_id,
  seasons.name AS season_name,
  batting_stats.game_id,
  games.scheduled_at,
  teams.name AS team,
  batting_stats.team_id,
  CASE
    WHEN batting_stats.team_id = games.home_team_id THEN away.name
    ELSE home.name
  END AS opponent,
  CASE
    WHEN batting_stats.team_id = games.home_team_id THEN games.away_team_id
    ELSE games.home_team_id
  END AS opponent_team_id,
  CASE
    WHEN games.is_tie = 1 THEN 'T'
    WHEN games.winner_team_id = batting_stats.team_id THEN 'W'
    WHEN games.loser_team_id = batting_stats.team_id THEN 'L'
    ELSE games.status
  END AS result,
  CASE
    WHEN batting_stats.team_id = games.home_team_id THEN games.home_score || '-' || games.away_score
    ELSE games.away_score || '-' || games.home_score
  END AS score,
  ab,
  runs,
  hits,
  doubles,
  triples,
  hr,
  rbi,
  bb,
  so,
  sb,
  caught_stealing,
  hit_by_pitch,
  sacrifice_flies,
  sacrifice_bunts,
  avg
FROM batting_stats
LEFT JOIN games ON games.game_id = batting_stats.game_id
LEFT JOIN seasons ON seasons.season_id = batting_stats.season_id
LEFT JOIN teams ON teams.team_id = batting_stats.team_id
LEFT JOIN teams away ON away.team_id = games.away_team_id
LEFT JOIN teams home ON home.team_id = games.home_team_id
WHERE player_id = ${playerId}
  ${battingGameLogSeasonFilter}
ORDER BY batting_stats.season_id DESC, games.scheduled_at DESC, batting_stats.game_id DESC
LIMIT ${limit} OFFSET ${offset};
`;
}

export function buildPlayerPitchingGameLogSql(playerId: number, seasonId?: number) {
  return buildPlayerPitchingGameLogPageSql(playerId, seasonId, 100, 0);
}

export function buildPlayerPitchingGameLogPageSql(
  playerId: number,
  seasonId: number | undefined,
  limit: number,
  offset: number,
) {
  const pitchingGameLogSeasonFilter = seasonId != null ? `AND pitching_stats.season_id = ${seasonId}` : "";

  return `
SELECT
  pitching_stats.season_id,
  seasons.name AS season_name,
  pitching_stats.game_id,
  games.scheduled_at,
  teams.name AS team,
  pitching_stats.team_id,
  CASE
    WHEN pitching_stats.team_id = games.home_team_id THEN away.name
    ELSE home.name
  END AS opponent,
  CASE
    WHEN pitching_stats.team_id = games.home_team_id THEN games.away_team_id
    ELSE games.home_team_id
  END AS opponent_team_id,
  CASE
    WHEN games.is_tie = 1 THEN 'T'
    WHEN games.winner_team_id = pitching_stats.team_id THEN 'W'
    WHEN games.loser_team_id = pitching_stats.team_id THEN 'L'
    ELSE games.status
  END AS result,
  CASE
    WHEN pitching_stats.team_id = games.home_team_id THEN games.home_score || '-' || games.away_score
    ELSE games.away_score || '-' || games.home_score
  END AS score,
  ip,
  hits,
  runs,
  earned_runs,
  doubles_allowed,
  triples_allowed,
  home_runs_allowed,
  bb,
  so,
  hit_by_pitch,
  win,
  loss,
  save,
  blown_save,
  complete_game,
  batters_faced,
  pitches,
  era
FROM pitching_stats
LEFT JOIN games ON games.game_id = pitching_stats.game_id
LEFT JOIN seasons ON seasons.season_id = pitching_stats.season_id
LEFT JOIN teams ON teams.team_id = pitching_stats.team_id
LEFT JOIN teams away ON away.team_id = games.away_team_id
LEFT JOIN teams home ON home.team_id = games.home_team_id
WHERE player_id = ${playerId}
  ${pitchingGameLogSeasonFilter}
ORDER BY pitching_stats.season_id DESC, games.scheduled_at DESC, pitching_stats.game_id DESC
LIMIT ${limit} OFFSET ${offset};
`;
}
