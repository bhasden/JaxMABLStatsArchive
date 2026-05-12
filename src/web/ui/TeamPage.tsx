import { useState } from "react";
import { BattingLeaderSections, PitchingLeaderSections } from "./LeaderSections";
import { href } from "../hooks/useHashRoute";
import type { ColumnHeaderMode } from "../hooks/useColumnHeaderMode";
import { Table, type ArchiveContext, usePageQuery } from "./queryHelpers";

export function TeamPage({
  archive,
  teamId,
  seasonId,
  columnHeaderMode,
}: {
  archive: ArchiveContext;
  teamId: number;
  seasonId?: number;
  columnHeaderMode: ColumnHeaderMode;
}) {
  const seasonFilter = seasonId != null ? `AND season_id = ${seasonId}` : "";
  const summary = usePageQuery(
    archive,
    `
SELECT
  season_name,
  season_id,
  canonical_team_name,
  season_team_name,
  games_played,
  wins,
  losses,
  ties,
  pct,
  rostered_players
FROM v_team_season_summary
WHERE team_id = ${teamId}
  ${seasonFilter}
ORDER BY season_id DESC;
`,
    seasonId != null ? `Team ${teamId} ${seasonId} summary` : `Team ${teamId} season summary`,
  );

  const roster = usePageQuery(
    archive,
    seasonId != null
      ? `
SELECT DISTINCT
  CASE
    WHEN last_name IS NOT NULL AND first_name IS NOT NULL THEN last_name || ', ' || first_name
    WHEN last_name IS NOT NULL THEN last_name
    WHEN first_name IS NOT NULL THEN first_name
    ELSE name
  END AS name,
  player_id,
  position,
  jersey,
  bats,
  throws,
  hometown
FROM rosters
WHERE team_id = ${teamId}
  AND season_id = ${seasonId}
ORDER BY COALESCE(last_name, name), first_name, name
LIMIT 100;
`
      : `
WITH player_games AS (
  SELECT player_id, game_id
  FROM lineups
  WHERE team_id = ${teamId}
    AND player_id IS NOT NULL
  UNION
  SELECT player_id, game_id
  FROM batting_stats
  WHERE team_id = ${teamId}
    AND player_id IS NOT NULL
  UNION
  SELECT player_id, game_id
  FROM pitching_stats
  WHERE team_id = ${teamId}
    AND player_id IS NOT NULL
)
SELECT
  CASE
    WHEN MAX(last_name) IS NOT NULL AND MAX(first_name) IS NOT NULL THEN MAX(last_name) || ', ' || MAX(first_name)
    WHEN MAX(last_name) IS NOT NULL THEN MAX(last_name)
    WHEN MAX(first_name) IS NOT NULL THEN MAX(first_name)
    ELSE MAX(name)
  END AS name,
  COUNT(DISTINCT season_id) AS seasons,
  player_id,
  (
    SELECT COUNT(DISTINCT game_id)
    FROM player_games
    WHERE player_games.player_id = rosters.player_id
  ) AS games_played
FROM rosters
WHERE team_id = ${teamId}
  AND player_id IS NOT NULL
GROUP BY player_id
ORDER BY COALESCE(MAX(last_name), MAX(name)), MAX(first_name), MAX(name)
LIMIT 500;
`,
    seasonId != null ? `Team ${teamId} ${seasonId} roster` : `Team ${teamId} all-time players`,
  );

  const teamNameColumn =
    summary.result?.columns.indexOf(seasonId != null ? "season_team_name" : "canonical_team_name") ?? -1;
  const teamName = teamNameColumn >= 0 ? summary.result?.values[0]?.[teamNameColumn] : undefined;
  const seasonNameColumn = summary.result?.columns.indexOf("season_name") ?? -1;
  const seasonName = seasonNameColumn >= 0 ? summary.result?.values[0]?.[seasonNameColumn] : undefined;

  return (
    <div className="page-grid">
      <section className="section-head">
        <p className="eyebrow">{seasonId != null ? `${seasonName ?? `Season ${seasonId}`} Team` : "Team"}</p>
        <h1>{teamName ? String(teamName) : `Team ${teamId}`}</h1>
        <div className="context-links">
          {seasonId != null ? <a href={href(`/teams/${teamId}`)}>Lifetime Team Page</a> : null}
          {seasonId != null ? <a href={href(`/seasons/${seasonId}`)}>Season Page</a> : null}
        </div>
      </section>
      <section>
        <h2>Season Summary</h2>
        <Table
          result={summary.result}
          columnHeaderMode={columnHeaderMode}
          query={summary.sql}
          hiddenColumns={["season_id"]}
          cellHref={({ column, row, columns }) =>
            column === "season_name" ? href(`/seasons/${row[columns.indexOf("season_id")]}/teams/${teamId}`) : undefined
          }
        />
      </section>
      <BattingLeaderSections
        archive={archive}
        columnHeaderMode={columnHeaderMode}
        seasonId={seasonId}
        teamId={teamId}
      />
      <PitchingLeaderSections
        archive={archive}
        columnHeaderMode={columnHeaderMode}
        seasonId={seasonId}
        teamId={teamId}
      />
      {seasonId != null ? (
        <TeamSeasonStatsSection
          archive={archive}
          columnHeaderMode={columnHeaderMode}
          seasonId={seasonId}
          teamId={teamId}
        />
      ) : null}
      <section>
        <h2>{seasonId != null ? "Roster" : "Players"}</h2>
        <Table
          result={roster.result}
          columnHeaderMode={columnHeaderMode}
          query={roster.sql}
          hiddenColumns={["player_id"]}
          cellHref={({ column, row, columns }) => {
            if (column !== "name") {
              return undefined;
            }
            const playerId = row[columns.indexOf("player_id")];
            if (!playerId) {
              return undefined;
            }
            return seasonId != null ? href(`/seasons/${seasonId}/players/${playerId}`) : href(`/players/${playerId}`);
          }}
        />
      </section>
    </div>
  );
}

function TeamSeasonStatsSection({
  archive,
  teamId,
  seasonId,
  columnHeaderMode,
}: {
  archive: ArchiveContext;
  teamId: number;
  seasonId: number;
  columnHeaderMode: ColumnHeaderMode;
}) {
  const [activeTable, setActiveTable] = useState<"batting" | "pitching">("batting");
  const batting = usePageQuery(
    archive,
    `
SELECT
  player_name,
  player_id,
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
FROM season_batting_stats
WHERE team_id = ${teamId}
  AND scope = 'team'
  AND season_id = ${seasonId}
ORDER BY
  COALESCE(
    (
      SELECT last_name
      FROM rosters
      WHERE rosters.season_id = season_batting_stats.season_id
        AND rosters.team_id = season_batting_stats.team_id
        AND rosters.player_id = season_batting_stats.player_id
        AND last_name IS NOT NULL
      LIMIT 1
    ),
    player_name
  ),
  player_name
LIMIT 50;
`,
    `Team ${teamId} ${seasonId} batting`,
  );
  const pitching = usePageQuery(
    archive,
    `
SELECT
  player_name,
  player_id,
  wins,
  losses,
  games,
  games_started,
  innings_pitched,
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
  era
FROM season_pitching_stats
WHERE team_id = ${teamId}
  AND scope = 'team'
  AND season_id = ${seasonId}
ORDER BY
  COALESCE(
    (
      SELECT last_name
      FROM rosters
      WHERE rosters.season_id = season_pitching_stats.season_id
        AND rosters.team_id = season_pitching_stats.team_id
        AND rosters.player_id = season_pitching_stats.player_id
        AND last_name IS NOT NULL
      LIMIT 1
    ),
    player_name
  ),
  player_name
LIMIT 50;
`,
    `Team ${teamId} ${seasonId} pitching`,
  );

  const activeResult = activeTable === "batting" ? batting : pitching;

  return (
    <section>
      <div className="section-title-row">
        <h2>Team Stats</h2>
        <div className="segmented-control" role="tablist" aria-label="Team stats table">
          <button
            type="button"
            role="tab"
            aria-selected={activeTable === "batting"}
            className={activeTable === "batting" ? "active" : ""}
            onClick={() => setActiveTable("batting")}
          >
            Batting
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTable === "pitching"}
            className={activeTable === "pitching" ? "active" : ""}
            onClick={() => setActiveTable("pitching")}
          >
            Pitching
          </button>
        </div>
      </div>
      <Table
        result={activeResult.result}
        columnHeaderMode={columnHeaderMode}
        query={activeResult.sql}
        hiddenColumns={["player_id"]}
        cellHref={({ column, row, columns }) => {
          if (column !== "player_name") {
            return undefined;
          }
          const playerId = row[columns.indexOf("player_id")];
          return playerId ? href(`/seasons/${seasonId}/players/${playerId}`) : undefined;
        }}
      />
    </section>
  );
}
