import fs from "fs/promises";
import path from "path";
import { load as cheerioLoad } from "cheerio";
import {
  applyBoxscoreSeedCleanups,
  createBoxscoreSeedCleanupStats,
  formatBoxscoreSeedCleanupStats,
  mergeBoxscoreSeedCleanupStats,
} from "./boxscore-seed-cleanups";
import { applySeasonSeedCleanups, formatSeasonSeedCleanupStats } from "./season-seed-cleanups";
import {
  buildBoxscoreUrl,
  buildLeagueBattingLeadersUrl,
  buildLeaguePitchingLeadersUrl,
  buildLeagueStatsUrl,
  buildRosterUrl,
  buildSeasonScheduleUrl,
  buildStandingsUrl,
  buildTeamBattingLeadersUrl,
  buildTeamPitchingLeadersUrl,
  buildTeamStatsUrl,
} from "./pointstreak";

export type ArchiveLog = {
  level: "info" | "error" | "progress";
  message: string;
  gameId?: string;
  current?: number;
  total?: number;
  percent?: number;
};

export type ExistingRawXmlFileDecision = "overwrite" | "overwriteAlways" | "skip" | "skipAlways";

export type ExistingRawXmlFileContext = {
  label: string;
  outPath: string;
};

export type ExistingRawXmlFilePrompt = (
  context: ExistingRawXmlFileContext,
) => ExistingRawXmlFileDecision | Promise<ExistingRawXmlFileDecision>;

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export function getSeasonRawDir(outDir: string, seasonId: number) {
  return path.join(outDir, "raw", String(seasonId));
}

export async function resolveSeasonRawDir(outDir: string, seasonId: number) {
  const canonicalDir = getSeasonRawDir(outDir, seasonId);
  try {
    await fs.access(canonicalDir);
    return canonicalDir;
  } catch {
    // Fall back to the legacy flat raw-data layout below.
  }

  const flatDir = path.join(outDir, String(seasonId));
  try {
    await fs.access(flatDir);
    return flatDir;
  } catch {
    // Use the canonical path even when neither directory exists yet.
  }

  return canonicalDir;
}

export function getSeasonSeedsDir(outDir: string, seasonId: number) {
  return path.join(outDir, "seeds", String(seasonId));
}

export function getSeasonRawLeagueDir(outDir: string, seasonId: number) {
  return path.join(getSeasonRawDir(outDir, seasonId), "league");
}

export function getSeasonRawTeamsDir(outDir: string, seasonId: number) {
  return path.join(getSeasonRawDir(outDir, seasonId), "teams");
}

export function getSeasonRawTeamDir(outDir: string, seasonId: number, teamId: number) {
  return path.join(getSeasonRawTeamsDir(outDir, seasonId), String(teamId));
}

export async function fetchUrlText(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  return res.text();
}

export async function countSeasonRawGameFiles(seasonId: number, outDir = path.join(process.cwd(), "data")) {
  try {
    const files = await fs.readdir(await resolveSeasonRawDir(outDir, seasonId));
    return files.filter((file) => /^game-\d+\.xml$/i.test(file)).length;
  } catch {
    return 0;
  }
}

type ArchiveRawXmlResource = {
  label: string;
  url: string;
  outPath: string;
};

type ArchiveRawXmlSummary = {
  fetched: number;
  skipped: number;
  failed: number;
};

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

async function shouldFetchRawXmlResource(
  resource: ArchiveRawXmlResource,
  options: {
    onExistingFile?: ExistingRawXmlFilePrompt;
    onLog: (log: ArchiveLog) => void;
  },
) {
  const exists = await rawXmlFileExists(resource.outPath);
  if (!exists) {
    return true;
  }

  const decision = (await options.onExistingFile?.({ label: resource.label, outPath: resource.outPath })) ?? "skip";
  if (shouldOverwriteExistingRawXmlFile(decision)) {
    options.onLog({ level: "info", message: `Overwriting existing ${resource.label}` });
    return true;
  }

  options.onLog({ level: "info", message: `Skipping existing ${resource.label}` });
  return false;
}

async function fetchRawXmlResource(
  resource: ArchiveRawXmlResource,
  options: {
    retries: number;
    onLog: (log: ArchiveLog) => void;
    gameId?: string;
  },
) {
  let attempt = 0;
  while (true) {
    try {
      attempt++;
      options.onLog({
        level: "info",
        gameId: options.gameId,
        message: `Fetching ${resource.label} (attempt ${attempt})`,
      });
      const xml = await fetchUrlText(resource.url);
      await ensureDir(path.dirname(resource.outPath));
      await fs.writeFile(resource.outPath, xml, "utf8");
      options.onLog({
        level: "info",
        gameId: options.gameId,
        message: `Saved ${resource.label} XML to ${resource.outPath}`,
      });
      return xml;
    } catch (err: any) {
      options.onLog({
        level: "error",
        gameId: options.gameId,
        message: `Error fetching ${resource.label}: ${err?.message ?? err}`,
      });
      if (attempt >= options.retries) {
        throw err;
      }
      const backoff = Math.min(5000, 200 * attempt);
      await sleep(backoff);
    }
  }
}

async function fetchSupplementalRawXmlResources(
  resources: ArchiveRawXmlResource[],
  options: {
    retries: number;
    minDelay: number;
    maxDelay: number;
    onLog: (log: ArchiveLog) => void;
    onExistingFile?: ExistingRawXmlFilePrompt;
  },
): Promise<ArchiveRawXmlSummary> {
  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const resource of resources) {
    const shouldFetch = await shouldFetchRawXmlResource(resource, options);
    if (!shouldFetch) {
      skipped++;
      continue;
    }

    try {
      await fetchRawXmlResource(resource, options);
      fetched++;
    } catch {
      failed++;
      continue;
    }

    const delay = Math.floor(Math.random() * (options.maxDelay - options.minDelay + 1)) + options.minDelay;
    await sleep(delay);
  }

  return { fetched, skipped, failed };
}

function addGameId(target: Set<string>, value: string | null | undefined) {
  const gameId = value?.trim();
  if (gameId && /^\d+$/.test(gameId)) {
    target.add(gameId);
  }
}

export function extractGameIdsFromScheduleXml(scheduleXml: string) {
  const $ = cheerioLoad(scheduleXml, { xmlMode: true });
  const gameIds = new Set<string>();

  const collectFromNode = (_: number, el: any) => {
    const node = $(el);
    addGameId(gameIds, node.attr("gameid"));
    addGameId(gameIds, node.attr("game_id"));
    addGameId(gameIds, node.attr("eventid"));
    addGameId(gameIds, node.attr("event_id"));
    node.children("gameid, game_id, eventid, event_id").each((__, child) => addGameId(gameIds, $(child).text()));
  };

  $("game").each(collectFromNode);
  if (gameIds.size === 0) {
    $("event, match, matchup").each(collectFromNode);
  }

  return Array.from(gameIds).sort((left, right) => Number(left) - Number(right));
}

export function extractTeamIdsFromScheduleXml(scheduleXml: string) {
  const $ = cheerioLoad(scheduleXml, { xmlMode: true });
  const teamIds = new Set<number>();

  const collectFromNode = (_: number, el: any) => {
    const node = $(el);
    const attrs = el.attribs || {};
    const teamId = firstNumericId(
      attrs.teamlinkid,
      attrs.teamLinkId,
      attrs.linkid,
      attrs.homeid,
      attrs.awayid,
      attrs.teamid,
      node.children("teamlinkid").text(),
      node.children("linkid").text(),
      node.children("homeid").text(),
      node.children("awayid").text(),
      node.children("teamid").text(),
    );
    if (teamId != null) {
      teamIds.add(teamId);
    }
  };

  $("game awayteam, game hometeam, team").each(collectFromNode);
  if (teamIds.size === 0) {
    $("[teamlinkid], [teamid], [homeid], [awayid]").each(collectFromNode);
  }

  return Array.from(teamIds).sort((left, right) => left - right);
}

function buildProgressDetails(current: number, total: number, message: string) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  return {
    current,
    total,
    percent,
    message: `${current}/${total} (${percent}%) ${message}`,
  };
}

type TeamIdentity = {
  pointstreakTeamId: number | null;
  pointstreakTeamLinkId: number | null;
  canonicalTeamId: number | null;
};

function firstNumericId(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && /^\d+$/.test(trimmed)) {
      return Number(trimmed);
    }
  }

  return null;
}

function buildTeamIdentity(options: {
  pointstreakTeamLinkIds: Array<string | null | undefined>;
  pointstreakTeamIds: Array<string | null | undefined>;
}): TeamIdentity {
  const pointstreakTeamLinkId = firstNumericId(...options.pointstreakTeamLinkIds);
  const pointstreakTeamId = firstNumericId(...options.pointstreakTeamIds);

  return {
    pointstreakTeamId,
    pointstreakTeamLinkId,
    canonicalTeamId: pointstreakTeamLinkId ?? pointstreakTeamId,
  };
}

function firstNumericValue(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && /^-?\d+(\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }
  }

  return null;
}

function formatStandingsPct(wins: number, losses: number, ties: number, gamesPlayed?: number | null) {
  const totalGames = gamesPlayed ?? wins + losses + ties;
  if (totalGames <= 0) {
    return null;
  }

  return ((wins + ties * 0.5) / totalGames).toFixed(3);
}

function upsertTeamRow(
  teamsMap: Map<string, any>,
  seasonTeamIdToLinkId: Map<number, number>,
  identity: TeamIdentity,
  leagueId: number,
  name: string | null,
  shortName: string | null = null,
) {
  if (identity.pointstreakTeamId != null && identity.canonicalTeamId != null) {
    seasonTeamIdToLinkId.set(identity.pointstreakTeamId, identity.canonicalTeamId);
  }

  if (identity.canonicalTeamId == null) {
    return;
  }

  const key = String(identity.canonicalTeamId);
  const existing = teamsMap.get(key);
  if (existing) {
    if (existing.season_team_id == null && identity.pointstreakTeamId != null) {
      existing.season_team_id = identity.pointstreakTeamId;
    }
    if (existing.team_id == null) {
      existing.team_id = identity.pointstreakTeamLinkId ?? identity.canonicalTeamId;
    }
    if (!existing.name && name) {
      existing.name = name;
    }
    if (!existing.short_name && shortName) {
      existing.short_name = shortName;
    }
    return;
  }

  teamsMap.set(key, {
    season_team_id: identity.pointstreakTeamId,
    team_id: identity.pointstreakTeamLinkId ?? identity.canonicalTeamId,
    league_id: leagueId,
    name,
    short_name: shortName,
  });
}

type SupplementalScope = "league" | "team";

type SupplementalContext = {
  scope: SupplementalScope;
  leagueId: number;
  seasonId: number;
  teamPointstreakLinkId: number | null;
  teamPointstreakId: number | null;
  teamName: string | null;
};

function textOrNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function numberOrNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildFullPlayerName(firstName: string | null, lastName: string | null) {
  const parts = [firstName, lastName].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" ") : null;
}

function appendStandingsRowsFromXml(
  xml: string,
  context: SupplementalContext,
  rows: any[],
  teamsMap: Map<string, any>,
  seasonTeamIdToLinkId: Map<number, number>,
) {
  const $ = cheerioLoad(xml, { xmlMode: true });

  $("division team, team, row").each((_, el) => {
    const team = $(el);
    const attrs = el.attribs || {};
    const identity = buildTeamIdentity({
      pointstreakTeamLinkIds: [
        attrs.teamlinkid,
        attrs.teamLinkId,
        attrs.linkid,
        team.find("teamlinkid").text(),
        team.find("linkid").text(),
      ],
      pointstreakTeamIds: [
        attrs.teamid,
        attrs.teamID,
        attrs.team_id,
        attrs.id,
        team.find("teamid").text(),
        team.find("id").text(),
      ],
    });
    const teamPointstreakLinkId =
      identity.pointstreakTeamLinkId ??
      (identity.pointstreakTeamId != null
        ? (seasonTeamIdToLinkId.get(identity.pointstreakTeamId) ?? identity.pointstreakTeamId)
        : null);

    if (teamPointstreakLinkId == null && identity.pointstreakTeamId == null) {
      return;
    }

    const wins = firstNumericValue(team.find("wins").text(), team.attr("wins")) ?? 0;
    const losses = firstNumericValue(team.find("losses").text(), team.attr("losses")) ?? 0;
    const gamesPlayed = firstNumericValue(
      team.find("gp").text(),
      team.attr("gp"),
      team.find("gamesplayed").text(),
      team.attr("gamesplayed"),
    );
    const explicitTies = firstNumericValue(team.find("ties").text(), team.attr("ties"));
    const ties = explicitTies ?? Math.max(0, (gamesPlayed ?? wins + losses) - wins - losses);
    const pctText = team.find("pct").text().trim() || team.attr("pct") || null;
    const pct = pctText || formatStandingsPct(wins, losses, ties, gamesPlayed);

    rows.push({
      league_id: context.leagueId,
      season_id: context.seasonId,
      team_id: teamPointstreakLinkId,
      season_team_id: identity.pointstreakTeamId ?? teamsMap.get(String(teamPointstreakLinkId))?.season_team_id ?? null,
      name:
        team.attr("teamname") ||
        team.attr("teamName") ||
        team.find("teamname").text().trim() ||
        team.find("name").text().trim() ||
        null,
      games_played: gamesPlayed ?? wins + losses + ties,
      wins,
      losses,
      ties,
      pct,
    });
  });
}

function scorePlayerName(name: string | null) {
  if (!name) {
    return -1;
  }

  let score = name.length;
  if (/^[^,]+,\s*[A-Z](?:\.|$)/.test(name)) {
    score -= 20;
  }
  if (/^[A-Z][^,]+\s+[A-Z]/.test(name)) {
    score += 10;
  }
  return score;
}

function upsertPlayerRow(playersMap: Map<string, any>, pointstreakPlayerId: number | null, name: string | null) {
  if (pointstreakPlayerId == null) {
    return;
  }

  const key = String(pointstreakPlayerId);
  const existing = playersMap.get(key);
  if (!existing) {
    playersMap.set(key, {
      player_id: pointstreakPlayerId,
      name,
    });
    return;
  }

  if (scorePlayerName(name) > scorePlayerName(textOrNull(existing.name))) {
    existing.name = name;
  }
}

async function readOptionalTextFile(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

async function listSeasonSupplementalTeamLinkIds(rawDir: string, teamsMap: Map<string, any>) {
  const ids = new Set<number>();

  for (const team of Array.from(teamsMap.values())) {
    const teamLinkId = Number(team?.team_id);
    if (Number.isFinite(teamLinkId) && teamLinkId > 0) {
      ids.add(teamLinkId);
    }
  }

  try {
    const entries = await fs.readdir(path.join(rawDir, "teams"), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) {
        continue;
      }
      ids.add(Number(entry.name));
    }
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      throw err;
    }
  }

  return Array.from(ids).sort((left, right) => left - right);
}

function appendSeasonBattingStatsFromXml(
  xml: string,
  context: SupplementalContext,
  rows: any[],
  playersMap: Map<string, any>,
) {
  const $ = cheerioLoad(xml, { xmlMode: true });

  $("stats batting player").each((_, el) => {
    const player = $(el);
    const pointstreakPlayerId = firstNumericId(player.attr("playerlinkid"), player.find("playerlinkid").first().text());
    const pointstreakPlayerSeasonId = firstNumericId(player.attr("playerid"), player.find("playerid").first().text());
    const playerName = textOrNull(player.find("playername").first().text());

    rows.push({
      scope: context.scope,
      league_id: context.leagueId,
      season_id: context.seasonId,
      team_id: context.teamPointstreakLinkId,
      season_team_id: context.teamPointstreakId,
      source_team_name: textOrNull(player.find("teamname").first().text()) ?? context.teamName,
      player_id: pointstreakPlayerId,
      player_season_id: pointstreakPlayerSeasonId,
      player_name: playerName,
      jersey: textOrNull(player.find("jersey").first().text()),
      at_bats: firstNumericValue(player.find("ab").first().text()),
      runs: firstNumericValue(player.find("runs").first().text()),
      hits: firstNumericValue(player.find("hits").first().text()),
      doubles: firstNumericValue(player.find("bib").first().text()),
      triples: firstNumericValue(player.find("trib").first().text()),
      home_runs: firstNumericValue(player.find("hr").first().text()),
      runs_batted_in: firstNumericValue(player.find("rbi").first().text()),
      walks: firstNumericValue(player.find("bb").first().text()),
      hit_by_pitch: firstNumericValue(player.find("hp").first().text()),
      strikeouts: firstNumericValue(player.find("so").first().text()),
      sacrifice_flies: firstNumericValue(player.find("sf").first().text()),
      stolen_bases: firstNumericValue(player.find("sb").first().text()),
      double_plays: firstNumericValue(player.find("dp").first().text()),
      on_base_percentage: textOrNull(player.find("obp").first().text()),
      slugging_percentage: textOrNull(player.find("slg").first().text()),
      batting_average: textOrNull(player.find("avg").first().text()),
    });

    upsertPlayerRow(playersMap, pointstreakPlayerId, playerName);
  });
}

function appendSeasonPitchingStatsFromXml(
  xml: string,
  context: SupplementalContext,
  rows: any[],
  playersMap: Map<string, any>,
) {
  const $ = cheerioLoad(xml, { xmlMode: true });

  $("stats pitching player").each((_, el) => {
    const player = $(el);
    const pointstreakPlayerId = firstNumericId(player.attr("playerlinkid"), player.find("playerlinkid").first().text());
    const pointstreakPlayerSeasonId = firstNumericId(player.attr("playerid"), player.find("playerid").first().text());
    const playerName = textOrNull(player.find("playername").first().text());

    rows.push({
      scope: context.scope,
      league_id: context.leagueId,
      season_id: context.seasonId,
      team_id: context.teamPointstreakLinkId,
      season_team_id: context.teamPointstreakId,
      source_team_name: textOrNull(player.find("teamname").first().text()) ?? context.teamName,
      player_id: pointstreakPlayerId,
      player_season_id: pointstreakPlayerSeasonId,
      player_name: playerName,
      jersey: textOrNull(player.find("jersey").first().text()),
      wins: firstNumericValue(player.find("wins").first().text()),
      losses: firstNumericValue(player.find("losses").first().text()),
      innings_pitched: textOrNull(player.find("ip").first().text()),
      runs: firstNumericValue(player.find("runs").first().text()),
      earned_runs: firstNumericValue(player.find("er").first().text()),
      hits: firstNumericValue(player.find("hits").first().text()),
      walks: firstNumericValue(player.find("bb").first().text()),
      strikeouts: firstNumericValue(player.find("so").first().text()),
      batters_faced: firstNumericValue(player.find("bf").first().text()),
      games: firstNumericValue(player.find("games").first().text()),
      games_started: firstNumericValue(player.find("gs").first().text()),
      complete_games: firstNumericValue(player.find("cg").first().text()),
      complete_game_losses: firstNumericValue(player.find("cgl").first().text()),
      shutouts: firstNumericValue(player.find("sho").first().text()),
      saves: firstNumericValue(player.find("sv").first().text()),
      blown_saves: firstNumericValue(player.find("bsv").first().text()),
      opponent_on_base_percentage: textOrNull(player.find("oobp").first().text()),
      opponent_slugging_percentage: textOrNull(player.find("oslg").first().text()),
      opponent_average: textOrNull(player.find("oavg").first().text()),
      era: textOrNull(player.find("era").first().text()),
    });

    upsertPlayerRow(playersMap, pointstreakPlayerId, playerName);
  });
}

function appendSeasonBattingLeadersFromXml(
  xml: string,
  context: SupplementalContext,
  rows: any[],
  playersMap: Map<string, any>,
) {
  const $ = cheerioLoad(xml, { xmlMode: true });

  $("stats")
    .children()
    .each((_, el) => {
      const leaderCategory = el.tagName;
      if (leaderCategory === "link" || leaderCategory === "season") {
        return;
      }

      $(el)
        .children("batter")
        .each((index, child) => {
          const batter = $(child);
          const pointstreakPlayerId = firstNumericId(
            batter.attr("playerlinkid"),
            batter.find("playerlinkid").first().text(),
          );
          const pointstreakPlayerSeasonId = firstNumericId(
            batter.attr("playerid"),
            batter.find("playerid").first().text(),
          );
          const playerName = textOrNull(batter.find("playername").first().text());

          rows.push({
            scope: context.scope,
            league_id: context.leagueId,
            season_id: context.seasonId,
            team_id: context.teamPointstreakLinkId,
            season_team_id: context.teamPointstreakId,
            leader_category: leaderCategory,
            rank: index + 1,
            source_team_name: textOrNull(batter.find("teamname").first().text()) ?? context.teamName,
            player_id: pointstreakPlayerId,
            player_season_id: pointstreakPlayerSeasonId,
            player_name: playerName,
            jersey: textOrNull(batter.find("jersey").first().text()),
            at_bats: firstNumericValue(batter.find("ab").first().text()),
            runs: firstNumericValue(batter.find("runs").first().text()),
            hits: firstNumericValue(batter.find("hits").first().text()),
            doubles: firstNumericValue(batter.find("bib").first().text()),
            triples: firstNumericValue(batter.find("trib").first().text()),
            home_runs: firstNumericValue(batter.find("hr").first().text()),
            runs_batted_in: firstNumericValue(batter.find("rbi").first().text()),
            walks: firstNumericValue(batter.find("bb").first().text()),
            hit_by_pitch: firstNumericValue(batter.find("hp").first().text()),
            strikeouts: firstNumericValue(batter.find("so").first().text()),
            sacrifice_flies: firstNumericValue(batter.find("sf").first().text()),
            stolen_bases: firstNumericValue(batter.find("sb").first().text()),
            double_plays: firstNumericValue(batter.find("dp").first().text()),
            on_base_percentage: textOrNull(batter.find("obp").first().text()),
            slugging_percentage: textOrNull(batter.find("slg").first().text()),
            batting_average: textOrNull(batter.find("avg").first().text()),
          });

          upsertPlayerRow(playersMap, pointstreakPlayerId, playerName);
        });
    });
}

function appendSeasonPitchingLeadersFromXml(
  xml: string,
  context: SupplementalContext,
  rows: any[],
  playersMap: Map<string, any>,
) {
  const $ = cheerioLoad(xml, { xmlMode: true });

  $("stats")
    .children()
    .each((_, el) => {
      const leaderCategory = el.tagName;
      if (leaderCategory === "link" || leaderCategory === "season") {
        return;
      }

      $(el)
        .children("player, pitcher")
        .each((index, child) => {
          const player = $(child);
          const pointstreakPlayerId = firstNumericId(
            player.attr("playerlinkid"),
            player.find("playerlinkid").first().text(),
          );
          const pointstreakPlayerSeasonId = firstNumericId(
            player.attr("playerid"),
            player.find("playerid").first().text(),
          );
          const playerName = textOrNull(player.find("playername").first().text());

          rows.push({
            scope: context.scope,
            league_id: context.leagueId,
            season_id: context.seasonId,
            team_id: context.teamPointstreakLinkId,
            season_team_id: context.teamPointstreakId,
            leader_category: leaderCategory,
            rank: index + 1,
            source_team_name: textOrNull(player.find("teamname").first().text()) ?? context.teamName,
            player_id: pointstreakPlayerId,
            player_season_id: pointstreakPlayerSeasonId,
            player_name: playerName,
            jersey: textOrNull(player.find("jersey").first().text()),
            wins: firstNumericValue(player.find("wins").first().text()),
            losses: firstNumericValue(player.find("losses").first().text()),
            innings_pitched: textOrNull(player.find("ip").first().text()),
            runs: firstNumericValue(player.find("runs").first().text()),
            earned_runs: firstNumericValue(player.find("er").first().text()),
            hits: firstNumericValue(player.find("hits").first().text()),
            walks: firstNumericValue(player.find("bb").first().text()),
            strikeouts: firstNumericValue(player.find("so").first().text()),
            batters_faced: firstNumericValue(player.find("bf").first().text()),
            games: firstNumericValue(player.find("games").first().text()),
            games_started: firstNumericValue(player.find("gs").first().text()),
            complete_games: firstNumericValue(player.find("cg").first().text()),
            complete_game_losses: firstNumericValue(player.find("cgl").first().text()),
            shutouts: firstNumericValue(player.find("sho").first().text()),
            saves: firstNumericValue(player.find("sv").first().text()),
            blown_saves: firstNumericValue(player.find("bsv").first().text()),
            opponent_on_base_percentage: textOrNull(player.find("oobp").first().text()),
            opponent_slugging_percentage: textOrNull(player.find("oslg").first().text()),
            opponent_average: textOrNull(player.find("oavg").first().text()),
            era: textOrNull(player.find("era").first().text()),
          });

          upsertPlayerRow(playersMap, pointstreakPlayerId, playerName);
        });
    });
}

function appendRosterRowsFromXml(xml: string, context: SupplementalContext, rows: any[], playersMap: Map<string, any>) {
  const $ = cheerioLoad(xml, { xmlMode: true });
  const rosterTeamName = textOrNull($("league > team > name").first().text()) ?? context.teamName;

  $("league > player").each((_, el) => {
    const player = $(el);
    const pointstreakPlayerId = firstNumericId(player.attr("playerlinkid"), player.find("playerlinkid").first().text());
    const pointstreakPlayerSeasonId = firstNumericId(player.attr("playerid"), player.find("playerid").first().text());
    const firstName = textOrNull(player.find("fname").first().text());
    const lastName = textOrNull(player.find("lname").first().text());
    const fullName = buildFullPlayerName(firstName, lastName);

    rows.push({
      league_id: context.leagueId,
      season_id: context.seasonId,
      team_id: context.teamPointstreakLinkId,
      season_team_id: context.teamPointstreakId,
      team_name: rosterTeamName,
      player_id: pointstreakPlayerId,
      player_season_id: pointstreakPlayerSeasonId,
      first_name: firstName,
      last_name: lastName,
      name: fullName,
      position: textOrNull(player.find("position").first().text()),
      jersey: textOrNull(player.find("jersey").first().text()),
      height: textOrNull(player.find("height").first().text()),
      weight: textOrNull(player.find("weight").first().text()),
      birthdate: textOrNull(player.find("birthday").first().text()),
      bats: textOrNull(player.find("bats").first().text()),
      throws: textOrNull(player.find("throws").first().text()),
      status: textOrNull(player.find("status").first().text()),
      hometown: textOrNull(player.find("hometown").first().text()),
      photo_url: textOrNull(player.find("photo").first().text()),
    });

    upsertPlayerRow(playersMap, pointstreakPlayerId, fullName);
  });
}

async function writeNdjsonFile(filePath: string, rows: any[]) {
  await fs.writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

export async function archiveSeasonRaw(options: {
  leagueId?: number;
  seasonId: number;
  outDir?: string;
  minDelayMs?: number;
  maxDelayMs?: number;
  retries?: number;
  onLog?: (log: ArchiveLog) => void;
  onExistingFile?: ExistingRawXmlFilePrompt;
}) {
  const leagueId = options.leagueId ?? 1552;
  const seasonId = options.seasonId;
  const outDir = options.outDir ?? path.join(process.cwd(), "data");
  const minDelay = options.minDelayMs ?? 500;
  const maxDelay = options.maxDelayMs ?? 1500;
  const retries = options.retries ?? 3;
  const onLog = options.onLog ?? (() => {});

  const rawDir = getSeasonRawDir(outDir, seasonId);
  await ensureDir(rawDir);

  const schedulePath = path.join(rawDir, "schedule.xml");
  const scheduleResource: ArchiveRawXmlResource = {
    label: `schedule for season ${seasonId}`,
    url: buildSeasonScheduleUrl(leagueId, seasonId),
    outPath: schedulePath,
  };
  const scheduleXml = (await shouldFetchRawXmlResource(scheduleResource, {
    onExistingFile: options.onExistingFile,
    onLog,
  }))
    ? await fetchRawXmlResource(scheduleResource, { retries, onLog })
    : await fs.readFile(schedulePath, "utf8");

  const gamesList = extractGameIdsFromScheduleXml(scheduleXml);
  onLog({ level: "info", message: `Found ${gamesList.length} games in schedule` });

  const teamIds = extractTeamIdsFromScheduleXml(scheduleXml);
  onLog({ level: "info", message: `Found ${teamIds.length} teams in schedule` });

  const leagueResources: ArchiveRawXmlResource[] = [
    {
      label: `league-wide standings for season ${seasonId}`,
      url: buildStandingsUrl(leagueId, seasonId),
      outPath: path.join(getSeasonRawLeagueDir(outDir, seasonId), "standings.xml"),
    },
    {
      label: `league-wide stats for season ${seasonId}`,
      url: buildLeagueStatsUrl(leagueId, seasonId),
      outPath: path.join(getSeasonRawLeagueDir(outDir, seasonId), "stats.xml"),
    },
    {
      label: `league-wide batting leaders for season ${seasonId}`,
      url: buildLeagueBattingLeadersUrl(leagueId, seasonId),
      outPath: path.join(getSeasonRawLeagueDir(outDir, seasonId), "batting-leaders.xml"),
    },
    {
      label: `league-wide pitching leaders for season ${seasonId}`,
      url: buildLeaguePitchingLeadersUrl(leagueId, seasonId),
      outPath: path.join(getSeasonRawLeagueDir(outDir, seasonId), "pitching-leaders.xml"),
    },
  ];
  onLog({
    level: "info",
    message: `Fetching ${leagueResources.length} league-wide XML exports for season ${seasonId}`,
  });
  const leagueSummary = await fetchSupplementalRawXmlResources(leagueResources, {
    retries,
    minDelay,
    maxDelay,
    onLog,
    onExistingFile: options.onExistingFile,
  });

  let teamSummary: ArchiveRawXmlSummary = { fetched: 0, skipped: 0, failed: 0 };
  if (teamIds.length > 0) {
    const teamResources = teamIds.flatMap((teamId) => {
      const teamDir = getSeasonRawTeamDir(outDir, seasonId, teamId);
      return [
        {
          label: `team ${teamId} full-season stats for season ${seasonId}`,
          url: buildTeamStatsUrl(leagueId, seasonId, teamId),
          outPath: path.join(teamDir, "stats.xml"),
        },
        {
          label: `team ${teamId} batting leaders for season ${seasonId}`,
          url: buildTeamBattingLeadersUrl(leagueId, seasonId, teamId),
          outPath: path.join(teamDir, "batting-leaders.xml"),
        },
        {
          label: `team ${teamId} pitching leaders for season ${seasonId}`,
          url: buildTeamPitchingLeadersUrl(leagueId, seasonId, teamId),
          outPath: path.join(teamDir, "pitching-leaders.xml"),
        },
        {
          label: `team ${teamId} roster for season ${seasonId}`,
          url: buildRosterUrl(leagueId, seasonId, teamId),
          outPath: path.join(teamDir, "roster.xml"),
        },
      ];
    });
    onLog({
      level: "info",
      message: `Fetching ${teamResources.length} team-wide XML exports across ${teamIds.length} teams`,
    });
    teamSummary = await fetchSupplementalRawXmlResources(teamResources, {
      retries,
      minDelay,
      maxDelay,
      onLog,
      onExistingFile: options.onExistingFile,
    });
  }

  // iterate games and fetch boxscore if missing
  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  for (const [index, gid] of gamesList.entries()) {
    const current = index + 1;
    const outPath = path.join(rawDir, `game-${gid}.xml`);
    const boxscoreResource: ArchiveRawXmlResource = {
      label: `boxscore ${gid}`,
      url: buildBoxscoreUrl(leagueId, seasonId, Number(gid)),
      outPath,
    };
    try {
      const shouldFetch = await shouldFetchRawXmlResource(boxscoreResource, {
        onExistingFile: options.onExistingFile,
        onLog: (log) =>
          onLog({
            ...log,
            level: log.level === "info" ? "progress" : log.level,
            gameId: gid,
            ...buildProgressDetails(current, gamesList.length, log.message),
          }),
      });

      if (!shouldFetch) {
        skipped++;
        continue;
      }

      await fetchRawXmlResource(boxscoreResource, { retries, onLog, gameId: gid });
      fetched++;
      onLog({
        level: "progress",
        gameId: gid,
        ...buildProgressDetails(current, gamesList.length, `Saved boxscore ${gid}`),
      });

      // delay between requests
      const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
      await sleep(delay);
    } catch (err: any) {
      failed++;
      onLog({
        level: "error",
        gameId: gid,
        ...buildProgressDetails(current, gamesList.length, `Failed to fetch ${gid}: ${err?.message ?? String(err)}`),
      });
    }
  }

  const supplementalFetched = leagueSummary.fetched + teamSummary.fetched;
  const supplementalSkipped = leagueSummary.skipped + teamSummary.skipped;
  const supplementalFailed = leagueSummary.failed + teamSummary.failed;
  onLog({
    level: "info",
    message: `Archive complete. boxscores fetched=${fetched} skipped=${skipped} failed=${failed}; supplemental fetched=${supplementalFetched} skipped=${supplementalSkipped} failed=${supplementalFailed}`,
  });
  return {
    fetched,
    skipped,
    failed,
    total: gamesList.length,
    supplementalFetched,
    supplementalSkipped,
    supplementalFailed,
  };
}

export async function archiveSeason(options: {
  leagueId?: number;
  seasonId: number;
  outDir?: string;
  minDelayMs?: number;
  maxDelayMs?: number;
  retries?: number;
  onLog?: (log: ArchiveLog) => void;
  onExistingFile?: ExistingRawXmlFilePrompt;
}) {
  const outDir = options.outDir ?? path.join(process.cwd(), "data");
  const onLog = options.onLog ?? (() => {});

  const result = await archiveSeasonRaw({ ...options, outDir, onLog });

  // After all boxscores are fetched, generate deterministic seeds (batch mode)
  try {
    await generateSeedsForSeason(options.seasonId, outDir, onLog, options.leagueId ?? 1552);
    onLog({ level: "info", message: "Deterministic seeds generated" });
  } catch (err: any) {
    onLog({ level: "error", message: `Failed to generate seeds: ${err?.message ?? String(err)}` });
  }

  return result;
}

// processBoxscoreSeeds removed — batch generation uses `generateSeedsForSeason` only

/**
 * Batch-generate deterministic NDJSON seeds from all raw XML files for a season.
 */
export async function generateSeedsForSeason(
  seasonId: number,
  outDir: string,
  onLog: (l: ArchiveLog) => void,
  leagueId = 1552,
  options?: { emitProgress?: boolean },
) {
  const rawDir = await resolveSeasonRawDir(outDir, seasonId);
  const rawLeagueDir = path.join(rawDir, "league");
  const rawTeamsDir = path.join(rawDir, "teams");
  const seedsRootDir = path.join(outDir, "seeds");
  const seedsDir = getSeasonSeedsDir(outDir, seasonId);
  const emitProgress = options?.emitProgress ?? false;
  await ensureDir(seedsRootDir);
  await ensureDir(seedsDir);

  onLog({ level: "info", message: `Generating deterministic seeds for season ${seasonId}` });

  const playersMap = new Map<string, any>();
  const teamsMap = new Map<string, any>();
  const seasonTeamIdToLinkId = new Map<number, number>();
  const gamesMap = new Map<string, any>();
  const rosters: any[] = [];
  const lineups: any[] = [];
  const batting: any[] = [];
  const pitching: any[] = [];
  const seasonBattingStats: any[] = [];
  const seasonPitchingStats: any[] = [];
  const seasonBattingLeaders: any[] = [];
  const seasonPitchingLeaders: any[] = [];
  const innings: any[] = [];
  const boxscoreCleanupStats = createBoxscoreSeedCleanupStats();

  // read schedule for team metadata and games
  const schedulePath = path.join(rawDir, "schedule.xml");
  try {
    const schedXml = await fs.readFile(schedulePath, "utf8");
    const $s = cheerioLoad(schedXml, { xmlMode: true });
    // teams
    // Robust team discovery: attributes and child nodes with many possible names
    $s("team").each((_, el) => {
      const t = $s(el);
      const attrs = el.attribs || {};
      const identity = buildTeamIdentity({
        pointstreakTeamLinkIds: [
          attrs.teamlinkid,
          attrs.teamLinkId,
          attrs.linkid,
          t.find("teamlinkid").text(),
          t.find("linkid").text(),
        ],
        pointstreakTeamIds: [
          attrs.homeid,
          attrs.awayid,
          attrs.teamid,
          attrs.teamID,
          attrs.team_id,
          attrs.id,
          t.find("homeid").text(),
          t.find("awayid").text(),
          t.find("teamid").text(),
          t.find("id").text(),
        ],
      });
      if (identity.canonicalTeamId == null) return;
      const nameCandidates = [
        attrs.teamname,
        attrs.teamName,
        attrs.name,
        t.find("teamname").text(),
        t.find("name").text(),
      ];
      const name = nameCandidates.map((v) => (v ? String(v).trim() : "")).find((v) => v && v.length > 0) || null;
      const shortName =
        [attrs.shortname, attrs.shortName, attrs.short_name, t.find("shortname").text(), t.find("short_name").text()]
          .map((v) => (v ? String(v).trim() : ""))
          .find((v) => v && v.length > 0) || null;
      upsertTeamRow(teamsMap, seasonTeamIdToLinkId, identity, leagueId, name, shortName);
    });

    // also search for any elements that carry team identifiers if <team> wasn't present
    $s("[teamlinkid], [teamid], [homeid], [awayid]").each((_, el) => {
      const t = $s(el);
      const attrs = el.attribs || {};
      const identity = buildTeamIdentity({
        pointstreakTeamLinkIds: [
          attrs.teamlinkid,
          attrs.teamLinkId,
          attrs.linkid,
          t.find("teamlinkid").text(),
          t.find("linkid").text(),
        ],
        pointstreakTeamIds: [
          attrs.homeid,
          attrs.awayid,
          attrs.teamid,
          attrs.teamID,
          attrs.team_id,
          attrs.id,
          t.find("homeid").text(),
          t.find("awayid").text(),
          t.find("teamid").text(),
          t.find("id").text(),
        ],
      });
      if (identity.canonicalTeamId == null) return;

      const name =
        t.attr("teamname") ||
        t.attr("name") ||
        t.find("teamname").text().trim() ||
        t.find("name").text().trim() ||
        null;
      const shortName =
        t.attr("shortname") ||
        t.attr("shortName") ||
        t.attr("short_name") ||
        t.find("shortname").text().trim() ||
        t.find("short_name").text().trim() ||
        null;
      upsertTeamRow(teamsMap, seasonTeamIdToLinkId, identity, leagueId, name, shortName);
    });
  } catch {
    onLog({ level: "info", message: "No schedule.xml metadata available for teams" });
  }

  // iterate game files
  const files = await fs.readdir(rawDir);
  const gameFiles = files
    .filter((f) => f.startsWith("game-") && f.endsWith(".xml"))
    .sort(
      (left, right) =>
        Number(left.match(/game-(\d+)\.xml/)?.[1] || 0) - Number(right.match(/game-(\d+)\.xml/)?.[1] || 0),
    );
  for (const [index, fn] of gameFiles.entries()) {
    const current = index + 1;
    try {
      const xml = await fs.readFile(path.join(rawDir, fn), "utf8");
      const $ = cheerioLoad(xml, { xmlMode: true });
      const gameId = fn.match(/game-(\d+)\.xml/)?.[1];
      if (!gameId) {
        throw new Error(`Could not determine game id from file name: ${fn}`);
      }

      // teams
      const hometeam = $("teams hometeam");
      const awayteam = $("teams awayteam");
      const homeIdentity = buildTeamIdentity({
        pointstreakTeamLinkIds: [hometeam.attr("teamlinkid")],
        pointstreakTeamIds: [hometeam.attr("teamid"), hometeam.attr("homeid")],
      });
      const awayIdentity = buildTeamIdentity({
        pointstreakTeamLinkIds: [awayteam.attr("teamlinkid")],
        pointstreakTeamIds: [awayteam.attr("teamid"), awayteam.attr("awayid")],
      });
      upsertTeamRow(teamsMap, seasonTeamIdToLinkId, homeIdentity, leagueId, hometeam.text().trim() || null);
      upsertTeamRow(teamsMap, seasonTeamIdToLinkId, awayIdentity, leagueId, awayteam.text().trim() || null);

      const homeTeamId = homeIdentity.pointstreakTeamId;
      const awayTeamId = awayIdentity.pointstreakTeamId;
      const homeTeamLinkId = homeIdentity.pointstreakTeamLinkId ?? homeIdentity.canonicalTeamId;
      const awayTeamLinkId = awayIdentity.pointstreakTeamLinkId ?? awayIdentity.canonicalTeamId;

      // game row
      const schedgametime = $("schedgametime").text().trim() || null;
      const status = $("status").text().trim() || null;
      const homescore = Number($("score").attr("homescore") || $("score").attr("home") || 0);
      const awayscore = Number($("score").attr("awayscore") || $("score").attr("away") || 0);
      const isTie = homescore === awayscore;
      const winnerTeamLinkId = isTie ? null : homescore > awayscore ? homeTeamLinkId : awayTeamLinkId;
      const loserTeamLinkId = isTie ? null : homescore > awayscore ? awayTeamLinkId : homeTeamLinkId;
      const winnerTeamId = isTie ? null : homescore > awayscore ? homeTeamId : awayTeamId;
      const loserTeamId = isTie ? null : homescore > awayscore ? awayTeamId : homeTeamId;
      gamesMap.set(String(gameId), {
        game_id: Number(gameId),
        league_id: leagueId,
        season_id: seasonId,
        scheduled_at: schedgametime,
        status,
        home_team_id: homeTeamLinkId,
        away_team_id: awayTeamLinkId,
        home_season_team_id: homeTeamId,
        away_season_team_id: awayTeamId,
        home_score: homescore,
        away_score: awayscore,
        is_tie: isTie,
        winner_team_id: winnerTeamLinkId,
        loser_team_id: loserTeamLinkId,
        winner_season_team_id: winnerTeamId,
        loser_season_team_id: loserTeamId,
        raw_xml_file: fn,
      });

      const gameLineups: any[] = [];
      const gameBatting: any[] = [];

      // lineup
      $("battinglineup away player").each((_, el) => {
        const p = $(el);
        const pid = p.find("playerlinkid").text().trim();
        gameLineups.push({
          game_id: Number(gameId),
          season_id: seasonId,
          team_id: awayTeamLinkId,
          season_team_id: awayTeamId,
          is_home: false,
          player_id: pid ? Number(pid) : null,
          name: p.find("name").text().trim() || null,
          jersey: p.find("jersey").text().trim() || null,
          position: p.find("position").text().trim() || null,
          order_idx: Number(p.find("order").text() || 0),
        });
        if (pid && !playersMap.has(pid))
          playersMap.set(pid, { player_id: Number(pid), name: p.find("name").text().trim() || null });
      });
      $("battinglineup home player").each((_, el) => {
        const p = $(el);
        const pid = p.find("playerlinkid").text().trim();
        gameLineups.push({
          game_id: Number(gameId),
          season_id: seasonId,
          team_id: homeTeamLinkId,
          season_team_id: homeTeamId,
          is_home: true,
          player_id: pid ? Number(pid) : null,
          name: p.find("name").text().trim() || null,
          jersey: p.find("jersey").text().trim() || null,
          position: p.find("position").text().trim() || null,
          order_idx: Number(p.find("order").text() || 0),
        });
        if (pid && !playersMap.has(pid))
          playersMap.set(pid, { player_id: Number(pid), name: p.find("name").text().trim() || null });
      });

      // batting
      $("battingstats away player").each((_, el) => {
        const p = $(el);
        const pid = p.find("playerlinkid").text().trim();
        if (pid && !playersMap.has(pid))
          playersMap.set(pid, { player_id: Number(pid), name: p.find("name").text().trim() || null });
        gameBatting.push({
          game_id: Number(gameId),
          season_id: seasonId,
          team_id: awayTeamLinkId,
          season_team_id: awayTeamId,
          is_home: false,
          player_id: pid ? Number(pid) : null,
          jersey: p.find("jersey").text().trim() || null,
          position: p.find("position").text().trim() || null,
          ab: Number(p.find("ab").text() || 0),
          runs: Number(p.find("runs").text() || 0),
          hits: Number(p.find("hits").text() || 0),
          hr: Number(p.find("hr").text() || 0),
          rbi: Number(p.find("rbi").text() || 0),
          bb: Number(p.find("bb").text() || 0),
          so: Number(p.find("so").text() || 0),
          sb: Number(p.find("sb").text() || 0),
          avg: p.find("avg").text().trim() || null,
        });
      });
      $("battingstats home player").each((_, el) => {
        const p = $(el);
        const pid = p.find("playerlinkid").text().trim();
        if (pid && !playersMap.has(pid))
          playersMap.set(pid, { player_id: Number(pid), name: p.find("name").text().trim() || null });
        gameBatting.push({
          game_id: Number(gameId),
          season_id: seasonId,
          team_id: homeTeamLinkId,
          season_team_id: homeTeamId,
          is_home: true,
          player_id: pid ? Number(pid) : null,
          jersey: p.find("jersey").text().trim() || null,
          position: p.find("position").text().trim() || null,
          ab: Number(p.find("ab").text() || 0),
          runs: Number(p.find("runs").text() || 0),
          hits: Number(p.find("hits").text() || 0),
          hr: Number(p.find("hr").text() || 0),
          rbi: Number(p.find("rbi").text() || 0),
          bb: Number(p.find("bb").text() || 0),
          so: Number(p.find("so").text() || 0),
          sb: Number(p.find("sb").text() || 0),
          avg: p.find("avg").text().trim() || null,
        });
      });

      const cleanedBoxscoreRows = applyBoxscoreSeedCleanups({
        gameId: Number(gameId),
        seasonId,
        lineups: gameLineups,
        batting: gameBatting,
      });
      lineups.push(...cleanedBoxscoreRows.lineups);
      batting.push(...cleanedBoxscoreRows.batting);
      mergeBoxscoreSeedCleanupStats(boxscoreCleanupStats, cleanedBoxscoreRows.stats);

      // pitching
      $("pitchingstats away player").each((index, el) => {
        const p = $(el);
        const pid = p.find("playerlinkid").text().trim();
        if (pid && !playersMap.has(pid))
          playersMap.set(pid, { player_id: Number(pid), name: p.find("name").text().trim() || null });
        pitching.push({
          game_id: Number(gameId),
          season_id: seasonId,
          team_id: awayTeamLinkId,
          season_team_id: awayTeamId,
          is_home: false,
          player_id: pid ? Number(pid) : null,
          jersey: p.find("jersey").text().trim() || null,
          pitching_order: index + 1,
          ip: p.find("ip").text().trim() || null,
          hits: Number(p.find("hits").text() || 0),
          runs: Number(p.find("runs").text() || 0),
          earned_runs: Number(p.find("earnedruns").text() || 0),
          bb: Number(p.find("bb").text() || 0),
          so: Number(p.find("so").text() || 0),
          era: p.find("era").text().trim() || null,
        });
      });
      $("pitchingstats home player").each((index, el) => {
        const p = $(el);
        const pid = p.find("playerlinkid").text().trim();
        if (pid && !playersMap.has(pid))
          playersMap.set(pid, { player_id: Number(pid), name: p.find("name").text().trim() || null });
        pitching.push({
          game_id: Number(gameId),
          season_id: seasonId,
          team_id: homeTeamLinkId,
          season_team_id: homeTeamId,
          is_home: true,
          player_id: pid ? Number(pid) : null,
          jersey: p.find("jersey").text().trim() || null,
          pitching_order: index + 1,
          ip: p.find("ip").text().trim() || null,
          hits: Number(p.find("hits").text() || 0),
          runs: Number(p.find("runs").text() || 0),
          earned_runs: Number(p.find("earnedruns").text() || 0),
          bb: Number(p.find("bb").text() || 0),
          so: Number(p.find("so").text() || 0),
          era: p.find("era").text().trim() || null,
        });
      });

      // innings
      const awayScoreByInning = $("scoresbyinning away").first();
      const awayTotalRuns = numberOrNull(awayScoreByInning.attr("runs"));
      const awayTotalHits = numberOrNull(awayScoreByInning.attr("hits"));
      const awayTotalErrors = numberOrNull(awayScoreByInning.attr("errors"));
      const homeScoreByInning = $("scoresbyinning home").first();
      const homeTotalRuns = numberOrNull(homeScoreByInning.attr("runs"));
      const homeTotalHits = numberOrNull(homeScoreByInning.attr("hits"));
      const homeTotalErrors = numberOrNull(homeScoreByInning.attr("errors"));

      $("scoresbyinning away inning").each((_, el) => {
        const inn = $(el);
        const num = Number(inn.attr("number") || 0);
        const score = Number(inn.attr("score") || 0);
        innings.push({
          game_id: Number(gameId),
          season_id: seasonId,
          team_id: awayTeamLinkId,
          season_team_id: awayTeamId,
          is_home: false,
          inning_number: num,
          runs: score,
          total_runs: awayTotalRuns,
          total_hits: awayTotalHits,
          total_errors: awayTotalErrors,
        });
      });
      $("scoresbyinning home inning").each((_, el) => {
        const inn = $(el);
        const num = Number(inn.attr("number") || 0);
        const score = Number(inn.attr("score") || 0);
        innings.push({
          game_id: Number(gameId),
          season_id: seasonId,
          team_id: homeTeamLinkId,
          season_team_id: homeTeamId,
          is_home: true,
          inning_number: num,
          runs: score,
          total_runs: homeTotalRuns,
          total_hits: homeTotalHits,
          total_errors: homeTotalErrors,
        });
      });

      if (emitProgress) {
        onLog({
          level: "progress",
          gameId,
          ...buildProgressDetails(current, gameFiles.length, `Parsed seed data for game ${gameId}`),
        });
      }
    } catch (err: any) {
      if (emitProgress) {
        onLog({
          level: "error",
          ...buildProgressDetails(current, gameFiles.length, `Failed parsing ${fn}: ${err?.message ?? String(err)}`),
        });
      } else {
        onLog({ level: "error", message: `Failed parsing ${fn}: ${err?.message ?? String(err)}` });
      }
    }
  }

  onLog({ level: "info", message: formatBoxscoreSeedCleanupStats(boxscoreCleanupStats) });

  const leagueContext: SupplementalContext = {
    scope: "league",
    leagueId,
    seasonId,
    teamPointstreakLinkId: null,
    teamPointstreakId: null,
    teamName: null,
  };

  const leagueStatsXml = await readOptionalTextFile(path.join(rawLeagueDir, "stats.xml"));
  if (leagueStatsXml) {
    appendSeasonBattingStatsFromXml(leagueStatsXml, leagueContext, seasonBattingStats, playersMap);
    appendSeasonPitchingStatsFromXml(leagueStatsXml, leagueContext, seasonPitchingStats, playersMap);
  }

  const leagueBattingLeadersXml = await readOptionalTextFile(path.join(rawLeagueDir, "batting-leaders.xml"));
  if (leagueBattingLeadersXml) {
    appendSeasonBattingLeadersFromXml(leagueBattingLeadersXml, leagueContext, seasonBattingLeaders, playersMap);
  }

  const leaguePitchingLeadersXml = await readOptionalTextFile(path.join(rawLeagueDir, "pitching-leaders.xml"));
  if (leaguePitchingLeadersXml) {
    appendSeasonPitchingLeadersFromXml(leaguePitchingLeadersXml, leagueContext, seasonPitchingLeaders, playersMap);
  }

  const supplementalTeamLinkIds = await listSeasonSupplementalTeamLinkIds(rawDir, teamsMap);
  for (const teamPointstreakLinkId of supplementalTeamLinkIds) {
    const teamRow = teamsMap.get(String(teamPointstreakLinkId));
    const teamContext: SupplementalContext = {
      scope: "team",
      leagueId,
      seasonId,
      teamPointstreakLinkId,
      teamPointstreakId: teamRow?.season_team_id ?? null,
      teamName: teamRow?.name ?? null,
    };
    const teamDir = path.join(rawTeamsDir, String(teamPointstreakLinkId));

    const rosterXml = await readOptionalTextFile(path.join(teamDir, "roster.xml"));
    if (rosterXml) {
      appendRosterRowsFromXml(rosterXml, teamContext, rosters, playersMap);
    }

    const teamStatsXml = await readOptionalTextFile(path.join(teamDir, "stats.xml"));
    if (teamStatsXml) {
      appendSeasonBattingStatsFromXml(teamStatsXml, teamContext, seasonBattingStats, playersMap);
      appendSeasonPitchingStatsFromXml(teamStatsXml, teamContext, seasonPitchingStats, playersMap);
    }

    const teamBattingLeadersXml = await readOptionalTextFile(path.join(teamDir, "batting-leaders.xml"));
    if (teamBattingLeadersXml) {
      appendSeasonBattingLeadersFromXml(teamBattingLeadersXml, teamContext, seasonBattingLeaders, playersMap);
    }

    const teamPitchingLeadersXml = await readOptionalTextFile(path.join(teamDir, "pitching-leaders.xml"));
    if (teamPitchingLeadersXml) {
      appendSeasonPitchingLeadersFromXml(teamPitchingLeadersXml, teamContext, seasonPitchingLeaders, playersMap);
    }
  }

  onLog({
    level: "info",
    message: `Parsed supplemental season data: ${rosters.length} roster rows, ${seasonBattingStats.length} season batting rows, ${seasonPitchingStats.length} season pitching rows, ${seasonBattingLeaders.length} batting leader rows, ${seasonPitchingLeaders.length} pitching leader rows`,
  });

  const cleanedSeasonRows = applySeasonSeedCleanups({ seasonPitchingStats });
  onLog({ level: "info", message: formatSeasonSeedCleanupStats(cleanedSeasonRows.stats) });

  // write deterministic NDJSON (sorted by id where applicable)
  const playersPath = path.join(seedsDir, "players.ndjson");
  const teamsPath = path.join(seedsDir, "teams.ndjson");
  const gamesPath = path.join(seedsDir, "games.ndjson");
  const rostersPath = path.join(seedsDir, "rosters.ndjson");
  const lineupPath = path.join(seedsDir, "lineups.ndjson");
  const battingPath = path.join(seedsDir, "batting_stats.ndjson");
  const pitchingPath = path.join(seedsDir, "pitching_stats.ndjson");
  const seasonBattingStatsPath = path.join(seedsDir, "season_batting_stats.ndjson");
  const seasonPitchingStatsPath = path.join(seedsDir, "season_pitching_stats.ndjson");
  const seasonBattingLeadersPath = path.join(seedsDir, "season_batting_leaders.ndjson");
  const seasonPitchingLeadersPath = path.join(seedsDir, "season_pitching_leaders.ndjson");
  const inningsPath = path.join(seedsDir, "innings.ndjson");
  const standingsPath = path.join(seedsDir, "standings.ndjson");

  // players
  const players = Array.from(playersMap.values()).sort((a, b) => (a.player_id || 0) - (b.player_id || 0));
  await writeNdjsonFile(playersPath, players);

  // teams
  const teams = Array.from(teamsMap.values()).sort((a, b) => {
    if ((a.team_id || 0) !== (b.team_id || 0)) {
      return (a.team_id || 0) - (b.team_id || 0);
    }
    return (a.season_team_id || 0) - (b.season_team_id || 0);
  });
  await writeNdjsonFile(teamsPath, teams);

  // games
  const games = Array.from(gamesMap.values()).sort((a, b) => (a.game_id || 0) - (b.game_id || 0));
  await writeNdjsonFile(gamesPath, games);

  rosters.sort((a, b) => {
    if ((a.team_id || 0) !== (b.team_id || 0)) {
      return (a.team_id || 0) - (b.team_id || 0);
    }
    if ((a.player_id || 0) !== (b.player_id || 0)) {
      return (a.player_id || 0) - (b.player_id || 0);
    }
    return (a.player_season_id || 0) - (b.player_season_id || 0);
  });
  await writeNdjsonFile(rostersPath, rosters);

  // lineups, batting, pitching, innings (already arrays) — write in deterministic order
  lineups.sort((a, b) => (a.game_id || 0) - (b.game_id || 0));
  await writeNdjsonFile(lineupPath, lineups);

  batting.sort((a, b) => (a.game_id || 0) - (b.game_id || 0));
  await writeNdjsonFile(battingPath, batting);

  pitching.sort((a, b) => (a.game_id || 0) - (b.game_id || 0));
  await writeNdjsonFile(pitchingPath, pitching);

  seasonBattingStats.sort((a, b) => {
    const scopeCompare = String(a.scope || "").localeCompare(String(b.scope || ""));
    if (scopeCompare !== 0) {
      return scopeCompare;
    }
    if ((a.team_id || 0) !== (b.team_id || 0)) {
      return (a.team_id || 0) - (b.team_id || 0);
    }
    if ((a.player_id || 0) !== (b.player_id || 0)) {
      return (a.player_id || 0) - (b.player_id || 0);
    }
    return (a.player_season_id || 0) - (b.player_season_id || 0);
  });
  await writeNdjsonFile(seasonBattingStatsPath, seasonBattingStats);

  seasonPitchingStats.sort((a, b) => {
    const scopeCompare = String(a.scope || "").localeCompare(String(b.scope || ""));
    if (scopeCompare !== 0) {
      return scopeCompare;
    }
    if ((a.team_id || 0) !== (b.team_id || 0)) {
      return (a.team_id || 0) - (b.team_id || 0);
    }
    if ((a.player_id || 0) !== (b.player_id || 0)) {
      return (a.player_id || 0) - (b.player_id || 0);
    }
    return (a.player_season_id || 0) - (b.player_season_id || 0);
  });
  await writeNdjsonFile(seasonPitchingStatsPath, seasonPitchingStats);

  seasonBattingLeaders.sort((a, b) => {
    const scopeCompare = String(a.scope || "").localeCompare(String(b.scope || ""));
    if (scopeCompare !== 0) {
      return scopeCompare;
    }
    const categoryCompare = String(a.leader_category || "").localeCompare(String(b.leader_category || ""));
    if (categoryCompare !== 0) {
      return categoryCompare;
    }
    if ((a.team_id || 0) !== (b.team_id || 0)) {
      return (a.team_id || 0) - (b.team_id || 0);
    }
    if ((a.rank || 0) !== (b.rank || 0)) {
      return (a.rank || 0) - (b.rank || 0);
    }
    return (a.player_id || 0) - (b.player_id || 0);
  });
  await writeNdjsonFile(seasonBattingLeadersPath, seasonBattingLeaders);

  seasonPitchingLeaders.sort((a, b) => {
    const scopeCompare = String(a.scope || "").localeCompare(String(b.scope || ""));
    if (scopeCompare !== 0) {
      return scopeCompare;
    }
    const categoryCompare = String(a.leader_category || "").localeCompare(String(b.leader_category || ""));
    if (categoryCompare !== 0) {
      return categoryCompare;
    }
    if ((a.team_id || 0) !== (b.team_id || 0)) {
      return (a.team_id || 0) - (b.team_id || 0);
    }
    if ((a.rank || 0) !== (b.rank || 0)) {
      return (a.rank || 0) - (b.rank || 0);
    }
    return (a.player_id || 0) - (b.player_id || 0);
  });
  await writeNdjsonFile(seasonPitchingLeadersPath, seasonPitchingLeaders);

  innings.sort((a, b) => (a.game_id || 0) - (b.game_id || 0));
  await writeNdjsonFile(inningsPath, innings);

  const standingsRows: any[] = [];

  const standingsXml = await readOptionalTextFile(path.join(rawLeagueDir, "standings.xml"));
  if (standingsXml) {
    appendStandingsRowsFromXml(standingsXml, leagueContext, standingsRows, teamsMap, seasonTeamIdToLinkId);
    onLog({ level: "info", message: `Parsed ${standingsRows.length} standings rows from archived standings XML` });
  }

  if (standingsRows.length === 0) {
    onLog({ level: "info", message: "No archived standings XML found; deriving standings from archived game scores" });

    const stats = new Map<number, any>();
    for (const g of Array.from(gamesMap.values())) {
      const hid = g.home_team_id;
      const aid = g.away_team_id;
      if (!hid && !aid) continue;
      for (const id of [hid, aid]) {
        if (!id) continue;
        if (!stats.has(id)) {
          const team = teamsMap.get(String(id));
          stats.set(id, {
            league_id: leagueId,
            season_id: seasonId,
            team_id: id,
            season_team_id: team?.season_team_id ?? null,
            name: team?.name || null,
            games_played: 0,
            wins: 0,
            losses: 0,
            ties: 0,
          });
        }
      }
      const home = stats.get(hid);
      const away = stats.get(aid);
      const hasScores = Number.isFinite(g.home_score) && Number.isFinite(g.away_score);
      if (!hasScores) continue;

      if (g.home_score === g.away_score) {
        if (home) home.games_played += 1;
        if (away) away.games_played += 1;
        if (home) home.ties += 1;
        if (away) away.ties += 1;
      } else if (g.home_score > g.away_score) {
        if (home) home.games_played += 1;
        if (away) away.games_played += 1;
        if (home) home.wins += 1;
        if (away) away.losses += 1;
      } else {
        if (home) home.games_played += 1;
        if (away) away.games_played += 1;
        if (away) away.wins += 1;
        if (home) home.losses += 1;
      }
    }

    for (const value of Array.from(stats.values())) {
      standingsRows.push({
        ...value,
        pct: formatStandingsPct(value.wins, value.losses, value.ties, value.games_played),
      });
    }
  }

  standingsRows.sort((a, b) => {
    if ((a.team_id || 0) !== (b.team_id || 0)) {
      return (a.team_id || 0) - (b.team_id || 0);
    }
    return (a.season_team_id || 0) - (b.season_team_id || 0);
  });
  await writeNdjsonFile(standingsPath, standingsRows);
  onLog({ level: "info", message: "Wrote standings seed" });
  onLog({ level: "info", message: `Wrote season seeds to ${seedsDir}` });
}
