import { useMemo, useState } from "react";
import {
  LEAGUE_BATTING_LEADER_TABLES,
  LEAGUE_LONGEVITY_LEADER_TABLES,
  LEAGUE_PITCHING_LEADER_TABLES,
  PLAYER_LOOKUP_SQL,
  buildLeaguePlayerRankSql,
} from "../data/leagueLeaderQueries";
import { href } from "../hooks/useHashRoute";
import type { ColumnHeaderMode } from "../hooks/useColumnHeaderMode";
import { Table, type ArchiveContext, usePageQuery } from "./queryHelpers";

const SEASONS_SQL = `
SELECT
  season_id,
  season_name,
  teams,
  games,
  players,
  runs,
  hits,
  home_runs
FROM v_season_summary
ORDER BY season_id DESC;
`;

const ROLLUP_SQL = `
SELECT
  COUNT(DISTINCT team_id) AS teams,
  (SELECT COUNT(*) FROM players) AS players,
  (SELECT COUNT(*) FROM games) AS games,
  (SELECT SUM(runs) FROM batting_stats) AS runs,
  (SELECT SUM(hits) FROM batting_stats) AS hits,
  (SELECT SUM(hr) FROM batting_stats) AS home_runs
FROM teams;
`;

export function HomePage({
  archive,
  columnHeaderMode,
}: {
  archive: ArchiveContext;
  columnHeaderMode: ColumnHeaderMode;
}) {
  const seasons = usePageQuery(archive, SEASONS_SQL, "Seasons list");
  const rollup = usePageQuery(archive, ROLLUP_SQL, "League rollup");
  const players = usePageQuery(archive, PLAYER_LOOKUP_SQL, "League player lookup");
  const [playerFilter, setPlayerFilter] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const playerRanks = usePageQuery(
    archive,
    buildLeaguePlayerRankSql(selectedPlayerId),
    selectedPlayerId != null ? `League player ${selectedPlayerId} rank lookup` : "League player rank lookup",
  );
  const playerOptions = useMemo(() => {
    return (players.result?.values ?? [])
      .map((row) => ({
        id: Number(row[0]),
        name: String(row[1] ?? row[0]),
      }))
      .filter((player) => Number.isFinite(player.id));
  }, [players.result]);
  const matchingPlayers = useMemo(() => {
    const normalizedFilter = playerFilter.trim().toLowerCase();
    return normalizedFilter
      ? playerOptions.filter((player) => `${player.name} ${player.id}`.toLowerCase().includes(normalizedFilter))
      : playerOptions;
  }, [playerFilter, playerOptions]);
  const filteredPlayers = matchingPlayers.slice(0, 100);
  const playerFilterActive = playerFilter.trim().length > 0;
  const selectedPlayer = playerOptions.find((player) => player.id === selectedPlayerId);

  return (
    <div className="page-grid">
      <section className="page-hero">
        <p className="eyebrow">Historical archive</p>
        <h1>JAX MABL stats, preserved and queryable.</h1>
      </section>

      <section>
        <h2>League Rollup</h2>
        <Table result={rollup.result} columnHeaderMode={columnHeaderMode} query={rollup.sql} />
      </section>

      <section>
        <h2>League Longevity</h2>
        <div className="leader-grid">
          {LEAGUE_LONGEVITY_LEADER_TABLES.map((table) => (
            <LeagueLeaderTable
              key={table.title}
              archive={archive}
              title={table.title}
              sql={table.sql}
              label={table.label}
              columnHeaderMode={columnHeaderMode}
            />
          ))}
        </div>
      </section>

      <section>
        <h2>Batting Leaders</h2>
        <p className="leader-note">Career AVG requires 300 at-bats.</p>
        <div className="leader-grid">
          {LEAGUE_BATTING_LEADER_TABLES.map((table) => (
            <LeagueLeaderTable
              key={table.title}
              archive={archive}
              title={table.title}
              sql={table.sql}
              label={table.label}
              columnHeaderMode={columnHeaderMode}
            />
          ))}
        </div>
      </section>

      <section>
        <h2>Pitching Leaders</h2>
        <p className="leader-note">Career ERA requires 100 innings pitched.</p>
        <div className="leader-grid">
          {LEAGUE_PITCHING_LEADER_TABLES.map((table) => (
            <LeagueLeaderTable
              key={table.title}
              archive={archive}
              title={table.title}
              sql={table.sql}
              label={table.label}
              columnHeaderMode={columnHeaderMode}
            />
          ))}
        </div>
      </section>

      <section>
        <h2>Player Rank Lookup</h2>
        <div className="lookup-controls">
          <label>
            <span>Filter players</span>
            <input
              type="search"
              value={playerFilter}
              onChange={(event) => setPlayerFilter(event.currentTarget.value)}
              placeholder="Search by name or ID"
            />
          </label>
          <label>
            <span>Player</span>
            <select
              value={selectedPlayerId ?? ""}
              onChange={(event) =>
                setSelectedPlayerId(event.currentTarget.value ? Number(event.currentTarget.value) : null)
              }
            >
              <option value="">Select a player</option>
              {filteredPlayers.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
            </select>
          </label>
          {selectedPlayer ? (
            <a
              className="lookup-open-link"
              href={href(`/players/${selectedPlayer.id}`)}
              target="_blank"
              rel="noreferrer"
              title="Open Player Page"
              aria-label="Open Player Page"
            >
              ↗
            </a>
          ) : null}
        </div>
        {playerFilterActive ? (
          <div className="lookup-status">
            {filteredPlayers.length > 0
              ? `${filteredPlayers.length}${matchingPlayers.length > filteredPlayers.length ? "+" : ""} matching players in the dropdown`
              : "No matching players"}
          </div>
        ) : null}
        {players.error ? <div className="notice error">{players.error}</div> : null}
        {playerRanks.error ? <div className="notice error">{playerRanks.error}</div> : null}
        {selectedPlayer == null ? (
          <div className="notice">Select a player to see their league ranks across these categories.</div>
        ) : null}
        {selectedPlayer != null ? (
          <Table result={playerRanks.result} columnHeaderMode={columnHeaderMode} query={playerRanks.sql} />
        ) : null}
      </section>

      <section>
        <h2>Seasons</h2>
        {seasons.error ? <div className="notice error">{seasons.error}</div> : null}
        <Table
          result={seasons.result}
          columnHeaderMode={columnHeaderMode}
          query={seasons.sql}
          cellHref={({ column, row, columns }) => {
            if (column !== "season_id" && column !== "season_name") {
              return undefined;
            }
            return href(`/seasons/${row[columns.indexOf("season_id")]}`);
          }}
        />
      </section>
    </div>
  );
}

function LeagueLeaderTable({
  archive,
  title,
  sql,
  label,
  columnHeaderMode,
}: {
  archive: ArchiveContext;
  title: string;
  sql: string;
  label: string;
  columnHeaderMode: ColumnHeaderMode;
}) {
  const result = usePageQuery(archive, sql, label);

  return (
    <div className="leader-panel">
      <h3>{title}</h3>
      {result.error ? <div className="notice error">{result.error}</div> : null}
      <Table
        result={result.result}
        columnHeaderMode={columnHeaderMode}
        query={result.sql}
        hiddenColumns={["player_id"]}
        cellHref={({ column, row, columns }) => {
          if (column !== "player_name") {
            return undefined;
          }
          const playerId = row[columns.indexOf("player_id")];
          return playerId ? href(`/players/${playerId}`) : undefined;
        }}
      />
    </div>
  );
}
