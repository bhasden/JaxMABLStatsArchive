import { downloadBytes } from "../data/archiveDb";
import { useArchiveDatabase } from "../hooks/useArchiveDatabase";
import { useColorTheme } from "../hooks/useColorTheme";
import { useColumnHeaderMode } from "../hooks/useColumnHeaderMode";
import { href, useHashRoute } from "../hooks/useHashRoute";
import { GamePage } from "./GamePage";
import { HomePage } from "./HomePage";
import { PlayerPage } from "./PlayerPage";
import { PlayersPage } from "./PlayersPage";
import { SchemaPage } from "./SchemaPage";
import { SeasonPage } from "./SeasonPage";
import { SeasonsPage } from "./SeasonsPage";
import { SqlPage } from "./SqlPage";
import { TeamPage } from "./TeamPage";
import { TeamsPage } from "./TeamsPage";

export function App() {
  const archive = useArchiveDatabase();
  const route = useHashRoute();
  const columnHeaders = useColumnHeaderMode();
  const colorTheme = useColorTheme();

  async function downloadDb() {
    const bytes = await archive.exportWorkingDb();
    downloadBytes(bytes, "jax-mabl-archive-working.sqlite");
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href={href("/")}>
          <img className="brand-logo" src={`${import.meta.env.BASE_URL}images/logo.jpg`} alt="JAX MABL logo" />
          <span className="brand-text">
            <span>JAX MABL Stats Archive</span>
          </span>
        </a>
        <nav className="site-nav" aria-label="Primary">
          <a href={href("/")} aria-current={route.name === "home" ? "page" : undefined}>
            League
          </a>
          <a
            href={href("/seasons")}
            aria-current={route.name === "seasons" || route.name === "season" ? "page" : undefined}
          >
            Seasons
          </a>
          <a
            href={href("/players")}
            aria-current={
              route.name === "players" || route.name === "player" || route.name === "seasonPlayer" ? "page" : undefined
            }
          >
            Players
          </a>
          <a
            href={href("/teams")}
            aria-current={
              route.name === "teams" || route.name === "team" || route.name === "seasonTeam" ? "page" : undefined
            }
          >
            Teams
          </a>
          <details className="header-menu">
            <summary>Data</summary>
            <div className="header-menu-panel">
              <a href={href("/sql")}>SQL Explorer</a>
              <a href={href("/schema")}>Schema Explorer</a>
            </div>
          </details>
          <details className="header-menu settings-menu">
            <summary>Settings</summary>
            <div className="header-menu-panel settings-panel">
              <label className="settings-toggle">
                <span>Friendly labels</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={columnHeaders.mode === "friendly"}
                  onChange={columnHeaders.toggleMode}
                />
              </label>
              <label className="settings-toggle">
                <span>Dark mode</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={colorTheme.theme === "dark"}
                  onChange={colorTheme.toggleTheme}
                />
              </label>
            </div>
          </details>
        </nav>
        <details className="mobile-nav-menu">
          <summary>Menu</summary>
          <div className="mobile-nav-panel">
            <a href={href("/")}>League</a>
            <a href={href("/seasons")}>Seasons</a>
            <a href={href("/players")}>Players</a>
            <a href={href("/teams")}>Teams</a>
            <a href={href("/sql")}>SQL Explorer</a>
            <a href={href("/schema")}>Schema Explorer</a>
            <div className="mobile-nav-divider" />
            <label className="settings-toggle">
              <span>Friendly labels</span>
              <input
                type="checkbox"
                role="switch"
                checked={columnHeaders.mode === "friendly"}
                onChange={columnHeaders.toggleMode}
              />
            </label>
            <label className="settings-toggle">
              <span>Dark mode</span>
              <input
                type="checkbox"
                role="switch"
                checked={colorTheme.theme === "dark"}
                onChange={colorTheme.toggleTheme}
              />
            </label>
          </div>
        </details>
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
        {archive.ready && route.name === "seasons" ? (
          <SeasonsPage archive={archive} columnHeaderMode={columnHeaders.mode} />
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
        {archive.ready && route.name === "teams" ? (
          <TeamsPage archive={archive} columnHeaderMode={columnHeaders.mode} />
        ) : null}
        {archive.ready && route.name === "player" ? (
          <PlayerPage archive={archive} columnHeaderMode={columnHeaders.mode} playerId={route.playerId} />
        ) : null}
        {archive.ready && route.name === "players" ? (
          <PlayersPage archive={archive} columnHeaderMode={columnHeaders.mode} />
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
