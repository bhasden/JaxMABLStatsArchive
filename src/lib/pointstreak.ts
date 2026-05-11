// Centralized Pointstreak constants and URL helpers.
import { LEAGUE_ID, SEASONS } from "./constants";

const POINTSTREAK_BASE = "https://apix.pointstreak.com/partner/";

type PointstreakParamValue = string | number | null | undefined;

function getPointstreakCredentials() {
  const username = process.env.POINTSTREAK_USERNAME?.trim();
  const password = process.env.POINTSTREAK_PASSWORD?.trim();

  if (!username || !password) {
    throw new Error(
      "Missing Pointstreak credentials. Set POINTSTREAK_USERNAME and POINTSTREAK_PASSWORD before calling Pointstreak APIs.",
    );
  }

  return { username, password };
}

function buildPartnerUrl(action: string, params: Record<string, PointstreakParamValue>) {
  const { username, password } = getPointstreakCredentials();
  const searchParams = new URLSearchParams({
    sport: "baseball",
    u: username,
    p: password,
    action,
  });

  Object.entries(params).forEach(([key, value]) => {
    if (value != null && String(value).length > 0) {
      searchParams.set(key, String(value));
    }
  });

  return `${POINTSTREAK_BASE}?${searchParams.toString()}`;
}

export function buildRosterUrl(
  leagueId?: string | number,
  seasonId?: string | number | null,
  teamId?: string | number,
) {
  const l = leagueId || LEAGUE_ID;
  const s = seasonId === undefined ? SEASONS[SEASONS.length - 1]?.id : seasonId;
  const t = teamId || SEASONS[SEASONS.length - 1]?.teamId;

  if (!l || !t) {
    throw new Error("Missing leagueId or teamId when building Pointstreak roster URL");
  }

  return buildPartnerUrl("getteamroster", {
    leagueid: l,
    seasonid: s,
    teamid: t,
  });
}

export function buildPlayerProfileUrl(leagueId?: number, seasonId?: number, teamId?: number, playerId?: number) {
  const l = leagueId || LEAGUE_ID;
  const s = seasonId || SEASONS[SEASONS.length - 1]?.id?.toString(); // Use last season ID as default if available
  const t = teamId || SEASONS[SEASONS.length - 1]?.teamId?.toString(); // Use last season team ID as default if available
  const p = playerId;

  if (!l || !s || !t || !p) {
    throw new Error("Missing leagueId, seasonId, teamId, or playerId when building Pointstreak player profile URL");
  }

  return buildPartnerUrl("playerprofile", {
    leagueid: l,
    seasonid: s,
    teamid: t,
    playerid: p,
  });
}

export function buildScheduleUrl(leagueId?: number, seasonId?: number, teamId?: number) {
  const l = leagueId || LEAGUE_ID;
  const s = seasonId || SEASONS[SEASONS.length - 1]?.id; // Use last season ID as default if available
  const t = teamId || SEASONS[SEASONS.length - 1]?.teamId; // Use last season team ID as default if available

  if (!l || !s || !t) {
    throw new Error("Missing leagueId, seasonId, or teamId when building Pointstreak schedule URL");
  }

  return buildPartnerUrl("getteamschedule", {
    leagueid: l,
    seasonid: s,
    teamid: t,
  });
}

export function buildSeasonScheduleUrl(leagueId?: number, seasonId?: number) {
  const l = leagueId || LEAGUE_ID;
  const s = seasonId || SEASONS[SEASONS.length - 1]?.id;

  if (!l || !s) {
    throw new Error("Missing leagueId or seasonId when building Pointstreak season schedule URL");
  }

  return buildPartnerUrl("getschedule", {
    leagueid: l,
    seasonid: s,
  });
}

export function buildStandingsUrl(leagueId?: number, seasonId?: number) {
  const l = leagueId || LEAGUE_ID;
  const s = seasonId || SEASONS[SEASONS.length - 1]?.id; // Use last season ID as default if available

  if (!l || !s) {
    throw new Error("Missing leagueId or seasonId when building Pointstreak standings URL");
  }

  return buildPartnerUrl("standings", {
    leagueid: l,
    seasonid: s,
  });
}

export function buildLeagueStatsUrl(leagueId?: number, seasonId?: number) {
  const l = leagueId || LEAGUE_ID;
  const s = seasonId || SEASONS[SEASONS.length - 1]?.id;

  if (!l || !s) {
    throw new Error("Missing leagueId or seasonId when building Pointstreak league stats URL");
  }

  return buildPartnerUrl("stats", {
    leagueid: l,
    seasonid: s,
  });
}

export function buildLeagueBattingLeadersUrl(leagueId?: number, seasonId?: number) {
  const l = leagueId || LEAGUE_ID;
  const s = seasonId || SEASONS[SEASONS.length - 1]?.id;

  if (!l || !s) {
    throw new Error("Missing leagueId or seasonId when building Pointstreak league batting leaders URL");
  }

  return buildPartnerUrl("battingleaders", {
    leagueid: l,
    seasonid: s,
  });
}

export function buildLeaguePitchingLeadersUrl(leagueId?: number, seasonId?: number) {
  const l = leagueId || LEAGUE_ID;
  const s = seasonId || SEASONS[SEASONS.length - 1]?.id;

  if (!l || !s) {
    throw new Error("Missing leagueId or seasonId when building Pointstreak league pitching leaders URL");
  }

  return buildPartnerUrl("pitchingleaders", {
    leagueid: l,
    seasonid: s,
  });
}

export function buildTeamStatsUrl(leagueId?: number, seasonId?: number, teamId?: number) {
  const l = leagueId || LEAGUE_ID;
  const s = seasonId || SEASONS[SEASONS.length - 1]?.id; // Use last season ID as default if available
  const t = teamId || SEASONS[SEASONS.length - 1]?.teamId; // Use last season team ID as default if available

  if (!l || !s || !t) {
    throw new Error("Missing leagueId, seasonId, or teamId when building Pointstreak team stats URL");
  }

  return buildPartnerUrl("getteamstats", {
    leagueid: l,
    seasonid: s,
    teamid: t,
  });
}

export function buildTeamBattingLeadersUrl(leagueId?: number, seasonId?: number, teamId?: number) {
  const l = leagueId || LEAGUE_ID;
  const s = seasonId || SEASONS[SEASONS.length - 1]?.id;
  const t = teamId || SEASONS[SEASONS.length - 1]?.teamId;

  if (!l || !s || !t) {
    throw new Error("Missing leagueId, seasonId, or teamId when building Pointstreak team batting leaders URL");
  }

  return buildPartnerUrl("teambattingleaders", {
    leagueid: l,
    seasonid: s,
    teamid: t,
  });
}

export function buildTeamPitchingLeadersUrl(leagueId?: number, seasonId?: number, teamId?: number) {
  const l = leagueId || LEAGUE_ID;
  const s = seasonId || SEASONS[SEASONS.length - 1]?.id;
  const t = teamId || SEASONS[SEASONS.length - 1]?.teamId;

  if (!l || !s || !t) {
    throw new Error("Missing leagueId, seasonId, or teamId when building Pointstreak team pitching leaders URL");
  }

  return buildPartnerUrl("teampitchingleaders", {
    leagueid: l,
    seasonid: s,
    teamid: t,
  });
}

export function buildBoxscoreUrl(leagueId?: number, seasonId?: number, gameId?: number) {
  const l = leagueId || LEAGUE_ID;
  const s = seasonId || SEASONS[SEASONS.length - 1]?.id;
  const g = gameId;

  if (!l || !s || !g) {
    throw new Error("Missing leagueId, seasonId, or gameId when building Pointstreak boxscore URL");
  }

  return buildPartnerUrl("getboxscore", {
    leagueid: l,
    seasonid: s,
    gameid: g,
  });
}
