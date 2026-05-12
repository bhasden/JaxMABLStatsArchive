import { useState } from "react";
import { href } from "../hooks/useHashRoute";
import type { ColumnHeaderMode } from "../hooks/useColumnHeaderMode";
import { Table, type ArchiveContext, usePageQuery } from "./queryHelpers";

type LeaderScope = {
  archive: ArchiveContext;
  seasonId?: number;
  teamId?: number;
  columnHeaderMode: ColumnHeaderMode;
};

type LeaderMode = "singleSeason" | "career";
type BattingLeaderCategory = "hits" | "hr" | "avr" | "rbi";
type PitchingLeaderCategory = "wins" | "so" | "era";

const TEAM_LEADER_LIMIT = 5;
const compactSeasonNameExpression = "NULLIF(TRIM(REPLACE(seasons.name, 'JAX MABL', '')), '')";

function scopeWhere(seasonId?: number, teamId?: number) {
  const clauses: string[] = [];
  if (seasonId != null) {
    clauses.push(`season_id = ${seasonId}`);
  }
  if (teamId != null) {
    clauses.push(`team_id = ${teamId}`);
  } else {
    clauses.push("scope = 'league'");
  }
  return clauses.join(" AND ");
}

function leaderLabel(prefix: string, seasonId?: number, teamId?: number) {
  if (teamId != null) {
    return `Team ${teamId} ${prefix}`;
  }
  return `Season ${seasonId} ${prefix}`;
}

function teamBattingSql(teamId: number, category: "hr" | "avr" | "rbi", statColumn: string, seasonId?: number) {
  const seasonFilter = seasonId != null ? `AND stats.season_id = ${seasonId}` : "";
  const seasonSelect =
    seasonId == null
      ? `COALESCE(${compactSeasonNameExpression}, seasons.name) AS season_name,\n    stats.season_id,`
      : "stats.season_id,";
  const seasonColumns = seasonId == null ? "season_name, season_id, " : "season_id, ";
  const statExpression =
    category === "avr" ? "printf('%.3f', CAST(stats.hits AS REAL) / stats.at_bats)" : `stats.${statColumn}`;
  const orderExpression =
    category === "avr" ? "CAST(stats.hits AS REAL) / stats.at_bats" : `CAST(stats.${statColumn} AS INTEGER)`;
  const tieBreaker = category === "avr" ? "CAST(stats.at_bats AS INTEGER) DESC" : "player_name";
  const averageFilter = category === "avr" ? "AND stats.at_bats > 0" : "";
  const plateAppearanceFilter =
    category === "avr"
      ? `AND (
      COALESCE(stats.at_bats, 0)
      + COALESCE(stats.walks, 0)
      + COALESCE(stats.hit_by_pitch, 0)
      + COALESCE(stats.sacrifice_flies, 0)
    ) >= standings.games_played * 2.7`
      : "";
  return `
WITH ranked AS (
  SELECT
    ROW_NUMBER() OVER (ORDER BY ${orderExpression} DESC, ${tieBreaker}, stats.player_name) AS rank,
    ${seasonSelect}
    stats.player_name,
    ${statExpression} AS ${statColumn},
    stats.player_id
  FROM season_batting_stats stats
  JOIN standings ON standings.season_id = stats.season_id
    AND standings.team_id = stats.team_id
  LEFT JOIN seasons ON seasons.season_id = stats.season_id
  WHERE stats.team_id = ${teamId}
    AND stats.scope = 'team'
    ${seasonFilter}
    AND stats.player_id IS NOT NULL
    ${plateAppearanceFilter}
    ${averageFilter}
)
SELECT rank, ${seasonColumns}player_name, ${statColumn}, player_id
FROM ranked
ORDER BY rank
LIMIT ${TEAM_LEADER_LIMIT};
`;
}

function teamCareerBattingSql(teamId: number, category: BattingLeaderCategory, statColumn: string) {
  const statExpression = category === "avr" ? "printf('%.3f', CAST(hits AS REAL) / at_bats)" : statColumn;
  const orderExpression = category === "avr" ? "CAST(hits AS REAL) / at_bats" : `CAST(${statColumn} AS INTEGER)`;
  const tieBreaker = category === "avr" ? "CAST(at_bats AS INTEGER) DESC" : "player_name";
  const qualificationFilter = category === "avr" ? "WHERE plate_appearances >= team_games * 2.7 AND at_bats > 0" : "";

  return `
WITH totals AS (
  SELECT
    stats.player_id,
    COALESCE(players.name, stats.player_name) AS player_name,
    SUM(COALESCE(stats.hits, 0)) AS hits,
    SUM(COALESCE(stats.home_runs, 0)) AS home_runs,
    SUM(COALESCE(stats.at_bats, 0)) AS at_bats,
    SUM(
      COALESCE(stats.at_bats, 0)
      + COALESCE(stats.walks, 0)
      + COALESCE(stats.hit_by_pitch, 0)
      + COALESCE(stats.sacrifice_flies, 0)
    ) AS plate_appearances,
    SUM(standings.games_played) AS team_games
  FROM season_batting_stats stats
  JOIN standings ON standings.season_id = stats.season_id
    AND standings.team_id = stats.team_id
  LEFT JOIN players ON players.player_id = stats.player_id
  WHERE stats.team_id = ${teamId}
    AND stats.scope = 'team'
    AND stats.player_id IS NOT NULL
  GROUP BY stats.player_id
),
ranked AS (
  SELECT
    ROW_NUMBER() OVER (ORDER BY ${orderExpression} DESC, ${tieBreaker}, player_name) AS rank,
    player_name,
    ${statExpression} AS ${statColumn},
    player_id
  FROM totals
  ${qualificationFilter}
)
SELECT rank, player_name, ${statColumn}, player_id
FROM ranked
ORDER BY rank
LIMIT ${TEAM_LEADER_LIMIT};
`;
}

function teamPitchingSql(teamId: number, category: PitchingLeaderCategory, statColumn: string, seasonId?: number) {
  const seasonFilter = seasonId != null ? `AND stats.season_id = ${seasonId}` : "";
  const seasonSelect =
    seasonId == null
      ? `COALESCE(${compactSeasonNameExpression}, seasons.name) AS season_name,\n    stats.season_id,`
      : "stats.season_id,";
  const seasonColumns = seasonId == null ? "season_name, season_id, " : "season_id, ";
  const outsExpression = `
    CASE
      WHEN stats.innings_pitched IS NULL OR stats.innings_pitched = '' THEN 0
      WHEN instr(stats.innings_pitched, '.') > 0 THEN
        CAST(substr(stats.innings_pitched, 1, instr(stats.innings_pitched, '.') - 1) AS INTEGER) * 3
        + CAST(substr(stats.innings_pitched, instr(stats.innings_pitched, '.') + 1) AS INTEGER)
      ELSE CAST(stats.innings_pitched AS INTEGER) * 3
    END
  `;
  const orderExpression =
    category === "era" ? "(COALESCE(earned_runs, 0) * 27.0) / outs" : `CAST(${statColumn} AS INTEGER)`;
  const orderDirection = category === "era" ? "ASC" : "DESC";
  const statExpression = category === "era" ? "printf('%.2f', (COALESCE(earned_runs, 0) * 27.0) / outs)" : statColumn;
  const qualificationFilter = category === "era" ? "WHERE outs >= team_games * 0.8 * 3 AND outs > 0" : "";
  return `
WITH qualified AS (
  SELECT
    ${seasonSelect}
    stats.player_name,
    stats.${statColumn},
    stats.earned_runs,
    ${outsExpression} AS outs,
    standings.games_played AS team_games,
    stats.player_id
  FROM season_pitching_stats stats
  JOIN standings ON standings.season_id = stats.season_id
    AND standings.team_id = stats.team_id
  LEFT JOIN seasons ON seasons.season_id = stats.season_id
  WHERE stats.team_id = ${teamId}
    AND stats.scope = 'team'
    ${seasonFilter}
    AND stats.player_id IS NOT NULL
),
ranked AS (
  SELECT
    ROW_NUMBER() OVER (ORDER BY ${orderExpression} ${orderDirection}, outs DESC, player_name) AS rank,
    ${seasonColumns}
    player_name,
    ${statExpression} AS ${statColumn},
    player_id
  FROM qualified
  ${qualificationFilter}
)
SELECT rank, ${seasonColumns}player_name, ${statColumn}, player_id
FROM ranked
ORDER BY rank
LIMIT ${TEAM_LEADER_LIMIT};
`;
}

function teamCareerPitchingSql(teamId: number, category: PitchingLeaderCategory, statColumn: string) {
  const outsExpression = `
    CASE
      WHEN stats.innings_pitched IS NULL OR stats.innings_pitched = '' THEN 0
      WHEN instr(stats.innings_pitched, '.') > 0 THEN
        CAST(substr(stats.innings_pitched, 1, instr(stats.innings_pitched, '.') - 1) AS INTEGER) * 3
        + CAST(substr(stats.innings_pitched, instr(stats.innings_pitched, '.') + 1) AS INTEGER)
      ELSE CAST(stats.innings_pitched AS INTEGER) * 3
    END
  `;
  const orderExpression =
    category === "era" ? "(COALESCE(earned_runs, 0) * 27.0) / outs" : `CAST(${statColumn} AS INTEGER)`;
  const orderDirection = category === "era" ? "ASC" : "DESC";
  const statExpression = category === "era" ? "printf('%.2f', (COALESCE(earned_runs, 0) * 27.0) / outs)" : statColumn;
  const qualificationFilter = category === "era" ? "WHERE outs >= team_games * 0.8 * 3 AND outs > 0" : "";

  return `
WITH pitcher_seasons AS (
  SELECT
    stats.player_id,
    COALESCE(players.name, stats.player_name) AS player_name,
    COALESCE(stats.wins, 0) AS wins,
    COALESCE(stats.strikeouts, 0) AS strikeouts,
    COALESCE(stats.earned_runs, 0) AS earned_runs,
    ${outsExpression} AS outs,
    standings.games_played AS team_games
  FROM season_pitching_stats stats
  JOIN standings ON standings.season_id = stats.season_id
    AND standings.team_id = stats.team_id
  LEFT JOIN players ON players.player_id = stats.player_id
  WHERE stats.team_id = ${teamId}
    AND stats.scope = 'team'
    AND stats.player_id IS NOT NULL
),
totals AS (
  SELECT
    player_id,
    player_name,
    SUM(wins) AS wins,
    SUM(strikeouts) AS strikeouts,
    SUM(earned_runs) AS earned_runs,
    SUM(outs) AS outs,
    SUM(team_games) AS team_games
  FROM pitcher_seasons
  GROUP BY player_id
),
ranked AS (
  SELECT
    ROW_NUMBER() OVER (ORDER BY ${orderExpression} ${orderDirection}, outs DESC, player_name) AS rank,
    player_name,
    ${statExpression} AS ${statColumn},
    player_id
  FROM totals
  ${qualificationFilter}
)
SELECT rank, player_name, ${statColumn}, player_id
FROM ranked
ORDER BY rank
LIMIT ${TEAM_LEADER_LIMIT};
`;
}

function BattingLeaderTable({
  archive,
  title,
  category,
  statColumn,
  leaderMode = "singleSeason",
  seasonId,
  teamId,
  columnHeaderMode,
}: LeaderScope & { title: string; category: BattingLeaderCategory; statColumn: string; leaderMode?: LeaderMode }) {
  const where = scopeWhere(seasonId, teamId);
  const includeTeam = teamId == null;
  const sql =
    teamId != null && leaderMode === "career"
      ? teamCareerBattingSql(teamId, category, statColumn)
      : teamId != null
        ? teamBattingSql(teamId, category as "hr" | "avr" | "rbi", statColumn, seasonId)
        : `
SELECT
  rank,
  player_name,
  ${includeTeam ? "source_team_name," : ""}
  ${statColumn},
  player_id
FROM season_batting_leaders
WHERE ${where}
  AND leader_category = '${category}'
ORDER BY rank
LIMIT 10;
`;
  const result = usePageQuery(archive, sql, leaderLabel(title, seasonId, teamId));
  const isCompactSingleSeasonTeamLeader = teamId != null && seasonId == null && leaderMode === "singleSeason";

  return (
    <div className={isCompactSingleSeasonTeamLeader ? "leader-panel compact-leader-panel" : "leader-panel"}>
      <h3>{title}</h3>
      <Table
        result={result.result}
        columnHeaderMode={columnHeaderMode}
        query={result.sql}
        hiddenColumns={["season_id", "player_id"]}
        cellHref={({ column, row, columns }) => {
          const rowSeasonId = seasonId ?? row[columns.indexOf("season_id")];
          if (column === "season_name" && teamId != null && rowSeasonId) {
            return href(`/seasons/${rowSeasonId}/teams/${teamId}`);
          }
          if (column === "player_name") {
            const playerId = row[columns.indexOf("player_id")];
            return rowSeasonId ? href(`/seasons/${rowSeasonId}/players/${playerId}`) : href(`/players/${playerId}`);
          }
          return undefined;
        }}
      />
    </div>
  );
}

function PitchingLeaderTable({
  archive,
  title,
  category,
  statColumn,
  leaderMode = "singleSeason",
  seasonId,
  teamId,
  columnHeaderMode,
}: LeaderScope & { title: string; category: PitchingLeaderCategory; statColumn: string; leaderMode?: LeaderMode }) {
  const where = scopeWhere(seasonId, teamId);
  const includeTeam = teamId == null;
  const categoryWhere =
    category === "so" && teamId != null
      ? "(leader_category = 'so' OR leader_category = 'sho')"
      : `leader_category = '${category}'`;
  const orderBy = category === "so" && teamId != null ? "CAST(strikeouts AS INTEGER) DESC, rank" : "rank";
  const sql =
    teamId != null && leaderMode === "career"
      ? teamCareerPitchingSql(teamId, category, statColumn)
      : teamId != null
        ? teamPitchingSql(teamId, category, statColumn, seasonId)
        : `
SELECT
  rank,
  player_name,
  ${includeTeam ? "source_team_name," : ""}
  ${statColumn},
  player_id
FROM season_pitching_leaders
WHERE ${where}
  AND ${categoryWhere}
ORDER BY ${orderBy}
LIMIT 10;
`;
  const result = usePageQuery(archive, sql, leaderLabel(title, seasonId, teamId));
  const isCompactSingleSeasonTeamLeader = teamId != null && seasonId == null && leaderMode === "singleSeason";

  return (
    <div className={isCompactSingleSeasonTeamLeader ? "leader-panel compact-leader-panel" : "leader-panel"}>
      <h3>{title}</h3>
      <Table
        result={result.result}
        columnHeaderMode={columnHeaderMode}
        query={result.sql}
        hiddenColumns={["season_id", "player_id"]}
        cellHref={({ column, row, columns }) => {
          const rowSeasonId = seasonId ?? row[columns.indexOf("season_id")];
          if (column === "season_name" && teamId != null && rowSeasonId) {
            return href(`/seasons/${rowSeasonId}/teams/${teamId}`);
          }
          if (column === "player_name") {
            const playerId = row[columns.indexOf("player_id")];
            return rowSeasonId ? href(`/seasons/${rowSeasonId}/players/${playerId}`) : href(`/players/${playerId}`);
          }
          return undefined;
        }}
      />
    </div>
  );
}

export function BattingLeaderSections(props: LeaderScope) {
  const showLeaderModeToggle = props.teamId != null && props.seasonId == null;
  const [leaderMode, setLeaderMode] = useState<LeaderMode>("singleSeason");
  const tables =
    leaderMode === "career"
      ? [
          { title: "Average", category: "avr" as const, statColumn: "batting_average" },
          { title: "Home Runs", category: "hr" as const, statColumn: "home_runs" },
          { title: "Hits", category: "hits" as const, statColumn: "hits" },
        ]
      : [
          { title: "Average", category: "avr" as const, statColumn: "batting_average" },
          { title: "Home Runs", category: "hr" as const, statColumn: "home_runs" },
          { title: "RBI", category: "rbi" as const, statColumn: "runs_batted_in" },
        ];

  return (
    <section>
      <LeaderSectionHead
        title="Batting Leaders"
        leaderMode={leaderMode}
        setLeaderMode={setLeaderMode}
        showToggle={showLeaderModeToggle}
      />
      <p className="leader-note">
        Minimum qualification for average: 2.7 plate appearances per team game
        {leaderMode === "career" ? " in seasons played for this team." : "."}
      </p>
      <div className="leader-grid">
        {tables.map((table) => (
          <BattingLeaderTable key={table.title} {...props} {...table} leaderMode={leaderMode} />
        ))}
      </div>
    </section>
  );
}

export function PitchingLeaderSections(props: LeaderScope) {
  const showLeaderModeToggle = props.teamId != null && props.seasonId == null;
  const [leaderMode, setLeaderMode] = useState<LeaderMode>("singleSeason");

  return (
    <section>
      <LeaderSectionHead
        title="Pitching Leaders"
        leaderMode={leaderMode}
        setLeaderMode={setLeaderMode}
        showToggle={showLeaderModeToggle}
      />
      <p className="leader-note">
        Minimum qualification for ERA: 0.8 innings pitched per team game
        {leaderMode === "career" ? " in seasons played for this team." : "."}
      </p>
      <div className="leader-grid">
        <PitchingLeaderTable {...props} title="Wins" category="wins" statColumn="wins" leaderMode={leaderMode} />
        <PitchingLeaderTable
          {...props}
          title="Strikeouts"
          category="so"
          statColumn="strikeouts"
          leaderMode={leaderMode}
        />
        <PitchingLeaderTable {...props} title="ERA" category="era" statColumn="era" leaderMode={leaderMode} />
      </div>
    </section>
  );
}

function LeaderSectionHead({
  title,
  leaderMode,
  setLeaderMode,
  showToggle,
}: {
  title: string;
  leaderMode: LeaderMode;
  setLeaderMode: (mode: LeaderMode) => void;
  showToggle: boolean;
}) {
  if (!showToggle) {
    return <h2>{title}</h2>;
  }

  return (
    <div className="section-title-row">
      <h2>{title}</h2>
      <div className="segmented-control" role="tablist" aria-label={`${title} view`}>
        <button
          type="button"
          role="tab"
          aria-selected={leaderMode === "singleSeason"}
          className={leaderMode === "singleSeason" ? "active" : ""}
          onClick={() => setLeaderMode("singleSeason")}
        >
          Single-Season
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={leaderMode === "career"}
          className={leaderMode === "career" ? "active" : ""}
          onClick={() => setLeaderMode("career")}
        >
          Career With Team
        </button>
      </div>
    </div>
  );
}
