import { downloadBytes } from "../data/archiveDb";
import { useArchiveDatabase } from "../hooks/useArchiveDatabase";
import { useColumnHeaderMode } from "../hooks/useColumnHeaderMode";
import { href, useHashRoute } from "../hooks/useHashRoute";
import { GamePage } from "./GamePage";
import { HomePage } from "./HomePage";
import { PlayerPage } from "./PlayerPage";
import { SchemaPage } from "./SchemaPage";
import { SeasonPage } from "./SeasonPage";
import { SqlPage } from "./SqlPage";
import { TeamPage } from "./TeamPage";

export function App() {
  const archive = useArchiveDatabase();
  const route = useHashRoute();
  const columnHeaders = useColumnHeaderMode();

  async function downloadDb() {
    const bytes = await archive.exportWorkingDb();
    downloadBytes(bytes, "jax-mabl-archive-working.sqlite");
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href={href("/")}>
          JAX MABL Stats Archive
        </a>
        <nav aria-label="Primary">
          <a href={href("/")}>Seasons</a>
          <a href={href("/sql")}>SQL</a>
          <a href={href("/schema")}>Schema</a>
          <button className="header-toggle" type="button" onClick={columnHeaders.toggleMode}>
            {columnHeaders.mode === "friendly" ? "Friendly Columns" : "DB Columns"}
          </button>
        </nav>
      </header>

      {archive.modified ? (
        <div className="modified-banner">
          <span>You are viewing a modified local copy of the archive database.</span>
          <div>
            <button type="button" onClick={downloadDb}>
              Download DB
            </button>
            <button type="button" onClick={archive.reset}>
              Reset
            </button>
          </div>
        </div>
      ) : null}

      <main>
        {archive.error ? <div className="notice error">{archive.error}</div> : null}
        {!archive.ready && !archive.error ? <div className="notice">{archive.loadingMessage}</div> : null}
        {archive.ready && route.name === "home" ? (
          <HomePage archive={archive} columnHeaderMode={columnHeaders.mode} />
        ) : null}
        {archive.ready && route.name === "season" ? (
          <SeasonPage archive={archive} columnHeaderMode={columnHeaders.mode} seasonId={route.seasonId} />
        ) : null}
        {archive.ready && route.name === "seasonTeam" ? (
          <TeamPage
            archive={archive}
            columnHeaderMode={columnHeaders.mode}
            seasonId={route.seasonId}
            teamId={route.teamId}
          />
        ) : null}
        {archive.ready && route.name === "seasonPlayer" ? (
          <PlayerPage
            archive={archive}
            columnHeaderMode={columnHeaders.mode}
            seasonId={route.seasonId}
            playerId={route.playerId}
          />
        ) : null}
        {archive.ready && route.name === "team" ? (
          <TeamPage archive={archive} columnHeaderMode={columnHeaders.mode} teamId={route.teamId} />
        ) : null}
        {archive.ready && route.name === "player" ? (
          <PlayerPage archive={archive} columnHeaderMode={columnHeaders.mode} playerId={route.playerId} />
        ) : null}
        {archive.ready && route.name === "game" ? (
          <GamePage archive={archive} columnHeaderMode={columnHeaders.mode} gameId={route.gameId} />
        ) : null}
        {archive.ready && route.name === "sql" ? (
          <SqlPage archive={archive} columnHeaderMode={columnHeaders.mode} />
        ) : null}
        {archive.ready && route.name === "schema" ? (
          <SchemaPage archive={archive} columnHeaderMode={columnHeaders.mode} />
        ) : null}
      </main>
    </div>
  );
}
