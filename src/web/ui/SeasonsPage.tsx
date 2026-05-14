import { useEffect, useState } from "react";
import { href } from "../hooks/useHashRoute";
import { Table, usePageQuery, type ArchiveContext } from "./queryHelpers";
import type { ColumnHeaderMode } from "../hooks/useColumnHeaderMode";
import { ARCHIVE_COMPETITIONS, DEFAULT_COMPETITION_ID } from "../../lib/constants";

function seasonsSql(competitionId: string) {
  return `
SELECT
  competition,
  competition_id,
  season_name,
  season_id,
  teams,
  games,
  players,
  runs,
  hits,
  home_runs
FROM v_season_summary
WHERE competition_id = '${competitionId.replace(/'/g, "''")}'
ORDER BY season_id DESC;
`;
}

export function SeasonsPage({
  archive,
  columnHeaderMode,
  initialCompetitionId = DEFAULT_COMPETITION_ID,
}: {
  archive: ArchiveContext;
  columnHeaderMode: ColumnHeaderMode;
  initialCompetitionId?: string;
}) {
  const [competitionId, setCompetitionId] = useState(initialCompetitionId);
  useEffect(() => setCompetitionId(initialCompetitionId), [initialCompetitionId]);
  const seasons = usePageQuery(archive, seasonsSql(competitionId), `Archive seasons for ${competitionId}`);

  return (
    <div className="page-grid">
      <section className="page-hero">
        <p className="eyebrow">Archive Workbench</p>
        <h1>Seasons</h1>
      </section>

      <section>
        <div className="section-title-row">
          <h2>Archived Seasons</h2>
          <label className="browse-search">
            <span>Competition</span>
            <select value={competitionId} onChange={(event) => setCompetitionId(event.currentTarget.value)}>
              {ARCHIVE_COMPETITIONS.map((competition) => (
                <option key={competition.id} value={competition.id}>
                  {competition.shortName}
                </option>
              ))}
            </select>
          </label>
        </div>
        {seasons.error ? <div className="notice error">{seasons.error}</div> : null}
        <Table
          result={seasons.result}
          query={seasons.sql}
          columnHeaderMode={columnHeaderMode}
          hiddenColumns={["season_id", "competition_id"]}
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
