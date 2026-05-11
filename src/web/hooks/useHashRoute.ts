import { useEffect, useMemo, useState } from "react";

export type Route =
  | { name: "home" }
  | { name: "season"; seasonId: number }
  | { name: "seasonTeam"; seasonId: number; teamId: number }
  | { name: "seasonPlayer"; seasonId: number; playerId: number }
  | { name: "team"; teamId: number }
  | { name: "player"; playerId: number }
  | { name: "game"; gameId: number }
  | { name: "sql" }
  | { name: "schema" };

function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/";
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
  if (parts[0] === "teams" && parts[1]) {
    return { name: "team", teamId: Number(parts[1]) };
  }
  if (parts[0] === "players" && parts[1]) {
    return { name: "player", playerId: Number(parts[1]) };
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
  return `#${path}`;
}

export function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash || "#/");

  useEffect(() => {
    const update = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  return useMemo(() => parseRoute(hash), [hash]);
}
