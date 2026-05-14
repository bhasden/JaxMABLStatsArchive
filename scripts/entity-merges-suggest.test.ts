import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import test from "node:test";
import { promisify } from "node:util";
import {
  ARCHIVE_SEED_FILES,
  ARCHIVE_SEED_TABLES,
  type ArchiveSeedRow,
  type ArchiveSeedTable,
} from "../src/lib/archive-seed-merge";
import { archiveEntityIdForCompetition } from "../src/lib/constants";

const execFileAsync = promisify(execFile);

type SeasonFixture = {
  seasonId: number;
  tables?: Partial<Record<ArchiveSeedTable, ArchiveSeedRow[]>>;
};

async function writeNdjson(filePath: string, rows: ArchiveSeedRow[]) {
  const content = rows.length === 0 ? "" : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  await fs.writeFile(filePath, content, "utf8");
}

async function withSuggestionFixture(
  seasons: SeasonFixture[],
  configFiles: Record<string, unknown>,
  run: (paths: { outDir: string; outputDir: string }) => Promise<void>,
) {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "jax-mabl-suggest-seeds-"));
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "jax-mabl-suggest-output-"));

  try {
    for (const [fileName, value] of Object.entries(configFiles)) {
      await fs.writeFile(path.join(outDir, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8");
    }

    for (const season of seasons) {
      const seasonDir = path.join(outDir, "seeds", String(season.seasonId));
      await fs.mkdir(seasonDir, { recursive: true });

      for (const table of ARCHIVE_SEED_TABLES) {
        await writeNdjson(path.join(seasonDir, ARCHIVE_SEED_FILES[table]), season.tables?.[table] ?? []);
      }
    }

    await run({ outDir, outputDir });
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
    await fs.rm(outputDir, { recursive: true, force: true });
  }
}

test("entity-merges-suggest writes separate player, team, and person candidate files", async () => {
  await withSuggestionFixture(
    [
      {
        seasonId: 32179,
        tables: {
          players: [
            { player_id: 126, name: "Brian Hasden" },
            { player_id: 614496, name: "Brian Hasden" },
            { player_id: 148, name: "Joe Hellett" },
          ],
          teams: [
            { team_id: 4, name: "Jacksonville Indians", short_name: "Indians" },
            { team_id: 44, name: "Jacksonville Indians", short_name: "Indians" },
          ],
        },
      },
      {
        seasonId: 32185,
        tables: {
          players: [{ player_id: 1372291, name: "Joe Hellett" }],
        },
      },
      {
        seasonId: 34286,
        tables: {
          players: [{ player_id: 1783209, name: "Joe Hellett" }],
        },
      },
    ],
    {
      "player-merge-approvals.json": { version: 1, merges: [] },
      "team-merge-approvals.json": { version: 1, merges: [] },
      "player-merge-rejections.json": { version: 1, rejections: [] },
      "team-merge-rejections.json": { version: 1, rejections: [] },
      "person-link-approvals.json": { version: 1, people: [] },
      "person-link-rejections.json": { version: 1, rejections: [] },
    },
    async ({ outDir, outputDir }) => {
      const scriptPath = path.join(process.cwd(), "scripts", "entity-merges-suggest.ts");
      await execFileAsync(
        "node",
        [
          "--import",
          "tsx",
          scriptPath,
          "--outDir",
          outDir,
          "--output",
          outputDir,
          "--playerMergeConfig",
          path.join(outDir, "player-merge-approvals.json"),
          "--teamMergeConfig",
          path.join(outDir, "team-merge-approvals.json"),
          "--personLinkConfig",
          path.join(outDir, "person-link-approvals.json"),
          "--personLinkRejectionConfig",
          path.join(outDir, "person-link-rejections.json"),
          "--playerRejectionConfig",
          path.join(outDir, "player-merge-rejections.json"),
          "--teamRejectionConfig",
          path.join(outDir, "team-merge-rejections.json"),
        ],
        {
          cwd: process.cwd(),
        },
      );

      const playerOutput = JSON.parse(await fs.readFile(path.join(outputDir, "player-merge-candidates.json"), "utf8"));
      const teamOutput = JSON.parse(await fs.readFile(path.join(outputDir, "team-merge-candidates.json"), "utf8"));
      const personOutput = JSON.parse(await fs.readFile(path.join(outputDir, "person-link-candidates.json"), "utf8"));

      assert.equal(playerOutput.playerMergeApprovalConfigPath, path.join(outDir, "player-merge-approvals.json"));
      assert.equal(playerOutput.playerMergeRejectionConfigPath, path.join(outDir, "player-merge-rejections.json"));
      assert.equal(playerOutput.entityType, "player-merge");
      assert.equal(playerOutput.candidates.length, 1);
      assert.deepEqual(
        {
          competitionId: playerOutput.suggestedPlayerMergeConfig.merges[0].competitionId,
          canonicalSourceId: playerOutput.suggestedPlayerMergeConfig.merges[0].canonicalSourceId,
          aliasSourceIds: playerOutput.suggestedPlayerMergeConfig.merges[0].aliasSourceIds,
        },
        {
          competitionId: "18-plus",
          canonicalSourceId: 126,
          aliasSourceIds: [614496],
        },
      );
      assert.match(
        playerOutput.suggestedPlayerMergeConfig.merges[0].reason,
        /exact:hasden:brian.*last-first-initial:hasden:b|last-first-initial:hasden:b.*exact:hasden:brian/,
      );
      assert.equal(playerOutput.candidates[0].candidateKey, "18-plus:126|614496");
      assert.deepEqual(playerOutput.candidates[0].acceptedEntry, playerOutput.suggestedPlayerMergeConfig.merges[0]);
      assert.deepEqual(playerOutput.candidates[0].acceptedEntry, {
        competitionId: "18-plus",
        canonicalSourceId: 126,
        aliasSourceIds: [614496],
        reason: playerOutput.candidates[0].acceptedEntry.reason,
      });
      assert.match(
        playerOutput.candidates[0].acceptedEntry.reason,
        /exact:hasden:brian.*last-first-initial:hasden:b|last-first-initial:hasden:b.*exact:hasden:brian/,
      );
      assert.deepEqual(playerOutput.candidates[0].rejectedEntry, {
        competitionId: "18-plus",
        sourceIds: [126, 614496],
        reason: "Reviewed candidate 18-plus:126|614496 rejected",
      });
      assert.deepEqual(
        playerOutput.suggestedPlayerMergeRejectionConfig.rejections[0],
        playerOutput.candidates[0].rejectedEntry,
      );

      assert.equal(teamOutput.teamMergeApprovalConfigPath, path.join(outDir, "team-merge-approvals.json"));
      assert.equal(teamOutput.teamMergeRejectionConfigPath, path.join(outDir, "team-merge-rejections.json"));
      assert.equal(teamOutput.entityType, "team-merge");
      assert.equal(teamOutput.candidates.length, 1);
      assert.deepEqual(
        {
          competitionId: teamOutput.suggestedTeamMergeConfig.merges[0].competitionId,
          canonicalSourceId: teamOutput.suggestedTeamMergeConfig.merges[0].canonicalSourceId,
          aliasSourceIds: teamOutput.suggestedTeamMergeConfig.merges[0].aliasSourceIds,
        },
        {
          competitionId: "18-plus",
          canonicalSourceId: 4,
          aliasSourceIds: [44],
        },
      );
      assert.match(teamOutput.suggestedTeamMergeConfig.merges[0].reason, /team-short:indians/);
      assert.equal(teamOutput.candidates[0].candidateKey, "18-plus:4|44");
      assert.deepEqual(teamOutput.candidates[0].acceptedEntry, teamOutput.suggestedTeamMergeConfig.merges[0]);
      assert.deepEqual(teamOutput.candidates[0].acceptedEntry, {
        competitionId: "18-plus",
        canonicalSourceId: 4,
        aliasSourceIds: [44],
        reason: teamOutput.candidates[0].acceptedEntry.reason,
      });
      assert.match(teamOutput.candidates[0].acceptedEntry.reason, /team-short:indians/);
      assert.deepEqual(teamOutput.candidates[0].rejectedEntry, {
        competitionId: "18-plus",
        sourceIds: [4, 44],
        reason: "Reviewed candidate 18-plus:4|44 rejected",
      });
      assert.deepEqual(teamOutput.suggestedTeamMergeRejectionConfig.rejections[0], teamOutput.candidates[0].rejectedEntry);

      assert.equal(personOutput.personLinkApprovalConfigPath, path.join(outDir, "person-link-approvals.json"));
      assert.equal(personOutput.personLinkRejectionConfigPath, path.join(outDir, "person-link-rejections.json"));
      assert.equal(personOutput.entityType, "person-link");
      assert.equal(personOutput.candidates.length, 1);
      assert.equal(personOutput.suggestedPersonIdBase, 1);
      assert.equal(personOutput.candidates[0].candidateKey, "18-plus:148|30-plus:1372291|40-plus:1783209");
      assert.equal(personOutput.candidates[0].suggestedPersonId, 1);
      assert.equal(personOutput.candidates[0].acceptedEntry.personId, 1);
      assert.deepEqual(
        personOutput.candidates[0].members.map((member: any) => ({
          id: member.id,
          sourceId: member.sourceId,
          competitionId: member.competitionId,
          playerHref: member.playerHref,
          personHref: member.personHref,
        })),
        [
          {
            id: archiveEntityIdForCompetition("18-plus", 148),
            sourceId: 148,
            competitionId: "18-plus",
            playerHref: `#/players/${archiveEntityIdForCompetition("18-plus", 148)}`,
            personHref: "#/people/1",
          },
          {
            id: archiveEntityIdForCompetition("30-plus", 1372291),
            sourceId: 1372291,
            competitionId: "30-plus",
            playerHref: `#/players/${archiveEntityIdForCompetition("30-plus", 1372291)}`,
            personHref: "#/people/1",
          },
          {
            id: archiveEntityIdForCompetition("40-plus", 1783209),
            sourceId: 1783209,
            competitionId: "40-plus",
            playerHref: `#/players/${archiveEntityIdForCompetition("40-plus", 1783209)}`,
            personHref: "#/people/1",
          },
        ],
      );
      assert.deepEqual(personOutput.suggestedPersonLinkConfig.people[0].members, [
        { competitionId: "18-plus", canonicalSourcePlayerId: 148 },
        { competitionId: "30-plus", canonicalSourcePlayerId: 1372291 },
        { competitionId: "40-plus", canonicalSourcePlayerId: 1783209 },
      ]);
      assert.deepEqual(personOutput.suggestedPersonLinkConfig.people[0], personOutput.candidates[0].acceptedEntry);
      assert.deepEqual(
        personOutput.suggestedPersonLinkRejectionConfig.rejections[0],
        personOutput.candidates[0].rejectedEntry,
      );
    },
  );
});

test("entity-merges-suggest suppresses rejected person-link groups", async () => {
  await withSuggestionFixture(
    [
      {
        seasonId: 32179,
        tables: {
          players: [{ player_id: 148, name: "Joe Hellett" }],
        },
      },
      {
        seasonId: 32185,
        tables: {
          players: [{ player_id: 1372291, name: "Joe Hellett" }],
        },
      },
      {
        seasonId: 34286,
        tables: {
          players: [{ player_id: 1783209, name: "Joe Hellett" }],
        },
      },
    ],
    {
      "player-merge-approvals.json": { version: 1, merges: [] },
      "team-merge-approvals.json": { version: 1, merges: [] },
      "player-merge-rejections.json": { version: 1, rejections: [] },
      "team-merge-rejections.json": { version: 1, rejections: [] },
      "person-link-approvals.json": { version: 1, people: [] },
      "person-link-rejections.json": {
        version: 1,
        rejections: [
          {
            members: [
              { competitionId: "18-plus", canonicalSourcePlayerId: 148 },
              { competitionId: "30-plus", canonicalSourcePlayerId: 1372291 },
              { competitionId: "40-plus", canonicalSourcePlayerId: 1783209 },
            ],
            reason: "Reviewed manually; keep separate for now",
          },
        ],
      },
    },
    async ({ outDir, outputDir }) => {
      const scriptPath = path.join(process.cwd(), "scripts", "entity-merges-suggest.ts");
      await execFileAsync(
        "node",
        [
          "--import",
          "tsx",
          scriptPath,
          "--outDir",
          outDir,
          "--output",
          outputDir,
          "--playerMergeConfig",
          path.join(outDir, "player-merge-approvals.json"),
          "--teamMergeConfig",
          path.join(outDir, "team-merge-approvals.json"),
          "--personLinkConfig",
          path.join(outDir, "person-link-approvals.json"),
          "--personLinkRejectionConfig",
          path.join(outDir, "person-link-rejections.json"),
          "--playerRejectionConfig",
          path.join(outDir, "player-merge-rejections.json"),
          "--teamRejectionConfig",
          path.join(outDir, "team-merge-rejections.json"),
        ],
        {
          cwd: process.cwd(),
        },
      );

      const personOutput = JSON.parse(await fs.readFile(path.join(outputDir, "person-link-candidates.json"), "utf8"));

      assert.equal(personOutput.entityType, "person-link");
      assert.equal(personOutput.candidates.length, 0);
      assert.deepEqual(personOutput.suggestedPersonLinkConfig.people, []);
      assert.deepEqual(personOutput.suggestedPersonLinkRejectionConfig.rejections, []);
      assert.equal(personOutput.personLinkRejectionConfigPath, path.join(outDir, "person-link-rejections.json"));
    },
  );
});
