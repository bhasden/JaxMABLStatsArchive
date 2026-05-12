import { useEffect, useState } from "react";
import {
  buildPlayerBattingGameLogPageSql,
  buildPlayerLifetimeBattingSql,
  buildPlayerLifetimePitchingSql,
  buildPlayerPitchingGameLogPageSql,
  buildPlayerProfileSql,
  buildPlayerSeasonBattingSql,
  buildPlayerSeasonInfoSql,
  buildPlayerSeasonPitchingSql,
} from "../data/playerQueries";
import type { ColumnHeaderMode } from "../hooks/useColumnHeaderMode";
import { href } from "../hooks/useHashRoute";
import { Table, type ArchiveContext, usePageQuery } from "./queryHelpers";

const GAME_LOG_PAGE_SIZE = 50;

export function PlayerPage({
  archive,
  playerId,
  seasonId,
  columnHeaderMode,
}: {
  archive: ArchiveContext;
  playerId: number;
  seasonId?: number;
  columnHeaderMode: ColumnHeaderMode;
}) {
  const [battingGamePage, setBattingGamePage] = useState(0);
  const [pitchingGamePage, setPitchingGamePage] = useState(0);

  useEffect(() => {
    setBattingGamePage(0);
    setPitchingGamePage(0);
  }, [playerId, seasonId]);

  const profile = usePageQuery(archive, buildPlayerProfileSql(playerId), `Player ${playerId} profile`);
  const seasonInfo = usePageQuery(
    archive,
    buildPlayerSeasonInfoSql(seasonId),
    seasonId != null ? `Season ${seasonId} name` : "No season selected",
  );
  const batting = usePageQuery(archive, buildPlayerLifetimeBattingSql(playerId), `Player ${playerId} lifetime batting`);
  const lifetimePitching = usePageQuery(
    archive,
    buildPlayerLifetimePitchingSql(playerId),
    `Player ${playerId} lifetime pitching`,
  );
  const seasonBatting = usePageQuery(
    archive,
    buildPlayerSeasonBattingSql(playerId, seasonId),
    seasonId != null ? `Player ${playerId} ${seasonId} batting` : `Player ${playerId} season batting`,
  );
  const seasonPitching = usePageQuery(
    archive,
    buildPlayerSeasonPitchingSql(playerId, seasonId),
    seasonId != null ? `Player ${playerId} ${seasonId} pitching` : `Player ${playerId} season pitching`,
  );
  const battingGameOffset = battingGamePage * GAME_LOG_PAGE_SIZE;
  const pitchingGameOffset = pitchingGamePage * GAME_LOG_PAGE_SIZE;
  const battingGameLogSql = buildPlayerBattingGameLogPageSql(
    playerId,
    seasonId,
    GAME_LOG_PAGE_SIZE + 1,
    battingGameOffset,
  );
  const visibleBattingGameLogSql = buildPlayerBattingGameLogPageSql(
    playerId,
    seasonId,
    GAME_LOG_PAGE_SIZE,
    battingGameOffset,
  );
  const pitchingGameLogSql = buildPlayerPitchingGameLogPageSql(
    playerId,
    seasonId,
    GAME_LOG_PAGE_SIZE + 1,
    pitchingGameOffset,
  );
  const visiblePitchingGameLogSql = buildPlayerPitchingGameLogPageSql(
    playerId,
    seasonId,
    GAME_LOG_PAGE_SIZE,
    pitchingGameOffset,
  );
  const battingGames = usePageQuery(
    archive,
    battingGameLogSql,
    seasonId != null
      ? `Player ${playerId} ${seasonId} batting game log page ${battingGamePage + 1}`
      : `Player ${playerId} batting game log page ${battingGamePage + 1}`,
  );
  const pitchingGames = usePageQuery(
    archive,
    pitchingGameLogSql,
    seasonId != null
      ? `Player ${playerId} ${seasonId} pitching game log page ${pitchingGamePage + 1}`
      : `Player ${playerId} pitching game log page ${pitchingGamePage + 1}`,
  );

  const playerNameColumn = profile.result?.columns.indexOf("player_name") ?? -1;
  const playerName = playerNameColumn >= 0 ? profile.result?.values[0]?.[playerNameColumn] : undefined;
  const seasonNameColumn = seasonInfo.result?.columns.indexOf("season_name") ?? -1;
  const seasonName = seasonNameColumn >= 0 ? seasonInfo.result?.values[0]?.[seasonNameColumn] : undefined;
  const seasonStatHiddenColumns = seasonId != null ? ["season_id", "season_name", "team_id"] : ["season_id", "team_id"];
  const gameLogHiddenColumns =
    seasonId != null
      ? ["season_id", "season_name", "game_id", "team_id", "opponent_team_id"]
      : ["season_id", "game_id", "team_id", "opponent_team_id"];

  return (
    <div className="page-grid">
      <section className="section-head">
        <p className="eyebrow">{seasonId != null ? `${seasonName ?? `Season ${seasonId}`} Player` : "Player"}</p>
        <h1>{playerName ? String(playerName) : playerId}</h1>
        <div className="context-links">
          {seasonId != null ? <a href={href(`/players/${playerId}`)}>Lifetime Player Page</a> : null}
          {seasonId != null ? <a href={href(`/seasons/${seasonId}`)}>Season Page</a> : null}
        </div>
      </section>
      <section>
        <h2>Player Overview</h2>
        {profile.error ? <div className="notice error">{profile.error}</div> : null}
        <Table result={profile.result} columnHeaderMode={columnHeaderMode} query={profile.sql} />
      </section>
      {seasonId == null ? (
        <>
          <section>
            <h2>Lifetime Batting</h2>
            <Table
              result={batting.result}
              columnHeaderMode={columnHeaderMode}
              query={batting.sql}
              hiddenColumns={["player_id"]}
            />
          </section>
          <section>
            <h2>Lifetime Pitching</h2>
            <Table
              result={lifetimePitching.result}
              columnHeaderMode={columnHeaderMode}
              query={lifetimePitching.sql}
              hiddenColumns={["player_id"]}
            />
          </section>
        </>
      ) : null}
      <section>
        <h2>Season Batting</h2>
        <Table
          result={seasonBatting.result}
          columnHeaderMode={columnHeaderMode}
          query={seasonBatting.sql}
          hiddenColumns={seasonStatHiddenColumns}
          cellHref={({ column, row, columns }) => {
            if (column === "season_name") {
              return href(`/seasons/${row[columns.indexOf("season_id")]}/players/${playerId}`);
            }
            if (column === "team") {
              const rowSeasonId = row[columns.indexOf("season_id")];
              const teamId = row[columns.indexOf("team_id")];
              return teamId ? href(`/seasons/${rowSeasonId}/teams/${teamId}`) : undefined;
            }
            return undefined;
          }}
        />
      </section>
      <section>
        <h2>Season Pitching</h2>
        <Table
          result={seasonPitching.result}
          columnHeaderMode={columnHeaderMode}
          query={seasonPitching.sql}
          hiddenColumns={seasonStatHiddenColumns}
          cellHref={({ column, row, columns }) => {
            if (column === "season_name") {
              return href(`/seasons/${row[columns.indexOf("season_id")]}/players/${playerId}`);
            }
            if (column === "team") {
              const rowSeasonId = row[columns.indexOf("season_id")];
              const teamId = row[columns.indexOf("team_id")];
              return teamId ? href(`/seasons/${rowSeasonId}/teams/${teamId}`) : undefined;
            }
            return undefined;
          }}
        />
      </section>
      <section>
        <h2>Batting Game Log</h2>
        <Table
          result={battingGames.result}
          limit={GAME_LOG_PAGE_SIZE}
          columnHeaderMode={columnHeaderMode}
          query={visibleBattingGameLogSql}
          hiddenColumns={gameLogHiddenColumns}
          cellHref={({ column, row, columns }) => {
            if (column === "season_name") {
              return href(`/seasons/${row[columns.indexOf("season_id")]}/players/${playerId}`);
            }
            if (column === "score") {
              return href(`/games/${row[columns.indexOf("game_id")]}`);
            }
            if (column === "team") {
              const rowSeasonId = row[columns.indexOf("season_id")];
              const teamId = row[columns.indexOf("team_id")];
              return teamId ? href(`/seasons/${rowSeasonId}/teams/${teamId}`) : undefined;
            }
            if (column === "opponent") {
              const rowSeasonId = row[columns.indexOf("season_id")];
              const teamId = row[columns.indexOf("opponent_team_id")];
              return teamId ? href(`/seasons/${rowSeasonId}/teams/${teamId}`) : undefined;
            }
            return undefined;
          }}
        />
        <GameLogPager
          page={battingGamePage}
          hasNext={(battingGames.result?.values.length ?? 0) > GAME_LOG_PAGE_SIZE}
          onPrevious={() => setBattingGamePage((page) => Math.max(0, page - 1))}
          onNext={() => setBattingGamePage((page) => page + 1)}
        />
      </section>
      <section>
        <h2>Pitching Game Log</h2>
        <Table
          result={pitchingGames.result}
          limit={GAME_LOG_PAGE_SIZE}
          columnHeaderMode={columnHeaderMode}
          query={visiblePitchingGameLogSql}
          hiddenColumns={gameLogHiddenColumns}
          cellHref={({ column, row, columns }) => {
            if (column === "season_name") {
              return href(`/seasons/${row[columns.indexOf("season_id")]}/players/${playerId}`);
            }
            if (column === "score") {
              return href(`/games/${row[columns.indexOf("game_id")]}`);
            }
            if (column === "team") {
              const rowSeasonId = row[columns.indexOf("season_id")];
              const teamId = row[columns.indexOf("team_id")];
              return teamId ? href(`/seasons/${rowSeasonId}/teams/${teamId}`) : undefined;
            }
            if (column === "opponent") {
              const rowSeasonId = row[columns.indexOf("season_id")];
              const teamId = row[columns.indexOf("opponent_team_id")];
              return teamId ? href(`/seasons/${rowSeasonId}/teams/${teamId}`) : undefined;
            }
            return undefined;
          }}
        />
        <GameLogPager
          page={pitchingGamePage}
          hasNext={(pitchingGames.result?.values.length ?? 0) > GAME_LOG_PAGE_SIZE}
          onPrevious={() => setPitchingGamePage((page) => Math.max(0, page - 1))}
          onNext={() => setPitchingGamePage((page) => page + 1)}
        />
      </section>
    </div>
  );
}

function GameLogPager({
  page,
  hasNext,
  onPrevious,
  onNext,
}: {
  page: number;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (page === 0 && !hasNext) {
    return null;
  }

  return (
    <div className="table-pager" aria-label="Game log pagination">
      <button type="button" disabled={page === 0} onClick={onPrevious}>
        Previous
      </button>
      <span>Page {page + 1}</span>
      <button type="button" disabled={!hasNext} onClick={onNext}>
        Next
      </button>
    </div>
  );
}
