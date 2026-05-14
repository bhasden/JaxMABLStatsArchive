import { buildPersonPlayersSql, buildPersonProfileSql } from "../data/personQueries";
import type { ColumnHeaderMode } from "../hooks/useColumnHeaderMode";
import { href } from "../hooks/useHashRoute";
import { Table, usePageQuery, type ArchiveContext } from "./queryHelpers";

export function PersonPage({
  archive,
  personId,
  columnHeaderMode,
}: {
  archive: ArchiveContext;
  personId: number;
  columnHeaderMode: ColumnHeaderMode;
}) {
  const profile = usePageQuery(archive, buildPersonProfileSql(personId), `Person ${personId} profile`);
  const linkedPlayers = usePageQuery(archive, buildPersonPlayersSql(personId), `Person ${personId} linked players`);

  const personNameColumn = profile.result?.columns.indexOf("person_name") ?? -1;
  const personName = personNameColumn >= 0 ? profile.result?.values[0]?.[personNameColumn] : undefined;

  return (
    <div className="page-grid">
      <section className="section-head">
        <p className="eyebrow">Person</p>
        <h1>{personName ? String(personName) : personId}</h1>
        <div className="context-links">
          <a href={href(`/people`)}>People Index</a>
        </div>
      </section>
      <section>
        <h2>Person Overview</h2>
        {profile.error ? <div className="notice error">{profile.error}</div> : null}
        <Table result={profile.result} columnHeaderMode={columnHeaderMode} query={profile.sql} hiddenColumns={[]} />
      </section>
      <section>
        <h2>Linked Competition Players</h2>
        <p className="section-copy">
          Person identity groups competition-local player records. Open a player page below for competition-scoped
          stats.
        </p>
        {linkedPlayers.error ? <div className="notice error">{linkedPlayers.error}</div> : null}
        <Table
          result={linkedPlayers.result}
          columnHeaderMode={columnHeaderMode}
          query={linkedPlayers.sql}
          hiddenColumns={["person_id", "competition_id"]}
          cellHref={({ column, row, columns }) => {
            const playerId = row[columns.indexOf("player_id")];
            const competitionId = row[columns.indexOf("competition_id")];
            if (column === "player_name" && typeof playerId === "number") {
              return href(`/players/${playerId}`);
            }
            if (column === "competition" && typeof playerId === "number" && typeof competitionId === "string") {
              return href(`/competitions/${competitionId}/players/${playerId}`);
            }
            return undefined;
          }}
        />
      </section>
    </div>
  );
}
