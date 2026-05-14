import { useEffect, useMemo, useState } from "react";
import playerMergeConfig from "../../../data/player-merge-approvals.json";
import teamMergeConfig from "../../../data/team-merge-approvals.json";
import { archiveEntityIdForCompetition, type ArchiveCompetitionId } from "../../lib/constants";

export type Route =
  | { name: "home" }
  | { name: "competition"; competitionId: string }
  | { name: "competitionSeasons"; competitionId: string }
  | { name: "competitionTeams"; competitionId: string }
  | { name: "competitionPlayers"; competitionId: string }
  | { name: "competitionTeam"; competitionId: string; teamId: number }
  | { name: "competitionPlayer"; competitionId: string; playerId: number }
  | { name: "seasons" }
  | { name: "season"; seasonId: number }
  | { name: "seasonTeam"; seasonId: number; teamId: number }
  | { name: "seasonPlayer"; seasonId: number; playerId: number }
  | { name: "teams" }
  | { name: "team"; teamId: number }
  | { name: "people" }
  | { name: "person"; personId: number }
  | { name: "players" }
  | { name: "player"; playerId: number }
  | { name: "game"; gameId: number }
  | { name: "sql" }
  | { name: "schema" };

type EntityMergeGroup = {
  competitionId: ArchiveCompetitionId;
  canonicalSourceId: number;
  aliasSourceIds?: number[];
};

type EntityMergeConfig = {
  version?: number;
  merges?: EntityMergeGroup[];
};

const entityAliases = buildEntityAliasMaps(
  playerMergeConfig as EntityMergeConfig,
  teamMergeConfig as EntityMergeConfig,
);

function buildEntityAliasMap(groups: EntityMergeGroup[] | undefined) {
  const aliases = new Map<number, number>();

  for (const group of groups ?? []) {
    const canonicalId = archiveEntityIdForCompetition(group.competitionId, group.canonicalSourceId);
    if (canonicalId == null) {
      continue;
    }
    for (const aliasSourceId of group.aliasSourceIds ?? []) {
      const aliasId = archiveEntityIdForCompetition(group.competitionId, aliasSourceId);
      if (aliasId != null && aliasId !== canonicalId) {
        aliases.set(aliasId, canonicalId);
      }
    }
  }

  for (const [aliasId, canonicalId] of aliases) {
    let resolvedCanonicalId = canonicalId;
    const seen = new Set([aliasId]);
    while (aliases.has(resolvedCanonicalId) && !seen.has(resolvedCanonicalId)) {
      seen.add(resolvedCanonicalId);
      resolvedCanonicalId = aliases.get(resolvedCanonicalId)!;
    }
    if (!seen.has(resolvedCanonicalId)) {
      aliases.set(aliasId, resolvedCanonicalId);
    }
  }

  return aliases;
}

function buildEntityAliasMaps(playerConfig: EntityMergeConfig, teamConfig: EntityMergeConfig) {
  return {
    players: buildEntityAliasMap(playerConfig.merges),
    teams: buildEntityAliasMap(teamConfig.merges),
  };
}

function canonicalizeIdSegment(segment: string, aliases: Map<number, number>) {
  const id = Number(segment);
  if (!Number.isInteger(id)) {
    return segment;
  }
  return String(aliases.get(id) ?? id);
}

function canonicalizeRoutePath(path: string) {
  const queryIndex = path.indexOf("?");
  const routePath = queryIndex >= 0 ? path.slice(0, queryIndex) : path;
  const query = queryIndex >= 0 ? path.slice(queryIndex + 1) : "";
  const parts = routePath.split("/");
  let changed = false;

  for (let index = 0; index < parts.length - 1; index += 1) {
    const segment = parts[index];
    const nextSegment = parts[index + 1];
    let canonicalSegment = nextSegment;

    if (segment === "teams" || segment === "team") {
      canonicalSegment = canonicalizeIdSegment(nextSegment, entityAliases.teams);
    }
    if (segment === "players" || segment === "player") {
      canonicalSegment = canonicalizeIdSegment(nextSegment, entityAliases.players);
    }

    if (canonicalSegment !== nextSegment) {
      parts[index + 1] = canonicalSegment;
      changed = true;
    }
  }

  return changed ? `${parts.join("/")}${query ? `?${query}` : ""}` : path;
}

function canonicalizeHash(hash: string) {
  const normalizedHash = hash || "#/";
  const hashPath = normalizedHash.replace(/^#/, "") || "/";
  const canonicalPath = canonicalizeRoutePath(hashPath);
  return canonicalPath === hashPath ? normalizedHash : `#${canonicalPath}`;
}

function parseRoute(hash: string): Route {
  const path = canonicalizeHash(hash).replace(/^#/, "") || "/";
  const routePath = path.split("?")[0] ?? "/";
  const parts = routePath.split("/").filter(Boolean);

  if (parts[0] === "competitions" && parts[1]) {
    const competitionId = parts[1];
    if (parts[2] === "seasons") {
      return { name: "competitionSeasons", competitionId };
    }
    if (parts[2] === "teams" && parts[3]) {
      return { name: "competitionTeam", competitionId, teamId: Number(parts[3]) };
    }
    if (parts[2] === "teams") {
      return { name: "competitionTeams", competitionId };
    }
    if (parts[2] === "players" && parts[3]) {
      return { name: "competitionPlayer", competitionId, playerId: Number(parts[3]) };
    }
    if (parts[2] === "players") {
      return { name: "competitionPlayers", competitionId };
    }
    return { name: "competition", competitionId };
  }

  if (parts[0] === "seasons" && parts[1] && parts[2] === "teams" && parts[3]) {
    return { name: "seasonTeam", seasonId: Number(parts[1]), teamId: Number(parts[3]) };
  }
  if (parts[0] === "seasons" && parts[1] && parts[2] === "players" && parts[3]) {
    return { name: "seasonPlayer", seasonId: Number(parts[1]), playerId: Number(parts[3]) };
  }
  if (parts[0] === "seasons" && parts[1]) {
    return { name: "season", seasonId: Number(parts[1]) };
  }
  if (parts[0] === "seasons") {
    return { name: "seasons" };
  }
  if (parts[0] === "teams" && parts[1]) {
    return { name: "team", teamId: Number(parts[1]) };
  }
  if (parts[0] === "teams") {
    return { name: "teams" };
  }
  if (parts[0] === "people" && parts[1]) {
    return { name: "person", personId: Number(parts[1]) };
  }
  if (parts[0] === "people") {
    return { name: "people" };
  }
  if (parts[0] === "players" && parts[1]) {
    return { name: "player", playerId: Number(parts[1]) };
  }
  if (parts[0] === "players") {
    return { name: "players" };
  }
  if (parts[0] === "games" && parts[1]) {
    return { name: "game", gameId: Number(parts[1]) };
  }
  if (parts[0] === "sql") {
    return { name: "sql" };
  }
  if (parts[0] === "schema") {
    return { name: "schema" };
  }
  return { name: "home" };
}

export function href(path: string) {
  return canonicalizeHash(`#${path}`);
}

export function useHashRoute() {
  const [hash, setHash] = useState(canonicalizeHash(window.location.hash || "#/"));

  useEffect(() => {
    const update = () => {
      const currentHash = window.location.hash || "#/";
      const canonicalHash = canonicalizeHash(currentHash);
      if (canonicalHash !== currentHash) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${canonicalHash}`);
      }
      setHash(canonicalHash);
    };
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  return useMemo(() => parseRoute(hash), [hash]);
}
