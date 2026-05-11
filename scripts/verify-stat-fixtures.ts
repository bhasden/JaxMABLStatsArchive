#!/usr/bin/env tsx
import fs from "fs/promises";
import path from "path";
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
  pointstreak_player_id,
  hits
FROM season_pitching_stats
WHERE scope = 'league'
  AND season_id = 29373
  AND pointstreak_player_id = 796978;
`,
      expectedRows: 1,
      expectedValues: {
        season_id: 29373,
        pointstreak_player_id: 796978,
        hits: 28,
      },
    },
    {
      label: "Al Arena lifetime batting totals",
      sql: buildPlayerLifetimeBattingSql(796978),
      expectedRows: 1,
      expectedValues: {
        pointstreak_player_id: 796978,
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
        pointstreak_player_id: 796978,
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
