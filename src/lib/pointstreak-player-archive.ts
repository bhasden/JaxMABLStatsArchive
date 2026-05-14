import fs from "fs/promises";
import path from "path";
import { load as cheerioLoad } from "cheerio";
import { buildPlayerProfileUrl } from "./pointstreak";
import {
  buildPointstreakRetryBackoffMs,
  fetchUrlText,
  randomRequestDelayMs,
  type ArchiveLog,
  type ExistingRawXmlFileDecision,
  type ExistingRawXmlFilePrompt,
} from "./pointstreak-archive";

export type PointstreakRosterPlayerReference = {
  playerId: number;
  playerSeasonId: number | null;
  name: string | null;
};

export type PointstreakPlayerDiscoveryResult = {
  playerIds: number[];
  rosterFileCount: number;
  rosterEntryCount: number;
  skippedSeasonOnlyEntries: number;
};

export type PointstreakPlayerArchiveSummary = PointstreakPlayerDiscoveryResult & {
  fetched: number;
  skipped: number;
  failed: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function textOrNull(value: unknown) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function firstNumericId(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized && /^\d+$/.test(normalized)) {
      return Number(normalized);
    }
  }

  return null;
}

async function rawXmlFileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function shouldOverwriteExistingRawXmlFile(decision: ExistingRawXmlFileDecision) {
  return decision === "overwrite" || decision === "overwriteAlways";
}

function buildProgressLog(current: number, total: number, message: string) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  return {
    current,
    total,
    percent,
    message: `${current}/${total} (${percent}%) ${message}`,
  };
}

async function shouldFetchPlayerProfile(
  playerId: number,
  outPath: string,
  options: {
    onLog: (log: ArchiveLog) => void;
    onExistingFile?: ExistingRawXmlFilePrompt;
  },
) {
  const exists = await rawXmlFileExists(outPath);
  if (!exists) {
    return true;
  }

  if (!options.onExistingFile) {
    options.onLog({ level: "info", message: `Skipping existing player profile ${playerId}` });
    return false;
  }

  const decision =
    (await options.onExistingFile({
      label: `player profile ${playerId}`,
      outPath,
    })) ?? "skip";
  if (shouldOverwriteExistingRawXmlFile(decision)) {
    options.onLog({ level: "info", message: `Overwriting existing player profile ${playerId}` });
    return true;
  }

  options.onLog({ level: "info", message: `Skipping existing player profile ${playerId}` });
  return false;
}

async function fetchAndWritePlayerProfile(
  playerId: number,
  outPath: string,
  options: {
    retries: number;
    minDelayMs?: number;
    maxDelayMs?: number;
    onLog: (log: ArchiveLog) => void;
  },
) {
  let attempt = 0;

  while (true) {
    try {
      attempt += 1;
      options.onLog({ level: "info", message: `Fetching player profile ${playerId} (attempt ${attempt})` });
      const xml = await fetchUrlText(buildPlayerProfileUrl(playerId));
      await ensureDir(path.dirname(outPath));
      await fs.writeFile(outPath, xml, "utf8");
      options.onLog({ level: "info", message: `Saved player profile ${playerId} XML to ${outPath}` });
      return;
    } catch (err: any) {
      options.onLog({ level: "error", message: `Error fetching player profile ${playerId}: ${err?.message ?? err}` });
      if (attempt >= options.retries) {
        throw err;
      }
      const backoff = buildPointstreakRetryBackoffMs(attempt, err, options.minDelayMs, options.maxDelayMs);
      options.onLog({
        level: "info",
        message: `Backing off for ${backoff}ms before retrying player profile ${playerId}`,
      });
      await sleep(backoff);
    }
  }
}

async function listNumericChildDirectories(dir: string) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => Number(left) - Number(right));
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

export function getRawPlayersDir(outDir: string) {
  return path.join(outDir, "raw", "players");
}

export function extractPointstreakPlayerReferencesFromRosterXml(xml: string): PointstreakRosterPlayerReference[] {
  const $ = cheerioLoad(xml, { xmlMode: true });
  const players: PointstreakRosterPlayerReference[] = [];

  $("league > player").each((_, element) => {
    const player = $(element);
    const playerId = firstNumericId(player.attr("playerlinkid"), player.find("playerlinkid").first().text());
    if (playerId == null) {
      return;
    }

    const playerSeasonId = firstNumericId(player.attr("playerid"), player.find("playerid").first().text());
    const firstName = textOrNull(player.find("fname").first().text());
    const lastName = textOrNull(player.find("lname").first().text());
    players.push({
      playerId,
      playerSeasonId,
      name: [firstName, lastName].filter((part): part is string => part != null).join(" ") || null,
    });
  });

  return players;
}

export async function discoverPointstreakPlayerIdsFromRawRosters(outDir: string) {
  const rawDir = path.join(outDir, "raw");
  const seasonIds = await listNumericChildDirectories(rawDir);
  const playerIds = new Set<number>();
  let rosterFileCount = 0;
  let rosterEntryCount = 0;
  let skippedSeasonOnlyEntries = 0;

  for (const seasonId of seasonIds) {
    const teamsDir = path.join(rawDir, seasonId, "teams");
    const teamIds = await listNumericChildDirectories(teamsDir);

    for (const teamId of teamIds) {
      const rosterPath = path.join(teamsDir, teamId, "roster.xml");
      const rosterExists = await rawXmlFileExists(rosterPath);
      if (!rosterExists) {
        continue;
      }

      rosterFileCount += 1;
      const xml = await fs.readFile(rosterPath, "utf8");
      const references = extractPointstreakPlayerReferencesFromRosterXml(xml);
      rosterEntryCount += references.length;
      for (const reference of references) {
        playerIds.add(reference.playerId);
      }

      const $ = cheerioLoad(xml, { xmlMode: true });
      $("league > player").each((_, element) => {
        const player = $(element);
        const playerId = firstNumericId(player.attr("playerlinkid"), player.find("playerlinkid").first().text());
        const playerSeasonId = firstNumericId(player.attr("playerid"), player.find("playerid").first().text());
        if (playerId == null && playerSeasonId != null) {
          skippedSeasonOnlyEntries += 1;
        }
      });
    }
  }

  return {
    playerIds: Array.from(playerIds).sort((left, right) => left - right),
    rosterFileCount,
    rosterEntryCount,
    skippedSeasonOnlyEntries,
  } satisfies PointstreakPlayerDiscoveryResult;
}

export async function archiveAllPointstreakPlayers(options: {
  outDir?: string;
  minDelayMs?: number;
  maxDelayMs?: number;
  retries?: number;
  onLog?: (log: ArchiveLog) => void;
  onExistingFile?: ExistingRawXmlFilePrompt;
}) {
  const outDir = options.outDir ?? path.join(process.cwd(), "data");
  const minDelay = options.minDelayMs ?? 500;
  const maxDelay = options.maxDelayMs ?? 1500;
  const retries = options.retries ?? 3;
  const onLog = options.onLog ?? (() => {});

  const discovered = await discoverPointstreakPlayerIdsFromRawRosters(outDir);
  if (discovered.rosterFileCount === 0) {
    throw new Error(`No raw roster XML files found under ${path.join(outDir, "raw")}. Archive seasons first.`);
  }

  onLog({
    level: "info",
    message: `Discovered ${discovered.playerIds.length} unique Pointstreak player ids from ${discovered.rosterFileCount} roster files (${discovered.rosterEntryCount} roster entries).`,
  });
  if (discovered.skippedSeasonOnlyEntries > 0) {
    onLog({
      level: "info",
      message: `Skipped ${discovered.skippedSeasonOnlyEntries} roster entries that only exposed a season-specific player id without a cross-season playerlinkid.`,
    });
  }

  const playersDir = getRawPlayersDir(outDir);
  await ensureDir(playersDir);

  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  for (const [index, playerId] of discovered.playerIds.entries()) {
    const current = index + 1;
    const outPath = path.join(playersDir, `${playerId}.xml`);
    let attemptedFetch = false;
    try {
      const shouldFetch = await shouldFetchPlayerProfile(playerId, outPath, {
        onLog,
        onExistingFile: options.onExistingFile,
      });
      if (!shouldFetch) {
        skipped += 1;
        continue;
      }

      attemptedFetch = true;
      await fetchAndWritePlayerProfile(playerId, outPath, {
        retries,
        minDelayMs: minDelay,
        maxDelayMs: maxDelay,
        onLog,
      });
      fetched += 1;
      onLog({
        level: "progress",
        ...buildProgressLog(current, discovered.playerIds.length, `Saved player profile ${playerId}`),
      });
    } catch (err: any) {
      failed += 1;
      onLog({
        level: "error",
        ...buildProgressLog(
          current,
          discovered.playerIds.length,
          `Failed to fetch player profile ${playerId}: ${err?.message ?? String(err)}`,
        ),
      });
    }

    if (attemptedFetch && current < discovered.playerIds.length) {
      const delay = randomRequestDelayMs(minDelay, maxDelay);
      await sleep(delay);
    }
  }

  return {
    ...discovered,
    fetched,
    skipped,
    failed,
  } satisfies PointstreakPlayerArchiveSummary;
}
