import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import test from "node:test";
import {
  discoverPointstreakPlayerIdsFromRawRosters,
  extractPointstreakPlayerReferencesFromRosterXml,
} from "./pointstreak-player-archive";

const SAMPLE_ROSTER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<league>
  <team teamlinkid="92342">
    <name>Example Team</name>
  </team>
  <player playerlinkid="148" playerid="602487">
    <fname>Joe</fname>
    <lname>Hellett</lname>
  </player>
  <player playerlinkid="1372291" playerid="144037">
    <fname>Joe</fname>
    <lname>Hellett</lname>
  </player>
  <player playerid="999001">
    <fname>Season</fname>
    <lname>Only</lname>
  </player>
</league>`;

test("extractPointstreakPlayerReferencesFromRosterXml uses playerlinkid as the canonical player id", () => {
  const references = extractPointstreakPlayerReferencesFromRosterXml(SAMPLE_ROSTER_XML);

  assert.deepEqual(references, [
    { playerId: 148, playerSeasonId: 602487, name: "Joe Hellett" },
    { playerId: 1372291, playerSeasonId: 144037, name: "Joe Hellett" },
  ]);
});

test("discoverPointstreakPlayerIdsFromRawRosters dedupes playerlinkid values across roster files", async () => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "jax-mabl-player-archive-"));

  try {
    await fs.mkdir(path.join(outDir, "raw", "32179", "teams", "92342"), { recursive: true });
    await fs.mkdir(path.join(outDir, "raw", "32185", "teams", "144037"), { recursive: true });

    await fs.writeFile(path.join(outDir, "raw", "32179", "teams", "92342", "roster.xml"), SAMPLE_ROSTER_XML, "utf8");
    await fs.writeFile(
      path.join(outDir, "raw", "32185", "teams", "144037", "roster.xml"),
      SAMPLE_ROSTER_XML.replace('playerlinkid="148" playerid="602487"', 'playerlinkid="148" playerid="700001"'),
      "utf8",
    );

    const discovered = await discoverPointstreakPlayerIdsFromRawRosters(outDir);

    assert.deepEqual(discovered.playerIds, [148, 1372291]);
    assert.equal(discovered.rosterFileCount, 2);
    assert.equal(discovered.rosterEntryCount, 4);
    assert.equal(discovered.skippedSeasonOnlyEntries, 2);
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});
