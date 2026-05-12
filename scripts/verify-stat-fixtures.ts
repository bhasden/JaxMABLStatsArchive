#!/usr/bin/env tsx
import fs from "fs/promises";
import path from "path";
import { normalizeLegacyLineupRows } from "../src/lib/legacy-lineup-cleanups";
import {
  buildPlayerBattingGameLogSql,
  buildPlayerLifetimeBattingSql,
  buildPlayerLifetimePitchingSql,
  buildPlayerPitchingGameLogSql,
  buildPlayerSeasonBattingSql,
  buildPlayerSeasonPitchingSql,
} from "../src/web/data/playerQueries";

type SqlJsModule = {
  Database: new (data?: Uint8Array) => any;
};

type QueryResult = {
  columns: string[];
  values: unknown[][];
};

type Fixture = {
  label: string;
  sql: string;
  expectedRows?: number;
  expectedValues?: Record<string, unknown>;
  expectedColumnSums?: Record<string, number>;
};

async function loadSqlJs(): Promise<SqlJsModule> {
  const module = await import("sql.js/dist/sql-asm.js");
  const initSqlJs = (module.default ?? module) as () => Promise<SqlJsModule>;
  return initSqlJs();
}

async function main() {
  assertLegacyLineupCleanupFixtures();

  const dbPath = process.argv[2] ?? path.join(process.cwd(), "public", "archive.sqlite");
  const dbBytes = await fs.readFile(dbPath);
  const SQL = await loadSqlJs();
  const db = new SQL.Database(new Uint8Array(dbBytes));

  const fixtures: Fixture[] = [
    {
      label: "Al Arena league pitching hits cleanup",
      sql: `
SELECT
  season_id,
  player_id,
  hits
FROM season_pitching_stats
WHERE scope = 'league'
  AND season_id = 29373
  AND player_id = 796978;
`,
      expectedRows: 1,
      expectedValues: {
        season_id: 29373,
        player_id: 796978,
        hits: 28,
      },
    },
    {
      label: "Al Arena lifetime batting totals",
      sql: buildPlayerLifetimeBattingSql(796978),
      expectedRows: 1,
      expectedValues: {
        player_id: 796978,
        seasons: 1,
        games_played: 2,
        at_bats: 4,
        hits: 1,
      },
    },
    {
      label: "Al Arena season batting totals",
      sql: buildPlayerSeasonBattingSql(796978, 29373),
      expectedRows: 1,
      expectedValues: {
        season_id: 29373,
        games_played: 2,
        at_bats: 4,
        hits: 1,
      },
    },
    {
      label: "Al Arena lifetime pitching totals",
      sql: buildPlayerLifetimePitchingSql(796978),
      expectedRows: 1,
      expectedValues: {
        player_id: 796978,
        seasons: 1,
        games: 7,
        hits: 28,
        innings_pitched: "20.0",
      },
    },
    {
      label: "Al Arena season pitching totals",
      sql: buildPlayerSeasonPitchingSql(796978, 29373),
      expectedRows: 1,
      expectedValues: {
        season_id: 29373,
        games: 7,
        hits: 28,
        innings_pitched: "20.0",
      },
    },
    {
      label: "Al Arena batting game log",
      sql: buildPlayerBattingGameLogSql(796978, 29373),
      expectedRows: 2,
      expectedColumnSums: {
        hits: 1,
        ab: 4,
      },
    },
    {
      label: "Al Arena pitching game log",
      sql: buildPlayerPitchingGameLogSql(796978, 29373),
      expectedRows: 7,
      expectedColumnSums: {
        hits: 28,
      },
    },
  ];

  try {
    for (const fixture of fixtures) {
      const result = runSingleResult(db, fixture.sql);
      assertFixture(result, fixture);
      console.log(`ok - ${fixture.label}`);
    }
  } finally {
    if (typeof db.close === "function") {
      db.close();
    }
  }
}

function assertLegacyLineupCleanupFixtures() {
  const allZero = normalizeLegacyLineupRows([
    { gameid: 1, teamid: 1, playerid: 10, lineup: 0, lineup2: 0 },
    { gameid: 1, teamid: 1, playerid: 11, lineup: 0, lineup2: 0 },
  ]);
  assertLineupRows("legacy lineup all-zero group", allZero.rows, [
    { source_batting_order: 0, source_batting_order_slot: 0, batting_order: null, batting_order_modifier: null },
    { source_batting_order: 0, source_batting_order_slot: 0, batting_order: null, batting_order_modifier: null },
  ]);
  assertEqual("legacy lineup all-zero group count", allZero.stats.allZeroGroups, 1);
  console.log("ok - legacy lineup all-zero group");

  const sameAsOrder = normalizeLegacyLineupRows([
    { gameid: 2, teamid: 1, playerid: 20, lineup: 7, lineup2: 7 },
    { gameid: 2, teamid: 1, playerid: 21, lineup: 8, lineup2: 8 },
  ]);
  assertLineupRows("legacy lineup same-as-order group", sameAsOrder.rows, [
    { source_batting_order: 7, source_batting_order_slot: 7, batting_order: 7, batting_order_modifier: null },
    { source_batting_order: 8, source_batting_order_slot: 8, batting_order: 8, batting_order_modifier: null },
  ]);
  assertEqual("legacy lineup same-as-order group count", sameAsOrder.stats.sameAsOrderGroups, 1);
  console.log("ok - legacy lineup same-as-order group");

  const alternating = normalizeLegacyLineupRows([
    { gameid: 3, teamid: 1, playerid: 30, lineup: 9, lineup2: 1 },
    { gameid: 3, teamid: 1, playerid: 31, lineup: 9, lineup2: 2 },
    { gameid: 3, teamid: 1, playerid: 32, lineup: 9, lineup2: 3 },
  ]);
  assertLineupRows("legacy lineup A/B/replacement group", alternating.rows, [
    { source_batting_order: 9, source_batting_order_slot: 1, batting_order: 9, batting_order_modifier: "A" },
    { source_batting_order: 9, source_batting_order_slot: 2, batting_order: 9, batting_order_modifier: "B" },
    { source_batting_order: 9, source_batting_order_slot: 3, batting_order: 9, batting_order_modifier: "R" },
  ]);
  console.log("ok - legacy lineup A/B/replacement group");

  const unusual = normalizeLegacyLineupRows([
    { gameid: 4, teamid: 1, playerid: 40, lineup: 4, lineup2: 1 },
    { gameid: 4, teamid: 1, playerid: 41, lineup: 4, lineup2: 8 },
  ]);
  assertLineupRows("legacy lineup unusual slot group", unusual.rows, [
    { source_batting_order: 4, source_batting_order_slot: 1, batting_order: 4, batting_order_modifier: "A" },
    { source_batting_order: 4, source_batting_order_slot: 8, batting_order: 4, batting_order_modifier: null },
  ]);
  assertEqual("legacy lineup unusual slot count", unusual.stats.unusualSlotValues.get(8), 1);
  console.log("ok - legacy lineup unusual slot group");
}

function assertLineupRows(
  label: string,
  actual: Array<{
    source_batting_order: number | null;
    source_batting_order_slot: number | null;
    batting_order: number | null;
    batting_order_modifier: string | null;
  }>,
  expected: Array<{
    source_batting_order: number | null;
    source_batting_order_slot: number | null;
    batting_order: number | null;
    batting_order_modifier: string | null;
  }>,
) {
  assertEqual(`${label} row count`, actual.length, expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    for (const key of Object.keys(expected[index]) as Array<keyof (typeof expected)[number]>) {
      assertEqual(`${label} row ${index + 1} ${key}`, actual[index]?.[key], expected[index][key]);
    }
  }
}

function runSingleResult(db: any, sql: string): QueryResult {
  const results = db.exec(sql);
  return results[0] ?? { columns: [], values: [] };
}

function assertFixture(result: QueryResult, fixture: Fixture) {
  if (fixture.expectedRows != null && result.values.length !== fixture.expectedRows) {
    throw new Error(`${fixture.label}: expected ${fixture.expectedRows} rows, got ${result.values.length}`);
  }

  if (fixture.expectedValues) {
    const row = result.values[0];
    if (!row) {
      throw new Error(`${fixture.label}: expected a row`);
    }

    for (const [column, expected] of Object.entries(fixture.expectedValues)) {
      const actual = valueForColumn(result, row, column);
      if (actual !== expected) {
        throw new Error(`${fixture.label}: expected ${column}=${String(expected)}, got ${String(actual)}`);
      }
    }
  }

  if (fixture.expectedColumnSums) {
    for (const [column, expected] of Object.entries(fixture.expectedColumnSums)) {
      const actual = sumColumn(result, column);
      if (actual !== expected) {
        throw new Error(`${fixture.label}: expected sum(${column})=${expected}, got ${actual}`);
      }
    }
  }
}

function valueForColumn(result: QueryResult, row: unknown[], column: string) {
  const index = result.columns.indexOf(column);
  if (index < 0) {
    throw new Error(`Missing expected column ${column}`);
  }
  return row[index];
}

function sumColumn(result: QueryResult, column: string) {
  const index = result.columns.indexOf(column);
  if (index < 0) {
    throw new Error(`Missing expected column ${column}`);
  }

  return result.values.reduce((total, row) => {
    const value = row[index];
    return total + (typeof value === "number" ? value : Number(value ?? 0));
  }, 0);
}

function assertEqual(label: string, actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
