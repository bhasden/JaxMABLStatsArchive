import { href } from "../hooks/useHashRoute";
import { Table, usePageQuery, type ArchiveContext } from "./queryHelpers";
import type { ColumnHeaderMode } from "../hooks/useColumnHeaderMode";

const SEASONS_SQL = `
SELECT
  season_name,
  season_id,
  teams,
  games,
  players,
  runs,
  hits,
  home_runs
FROM v_season_summary
ORDER BY season_id DESC;
`;

export function SeasonsPage({
  archive,
  columnHeaderMode,
}: {
  archive: ArchiveContext;
  columnHeaderMode: ColumnHeaderMode;
}) {
  const seasons = usePageQuery(archive, SEASONS_SQL, "Archive seasons");

  return (
    <div className="page-grid">
      <section className="page-hero">
        <p className="eyebrow">Archive Workbench</p>
        <h1>Seasons</h1>
      </section>

      <section>
        <h2>Archived Seasons</h2>
        {seasons.error ? <div className="notice error">{seasons.error}</div> : null}
        <Table
          result={seasons.result}
          query={seasons.sql}
          columnHeaderMode={columnHeaderMode}
          hiddenColumns={["season_id"]}
          cellHref={({ column, row, columns }) => {
            if (column !== "season_name") {
              return undefined;
            }
            const seasonId = row[columns.indexOf("season_id")];
            return typeof seasonId === "number" ? href(`/seasons/${seasonId}`) : undefined;
          }}
        />
      </section>
    </div>
  );
}
