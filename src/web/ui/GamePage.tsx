import { href } from "../hooks/useHashRoute";
import type { ColumnHeaderMode } from "../hooks/useColumnHeaderMode";
import { Table, type ArchiveContext, usePageQuery } from "./queryHelpers";

export function GamePage({
  archive,
  gameId,
  columnHeaderMode,
}: {
  archive: ArchiveContext;
  gameId: number;
  columnHeaderMode: ColumnHeaderMode;
}) {
  const game = usePageQuery(
    archive,
    `
SELECT
  games.pointstreak_game_id,
  games.season_id,
  seasons.name AS season_name,
  games.scheduled_at,
  games.status,
  away.name AS away_team_name,
  COALESCE(away.short_name, away.name) AS away_team,
  games.away_team_pointstreak_link_id,
  games.away_score,
  games.home_score,
  home.name AS home_team_name,
  COALESCE(home.short_name, home.name) AS home_team,
  games.home_team_pointstreak_link_id,
  CASE
    WHEN games.is_tie = 1 THEN 'Tie'
    WHEN games.winner_team_pointstreak_link_id = games.away_team_pointstreak_link_id THEN COALESCE(away.short_name, away.name) || ' win'
    WHEN games.winner_team_pointstreak_link_id = games.home_team_pointstreak_link_id THEN COALESCE(home.short_name, home.name) || ' win'
    ELSE games.status
  END AS result
FROM games
LEFT JOIN seasons ON seasons.season_id = games.season_id
LEFT JOIN teams away ON away.pointstreak_team_link_id = games.away_team_pointstreak_link_id
LEFT JOIN teams home ON home.pointstreak_team_link_id = games.home_team_pointstreak_link_id
WHERE games.pointstreak_game_id = ${gameId};
`,
    `Game ${gameId} summary`,
  );

  const maxInning = usePageQuery(
    archive,
    `
SELECT MAX(max_inning) AS max_inning
FROM (
  SELECT COALESCE(MAX(inning_number), 0) AS max_inning
  FROM innings
  WHERE pointstreak_game_id = ${gameId}
  UNION ALL
  SELECT COALESCE(MAX(CAST((team_outs + 2) / 3 AS INTEGER)), 0) AS max_inning
  FROM (
    SELECT
      SUM(
        CASE
          WHEN ip IS NULL OR ip = '' THEN 0
          WHEN instr(ip, '.') > 0 THEN
            CAST(substr(ip, 1, instr(ip, '.') - 1) AS INTEGER) * 3
            + CAST(substr(ip, instr(ip, '.') + 1) AS INTEGER)
          ELSE CAST(ip AS INTEGER) * 3
        END
      ) AS team_outs
    FROM pitching_stats
    WHERE pointstreak_game_id = ${gameId}
    GROUP BY team_pointstreak_link_id
  )
);
`,
    `Game ${gameId} max inning`,
  );
  const maxInningValue = readFirstNumber(maxInning.result, "max_inning");
  const boxScoreSql = buildBoxScoreSql(gameId, Math.max(9, maxInningValue ?? 9));
  const lineScore = usePageQuery(archive, boxScoreSql, `Game ${gameId} box score`);

  const awayBatting = usePageQuery(archive, battingBoxSql(gameId, 0), `Game ${gameId} away batting`);
  const homeBatting = usePageQuery(archive, battingBoxSql(gameId, 1), `Game ${gameId} home batting`);
  const awayPitching = usePageQuery(archive, pitchingBoxSql(gameId, 0), `Game ${gameId} away pitching`);
  const homePitching = usePageQuery(archive, pitchingBoxSql(gameId, 1), `Game ${gameId} home pitching`);

  const gameRow = game.result?.values[0];
  const readGameValue = (column: string) => {
    const index = game.result?.columns.indexOf(column) ?? -1;
    return index >= 0 ? gameRow?.[index] : undefined;
  };

  const seasonId = readGameValue("season_id");
  const awayTeam = readGameValue("away_team");
  const homeTeam = readGameValue("home_team");
  const awayTeamName = readGameValue("away_team_name") ?? awayTeam;
  const homeTeamName = readGameValue("home_team_name") ?? homeTeam;
  const awayScore = readGameValue("away_score");
  const homeScore = readGameValue("home_score");
  const awayTeamId = readGameValue("away_team_pointstreak_link_id");
  const homeTeamId = readGameValue("home_team_pointstreak_link_id");
  const gameTitle =
    awayTeamName && homeTeamName
      ? `${awayTeamName} ${awayScore ?? ""} at ${homeTeamName} ${homeScore ?? ""}`.trim()
      : `Game ${gameId}`;

  const playerLink = ({ column, row, columns }: TableCellLinkContext) => {
    if (column !== "player_name") {
      return undefined;
    }
    const rowSeasonId = row[columns.indexOf("season_id")];
    const playerId = row[columns.indexOf("pointstreak_player_id")];
    return playerId ? href(`/seasons/${rowSeasonId}/players/${playerId}`) : undefined;
  };

  return (
    <div className="page-grid">
      <section className="section-head">
        <p className="eyebrow">Game</p>
        <h1>{gameTitle}</h1>
        <div className="context-links">
          {seasonId ? <a href={href(`/seasons/${seasonId}`)}>Season Page</a> : null}
          {seasonId && awayTeamId ? (
            <a href={href(`/seasons/${seasonId}/teams/${awayTeamId}`)}>{String(awayTeamName)}</a>
          ) : null}
          {seasonId && homeTeamId ? (
            <a href={href(`/seasons/${seasonId}/teams/${homeTeamId}`)}>{String(homeTeamName)}</a>
          ) : null}
        </div>
      </section>
      <section>
        <h2>Game Summary</h2>
        {game.error ? <div className="notice error">{game.error}</div> : null}
        <Table
          result={game.result}
          columnHeaderMode={columnHeaderMode}
          query={game.sql}
          hiddenColumns={[
            "pointstreak_game_id",
            "season_id",
            "away_team_name",
            "away_team_pointstreak_link_id",
            "home_team_name",
            "home_team_pointstreak_link_id",
          ]}
          cellHref={({ column, row, columns, value }) => {
            if (value == null || value === "") {
              return undefined;
            }
            if (column === "season_name") {
              return href(`/seasons/${row[columns.indexOf("season_id")]}`);
            }
            if (column === "away_team") {
              return href(
                `/seasons/${row[columns.indexOf("season_id")]}/teams/${row[columns.indexOf("away_team_pointstreak_link_id")]}`,
              );
            }
            if (column === "home_team") {
              return href(
                `/seasons/${row[columns.indexOf("season_id")]}/teams/${row[columns.indexOf("home_team_pointstreak_link_id")]}`,
              );
            }
            return undefined;
          }}
        />
      </section>
      <section>
        <h2>Box Score</h2>
        {lineScore.error ? <div className="notice error">{lineScore.error}</div> : null}
        <Table
          result={lineScore.result}
          columnHeaderMode={columnHeaderMode}
          query={lineScore.sql}
          hiddenColumns={["season_id", "team_pointstreak_link_id"]}
          cellHref={({ column, row, columns }) => {
            if (column !== "team") {
              return undefined;
            }
            return href(
              `/seasons/${row[columns.indexOf("season_id")]}/teams/${row[columns.indexOf("team_pointstreak_link_id")]}`,
            );
          }}
        />
      </section>
      <section>
        <h2>Away Batting</h2>
        <Table
          result={awayBatting.result}
          columnHeaderMode={columnHeaderMode}
          query={awayBatting.sql}
          hiddenColumns={["sort_order", "season_id", "pointstreak_player_id"]}
          cellHref={playerLink}
        />
      </section>
      <section>
        <h2>Home Batting</h2>
        <Table
          result={homeBatting.result}
          columnHeaderMode={columnHeaderMode}
          query={homeBatting.sql}
          hiddenColumns={["sort_order", "season_id", "pointstreak_player_id"]}
          cellHref={playerLink}
        />
      </section>
      <section>
        <h2>Away Pitching</h2>
        <Table
          result={awayPitching.result}
          columnHeaderMode={columnHeaderMode}
          query={awayPitching.sql}
          hiddenColumns={["sort_order", "pitching_order", "season_id", "pointstreak_player_id"]}
          cellHref={playerLink}
        />
      </section>
      <section>
        <h2>Home Pitching</h2>
        <Table
          result={homePitching.result}
          columnHeaderMode={columnHeaderMode}
          query={homePitching.sql}
          hiddenColumns={["sort_order", "pitching_order", "season_id", "pointstreak_player_id"]}
          cellHref={playerLink}
        />
      </section>
    </div>
  );
}

function buildBoxScoreSql(gameId: number, maxInning: number) {
  const inningColumns = Array.from({ length: Math.max(1, maxInning) }, (_, index) => index + 1)
    .map(
      (inning) =>
        `  COALESCE(MAX(CASE WHEN innings.inning_number = ${inning} THEN innings.runs END), '') AS "${inning}"`,
    )
    .join(",\n");

  return `
WITH game_teams AS (
  SELECT
    0 AS sort_order,
    games.season_id,
    games.away_team_pointstreak_link_id AS team_pointstreak_link_id,
    away.name AS team,
    games.away_score AS total_runs
  FROM games
  LEFT JOIN teams away ON away.pointstreak_team_link_id = games.away_team_pointstreak_link_id
  WHERE games.pointstreak_game_id = ${gameId}
  UNION ALL
  SELECT
    1 AS sort_order,
    games.season_id,
    games.home_team_pointstreak_link_id AS team_pointstreak_link_id,
    home.name AS team,
    games.home_score AS total_runs
  FROM games
  LEFT JOIN teams home ON home.pointstreak_team_link_id = games.home_team_pointstreak_link_id
  WHERE games.pointstreak_game_id = ${gameId}
)
SELECT
  game_teams.season_id,
  game_teams.team,
  game_teams.team_pointstreak_link_id,
${inningColumns},
  COALESCE(MAX(innings.total_runs), game_teams.total_runs) AS runs,
  MAX(innings.total_hits) AS hits,
  MAX(innings.total_errors) AS errors
FROM game_teams
LEFT JOIN innings
  ON innings.pointstreak_game_id = ${gameId}
  AND innings.team_pointstreak_link_id = game_teams.team_pointstreak_link_id
GROUP BY
  game_teams.sort_order,
  game_teams.season_id,
  game_teams.team,
  game_teams.team_pointstreak_link_id,
  game_teams.total_runs
ORDER BY game_teams.sort_order;
`;
}

type TableCellLinkContext = {
  column: string;
  value: unknown;
  row: unknown[];
  columns: string[];
  rowIndex: number;
  cellIndex: number;
};

function readFirstNumber(result: { columns: string[]; values: unknown[][] } | null, column: string) {
  const index = result?.columns.indexOf(column) ?? -1;
  if (index < 0) {
    return null;
  }

  const value = result?.values[0]?.[index];
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function battingBoxSql(gameId: number, isHome: 0 | 1) {
  return `
WITH player_rows AS (
  SELECT
    0 AS sort_order,
    batting_stats.season_id,
    lineups.order_idx AS batting_order,
    COALESCE(lineups.name, players.name, batting_stats.pointstreak_player_id) AS player_name,
    batting_stats.pointstreak_player_id,
    batting_stats.ab,
    batting_stats.runs,
    batting_stats.hits,
    batting_stats.rbi,
    batting_stats.bb,
    batting_stats.so,
    batting_stats.sb,
    batting_stats.hr
  FROM batting_stats
  LEFT JOIN lineups
    ON lineups.pointstreak_game_id = batting_stats.pointstreak_game_id
    AND lineups.team_pointstreak_link_id = batting_stats.team_pointstreak_link_id
    AND lineups.pointstreak_player_id = batting_stats.pointstreak_player_id
  LEFT JOIN players ON players.pointstreak_player_id = batting_stats.pointstreak_player_id
  WHERE batting_stats.pointstreak_game_id = ${gameId}
    AND batting_stats.is_home = ${isHome}
    AND (
      lineups.order_idx > 0
      OR COALESCE(batting_stats.ab, 0) > 0
      OR COALESCE(batting_stats.runs, 0) > 0
      OR COALESCE(batting_stats.hits, 0) > 0
      OR COALESCE(batting_stats.hr, 0) > 0
      OR COALESCE(batting_stats.rbi, 0) > 0
      OR COALESCE(batting_stats.bb, 0) > 0
      OR COALESCE(batting_stats.so, 0) > 0
      OR COALESCE(batting_stats.sb, 0) > 0
    )
),
combined AS (
  SELECT
    sort_order,
    season_id,
    batting_order,
    player_name,
    pointstreak_player_id,
    ab,
    runs,
    hits,
    rbi,
    bb,
    so,
    sb,
    hr
  FROM player_rows
  UNION ALL
  SELECT
    1 AS sort_order,
    MAX(season_id) AS season_id,
    NULL AS batting_order,
    'Total' AS player_name,
    NULL AS pointstreak_player_id,
    SUM(COALESCE(ab, 0)) AS ab,
    SUM(COALESCE(runs, 0)) AS runs,
    SUM(COALESCE(hits, 0)) AS hits,
    SUM(COALESCE(rbi, 0)) AS rbi,
    SUM(COALESCE(bb, 0)) AS bb,
    SUM(COALESCE(so, 0)) AS so,
    SUM(COALESCE(sb, 0)) AS sb,
    SUM(COALESCE(hr, 0)) AS hr
  FROM player_rows
)
SELECT
  sort_order,
  season_id,
  batting_order,
  player_name,
  pointstreak_player_id,
  ab,
  runs,
  hits,
  rbi,
  bb,
  so,
  sb,
  hr
FROM combined
ORDER BY sort_order, batting_order IS NULL, batting_order, player_name;
`;
}

function pitchingBoxSql(gameId: number, isHome: 0 | 1) {
  return `
WITH player_rows AS (
  SELECT
    0 AS sort_order,
    COALESCE(pitching_stats.pitching_order, 999) AS pitching_order,
    pitching_stats.season_id,
    COALESCE(lineups.name, players.name, pitching_stats.pointstreak_player_id) AS player_name,
    pitching_stats.pointstreak_player_id,
    pitching_stats.ip,
    CASE
      WHEN pitching_stats.ip IS NULL OR pitching_stats.ip = '' THEN 0
      WHEN instr(pitching_stats.ip, '.') > 0 THEN
        CAST(substr(pitching_stats.ip, 1, instr(pitching_stats.ip, '.') - 1) AS INTEGER) * 3
        + CAST(substr(pitching_stats.ip, instr(pitching_stats.ip, '.') + 1) AS INTEGER)
      ELSE CAST(pitching_stats.ip AS INTEGER) * 3
    END AS outs,
    pitching_stats.hits,
    pitching_stats.runs,
    pitching_stats.earned_runs,
    pitching_stats.bb,
    pitching_stats.so
  FROM pitching_stats
  LEFT JOIN lineups
    ON lineups.pointstreak_game_id = pitching_stats.pointstreak_game_id
    AND lineups.team_pointstreak_link_id = pitching_stats.team_pointstreak_link_id
    AND lineups.pointstreak_player_id = pitching_stats.pointstreak_player_id
  LEFT JOIN players ON players.pointstreak_player_id = pitching_stats.pointstreak_player_id
  WHERE pitching_stats.pointstreak_game_id = ${gameId}
    AND pitching_stats.is_home = ${isHome}
),
combined AS (
  SELECT
    sort_order,
    pitching_order,
    season_id,
    player_name,
    pointstreak_player_id,
    ip,
    hits,
    runs,
    earned_runs,
    bb,
    so
  FROM player_rows
  UNION ALL
  SELECT
    1 AS sort_order,
    9999 AS pitching_order,
    MAX(season_id) AS season_id,
    'Total' AS player_name,
    NULL AS pointstreak_player_id,
    CAST(SUM(outs) / 3 AS INTEGER) || '.' || (SUM(outs) % 3) AS ip,
    SUM(COALESCE(hits, 0)) AS hits,
    SUM(COALESCE(runs, 0)) AS runs,
    SUM(COALESCE(earned_runs, 0)) AS earned_runs,
    SUM(COALESCE(bb, 0)) AS bb,
    SUM(COALESCE(so, 0)) AS so
  FROM player_rows
)
SELECT
  sort_order,
  pitching_order,
  season_id,
  player_name,
  pointstreak_player_id,
  ip,
  hits,
  runs,
  earned_runs,
  bb,
  so
FROM combined
ORDER BY sort_order, pitching_order, player_name;
`;
}
