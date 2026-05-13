import { useEffect, useMemo, useState } from "react";
import entityMergeConfig from "../../../data/entity-merges.json";

export type Route =
  | { name: "home" }
  | { name: "seasons" }
  | { name: "season"; seasonId: number }
  | { name: "seasonTeam"; seasonId: number; teamId: number }
  | { name: "seasonPlayer"; seasonId: number; playerId: number }
  | { name: "teams" }
  | { name: "team"; teamId: number }
  | { name: "players" }
  | { name: "player"; playerId: number }
  | { name: "game"; gameId: number }
  | { name: "sql" }
  | { name: "schema" };

type EntityMergeGroup = {
  canonicalId: number;
  aliasIds?: number[];
};

type EntityMergeConfig = {
  players?: EntityMergeGroup[];
  teams?: EntityMergeGroup[];
};

const entityAliases = buildEntityAliasMaps(entityMergeConfig as EntityMergeConfig);

function buildEntityAliasMap(groups: EntityMergeGroup[] | undefined) {
  const aliases = new Map<number, number>();

  for (const group of groups ?? []) {
    if (!Number.isInteger(group.canonicalId)) {
      continue;
    }
    for (const aliasId of group.aliasIds ?? []) {
      if (Number.isInteger(aliasId) && aliasId !== group.canonicalId) {
        aliases.set(aliasId, group.canonicalId);
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

function buildEntityAliasMaps(config: EntityMergeConfig) {
  return {
    players: buildEntityAliasMap(config.players),
    teams: buildEntityAliasMap(config.teams),
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
