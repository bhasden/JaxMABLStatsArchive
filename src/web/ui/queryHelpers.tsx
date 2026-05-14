import { useEffect, useState, type MouseEvent } from "react";
import { downloadBytes, type QueryResult } from "../data/archiveDb";
import type { useArchiveDatabase } from "../hooks/useArchiveDatabase";
import type { ColumnHeaderMode } from "../hooks/useColumnHeaderMode";
import { href } from "../hooks/useHashRoute";

export type ArchiveContext = ReturnType<typeof useArchiveDatabase>;

export const SQL_EXPLORER_DRAFT_KEY = "jax-mabl-sql-explorer-draft";
export const SQL_EXPLORER_DRAFT_PARAM = "draft";

export function usePageQuery(archive: ArchiveContext, sql: string, label: string) {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { runQuery } = archive;

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    runQuery(sql, { source: "page", label })
      .then((results) => {
        if (!cancelled) {
          setResult(results[0] ?? { columns: [], values: [] });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runQuery, sql, label]);

  return { result, error, sql, label };
}

const COLUMN_LABELS: Record<string, string> = {
  ab: "AB",
  at_bats: "AB",
  away_score: "Away",
  away_team: "Away Team",
  avg: "AVG",
  batting_order: "BO",
  batting_order_modifier: "BO Slot",
  batting_order_modifier_sort: "BO Slot Sort",
  batting_order_sort: "BO Sort",
  batting_average: "AVG",
  bb: "BB",
  batters_faced: "BF",
  blown_save: "BS",
  blown_saves: "BS",
  bats: "Bats",
  birthdate: "DOB",
  canonical_team_name: "Team",
  caught_stealing: "CS",
  complete_game: "CG",
  competition: "Competition",
  competition_id: "Competition ID",
  category: "Category",
  complete_game_losses: "CGL",
  complete_games: "CG",
  double_plays: "DP",
  doubles: "2B",
  doubles_allowed: "2B",
  earned_runs: "ER",
  era: "ERA",
  errors: "E",
  first_season: "First Season",
  games: "G",
  games_played: "GP",
  games_started: "GS",
  hit_by_pitch: "HBP",
  height: "Height",
  home_runs_allowed: "HR",
  hits: "H",
  jersey: "#",
  jersey_numbers: "#",
  home_runs: "HR",
  home_score: "Home",
  home_team: "Home Team",
  hr: "HR",
  ip: "IP",
  innings_pitched: "IP",
  losses: "L",
  loss: "L",
  losing_team: "Losing Team",
  last_season: "Last Season",
  leader_group: "Group",
  name: "Name",
  opponent: "Opponent",
  opponent_average: "OAVG",
  opponent_on_base_percentage: "OOBP",
  opponent_slugging_percentage: "OSLG",
  on_base_percentage: "OBP",
  pct: "PCT",
  pitches: "Pitches",
  plate_appearances: "PA",
  player_name: "Player",
  game_id: "Game ID",
  player_id: "Player ID",
  person_id: "Person ID",
  person_name: "Person",
  pitching_order: "PO",
  player_entries: "Player Entries",
  position: "POS",
  positions: "POS",
  qualification: "Qualification",
  qualified: "Status",
  rank: "Rank",
  rostered_players: "Rostered Players",
  runs: "R",
  rbi: "RBI",
  result: "Result",
  runs_batted_in: "RBI",
  sacrifice_flies: "SF",
  sacrifice_bunts: "SH",
  scheduled_at: "Date",
  score: "Score",
  season_id: "Season",
  season_name: "Season Name",
  season_team_name: "Season Team Name",
  season_year: "Year",
  seasons: "Seasons",
  short_name: "Short Name",
  source_player_id: "Source Player ID",
  source_team_id: "Source Team ID",
  saves: "SV",
  save: "SV",
  sb: "SB",
  sho: "SHO",
  shutouts: "SHO",
  slugging_percentage: "SLG",
  so: "SO",
  source_team_name: "Team",
  source_batting_order: "Source BO",
  source_batting_order_slot: "Source BO Slot",
  status: "Status",
  stolen_bases: "SB",
  strikeouts: "SO",
  team: "Team",
  team_name: "Team",
  team_id: "Team ID",
  season_team_id: "Season Team ID",
  teams: "Teams",
  ties: "T",
  triples: "3B",
  triples_allowed: "3B",
  throws: "Throws",
  type: "Type",
  value: "Value",
  walks: "BB",
  weight: "Weight",
  wins: "W",
  win: "W",
  winning_team: "Winning Team",
};

const COLUMN_DESCRIPTIONS: Record<string, string> = {
  ab: "At Bats",
  at_bats: "At Bats",
  away_score: "Away Team Score",
  away_team: "Away Team",
  avg: "Batting Average",
  batting_order: "Batting Order",
  batting_order_modifier: "Batting Order Modifier",
  batting_order_modifier_sort: "Batting Order Modifier Sort Value",
  batting_order_sort: "Batting Order Sort Value",
  batting_average: "Batting Average",
  bb: "Bases on Balls",
  batters_faced: "Batters Faced",
  blown_save: "Blown Save",
  blown_saves: "Blown Saves",
  bats: "Bats",
  birthdate: "Date of Birth",
  canonical_team_name: "Canonical Team Name",
  caught_stealing: "Caught Stealing",
  complete_game: "Complete Game",
  competition: "Competition",
  competition_id: "Stable Archive Competition Identifier",
  competition_count: "Number of Linked Competitions",
  competitions: "Linked Competitions",
  category: "Leaderboard Category",
  complete_game_losses: "Complete Game Losses",
  complete_games: "Complete Games",
  double_plays: "Double Plays",
  doubles: "Doubles",
  doubles_allowed: "Doubles Allowed",
  earned_runs: "Earned Runs",
  era: "Earned Run Average",
  errors: "Errors",
  first_season: "First Season",
  games: "Games",
  games_played: "Games Played",
  games_started: "Games Started",
  hit_by_pitch: "Hit By Pitch",
  height: "Height",
  home_runs_allowed: "Home Runs Allowed",
  hits: "Hits",
  jersey: "Jersey Number",
  jersey_numbers: "Jersey Numbers",
  home_runs: "Home Runs",
  home_score: "Home Team Score",
  home_team: "Home Team",
  hr: "Home Runs",
  ip: "Innings Pitched",
  innings_pitched: "Innings Pitched",
  losses: "Losses",
  loss: "Loss",
  losing_team: "Losing Team",
  last_season: "Last Season",
  leader_group: "Leaderboard Group",
  name: "Name",
  opponent: "Opponent",
  opponent_average: "Opponent Batting Average",
  opponent_on_base_percentage: "Opponent On-Base Percentage",
  opponent_slugging_percentage: "Opponent Slugging Percentage",
  on_base_percentage: "On-Base Percentage",
  pct: "Winning Percentage",
  pitches: "Pitches",
  plate_appearances: "Plate Appearances",
  player_name: "Player Name",
  game_id: "Archive Game Identifier",
  player_id: "Stable Archive Player Identifier",
  person_id: "Stable Archive Person Identifier",
  person_name: "Display Name for the Linked Person Record",
  pitching_order: "Pitching Order",
  player_entries: "Number of Linked Competition-Local Player Records",
  position: "Position",
  positions: "Positions",
  qualification: "Qualification Detail",
  qualified: "Qualification Status",
  rank: "Rank",
  rostered_players: "Rostered Players",
  runs: "Runs",
  rbi: "Runs Batted In",
  result: "Game Result",
  runs_batted_in: "Runs Batted In",
  sacrifice_flies: "Sacrifice Flies",
  sacrifice_bunts: "Sacrifice Bunts",
  scheduled_at: "Scheduled Date and Time",
  score: "Final Score",
  season_id: "Archive Season Identifier",
  season_name: "Archived Season Display Name",
  season_team_name: "Team Name as Reported for This Season",
  season_year: "Season Year",
  seasons: "Seasons Played",
  short_name: "Short Team Name",
  source_player_id: "Source Player Identifier",
  source_team_id: "Source Team Identifier",
  saves: "Saves",
  save: "Save",
  sb: "Stolen Bases",
  sho: "Shutouts",
  shutouts: "Shutouts",
  slugging_percentage: "Slugging Percentage",
  so: "Strikeouts",
  source_team_name: "Team Name from the Source Feed",
  source_batting_order: "Raw Batting Order from the Source Feed",
  source_batting_order_slot: "Raw Batting Order Slot from the Source Feed",
  status: "Roster Status",
  stolen_bases: "Stolen Bases",
  strikeouts: "Strikeouts",
  team: "Team",
  team_name: "Team Name",
  team_id: "Stable Archive Team Identifier",
  season_team_id: "Season-Scoped Source Team Identifier",
  teams: "Teams",
  ties: "Ties",
  triples: "Triples",
  triples_allowed: "Triples Allowed",
  throws: "Throws",
  type: "Type",
  value: "Leaderboard Value",
  walks: "Bases on Balls",
  weight: "Weight",
  wins: "Wins",
  win: "Win",
  winning_team: "Winning Team",
};

function friendlyColumnName(column: string) {
  if (/^\d+$/.test(column)) {
    return column;
  }

  return (
    COLUMN_LABELS[column] ??
    column
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function columnDescription(column: string) {
  if (/^\d+$/.test(column)) {
    return `Inning ${column}`;
  }

  return COLUMN_DESCRIPTIONS[column] ?? friendlyColumnName(column);
}

function ColumnHeader({ column, mode }: { column: string; mode: ColumnHeaderMode }) {
  const label = mode === "database" ? column : friendlyColumnName(column);
  const title = `${columnDescription(column)} (${column})`;

  return (
    <span className="column-heading" title={title}>
      {label}
    </span>
  );
}

type TableCellLink = (context: {
  column: string;
  value: unknown;
  row: unknown[];
  columns: string[];
  rowIndex: number;
  cellIndex: number;
}) => string | undefined;

export function Table({
  result,
  limit,
  cellHref,
  hiddenColumns = [],
  columnHeaderMode = "friendly",
  query,
}: {
  result: QueryResult | null;
  limit?: number;
  cellHref?: TableCellLink;
  hiddenColumns?: string[];
  columnHeaderMode?: ColumnHeaderMode;
  query?: string;
}) {
  if (!result) {
    return <div className="muted">Loading</div>;
  }

  const values = limit ? result.values.slice(0, limit) : result.values;
  const hidden = new Set(hiddenColumns);
  const visibleColumns = result.columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => !hidden.has(column));

  if (result.columns.length === 0) {
    return <div className="muted">No rows returned.</div>;
  }

  return (
    <div className="table-shell">
      <TableActions result={result} visibleColumns={visibleColumns} values={values} query={query} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {visibleColumns.map(({ column }) => (
                <th key={column} data-column={column}>
                  <ColumnHeader column={column} mode={columnHeaderMode} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {values.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {visibleColumns.map(({ column, index: cellIndex }) => {
                  const value = row[cellIndex];
                  const text = formatValue(value, column);
                  const link = cellHref?.({ column, value, row, columns: result.columns, rowIndex, cellIndex });
                  return (
                    <td key={cellIndex} data-column={column}>
                      {link ? <a href={link}>{text}</a> : text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TableActions({
  result,
  visibleColumns,
  values,
  query,
}: {
  result: QueryResult;
  visibleColumns: { column: string; index: number }[];
  values: unknown[][];
  query?: string;
}) {
  function closeMenu(event: MouseEvent<HTMLElement>) {
    event.currentTarget.closest("details")?.removeAttribute("open");
  }

  function downloadCsv(event: MouseEvent<HTMLButtonElement>) {
    closeMenu(event);
    const csv = resultToCsv(result, visibleColumns, values);
    const bytes = new TextEncoder().encode(csv);
    downloadBytes(bytes, "table-results.csv", "text/csv");
  }

  function openInSqlExplorer(event: MouseEvent<HTMLButtonElement>) {
    closeMenu(event);
    if (!query) {
      return;
    }

    const draftId = crypto.randomUUID();
    const draftKey = `${SQL_EXPLORER_DRAFT_KEY}:${draftId}`;
    window.localStorage.setItem(draftKey, query.trim());

    const sqlExplorerUrl = href(`/sql?${SQL_EXPLORER_DRAFT_PARAM}=${encodeURIComponent(draftId)}`);
    const sqlExplorer = window.open(sqlExplorerUrl, "_blank");
    if (sqlExplorer) {
      sqlExplorer.opener = null;
    } else {
      window.location.hash = sqlExplorerUrl;
    }
  }

  function copySql(event: MouseEvent<HTMLButtonElement>) {
    closeMenu(event);
    if (query) {
      copyText(query);
    }
  }

  return (
    <details className="table-action-menu">
      <summary title="Table actions" aria-label="Table actions">
        ▾
      </summary>
      <div className="table-action-list">
        <button type="button" onClick={downloadCsv}>
          Download CSV
        </button>
        <button type="button" disabled={!query} onClick={openInSqlExplorer}>
          Open in SQL Explorer
        </button>
        <button type="button" disabled={!query} onClick={copySql}>
          Copy SQL
        </button>
      </div>
    </details>
  );
}

function resultToCsv(result: QueryResult, visibleColumns: { column: string; index: number }[], values: unknown[][]) {
  const header = visibleColumns.map(({ column }) => csvEscape(column)).join(",");
  const rows = values.map((row) => visibleColumns.map(({ index }) => csvEscape(row[index])).join(","));
  return [header, ...rows].join("\n");
}

function csvEscape(value: unknown) {
  if (value == null) {
    return "";
  }
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function copyText(text: string) {
  void navigator.clipboard?.writeText(text.trim());
}

export function formatValue(value: unknown, column?: string) {
  if (value == null) {
    return "";
  }
  if (column === "birthdate" && typeof value === "string") {
    return formatDate(value);
  }
  if (column === "scheduled_at" && typeof value === "string") {
    return formatDateTime(value);
  }
  return String(value);
}

function formatDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return value;
  }

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(date);
}

function formatDateTime(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) {
    return value;
  }

  const [, year, month, day, hour, minute, second = "0"] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
