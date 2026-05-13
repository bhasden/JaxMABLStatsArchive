import { useMemo, useState } from "react";
import type { QueryResult } from "../data/archiveDb";
import type { ColumnHeaderMode } from "../hooks/useColumnHeaderMode";
import { href } from "../hooks/useHashRoute";
import { Table, usePageQuery, type ArchiveContext } from "./queryHelpers";

const TEAMS_SQL = `
SELECT
  canonical_team_name AS team_name,
  team_id,
  COUNT(DISTINCT season_id) AS seasons,
  COALESCE(SUM(games_played), 0) AS games_played,
  COALESCE(SUM(wins), 0) AS wins,
  COALESCE(SUM(losses), 0) AS losses,
  COALESCE(SUM(ties), 0) AS ties,
  MIN(season_id) AS first_season,
  MAX(season_id) AS last_season
FROM v_team_season_summary
WHERE team_id IS NOT NULL
GROUP BY team_id, canonical_team_name
ORDER BY canonical_team_name, team_id;
`;

export function TeamsPage({
  archive,
  columnHeaderMode,
}: {
  archive: ArchiveContext;
  columnHeaderMode: ColumnHeaderMode;
}) {
  const [search, setSearch] = useState("");
  const teams = usePageQuery(archive, TEAMS_SQL, "Archive teams");
  const filteredResult = useMemo(
    () => filterResult(teams.result, search, ["team_name", "team_id"]),
    [teams.result, search],
  );

  return (
    <div className="page-grid">
      <section className="page-hero">
        <p className="eyebrow">Archive Workbench</p>
        <h1>Teams</h1>
      </section>

      <section>
        <div className="section-title-row">
          <h2>Team Index</h2>
          <label className="browse-search">
            <span>Filter teams</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or team ID" />
          </label>
        </div>
        {teams.error ? <div className="notice error">{teams.error}</div> : null}
        <Table
          result={filteredResult}
          query={teams.sql}
          columnHeaderMode={columnHeaderMode}
          hiddenColumns={["team_id"]}
          cellHref={({ column, row, columns }) => {
            if (column !== "team_name") {
              return undefined;
            }
            const teamId = row[columns.indexOf("team_id")];
            return typeof teamId === "number" ? href(`/teams/${teamId}`) : undefined;
          }}
        />
      </section>
    </div>
  );
}

function filterResult(result: QueryResult | null, search: string, columns: string[]): QueryResult | null {
  const trimmedSearch = search.trim().toLowerCase();
  if (!result || !trimmedSearch) {
    return result;
  }

  const searchableIndexes = columns.map((column) => result.columns.indexOf(column)).filter((index) => index >= 0);

  return {
    ...result,
    values: result.values.filter((row) =>
      searchableIndexes.some((index) =>
        String(row[index] ?? "")
          .toLowerCase()
          .includes(trimmedSearch),
      ),
    ),
  };
}
