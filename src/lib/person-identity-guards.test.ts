import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import test from "node:test";
import {
  ARCHIVE_SEED_FILES,
  ARCHIVE_SEED_TABLES,
  buildMergedSeedBundle,
  type ArchiveSeedRow,
  type ArchiveSeedTable,
} from "./archive-seed-merge";
import {
  DEFAULT_PERSON_LINKS_FILE,
  DEFAULT_PLAYER_MERGES_FILE,
  DEFAULT_TEAM_MERGES_FILE,
  buildEntityMergeMaps,
} from "./entity-merges";

type SeasonFixture = {
  seasonId: number;
  tables?: Partial<Record<ArchiveSeedTable, ArchiveSeedRow[]>>;
};

async function writeNdjson(filePath: string, rows: ArchiveSeedRow[]) {
  const content = rows.length === 0 ? "" : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  await fs.writeFile(filePath, content, "utf8");
}

async function withSeedFixture(
  seasons: SeasonFixture[],
  configFiles: Record<string, unknown>,
  run: (outDir: string) => Promise<void>,
) {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "jax-mabl-person-guards-"));

  try {
    for (const [fileName, value] of Object.entries(configFiles)) {
      await fs.writeFile(path.join(outDir, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8");
    }

    for (const season of seasons) {
      const seasonDir = path.join(outDir, "seeds", String(season.seasonId));
      await fs.mkdir(seasonDir, { recursive: true });

      for (const table of ARCHIVE_SEED_TABLES) {
        await writeNdjson(seasonDir + path.sep + ARCHIVE_SEED_FILES[table], season.tables?.[table] ?? []);
      }
    }

    await run(outDir);
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
}

test("buildEntityMergeMaps rejects overlapping configured player ids", () => {
  assert.throws(
    () =>
      buildEntityMergeMaps(
        {
          merges: [
            { competitionId: "18-plus", canonicalSourceId: 148, aliasSourceIds: [594472] },
            { competitionId: "18-plus", canonicalSourceId: 594472, aliasSourceIds: [784824] },
          ],
        },
        { merges: [] },
      ),
    /players: 18-plus source id 594472 appears in both merge group 1 and merge group 2/,
  );
});

test("buildMergedSeedBundle rejects reviewed merge ids that do not exist in the configured competition", async () => {
  await withSeedFixture(
    [
      {
        seasonId: 32179,
        tables: {
          players: [{ player_id: 148, name: "Joe Hellett" }],
        },
      },
    ],
    {
      [DEFAULT_PLAYER_MERGES_FILE]: {
        version: 1,
        merges: [{ competitionId: "18-plus", canonicalSourceId: 148, aliasSourceIds: [1372291] }],
      },
      [DEFAULT_TEAM_MERGES_FILE]: { version: 1, merges: [] },
    },
    async (outDir) => {
      await assert.rejects(
        () => buildMergedSeedBundle(outDir, [32179]),
        /players: 18-plus source id 1372291 does not exist in scoped players rows; possible cross-competition or stale reviewed merge input/,
      );
    },
  );
});

test("buildMergedSeedBundle rejects person links with invalid competition ids", async () => {
  await withSeedFixture(
    [
      {
        seasonId: 32179,
        tables: {
          players: [{ player_id: 148, name: "Joe Hellett" }],
        },
      },
    ],
    {
      [DEFAULT_PERSON_LINKS_FILE]: {
        version: 1,
        people: [
          {
            personId: 2,
            displayName: "Joe Hellett",
            members: [{ competitionId: "50-plus", canonicalSourcePlayerId: 148 }],
          },
        ],
      },
    },
    async (outDir) => {
      await assert.rejects(
        () => buildMergedSeedBundle(outDir, [32179]),
        /person-links: personId 2 has invalid competitionId "50-plus"/,
      );
    },
  );
});

test("person links keep competition-local player and stat ownership separate", async () => {
  await withSeedFixture(
    [
      {
        seasonId: 32179,
        tables: {
          players: [{ player_id: 148, name: "Joe Hellett" }],
          batting_stats: [{ season_id: 32179, player_id: 148, hits: 1 }],
        },
      },
      {
        seasonId: 32185,
        tables: {
          players: [{ player_id: 1372291, name: "Joe Hellett" }],
          batting_stats: [{ season_id: 32185, player_id: 1372291, hits: 2 }],
        },
      },
    ],
    {
      [DEFAULT_PERSON_LINKS_FILE]: {
        version: 1,
        people: [
          {
            personId: 2,
            displayName: "Joe Hellett",
            members: [
              { competitionId: "18-plus", canonicalSourcePlayerId: 148 },
              { competitionId: "30-plus", canonicalSourcePlayerId: 1372291 },
            ],
          },
        ],
      },
    },
    async (outDir) => {
      const bundle = await buildMergedSeedBundle(outDir, [32179, 32185]);
      const players = [...bundle.tables.players].sort(
        (left, right) => Number(left.player_id) - Number(right.player_id),
      );

      assert.equal(players.length, 2);
      assert.notEqual(players[0].player_id, players[1].player_id);
      assert.equal(players[0].person_id, 2);
      assert.equal(players[1].person_id, 2);

      const playerIds = new Set(players.map((row) => Number(row.player_id)));
      const statPlayerIds = new Set(bundle.tables.batting_stats.map((row) => Number(row.player_id)));

      assert.equal(statPlayerIds.size, 2);
      assert.deepEqual(
        [...statPlayerIds].sort((left, right) => left - right),
        [...playerIds].sort((left, right) => left - right),
      );
    },
  );
});
