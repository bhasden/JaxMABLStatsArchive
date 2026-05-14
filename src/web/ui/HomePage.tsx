import { useMemo, useState } from "react";
import {
  DEFAULT_LEAGUE_COMPETITION_ID,
  buildLeagueBattingLeaderTables,
  buildLeagueLongevityLeaderTables,
  buildLeaguePitchingLeaderTables,
  buildLeaguePlayerRankSql,
  buildPlayerLookupSql,
} from "../data/leagueLeaderQueries";
import { href } from "../hooks/useHashRoute";
import type { ColumnHeaderMode } from "../hooks/useColumnHeaderMode";
import { Table, type ArchiveContext, usePageQuery } from "./queryHelpers";
import { ARCHIVE_COMPETITIONS } from "../../lib/constants";

const SEASONS_SQL = `
SELECT
  competition,
  competition_id,
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
  competitions.short_name AS competition,
  competitions.competition_id,
  (SELECT COUNT(*) FROM teams WHERE teams.competition_id = competitions.competition_id) AS teams,
  (SELECT COUNT(*) FROM players WHERE players.competition_id = competitions.competition_id) AS players,
  (SELECT COUNT(*) FROM games WHERE games.competition_id = competitions.competition_id) AS games,
  (SELECT COALESCE(SUM(runs), 0) FROM batting_stats WHERE batting_stats.competition_id = competitions.competition_id) AS runs,
  (SELECT COALESCE(SUM(hits), 0) FROM batting_stats WHERE batting_stats.competition_id = competitions.competition_id) AS hits,
  (SELECT COALESCE(SUM(hr), 0) FROM batting_stats WHERE batting_stats.competition_id = competitions.competition_id) AS home_runs
FROM competitions
ORDER BY competitions.sort_order;
`;

export function HomePage({
  archive,
  columnHeaderMode,
}: {
  archive: ArchiveContext;
  columnHeaderMode: ColumnHeaderMode;
}) {
  const [battingCompetitionId, setBattingCompetitionId] = useState(DEFAULT_LEAGUE_COMPETITION_ID);
  const [pitchingCompetitionId, setPitchingCompetitionId] = useState(DEFAULT_LEAGUE_COMPETITION_ID);
  const seasons = usePageQuery(archive, SEASONS_SQL, "Seasons list");
  const rollup = usePageQuery(archive, ROLLUP_SQL, "League rollup");
  const players = usePageQuery(archive, buildPlayerLookupSql(), "League player lookup across competitions");
  const [playerFilter, setPlayerFilter] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const longevityTables = buildLeagueLongevityLeaderTables(null);
  const battingTables = buildLeagueBattingLeaderTables(battingCompetitionId);
  const pitchingTables = buildLeaguePitchingLeaderTables(pitchingCompetitionId);
  const playerOptions = useMemo(() => {
    return (players.result?.values ?? [])
      .map((row) => ({
        id: Number(row[0]),
        name: String(row[1] || row[0]),
        competitionId: String(row[2] ?? DEFAULT_LEAGUE_COMPETITION_ID),
        competition: String(row[3] ?? ""),
      }))
      .filter((player) => Number.isFinite(player.id));
  }, [players.result]);
  const matchingPlayers = useMemo(() => {
    const normalizedFilter = playerFilter.trim().toLowerCase();
    return normalizedFilter
      ? playerOptions.filter((player) =>
          `${player.name} ${player.competition} ${player.id}`.toLowerCase().includes(normalizedFilter),
        )
      : playerOptions;
  }, [playerFilter, playerOptions]);
  const filteredPlayers = matchingPlayers.slice(0, 100);
  const groupedPlayers = useMemo(
    () =>
      ARCHIVE_COMPETITIONS.map((competition) => ({
        competition,
        players: filteredPlayers.filter((player) => player.competitionId === competition.id),
      })).filter((group) => group.players.length > 0),
    [filteredPlayers],
  );
  const playerFilterActive = playerFilter.trim().length > 0;
  const selectedPlayer = playerOptions.find((player) => player.id === selectedPlayerId);

  return (
    <div className="page-grid">
      <section className="page-hero">
        <p className="eyebrow">Historical archive</p>
        <h1>JAX MABL stats, preserved and queryable.</h1>
      </section>

      <section>
        <h2>Competition Rollup</h2>
        <Table result={rollup.result} columnHeaderMode={columnHeaderMode} query={rollup.sql} />
      </section>

      <section>
        <h2>League Longevity</h2>
        <p className="leader-note">Games Played and Seasons Played include all competition levels.</p>
        <div className="leader-grid">
          {longevityTables.map((table) => (
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
        <LeagueCompetitionSectionHead
          title="Batting Leaders"
          competitionId={battingCompetitionId}
          setCompetitionId={setBattingCompetitionId}
        />
        <p className="leader-note">Career AVG requires 300 at-bats.</p>
        <div className="leader-grid">
          {battingTables.map((table) => (
            <LeagueLeaderTable
              key={`${battingCompetitionId}-${table.title}`}
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
        <LeagueCompetitionSectionHead
          title="Pitching Leaders"
          competitionId={pitchingCompetitionId}
          setCompetitionId={setPitchingCompetitionId}
        />
        <p className="leader-note">Career ERA requires 100 innings pitched.</p>
        <div className="leader-grid">
          {pitchingTables.map((table) => (
            <LeagueLeaderTable
              key={`${pitchingCompetitionId}-${table.title}`}
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
              {groupedPlayers.map((group) => (
                <optgroup key={group.competition.id} label={group.competition.name}>
                  {group.players.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  ))}
                </optgroup>
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
        {selectedPlayer == null ? (
          <div className="notice">Select a player to see their league ranks across these categories.</div>
        ) : null}
        {selectedPlayer != null ? (
          <LeaguePlayerRankSection
            archive={archive}
            competitionId={selectedPlayer.competitionId}
            competitionName={
              ARCHIVE_COMPETITIONS.find((competition) => competition.id === selectedPlayer.competitionId)?.name ??
              selectedPlayer.competition
            }
            playerId={selectedPlayer.id}
            columnHeaderMode={columnHeaderMode}
          />
        ) : null}
      </section>

      <section>
        <h2>Seasons</h2>
        {seasons.error ? <div className="notice error">{seasons.error}</div> : null}
        <Table
          result={seasons.result}
          columnHeaderMode={columnHeaderMode}
          query={seasons.sql}
          hiddenColumns={["competition_id"]}
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

function LeagueCompetitionSectionHead({
  title,
  competitionId,
  setCompetitionId,
}: {
  title: string;
  competitionId: string;
  setCompetitionId: (competitionId: string) => void;
}) {
  return (
    <div className="section-title-row">
      <h2>{title}</h2>
      <div className="segmented-control" role="tablist" aria-label={`${title} competition`}>
        {ARCHIVE_COMPETITIONS.map((competition) => (
          <button
            key={competition.id}
            type="button"
            role="tab"
            aria-selected={competitionId === competition.id}
            className={competitionId === competition.id ? "active" : ""}
            onClick={() => setCompetitionId(competition.id)}
          >
            {competition.shortName}
          </button>
        ))}
      </div>
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

function LeaguePlayerRankSection({
  archive,
  competitionId,
  competitionName,
  playerId,
  columnHeaderMode,
}: {
  archive: ArchiveContext;
  competitionId: string;
  competitionName: string;
  playerId: number;
  columnHeaderMode: ColumnHeaderMode;
}) {
  const playerRanks = usePageQuery(
    archive,
    buildLeaguePlayerRankSql(playerId, competitionId),
    `League player ${playerId} rank lookup for ${competitionId}`,
  );

  return (
    <div className="leader-panel">
      <h3>{competitionName}</h3>
      {playerRanks.error ? <div className="notice error">{playerRanks.error}</div> : null}
      <Table result={playerRanks.result} columnHeaderMode={columnHeaderMode} query={playerRanks.sql} />
    </div>
  );
}
