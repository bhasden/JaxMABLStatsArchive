import { useEffect, useMemo, useState } from "react";
import type { QueryResult } from "../data/archiveDb";
import type { ColumnHeaderMode } from "../hooks/useColumnHeaderMode";
import { href } from "../hooks/useHashRoute";
import { Table, usePageQuery, type ArchiveContext } from "./queryHelpers";
import { ARCHIVE_COMPETITIONS, DEFAULT_COMPETITION_ID } from "../../lib/constants";

function playersSql(competitionId: string) {
  const competition = competitionId.replace(/'/g, "''");
  return `
WITH player_activity AS (
  SELECT player_id, season_id, game_id
  FROM batting_stats
  WHERE player_id IS NOT NULL
    AND competition_id = '${competition}'
    AND (COALESCE(ab, 0) > 0 OR COALESCE(runs, 0) > 0 OR COALESCE(hits, 0) > 0 OR COALESCE(bb, 0) > 0 OR COALESCE(so, 0) > 0 OR COALESCE(sb, 0) > 0 OR COALESCE(hr, 0) > 0 OR COALESCE(rbi, 0) > 0)
  UNION
  SELECT player_id, season_id, game_id
  FROM pitching_stats
  WHERE player_id IS NOT NULL
    AND competition_id = '${competition}'
    AND (COALESCE(NULLIF(ip, ''), '0') NOT IN ('0', '0.0') OR COALESCE(runs, 0) > 0 OR COALESCE(earned_runs, 0) > 0 OR COALESCE(hits, 0) > 0 OR COALESCE(bb, 0) > 0 OR COALESCE(so, 0) > 0 OR COALESCE(win, 0) > 0 OR COALESCE(loss, 0) > 0 OR COALESCE(save, 0) > 0)
  UNION
  SELECT player_id, season_id, NULL AS game_id
  FROM season_batting_stats
  WHERE player_id IS NOT NULL
    AND competition_id = '${competition}'
  UNION
  SELECT player_id, season_id, NULL AS game_id
  FROM season_pitching_stats
  WHERE player_id IS NOT NULL
    AND competition_id = '${competition}'
)
SELECT
  players.name AS player_name,
  players.player_id,
  players.competition_id,
  COUNT(DISTINCT player_activity.season_id) AS seasons,
  COUNT(DISTINCT player_activity.game_id) AS games_played,
  MIN(player_activity.season_id) AS first_season,
  MAX(player_activity.season_id) AS last_season
FROM players
JOIN player_activity ON player_activity.player_id = players.player_id
WHERE players.competition_id = '${competition}'
GROUP BY players.player_id, players.name
ORDER BY players.name, players.player_id;
`;
}

export function PlayersPage({
  archive,
  columnHeaderMode,
  initialCompetitionId = DEFAULT_COMPETITION_ID,
}: {
  archive: ArchiveContext;
  columnHeaderMode: ColumnHeaderMode;
  initialCompetitionId?: string;
}) {
  const [search, setSearch] = useState("");
  const [competitionId, setCompetitionId] = useState(initialCompetitionId);
  useEffect(() => setCompetitionId(initialCompetitionId), [initialCompetitionId]);
  const players = usePageQuery(archive, playersSql(competitionId), `Archive players for ${competitionId}`);
  const filteredResult = useMemo(
    () => filterResult(players.result, search, ["player_name", "player_id"]),
    [players.result, search],
  );

  return (
    <div className="page-grid">
      <section className="page-hero">
        <p className="eyebrow">Archive Workbench</p>
        <h1>Players</h1>
      </section>

      <section>
        <div className="section-title-row">
          <h2>Player Index</h2>
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
          <label className="browse-search">
            <span>Filter players</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or player ID" />
          </label>
        </div>
        {players.error ? <div className="notice error">{players.error}</div> : null}
        <Table
          result={filteredResult}
          query={players.sql}
          columnHeaderMode={columnHeaderMode}
          hiddenColumns={["player_id", "competition_id"]}
          cellHref={({ column, row, columns }) => {
            if (column !== "player_name") {
              return undefined;
            }
            const playerId = row[columns.indexOf("player_id")];
            return typeof playerId === "number" ? href(`/players/${playerId}`) : undefined;
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
