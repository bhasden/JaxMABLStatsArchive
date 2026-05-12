import { href } from "../hooks/useHashRoute";
import type { ColumnHeaderMode } from "../hooks/useColumnHeaderMode";
import { BattingLeaderSections, PitchingLeaderSections } from "./LeaderSections";
import { Table, type ArchiveContext, usePageQuery } from "./queryHelpers";

export function SeasonPage({
  archive,
  seasonId,
  columnHeaderMode,
}: {
  archive: ArchiveContext;
  seasonId: number;
  columnHeaderMode: ColumnHeaderMode;
}) {
  const overview = usePageQuery(
    archive,
    `
SELECT
  season_id,
  season_name,
  season_year,
  teams,
  games,
  players,
  runs,
  hits,
  home_runs
FROM v_season_summary
WHERE season_id = ${seasonId};
`,
    `Season ${seasonId} overview`,
  );

  const standings = usePageQuery(
    archive,
    `
SELECT
  name,
  games_played,
  wins,
  losses,
  ties,
  pct,
  team_id
FROM standings
WHERE season_id = ${seasonId}
ORDER BY wins DESC, pct DESC, name;
`,
    `Season ${seasonId} standings`,
  );

  const schedule = usePageQuery(
    archive,
    `
SELECT
  scheduled_at,
  away.name AS away_team,
  games.away_team_id,
  away_score,
  home_score,
  home.name AS home_team,
  games.home_team_id,
  status
FROM games
LEFT JOIN teams away ON away.team_id = games.away_team_id
LEFT JOIN teams home ON home.team_id = games.home_team_id
WHERE season_id = ${seasonId}
ORDER BY scheduled_at, game_id
LIMIT 50;
`,
    `Season ${seasonId} schedule`,
  );

  const seasonNameColumn = overview.result?.columns.indexOf("season_name") ?? -1;
  const seasonName = seasonNameColumn >= 0 ? overview.result?.values[0]?.[seasonNameColumn] : undefined;

  return (
    <div className="page-grid">
      <section className="section-head">
        <p className="eyebrow">Season</p>
        <h1>{seasonName ? String(seasonName) : seasonId}</h1>
      </section>
      <section>
        <h2>Season Overview</h2>
        {overview.error ? <div className="notice error">{overview.error}</div> : null}
        <Table result={overview.result} columnHeaderMode={columnHeaderMode} query={overview.sql} />
      </section>
      <section>
        <h2>Standings</h2>
        <Table
          result={standings.result}
          columnHeaderMode={columnHeaderMode}
          query={standings.sql}
          hiddenColumns={["team_id"]}
          cellHref={({ column, row, columns }) => {
            if (column !== "name") {
              return undefined;
            }
            return href(`/seasons/${seasonId}/teams/${row[columns.indexOf("team_id")]}`);
          }}
        />
      </section>
      <BattingLeaderSections archive={archive} columnHeaderMode={columnHeaderMode} seasonId={seasonId} />
      <PitchingLeaderSections archive={archive} columnHeaderMode={columnHeaderMode} seasonId={seasonId} />
      <section>
        <h2>Schedule</h2>
        <Table
          result={schedule.result}
          columnHeaderMode={columnHeaderMode}
          query={schedule.sql}
          hiddenColumns={["away_team_id", "home_team_id"]}
          cellHref={({ column, row, columns }) => {
            if (column === "away_team") {
              return href(`/seasons/${seasonId}/teams/${row[columns.indexOf("away_team_id")]}`);
            }
            if (column === "home_team") {
              return href(`/seasons/${seasonId}/teams/${row[columns.indexOf("home_team_id")]}`);
            }
            return undefined;
          }}
        />
      </section>
    </div>
  );
}
