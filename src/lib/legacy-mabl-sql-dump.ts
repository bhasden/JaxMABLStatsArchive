import fs from "fs/promises";

const LEGACY_MABL_TABLES = [
  "mabl_Team",
  "mabl_TeamSeason",
  "mabl_Schedule",
  "mabl_Position",
  "mabl_Player",
  "mabl_PlayerTeam",
  "mabl_Location",
  "mabl_Innings",
  "mabl_GameStatsBatting",
  "mabl_GameStatsPitching",
] as const;

type LegacyMablTableName = (typeof LEGACY_MABL_TABLES)[number];

type SqlValue = string | number | null;

type SqlRow = Record<string, SqlValue>;

export type LegacyMablTeam = {
  teamid: number;
  name: string | null;
  abbr: string | null;
};

export type LegacyMablTeamSeason = {
  teamid: number;
  season: number;
  division: number | null;
  teamname: string | null;
  clinch_division: number | null;
  clinch_playoffs: number | null;
  eliminated: number | null;
};

export type LegacyMablSchedule = {
  gameid: number;
  date: string | null;
  locationid: number | null;
  home_team: number | null;
  away_team: number | null;
  home_score: number | null;
  away_score: number | null;
  home_errors: number | null;
  away_errors: number | null;
  winning_team: number | null;
  season: number;
  ppt: number | null;
  cancelled: number | null;
};

export type LegacyMablPosition = {
  id: number;
  abbr: string | null;
  position: string | null;
};

export type LegacyMablPlayer = {
  id: number;
  firstname: string | null;
  lastname: string | null;
  position: number | null;
  throws: string | null;
  bats: string | null;
  number: string | null;
  manager: number | null;
  dob: string | null;
  hometown: string | null;
  pic: string | null;
};

export type LegacyMablPlayerTeam = {
  playerid: number;
  teamid: number;
  season: number;
  deleted: number | null;
};

export type LegacyMablLocation = {
  id: number;
  name: string | null;
  map: string | null;
};

export type LegacyMablInning = {
  gameid: number;
  inning: number;
  home_score: number | null;
  away_score: number | null;
};

export type LegacyMablBatting = {
  gameid: number;
  playerid: number;
  ab: number | null;
  runs: number | null;
  hits: number | null;
  doubles: number | null;
  triples: number | null;
  hr: number | null;
  rbi: number | null;
  sb: number | null;
  cs: number | null;
  bb: number | null;
  so: number | null;
  hbp: number | null;
  sacfly: number | null;
  sacbunt: number | null;
  position: number | null;
  lineup: number | null;
  lineup2: number | null;
  teamid: number | null;
};

export type LegacyMablPitching = {
  gameid: number;
  playerid: number;
  innings: number | null;
  hits: number | null;
  runs: number | null;
  earned: number | null;
  doubles: number | null;
  triples: number | null;
  hr: number | null;
  bb: number | null;
  so: number | null;
  win: number | null;
  loss: number | null;
  sv: number | null;
  blown: number | null;
  complete: number | null;
  atbats: number | null;
  pitches: number | null;
  ord: number | null;
  thirdinnings: number | null;
  hbp: number | null;
  teamid: number | null;
};

export type LegacyMablDump = {
  teams: LegacyMablTeam[];
  teamSeasons: LegacyMablTeamSeason[];
  schedules: LegacyMablSchedule[];
  positions: LegacyMablPosition[];
  players: LegacyMablPlayer[];
  playerTeams: LegacyMablPlayerTeam[];
  locations: LegacyMablLocation[];
  innings: LegacyMablInning[];
  batting: LegacyMablBatting[];
  pitching: LegacyMablPitching[];
};

export async function loadLegacyMablDump(filePath: string): Promise<LegacyMablDump> {
  const sql = await fs.readFile(filePath, "utf8");
  const rows = parseLegacyMablSqlDump(sql);

  return {
    teams: rows.mabl_Team.map(toTeam),
    teamSeasons: rows.mabl_TeamSeason.map(toTeamSeason),
    schedules: rows.mabl_Schedule.map(toSchedule),
    positions: rows.mabl_Position.map(toPosition),
    players: rows.mabl_Player.map(toPlayer),
    playerTeams: rows.mabl_PlayerTeam.map(toPlayerTeam),
    locations: rows.mabl_Location.map(toLocation),
    innings: rows.mabl_Innings.map(toInning),
    batting: rows.mabl_GameStatsBatting.map(toBatting),
    pitching: rows.mabl_GameStatsPitching.map(toPitching),
  };
}

function parseLegacyMablSqlDump(sql: string): Record<LegacyMablTableName, SqlRow[]> {
  const rows = Object.fromEntries(LEGACY_MABL_TABLES.map((table) => [table, []])) as unknown as Record<
    LegacyMablTableName,
    SqlRow[]
  >;
  const tableSet = new Set<string>(LEGACY_MABL_TABLES);
  const insertPattern = /INSERT INTO \[([^\]]+)]\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\);/g;

  for (const match of sql.matchAll(insertPattern)) {
    const [, tableName, columnsSql, valuesSql] = match;
    if (!tableSet.has(tableName)) {
      continue;
    }

    const table = tableName as LegacyMablTableName;
    const columns = parseColumnNames(columnsSql);
    const values = splitSqlValues(valuesSql).map(parseSqlValue);
    if (columns.length !== values.length) {
      throw new Error(`Could not parse ${table} row: ${columns.length} columns but ${values.length} values`);
    }

    rows[table].push(Object.fromEntries(columns.map((column, index) => [column, values[index]])));
  }

  return rows;
}

function parseColumnNames(columnsSql: string) {
  return columnsSql
    .split(",")
    .map((column) => column.trim().replace(/^\[/, "").replace(/]$/, ""))
    .filter(Boolean);
}

function splitSqlValues(valuesSql: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < valuesSql.length; index += 1) {
    const char = valuesSql[index];
    const next = valuesSql[index + 1];

    if (char === "'" && quoted && next === "'") {
      current += "''";
      index += 1;
      continue;
    }

    if (char === "'") {
      quoted = !quoted;
      current += char;
      continue;
    }

    if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim().length > 0) {
    values.push(current.trim());
  }

  return values;
}

function parseSqlValue(value: string): SqlValue {
  if (/^NULL$/i.test(value)) {
    return null;
  }

  const stringMatch = value.match(/^N?'([\s\S]*)'$/);
  if (stringMatch) {
    return stringMatch[1].replace(/''/g, "'").trim();
  }

  const number = Number(value);
  if (Number.isFinite(number)) {
    return number;
  }

  return value.trim();
}

function toTeam(row: SqlRow): LegacyMablTeam {
  return {
    teamid: requiredNumber(row.teamid, "mabl_Team.teamid"),
    name: nullableString(row.name),
    abbr: nullableString(row.abbr),
  };
}

function toTeamSeason(row: SqlRow): LegacyMablTeamSeason {
  return {
    teamid: requiredNumber(row.teamid, "mabl_TeamSeason.teamid"),
    season: requiredNumber(row.season, "mabl_TeamSeason.season"),
    division: nullableNumber(row.division),
    teamname: nullableString(row.teamname),
    clinch_division: nullableNumber(row.clinch_division),
    clinch_playoffs: nullableNumber(row.clinch_playoffs),
    eliminated: nullableNumber(row.eliminated),
  };
}

function toSchedule(row: SqlRow): LegacyMablSchedule {
  return {
    gameid: requiredNumber(row.gameid, "mabl_Schedule.gameid"),
    date: nullableString(row.date),
    locationid: nullableNumber(row.locationid),
    home_team: nullableNumber(row.home_team),
    away_team: nullableNumber(row.away_team),
    home_score: nullableNumber(row.home_score),
    away_score: nullableNumber(row.away_score),
    home_errors: nullableNumber(row.home_errors),
    away_errors: nullableNumber(row.away_errors),
    winning_team: nullableNumber(row.winning_team),
    season: requiredNumber(row.season, "mabl_Schedule.season"),
    ppt: nullableNumber(row.ppt),
    cancelled: nullableNumber(row.cancelled),
  };
}

function toPosition(row: SqlRow): LegacyMablPosition {
  return {
    id: requiredNumber(row.id, "mabl_Position.id"),
    abbr: nullableString(row.abbr),
    position: nullableString(row.position),
  };
}

function toPlayer(row: SqlRow): LegacyMablPlayer {
  return {
    id: requiredNumber(row.id, "mabl_Player.id"),
    firstname: nullableString(row.firstname),
    lastname: nullableString(row.lastname),
    position: nullableNumber(row.position),
    throws: nullableString(row.throws),
    bats: nullableString(row.bats),
    number: nullableString(row.number),
    manager: nullableNumber(row.manager),
    dob: nullableString(row.dob),
    hometown: nullableString(row.hometown),
    pic: nullableString(row.pic),
  };
}

function toPlayerTeam(row: SqlRow): LegacyMablPlayerTeam {
  return {
    playerid: requiredNumber(row.playerid, "mabl_PlayerTeam.playerid"),
    teamid: requiredNumber(row.teamid, "mabl_PlayerTeam.teamid"),
    season: requiredNumber(row.season, "mabl_PlayerTeam.season"),
    deleted: nullableNumber(row.deleted),
  };
}

function toLocation(row: SqlRow): LegacyMablLocation {
  return {
    id: requiredNumber(row.id, "mabl_Location.id"),
    name: nullableString(row.name),
    map: nullableString(row.map),
  };
}

function toInning(row: SqlRow): LegacyMablInning {
  return {
    gameid: requiredNumber(row.gameid, "mabl_Innings.gameid"),
    inning: requiredNumber(row.inning, "mabl_Innings.inning"),
    home_score: nullableNumber(row.home_score),
    away_score: nullableNumber(row.away_score),
  };
}

function toBatting(row: SqlRow): LegacyMablBatting {
  return {
    gameid: requiredNumber(row.gameid, "mabl_GameStatsBatting.gameid"),
    playerid: requiredNumber(row.playerid, "mabl_GameStatsBatting.playerid"),
    ab: nullableNumber(row.ab),
    runs: nullableNumber(row.runs),
    hits: nullableNumber(row.hits),
    doubles: nullableNumber(row.doubles),
    triples: nullableNumber(row.triples),
    hr: nullableNumber(row.hr),
    rbi: nullableNumber(row.rbi),
    sb: nullableNumber(row.sb),
    cs: nullableNumber(row.cs),
    bb: nullableNumber(row.bb),
    so: nullableNumber(row.so),
    hbp: nullableNumber(row.hbp),
    sacfly: nullableNumber(row.sacfly),
    sacbunt: nullableNumber(row.sacbunt),
    position: nullableNumber(row.position),
    lineup: nullableNumber(row.lineup),
    lineup2: nullableNumber(row.lineup2),
    teamid: nullableNumber(row.teamid),
  };
}

function toPitching(row: SqlRow): LegacyMablPitching {
  return {
    gameid: requiredNumber(row.gameid, "mabl_GameStatsPitching.gameid"),
    playerid: requiredNumber(row.playerid, "mabl_GameStatsPitching.playerid"),
    innings: nullableNumber(row.innings),
    hits: nullableNumber(row.hits),
    runs: nullableNumber(row.runs),
    earned: nullableNumber(row.earned),
    doubles: nullableNumber(row.doubles),
    triples: nullableNumber(row.triples),
    hr: nullableNumber(row.hr),
    bb: nullableNumber(row.bb),
    so: nullableNumber(row.so),
    win: nullableNumber(row.win),
    loss: nullableNumber(row.loss),
    sv: nullableNumber(row.sv),
    blown: nullableNumber(row.blown),
    complete: nullableNumber(row.complete),
    atbats: nullableNumber(row.atbats),
    pitches: nullableNumber(row.pitches),
    ord: nullableNumber(row.ord),
    thirdinnings: nullableNumber(row.thirdinnings),
    hbp: nullableNumber(row.hbp),
    teamid: nullableNumber(row.teamid),
  };
}

function nullableNumber(value: SqlValue) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function requiredNumber(value: SqlValue, label: string) {
  const number = nullableNumber(value);
  if (number == null) {
    throw new Error(`Expected numeric value for ${label}`);
  }
  return number;
}

function nullableString(value: SqlValue) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
