import fs from "fs/promises";
import path from "path";
import {
  ARCHIVE_SEED_FILES,
  ARCHIVE_SEED_TABLES,
  getAllSeasonsSeedDir,
  readNdjsonRows,
  type ArchiveSeedManifest,
  type ArchiveSeedTable,
} from "./archive-seed-merge";
import { ARCHIVE_COMPETITIONS, ARCHIVE_SEASONS, competitionIdForSeasonId } from "./constants";

export const DEFAULT_ARCHIVE_DB_FILE_NAME = "archive.sqlite";

const EXCLUDED_ARCHIVE_DB_SEASON_IDS = new Set([34360]);

export const ARCHIVE_DB_IMPORTED_TABLES = [
  "competitions",
  ...ARCHIVE_SEED_TABLES,
  "people",
  "seasons",
  "team_aliases",
  "team_season_ids",
  "metadata",
] as const;

export type ArchiveDbImportedTable = (typeof ARCHIVE_DB_IMPORTED_TABLES)[number];

export type ArchiveDbImportOptions = {
  outDir?: string;
  seedsDir?: string;
  mergedDirName?: string;
  dbFileName?: string;
};

export type ArchiveDbImportSummary = {
  dbPath: string;
  seedsDir: string;
  seasonCount: number;
  warnings: number;
  importedCounts: Record<ArchiveDbImportedTable, number>;
};

type SqlJsModule = {
  Database: new (data?: Uint8Array) => any;
};

function buildCountRecord(): Record<ArchiveDbImportedTable, number> {
  return Object.fromEntries(ARCHIVE_DB_IMPORTED_TABLES.map((table) => [table, 0])) as Record<
    ArchiveDbImportedTable,
    number
  >;
}

async function loadSqlJs(): Promise<SqlJsModule> {
  const module = await import("sql.js/dist/sql-asm.js");
  const initSqlJs = (module.default ?? module) as () => Promise<SqlJsModule>;
  return initSqlJs();
}

function integerOrNull(value: unknown) {
  if (value == null || value === "") {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function requiredInteger(value: unknown, field: string, table: string) {
  const numericValue = integerOrNull(value);
  if (numericValue == null) {
    throw new Error(`${table} row is missing required integer field ${field}`);
  }
  return numericValue;
}

function textOrNull(value: unknown) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function booleanToInteger(value: unknown) {
  if (value == null) {
    return null;
  }

  return value ? 1 : 0;
}

function integerArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as number[];
  }

  return [
    ...new Set(value.map((entry) => integerOrNull(entry)).filter((entry): entry is number => entry != null)),
  ].sort((left, right) => left - right);
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  const values: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = textOrNull(entry);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    values.push(normalized);
  }
  return values;
}

function seasonYearFromName(name: string) {
  const match = name.match(/\b(?:19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function shouldImportSeasonId(seasonId: unknown) {
  const numericSeasonId = integerOrNull(seasonId);
  return numericSeasonId == null || !EXCLUDED_ARCHIVE_DB_SEASON_IDS.has(numericSeasonId);
}

function competitionIdForRow(row: Record<string, unknown>) {
  return textOrNull(row.competition_id) ?? competitionIdForSeasonId(integerOrNull(row.season_id));
}

async function readManifest(seedsDir: string): Promise<ArchiveSeedManifest> {
  const manifestText = await fs.readFile(path.join(seedsDir, "manifest.json"), "utf8");
  return JSON.parse(manifestText) as ArchiveSeedManifest;
}

async function readSeedTableRows(seedsDir: string, table: ArchiveSeedTable) {
  return readNdjsonRows(path.join(seedsDir, ARCHIVE_SEED_FILES[table]));
}

function initializeArchiveDb(db: any) {
  db.run(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE competitions (
      competition_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      short_name TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      minimum_age INTEGER
    );

    CREATE TABLE seasons (
      season_id INTEGER PRIMARY KEY,
      competition_id TEXT NOT NULL,
      name TEXT NOT NULL,
      season_year INTEGER,
      FOREIGN KEY (competition_id) REFERENCES competitions(competition_id)
    );

    CREATE TABLE people (
      person_id INTEGER PRIMARY KEY,
      name TEXT
    );

    CREATE TABLE players (
      player_id INTEGER PRIMARY KEY,
      competition_id TEXT NOT NULL,
      source_player_id INTEGER,
      person_id INTEGER,
      name TEXT,
      FOREIGN KEY (competition_id) REFERENCES competitions(competition_id),
      FOREIGN KEY (person_id) REFERENCES people(person_id)
    );

    CREATE TABLE teams (
      team_id INTEGER PRIMARY KEY,
      competition_id TEXT NOT NULL,
      source_team_id INTEGER,
      league_id INTEGER,
      name TEXT NOT NULL,
      short_name TEXT,
      FOREIGN KEY (competition_id) REFERENCES competitions(competition_id)
    );

    CREATE TABLE team_aliases (
      team_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      is_current INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (team_id, name),
      FOREIGN KEY (team_id) REFERENCES teams(team_id)
    );

    CREATE TABLE team_season_ids (
      team_id INTEGER NOT NULL,
      season_team_id INTEGER NOT NULL,
      competition_id TEXT NOT NULL,
      PRIMARY KEY (team_id, season_team_id),
      FOREIGN KEY (team_id) REFERENCES teams(team_id),
      FOREIGN KEY (competition_id) REFERENCES competitions(competition_id)
    );

    CREATE TABLE rosters (
      competition_id TEXT NOT NULL,
      league_id INTEGER,
      season_id INTEGER NOT NULL,
      team_id INTEGER,
      season_team_id INTEGER,
      team_name TEXT,
      player_id INTEGER,
      player_season_id INTEGER,
      first_name TEXT,
      last_name TEXT,
      name TEXT,
      position TEXT,
      jersey TEXT,
      height TEXT,
      weight TEXT,
      birthdate TEXT,
      bats TEXT,
      throws TEXT,
      status TEXT,
      hometown TEXT,
      photo_url TEXT,
      FOREIGN KEY (team_id) REFERENCES teams(team_id),
      FOREIGN KEY (player_id) REFERENCES players(player_id),
      FOREIGN KEY (competition_id) REFERENCES competitions(competition_id)
    );

    CREATE TABLE games (
      game_id INTEGER PRIMARY KEY,
      competition_id TEXT NOT NULL,
      league_id INTEGER,
      season_id INTEGER NOT NULL,
      scheduled_at TEXT,
      status TEXT,
      home_team_id INTEGER,
      away_team_id INTEGER,
      home_season_team_id INTEGER,
      away_season_team_id INTEGER,
      home_score INTEGER,
      away_score INTEGER,
      is_tie INTEGER,
      winner_team_id INTEGER,
      loser_team_id INTEGER,
      winner_season_team_id INTEGER,
      loser_season_team_id INTEGER,
      raw_xml_file TEXT,
      FOREIGN KEY (home_team_id) REFERENCES teams(team_id),
      FOREIGN KEY (away_team_id) REFERENCES teams(team_id),
      FOREIGN KEY (winner_team_id) REFERENCES teams(team_id),
      FOREIGN KEY (loser_team_id) REFERENCES teams(team_id),
      FOREIGN KEY (competition_id) REFERENCES competitions(competition_id)
    );

    CREATE TABLE lineups (
      competition_id TEXT NOT NULL,
      game_id INTEGER NOT NULL,
      season_id INTEGER NOT NULL,
      team_id INTEGER,
      season_team_id INTEGER,
      is_home INTEGER NOT NULL,
      player_id INTEGER,
      name TEXT,
      jersey TEXT,
      position TEXT,
      order_idx INTEGER,
      source_batting_order INTEGER,
      source_batting_order_slot INTEGER,
      batting_order INTEGER,
      batting_order_modifier TEXT,
      FOREIGN KEY (game_id) REFERENCES games(game_id),
      FOREIGN KEY (team_id) REFERENCES teams(team_id),
      FOREIGN KEY (player_id) REFERENCES players(player_id),
      FOREIGN KEY (competition_id) REFERENCES competitions(competition_id)
    );

    CREATE TABLE batting_stats (
      competition_id TEXT NOT NULL,
      game_id INTEGER NOT NULL,
      season_id INTEGER NOT NULL,
      team_id INTEGER,
      season_team_id INTEGER,
      is_home INTEGER NOT NULL,
      player_id INTEGER,
      jersey TEXT,
      position TEXT,
      ab INTEGER,
      runs INTEGER,
      hits INTEGER,
      doubles INTEGER,
      triples INTEGER,
      hr INTEGER,
      rbi INTEGER,
      bb INTEGER,
      so INTEGER,
      sb INTEGER,
      caught_stealing INTEGER,
      hit_by_pitch INTEGER,
      sacrifice_flies INTEGER,
      sacrifice_bunts INTEGER,
      avg TEXT,
      source_batting_order INTEGER,
      source_batting_order_slot INTEGER,
      batting_order INTEGER,
      batting_order_modifier TEXT,
      FOREIGN KEY (game_id) REFERENCES games(game_id),
      FOREIGN KEY (team_id) REFERENCES teams(team_id),
      FOREIGN KEY (player_id) REFERENCES players(player_id),
      FOREIGN KEY (competition_id) REFERENCES competitions(competition_id)
    );

    CREATE TABLE pitching_stats (
      competition_id TEXT NOT NULL,
      game_id INTEGER NOT NULL,
      season_id INTEGER NOT NULL,
      team_id INTEGER,
      season_team_id INTEGER,
      is_home INTEGER NOT NULL,
      player_id INTEGER,
      jersey TEXT,
      pitching_order INTEGER,
      ip TEXT,
      hits INTEGER,
      runs INTEGER,
      earned_runs INTEGER,
      doubles_allowed INTEGER,
      triples_allowed INTEGER,
      home_runs_allowed INTEGER,
      bb INTEGER,
      so INTEGER,
      hit_by_pitch INTEGER,
      win INTEGER,
      loss INTEGER,
      save INTEGER,
      blown_save INTEGER,
      complete_game INTEGER,
      batters_faced INTEGER,
      pitches INTEGER,
      era TEXT,
      FOREIGN KEY (game_id) REFERENCES games(game_id),
      FOREIGN KEY (team_id) REFERENCES teams(team_id),
      FOREIGN KEY (player_id) REFERENCES players(player_id),
      FOREIGN KEY (competition_id) REFERENCES competitions(competition_id)
    );

    CREATE TABLE season_batting_stats (
      competition_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      league_id INTEGER,
      season_id INTEGER NOT NULL,
      team_id INTEGER,
      season_team_id INTEGER,
      source_team_name TEXT,
      player_id INTEGER,
      player_season_id INTEGER,
      player_name TEXT,
      jersey TEXT,
      at_bats INTEGER,
      runs INTEGER,
      hits INTEGER,
      doubles INTEGER,
      triples INTEGER,
      home_runs INTEGER,
      runs_batted_in INTEGER,
      walks INTEGER,
      hit_by_pitch INTEGER,
      strikeouts INTEGER,
      sacrifice_flies INTEGER,
      sacrifice_bunts INTEGER,
      stolen_bases INTEGER,
      caught_stealing INTEGER,
      double_plays INTEGER,
      on_base_percentage TEXT,
      slugging_percentage TEXT,
      batting_average TEXT,
      FOREIGN KEY (team_id) REFERENCES teams(team_id),
      FOREIGN KEY (player_id) REFERENCES players(player_id),
      FOREIGN KEY (competition_id) REFERENCES competitions(competition_id)
    );

    CREATE TABLE season_pitching_stats (
      competition_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      league_id INTEGER,
      season_id INTEGER NOT NULL,
      team_id INTEGER,
      season_team_id INTEGER,
      source_team_name TEXT,
      player_id INTEGER,
      player_season_id INTEGER,
      player_name TEXT,
      jersey TEXT,
      wins INTEGER,
      losses INTEGER,
      innings_pitched TEXT,
      runs INTEGER,
      earned_runs INTEGER,
      hits INTEGER,
      walks INTEGER,
      strikeouts INTEGER,
      hit_by_pitch INTEGER,
      batters_faced INTEGER,
      games INTEGER,
      games_started INTEGER,
      complete_games INTEGER,
      complete_game_losses INTEGER,
      shutouts INTEGER,
      saves INTEGER,
      blown_saves INTEGER,
      opponent_on_base_percentage TEXT,
      opponent_slugging_percentage TEXT,
      opponent_average TEXT,
      era TEXT,
      FOREIGN KEY (team_id) REFERENCES teams(team_id),
      FOREIGN KEY (player_id) REFERENCES players(player_id),
      FOREIGN KEY (competition_id) REFERENCES competitions(competition_id)
    );

    CREATE TABLE season_batting_leaders (
      competition_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      league_id INTEGER,
      season_id INTEGER NOT NULL,
      team_id INTEGER,
      season_team_id INTEGER,
      leader_category TEXT NOT NULL,
      rank INTEGER NOT NULL,
      source_team_name TEXT,
      player_id INTEGER,
      player_season_id INTEGER,
      player_name TEXT,
      jersey TEXT,
      at_bats INTEGER,
      runs INTEGER,
      hits INTEGER,
      doubles INTEGER,
      triples INTEGER,
      home_runs INTEGER,
      runs_batted_in INTEGER,
      walks INTEGER,
      hit_by_pitch INTEGER,
      strikeouts INTEGER,
      sacrifice_flies INTEGER,
      sacrifice_bunts INTEGER,
      stolen_bases INTEGER,
      caught_stealing INTEGER,
      double_plays INTEGER,
      on_base_percentage TEXT,
      slugging_percentage TEXT,
      batting_average TEXT,
      FOREIGN KEY (team_id) REFERENCES teams(team_id),
      FOREIGN KEY (player_id) REFERENCES players(player_id),
      FOREIGN KEY (competition_id) REFERENCES competitions(competition_id)
    );

    CREATE TABLE season_pitching_leaders (
      competition_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      league_id INTEGER,
      season_id INTEGER NOT NULL,
      team_id INTEGER,
      season_team_id INTEGER,
      leader_category TEXT NOT NULL,
      rank INTEGER NOT NULL,
      source_team_name TEXT,
      player_id INTEGER,
      player_season_id INTEGER,
      player_name TEXT,
      jersey TEXT,
      wins INTEGER,
      losses INTEGER,
      innings_pitched TEXT,
      runs INTEGER,
      earned_runs INTEGER,
      hits INTEGER,
      walks INTEGER,
      strikeouts INTEGER,
      hit_by_pitch INTEGER,
      batters_faced INTEGER,
      games INTEGER,
      games_started INTEGER,
      complete_games INTEGER,
      complete_game_losses INTEGER,
      shutouts INTEGER,
      saves INTEGER,
      blown_saves INTEGER,
      opponent_on_base_percentage TEXT,
      opponent_slugging_percentage TEXT,
      opponent_average TEXT,
      era TEXT,
      FOREIGN KEY (team_id) REFERENCES teams(team_id),
      FOREIGN KEY (player_id) REFERENCES players(player_id),
      FOREIGN KEY (competition_id) REFERENCES competitions(competition_id)
    );

    CREATE TABLE innings (
      competition_id TEXT NOT NULL,
      game_id INTEGER NOT NULL,
      season_id INTEGER NOT NULL,
      team_id INTEGER,
      season_team_id INTEGER,
      is_home INTEGER NOT NULL,
      inning_number INTEGER NOT NULL,
      runs INTEGER,
      total_runs INTEGER,
      total_hits INTEGER,
      total_errors INTEGER,
      FOREIGN KEY (game_id) REFERENCES games(game_id),
      FOREIGN KEY (team_id) REFERENCES teams(team_id),
      FOREIGN KEY (competition_id) REFERENCES competitions(competition_id)
    );

    CREATE TABLE standings (
      competition_id TEXT NOT NULL,
      league_id INTEGER,
      season_id INTEGER NOT NULL,
      team_id INTEGER,
      season_team_id INTEGER,
      name TEXT,
      games_played INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      losses INTEGER NOT NULL,
      ties INTEGER NOT NULL,
      pct TEXT,
      FOREIGN KEY (team_id) REFERENCES teams(team_id),
      FOREIGN KEY (competition_id) REFERENCES competitions(competition_id)
    );

    CREATE INDEX idx_games_season ON games(season_id);
    CREATE INDEX idx_games_competition ON games(competition_id);
    CREATE INDEX idx_games_home_team ON games(home_team_id);
    CREATE INDEX idx_games_away_team ON games(away_team_id);
    CREATE INDEX idx_rosters_season ON rosters(season_id);
    CREATE INDEX idx_rosters_competition ON rosters(competition_id);
    CREATE INDEX idx_rosters_team ON rosters(team_id);
    CREATE INDEX idx_rosters_player ON rosters(player_id);
    CREATE INDEX idx_lineups_game ON lineups(game_id);
    CREATE INDEX idx_lineups_player ON lineups(player_id);
    CREATE INDEX idx_lineups_team ON lineups(team_id);
    CREATE INDEX idx_batting_game ON batting_stats(game_id);
    CREATE INDEX idx_batting_player ON batting_stats(player_id);
    CREATE INDEX idx_batting_team ON batting_stats(team_id);
    CREATE INDEX idx_pitching_game ON pitching_stats(game_id);
    CREATE INDEX idx_pitching_player ON pitching_stats(player_id);
    CREATE INDEX idx_pitching_team ON pitching_stats(team_id);
    CREATE INDEX idx_season_batting_stats_season ON season_batting_stats(season_id);
    CREATE INDEX idx_season_batting_stats_scope ON season_batting_stats(scope);
    CREATE INDEX idx_season_batting_stats_team ON season_batting_stats(team_id);
    CREATE INDEX idx_season_batting_stats_player ON season_batting_stats(player_id);
    CREATE INDEX idx_season_pitching_stats_season ON season_pitching_stats(season_id);
    CREATE INDEX idx_season_pitching_stats_scope ON season_pitching_stats(scope);
    CREATE INDEX idx_season_pitching_stats_team ON season_pitching_stats(team_id);
    CREATE INDEX idx_season_pitching_stats_player ON season_pitching_stats(player_id);
    CREATE INDEX idx_season_batting_leaders_season ON season_batting_leaders(season_id);
    CREATE INDEX idx_season_batting_leaders_category ON season_batting_leaders(leader_category);
    CREATE INDEX idx_season_batting_leaders_team ON season_batting_leaders(team_id);
    CREATE INDEX idx_season_batting_leaders_player ON season_batting_leaders(player_id);
    CREATE INDEX idx_season_pitching_leaders_season ON season_pitching_leaders(season_id);
    CREATE INDEX idx_season_pitching_leaders_category ON season_pitching_leaders(leader_category);
    CREATE INDEX idx_season_pitching_leaders_team ON season_pitching_leaders(team_id);
    CREATE INDEX idx_season_pitching_leaders_player ON season_pitching_leaders(player_id);
    CREATE INDEX idx_innings_game ON innings(game_id);
    CREATE INDEX idx_innings_team ON innings(team_id);
    CREATE INDEX idx_standings_season ON standings(season_id);
    CREATE INDEX idx_standings_competition ON standings(competition_id);
    CREATE INDEX idx_standings_team ON standings(team_id);
  `);
}

function createArchiveViews(db: any) {
  db.run(`
    CREATE VIEW v_season_summary AS
    WITH season_ids AS (
      SELECT season_id FROM games
      UNION
      SELECT season_id FROM standings
      UNION
      SELECT season_id FROM season_batting_stats
      UNION
      SELECT season_id FROM season_pitching_stats
    )
    SELECT
      season_ids.season_id,
      seasons.competition_id,
      competitions.short_name AS competition,
      seasons.name AS season_name,
      seasons.season_year,
      (SELECT COUNT(DISTINCT team_id) FROM standings WHERE standings.season_id = season_ids.season_id) AS teams,
      (SELECT COUNT(*) FROM games WHERE games.season_id = season_ids.season_id) AS games,
      (
        SELECT COUNT(DISTINCT player_id)
        FROM rosters
        WHERE rosters.season_id = season_ids.season_id AND player_id IS NOT NULL
      ) AS players,
      (SELECT COALESCE(SUM(runs), 0) FROM batting_stats WHERE batting_stats.season_id = season_ids.season_id) AS runs,
      (SELECT COALESCE(SUM(hits), 0) FROM batting_stats WHERE batting_stats.season_id = season_ids.season_id) AS hits,
      (SELECT COALESCE(SUM(hr), 0) FROM batting_stats WHERE batting_stats.season_id = season_ids.season_id) AS home_runs
    FROM season_ids
    LEFT JOIN seasons ON seasons.season_id = season_ids.season_id
    LEFT JOIN competitions ON competitions.competition_id = seasons.competition_id;

    CREATE VIEW v_team_season_summary AS
    SELECT
      standings.season_id,
      standings.competition_id,
      competitions.short_name AS competition,
      seasons.name AS season_name,
      standings.team_id,
      teams.name AS canonical_team_name,
      standings.name AS season_team_name,
      standings.games_played,
      standings.wins,
      standings.losses,
      standings.ties,
      standings.pct,
      (
        SELECT COUNT(DISTINCT player_id)
        FROM rosters
        WHERE rosters.season_id = standings.season_id
          AND rosters.team_id = standings.team_id
          AND player_id IS NOT NULL
      ) AS rostered_players
    FROM standings
    LEFT JOIN teams ON teams.team_id = standings.team_id
    LEFT JOIN seasons ON seasons.season_id = standings.season_id
    LEFT JOIN competitions ON competitions.competition_id = standings.competition_id;

    CREATE VIEW v_player_batting_totals AS
    WITH player_games AS (
      SELECT player_id, game_id
      FROM lineups
      WHERE player_id IS NOT NULL
      UNION
      SELECT player_id, game_id
      FROM batting_stats
      WHERE player_id IS NOT NULL
      UNION
      SELECT player_id, game_id
      FROM pitching_stats
      WHERE player_id IS NOT NULL
    )
    SELECT
      season_batting_stats.player_id,
      season_batting_stats.competition_id,
      COALESCE(players.name, season_batting_stats.player_name) AS player_name,
      COUNT(DISTINCT season_id) AS seasons,
      (
        SELECT COUNT(DISTINCT game_id)
        FROM player_games
        WHERE player_games.player_id = season_batting_stats.player_id
      ) AS games_played,
      COALESCE(SUM(at_bats), 0) AS at_bats,
      COALESCE(SUM(runs), 0) AS runs,
      COALESCE(SUM(hits), 0) AS hits,
      COALESCE(SUM(doubles), 0) AS doubles,
      COALESCE(SUM(triples), 0) AS triples,
      COALESCE(SUM(home_runs), 0) AS home_runs,
      COALESCE(SUM(runs_batted_in), 0) AS runs_batted_in,
      COALESCE(SUM(walks), 0) AS walks,
      COALESCE(SUM(strikeouts), 0) AS strikeouts,
      COALESCE(SUM(stolen_bases), 0) AS stolen_bases,
      CASE
        WHEN COALESCE(SUM(at_bats), 0) = 0 THEN NULL
        ELSE printf('%.3f', CAST(SUM(hits) AS REAL) / SUM(at_bats))
      END AS batting_average
    FROM season_batting_stats
    LEFT JOIN players ON players.player_id = season_batting_stats.player_id
    WHERE season_batting_stats.scope = 'league'
      AND season_batting_stats.player_id IS NOT NULL
    GROUP BY season_batting_stats.player_id, season_batting_stats.competition_id;
  `);
}

export function getArchiveDbPath(outDir: string, dbFileName = DEFAULT_ARCHIVE_DB_FILE_NAME) {
  return path.join(outDir, dbFileName);
}

export async function importMergedSeedsToArchiveDb(
  options: ArchiveDbImportOptions = {},
): Promise<ArchiveDbImportSummary> {
  const outDir = options.outDir ?? path.join(process.cwd(), "data");
  const seedsDir = options.seedsDir ?? getAllSeasonsSeedDir(outDir, options.mergedDirName);
  const dbPath = getArchiveDbPath(outDir, options.dbFileName);
  const manifest = await readManifest(seedsDir);
  const importedCounts = buildCountRecord();
  const SQL = await loadSqlJs();
  const db = new SQL.Database();

  initializeArchiveDb(db);
  createArchiveViews(db);

  const insertMetadata = db.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)");
  const insertCompetition = db.prepare(
    "INSERT INTO competitions (competition_id, name, short_name, sort_order, minimum_age) VALUES (?, ?, ?, ?, ?)",
  );
  const insertSeason = db.prepare(
    "INSERT INTO seasons (season_id, competition_id, name, season_year) VALUES (?, ?, ?, ?)",
  );
  const insertPerson = db.prepare("INSERT OR IGNORE INTO people (person_id, name) VALUES (?, ?)");
  const insertPlayer = db.prepare(
    "INSERT INTO players (player_id, competition_id, source_player_id, person_id, name) VALUES (?, ?, ?, ?, ?)",
  );
  const insertTeam = db.prepare(
    "INSERT INTO teams (team_id, competition_id, source_team_id, league_id, name, short_name) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertTeamAlias = db.prepare("INSERT INTO team_aliases (team_id, name, is_current) VALUES (?, ?, ?)");
  const insertTeamSeasonId = db.prepare(
    "INSERT INTO team_season_ids (team_id, season_team_id, competition_id) VALUES (?, ?, ?)",
  );
  const insertRoster = db.prepare(`
    INSERT INTO rosters (
      competition_id, league_id, season_id, team_id, season_team_id, team_name,
      player_id, player_season_id,
      first_name, last_name, name, position, jersey, height, weight, birthdate,
      bats, throws, status, hometown, photo_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertGame = db.prepare(`
    INSERT INTO games (
      game_id, competition_id, league_id, season_id, scheduled_at, status,
      home_team_id, away_team_id,
      home_season_team_id, away_season_team_id,
      home_score, away_score, is_tie,
      winner_team_id, loser_team_id,
      winner_season_team_id, loser_season_team_id,
      raw_xml_file
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertLineup = db.prepare(`
    INSERT INTO lineups (
      competition_id, game_id, season_id, team_id, season_team_id,
      is_home, player_id, name, jersey, position, order_idx,
      source_batting_order, source_batting_order_slot, batting_order, batting_order_modifier
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertBatting = db.prepare(`
    INSERT INTO batting_stats (
      competition_id, game_id, season_id, team_id, season_team_id,
      is_home, player_id, jersey, position, ab, runs, hits, doubles, triples,
      hr, rbi, bb, so, sb, caught_stealing, hit_by_pitch, sacrifice_flies, sacrifice_bunts, avg,
      source_batting_order, source_batting_order_slot, batting_order, batting_order_modifier
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPitching = db.prepare(`
    INSERT INTO pitching_stats (
      competition_id, game_id, season_id, team_id, season_team_id,
      is_home, player_id, jersey, pitching_order, ip, hits, runs, earned_runs,
      doubles_allowed, triples_allowed, home_runs_allowed, bb, so, hit_by_pitch, win, loss,
      save, blown_save, complete_game, batters_faced, pitches, era
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSeasonBatting = db.prepare(`
    INSERT INTO season_batting_stats (
      competition_id, scope, league_id, season_id, team_id, season_team_id, source_team_name,
      player_id, player_season_id, player_name, jersey,
      at_bats, runs, hits, doubles, triples, home_runs, runs_batted_in, walks,
      hit_by_pitch, strikeouts, sacrifice_flies, sacrifice_bunts, stolen_bases, caught_stealing, double_plays,
      on_base_percentage, slugging_percentage, batting_average
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSeasonPitching = db.prepare(`
    INSERT INTO season_pitching_stats (
      competition_id, scope, league_id, season_id, team_id, season_team_id, source_team_name,
      player_id, player_season_id, player_name, jersey,
      wins, losses, innings_pitched, runs, earned_runs, hits, walks, strikeouts,
      hit_by_pitch, batters_faced, games, games_started, complete_games, complete_game_losses,
      shutouts, saves, blown_saves, opponent_on_base_percentage, opponent_slugging_percentage,
      opponent_average, era
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSeasonBattingLeader = db.prepare(`
    INSERT INTO season_batting_leaders (
      competition_id, scope, league_id, season_id, team_id, season_team_id, leader_category, rank,
      source_team_name, player_id, player_season_id, player_name, jersey,
      at_bats, runs, hits, doubles, triples, home_runs, runs_batted_in, walks,
      hit_by_pitch, strikeouts, sacrifice_flies, sacrifice_bunts, stolen_bases, caught_stealing, double_plays,
      on_base_percentage, slugging_percentage, batting_average
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSeasonPitchingLeader = db.prepare(`
    INSERT INTO season_pitching_leaders (
      competition_id, scope, league_id, season_id, team_id, season_team_id, leader_category, rank,
      source_team_name, player_id, player_season_id, player_name, jersey,
      wins, losses, innings_pitched, runs, earned_runs, hits, walks, strikeouts,
      hit_by_pitch, batters_faced, games, games_started, complete_games, complete_game_losses,
      shutouts, saves, blown_saves, opponent_on_base_percentage, opponent_slugging_percentage,
      opponent_average, era
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertInning = db.prepare(`
    INSERT INTO innings (
      competition_id, game_id, season_id, team_id, season_team_id,
      is_home, inning_number, runs, total_runs, total_hits, total_errors
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertStanding = db.prepare(`
    INSERT INTO standings (
      competition_id, league_id, season_id, team_id, season_team_id, name, games_played, wins, losses, ties, pct
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.run("BEGIN");
  try {
    insertMetadata.run(["source_seeds_dir", seedsDir]);
    importedCounts.metadata += 1;
    insertMetadata.run(["source_manifest_generated_at", manifest.generatedAt]);
    importedCounts.metadata += 1;
    insertMetadata.run(["manifest_json", JSON.stringify(manifest)]);
    importedCounts.metadata += 1;
    insertMetadata.run(["excluded_season_ids", JSON.stringify([...EXCLUDED_ARCHIVE_DB_SEASON_IDS])]);
    importedCounts.metadata += 1;
    insertMetadata.run(["imported_at", new Date().toISOString()]);
    importedCounts.metadata += 1;

    for (const competition of ARCHIVE_COMPETITIONS) {
      insertCompetition.run([
        competition.id,
        competition.name,
        competition.shortName,
        competition.sortOrder,
        competition.minimumAge,
      ]);
      importedCounts.competitions += 1;
    }

    for (const season of ARCHIVE_SEASONS) {
      if (!shouldImportSeasonId(season.id)) {
        continue;
      }
      insertSeason.run([Number(season.id), season.competitionId, season.name, seasonYearFromName(season.name)]);
      importedCounts.seasons += 1;
    }

    const playerRows = await readSeedTableRows(seedsDir, "players");
    const insertedPersonIds = new Set<number>();
    for (const row of playerRows) {
      const personId = requiredInteger(row.person_id, "person_id", "players");
      const personName = textOrNull(row.person_name) ?? textOrNull(row.name);
      if (!insertedPersonIds.has(personId)) {
        insertPerson.run([personId, personName]);
        importedCounts.people += 1;
        insertedPersonIds.add(personId);
      }
      insertPlayer.run([
        requiredInteger(row.player_id, "player_id", "players"),
        competitionIdForRow(row),
        integerOrNull(row.source_player_id),
        personId,
        textOrNull(row.name),
      ]);
      importedCounts.players += 1;
    }

    const teamRows = await readSeedTableRows(seedsDir, "teams");
    for (const row of teamRows) {
      const teamLinkId = requiredInteger(row.team_id, "team_id", "teams");
      const currentName = textOrNull(row.name);
      insertTeam.run([
        teamLinkId,
        competitionIdForRow(row),
        integerOrNull(row.source_team_id),
        integerOrNull(row.league_id),
        currentName ?? `Team ${teamLinkId}`,
        textOrNull(row.short_name),
      ]);
      importedCounts.teams += 1;

      for (const formerName of stringArray(row.former_names)) {
        insertTeamAlias.run([teamLinkId, formerName, 0]);
        importedCounts.team_aliases += 1;
      }
      if (currentName) {
        insertTeamAlias.run([teamLinkId, currentName, 1]);
        importedCounts.team_aliases += 1;
      }
      for (const seasonTeamId of integerArray(row.season_season_team_ids)) {
        insertTeamSeasonId.run([teamLinkId, seasonTeamId, competitionIdForRow(row)]);
        importedCounts.team_season_ids += 1;
      }
    }

    const rosterRows = await readSeedTableRows(seedsDir, "rosters");
    for (const row of rosterRows) {
      if (!shouldImportSeasonId(row.season_id)) {
        continue;
      }
      insertRoster.run([
        competitionIdForRow(row),
        integerOrNull(row.league_id),
        requiredInteger(row.season_id, "season_id", "rosters"),
        integerOrNull(row.team_id),
        integerOrNull(row.season_team_id),
        textOrNull(row.team_name),
        integerOrNull(row.player_id),
        integerOrNull(row.player_season_id),
        textOrNull(row.first_name),
        textOrNull(row.last_name),
        textOrNull(row.name),
        textOrNull(row.position),
        textOrNull(row.jersey),
        textOrNull(row.height),
        textOrNull(row.weight),
        textOrNull(row.birthdate),
        textOrNull(row.bats),
        textOrNull(row.throws),
        textOrNull(row.status),
        textOrNull(row.hometown),
        textOrNull(row.photo_url),
      ]);
      importedCounts.rosters += 1;
    }

    const gameRows = await readSeedTableRows(seedsDir, "games");
    for (const row of gameRows) {
      if (!shouldImportSeasonId(row.season_id)) {
        continue;
      }
      insertGame.run([
        requiredInteger(row.game_id, "game_id", "games"),
        competitionIdForRow(row),
        integerOrNull(row.league_id),
        requiredInteger(row.season_id, "season_id", "games"),
        textOrNull(row.scheduled_at),
        textOrNull(row.status),
        integerOrNull(row.home_team_id),
        integerOrNull(row.away_team_id),
        integerOrNull(row.home_season_team_id),
        integerOrNull(row.away_season_team_id),
        integerOrNull(row.home_score),
        integerOrNull(row.away_score),
        booleanToInteger(row.is_tie),
        integerOrNull(row.winner_team_id),
        integerOrNull(row.loser_team_id),
        integerOrNull(row.winner_season_team_id),
        integerOrNull(row.loser_season_team_id),
        textOrNull(row.raw_xml_file),
      ]);
      importedCounts.games += 1;
    }

    const lineupRows = await readSeedTableRows(seedsDir, "lineups");
    for (const row of lineupRows) {
      if (!shouldImportSeasonId(row.season_id)) {
        continue;
      }
      insertLineup.run([
        competitionIdForRow(row),
        requiredInteger(row.game_id, "game_id", "lineups"),
        requiredInteger(row.season_id, "season_id", "lineups"),
        integerOrNull(row.team_id),
        integerOrNull(row.season_team_id),
        booleanToInteger(row.is_home) ?? 0,
        integerOrNull(row.player_id),
        textOrNull(row.name),
        textOrNull(row.jersey),
        textOrNull(row.position),
        integerOrNull(row.order_idx),
        integerOrNull(row.source_batting_order),
        integerOrNull(row.source_batting_order_slot),
        integerOrNull(row.batting_order),
        textOrNull(row.batting_order_modifier),
      ]);
      importedCounts.lineups += 1;
    }

    const battingRows = await readSeedTableRows(seedsDir, "batting_stats");
    for (const row of battingRows) {
      if (!shouldImportSeasonId(row.season_id)) {
        continue;
      }
      insertBatting.run([
        competitionIdForRow(row),
        requiredInteger(row.game_id, "game_id", "batting_stats"),
        requiredInteger(row.season_id, "season_id", "batting_stats"),
        integerOrNull(row.team_id),
        integerOrNull(row.season_team_id),
        booleanToInteger(row.is_home) ?? 0,
        integerOrNull(row.player_id),
        textOrNull(row.jersey),
        textOrNull(row.position),
        integerOrNull(row.ab),
        integerOrNull(row.runs),
        integerOrNull(row.hits),
        integerOrNull(row.doubles),
        integerOrNull(row.triples),
        integerOrNull(row.hr),
        integerOrNull(row.rbi),
        integerOrNull(row.bb),
        integerOrNull(row.so),
        integerOrNull(row.sb),
        integerOrNull(row.caught_stealing),
        integerOrNull(row.hit_by_pitch),
        integerOrNull(row.sacrifice_flies),
        integerOrNull(row.sacrifice_bunts),
        textOrNull(row.avg),
        integerOrNull(row.source_batting_order),
        integerOrNull(row.source_batting_order_slot),
        integerOrNull(row.batting_order),
        textOrNull(row.batting_order_modifier),
      ]);
      importedCounts.batting_stats += 1;
    }

    const pitchingRows = await readSeedTableRows(seedsDir, "pitching_stats");
    for (const row of pitchingRows) {
      if (!shouldImportSeasonId(row.season_id)) {
        continue;
      }
      insertPitching.run([
        competitionIdForRow(row),
        requiredInteger(row.game_id, "game_id", "pitching_stats"),
        requiredInteger(row.season_id, "season_id", "pitching_stats"),
        integerOrNull(row.team_id),
        integerOrNull(row.season_team_id),
        booleanToInteger(row.is_home) ?? 0,
        integerOrNull(row.player_id),
        textOrNull(row.jersey),
        integerOrNull(row.pitching_order),
        textOrNull(row.ip),
        integerOrNull(row.hits),
        integerOrNull(row.runs),
        integerOrNull(row.earned_runs),
        integerOrNull(row.doubles_allowed),
        integerOrNull(row.triples_allowed),
        integerOrNull(row.home_runs_allowed),
        integerOrNull(row.bb),
        integerOrNull(row.so),
        integerOrNull(row.hit_by_pitch),
        booleanToInteger(row.win),
        booleanToInteger(row.loss),
        booleanToInteger(row.save),
        booleanToInteger(row.blown_save),
        booleanToInteger(row.complete_game),
        integerOrNull(row.batters_faced),
        integerOrNull(row.pitches),
        textOrNull(row.era),
      ]);
      importedCounts.pitching_stats += 1;
    }

    const seasonBattingRows = await readSeedTableRows(seedsDir, "season_batting_stats");
    for (const row of seasonBattingRows) {
      if (!shouldImportSeasonId(row.season_id)) {
        continue;
      }
      insertSeasonBatting.run([
        competitionIdForRow(row),
        textOrNull(row.scope),
        integerOrNull(row.league_id),
        requiredInteger(row.season_id, "season_id", "season_batting_stats"),
        integerOrNull(row.team_id),
        integerOrNull(row.season_team_id),
        textOrNull(row.source_team_name),
        integerOrNull(row.player_id),
        integerOrNull(row.player_season_id),
        textOrNull(row.player_name),
        textOrNull(row.jersey),
        integerOrNull(row.at_bats),
        integerOrNull(row.runs),
        integerOrNull(row.hits),
        integerOrNull(row.doubles),
        integerOrNull(row.triples),
        integerOrNull(row.home_runs),
        integerOrNull(row.runs_batted_in),
        integerOrNull(row.walks),
        integerOrNull(row.hit_by_pitch),
        integerOrNull(row.strikeouts),
        integerOrNull(row.sacrifice_flies),
        integerOrNull(row.sacrifice_bunts),
        integerOrNull(row.stolen_bases),
        integerOrNull(row.caught_stealing),
        integerOrNull(row.double_plays),
        textOrNull(row.on_base_percentage),
        textOrNull(row.slugging_percentage),
        textOrNull(row.batting_average),
      ]);
      importedCounts.season_batting_stats += 1;
    }

    const seasonPitchingRows = await readSeedTableRows(seedsDir, "season_pitching_stats");
    for (const row of seasonPitchingRows) {
      if (!shouldImportSeasonId(row.season_id)) {
        continue;
      }
      insertSeasonPitching.run([
        competitionIdForRow(row),
        textOrNull(row.scope),
        integerOrNull(row.league_id),
        requiredInteger(row.season_id, "season_id", "season_pitching_stats"),
        integerOrNull(row.team_id),
        integerOrNull(row.season_team_id),
        textOrNull(row.source_team_name),
        integerOrNull(row.player_id),
        integerOrNull(row.player_season_id),
        textOrNull(row.player_name),
        textOrNull(row.jersey),
        integerOrNull(row.wins),
        integerOrNull(row.losses),
        textOrNull(row.innings_pitched),
        integerOrNull(row.runs),
        integerOrNull(row.earned_runs),
        integerOrNull(row.hits),
        integerOrNull(row.walks),
        integerOrNull(row.strikeouts),
        integerOrNull(row.hit_by_pitch),
        integerOrNull(row.batters_faced),
        integerOrNull(row.games),
        integerOrNull(row.games_started),
        integerOrNull(row.complete_games),
        integerOrNull(row.complete_game_losses),
        integerOrNull(row.shutouts),
        integerOrNull(row.saves),
        integerOrNull(row.blown_saves),
        textOrNull(row.opponent_on_base_percentage),
        textOrNull(row.opponent_slugging_percentage),
        textOrNull(row.opponent_average),
        textOrNull(row.era),
      ]);
      importedCounts.season_pitching_stats += 1;
    }

    const seasonBattingLeaderRows = await readSeedTableRows(seedsDir, "season_batting_leaders");
    for (const row of seasonBattingLeaderRows) {
      if (!shouldImportSeasonId(row.season_id)) {
        continue;
      }
      insertSeasonBattingLeader.run([
        competitionIdForRow(row),
        textOrNull(row.scope),
        integerOrNull(row.league_id),
        requiredInteger(row.season_id, "season_id", "season_batting_leaders"),
        integerOrNull(row.team_id),
        integerOrNull(row.season_team_id),
        textOrNull(row.leader_category),
        requiredInteger(row.rank, "rank", "season_batting_leaders"),
        textOrNull(row.source_team_name),
        integerOrNull(row.player_id),
        integerOrNull(row.player_season_id),
        textOrNull(row.player_name),
        textOrNull(row.jersey),
        integerOrNull(row.at_bats),
        integerOrNull(row.runs),
        integerOrNull(row.hits),
        integerOrNull(row.doubles),
        integerOrNull(row.triples),
        integerOrNull(row.home_runs),
        integerOrNull(row.runs_batted_in),
        integerOrNull(row.walks),
        integerOrNull(row.hit_by_pitch),
        integerOrNull(row.strikeouts),
        integerOrNull(row.sacrifice_flies),
        integerOrNull(row.sacrifice_bunts),
        integerOrNull(row.stolen_bases),
        integerOrNull(row.caught_stealing),
        integerOrNull(row.double_plays),
        textOrNull(row.on_base_percentage),
        textOrNull(row.slugging_percentage),
        textOrNull(row.batting_average),
      ]);
      importedCounts.season_batting_leaders += 1;
    }

    const seasonPitchingLeaderRows = await readSeedTableRows(seedsDir, "season_pitching_leaders");
    for (const row of seasonPitchingLeaderRows) {
      if (!shouldImportSeasonId(row.season_id)) {
        continue;
      }
      insertSeasonPitchingLeader.run([
        competitionIdForRow(row),
        textOrNull(row.scope),
        integerOrNull(row.league_id),
        requiredInteger(row.season_id, "season_id", "season_pitching_leaders"),
        integerOrNull(row.team_id),
        integerOrNull(row.season_team_id),
        textOrNull(row.leader_category),
        requiredInteger(row.rank, "rank", "season_pitching_leaders"),
        textOrNull(row.source_team_name),
        integerOrNull(row.player_id),
        integerOrNull(row.player_season_id),
        textOrNull(row.player_name),
        textOrNull(row.jersey),
        integerOrNull(row.wins),
        integerOrNull(row.losses),
        textOrNull(row.innings_pitched),
        integerOrNull(row.runs),
        integerOrNull(row.earned_runs),
        integerOrNull(row.hits),
        integerOrNull(row.walks),
        integerOrNull(row.strikeouts),
        integerOrNull(row.hit_by_pitch),
        integerOrNull(row.batters_faced),
        integerOrNull(row.games),
        integerOrNull(row.games_started),
        integerOrNull(row.complete_games),
        integerOrNull(row.complete_game_losses),
        integerOrNull(row.shutouts),
        integerOrNull(row.saves),
        integerOrNull(row.blown_saves),
        textOrNull(row.opponent_on_base_percentage),
        textOrNull(row.opponent_slugging_percentage),
        textOrNull(row.opponent_average),
        textOrNull(row.era),
      ]);
      importedCounts.season_pitching_leaders += 1;
    }

    const inningRows = await readSeedTableRows(seedsDir, "innings");
    for (const row of inningRows) {
      if (!shouldImportSeasonId(row.season_id)) {
        continue;
      }
      insertInning.run([
        competitionIdForRow(row),
        requiredInteger(row.game_id, "game_id", "innings"),
        requiredInteger(row.season_id, "season_id", "innings"),
        integerOrNull(row.team_id),
        integerOrNull(row.season_team_id),
        booleanToInteger(row.is_home) ?? 0,
        requiredInteger(row.inning_number, "inning_number", "innings"),
        integerOrNull(row.runs),
        integerOrNull(row.total_runs),
        integerOrNull(row.total_hits),
        integerOrNull(row.total_errors),
      ]);
      importedCounts.innings += 1;
    }

    const standingsRows = await readSeedTableRows(seedsDir, "standings");
    for (const row of standingsRows) {
      if (!shouldImportSeasonId(row.season_id)) {
        continue;
      }
      const wins = requiredInteger(row.wins, "wins", "standings");
      const losses = requiredInteger(row.losses, "losses", "standings");
      const ties = requiredInteger(row.ties, "ties", "standings");
      insertStanding.run([
        competitionIdForRow(row),
        integerOrNull(row.league_id),
        requiredInteger(row.season_id, "season_id", "standings"),
        integerOrNull(row.team_id),
        integerOrNull(row.season_team_id),
        textOrNull(row.name),
        integerOrNull(row.games_played) ?? wins + losses + ties,
        wins,
        losses,
        ties,
        textOrNull(row.pct),
      ]);
      importedCounts.standings += 1;
    }

    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  } finally {
    insertMetadata.free();
    insertCompetition.free();
    insertSeason.free();
    insertPerson.free();
    insertPlayer.free();
    insertTeam.free();
    insertTeamAlias.free();
    insertTeamSeasonId.free();
    insertRoster.free();
    insertGame.free();
    insertLineup.free();
    insertBatting.free();
    insertPitching.free();
    insertSeasonBatting.free();
    insertSeasonPitching.free();
    insertSeasonBattingLeader.free();
    insertSeasonPitchingLeader.free();
    insertInning.free();
    insertStanding.free();
  }

  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.writeFile(dbPath, Buffer.from(db.export()));
  if (typeof db.close === "function") {
    db.close();
  }

  return {
    dbPath,
    seedsDir,
    seasonCount: manifest.seasonIds.filter((seasonId) => shouldImportSeasonId(seasonId)).length,
    warnings: manifest.warnings.length,
    importedCounts,
  };
}
