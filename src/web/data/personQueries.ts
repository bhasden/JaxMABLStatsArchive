export function buildPeopleIndexSql() {
  return `
SELECT
  people.person_id,
  COALESCE(people.name, MIN(players.name)) AS person_name,
  COUNT(DISTINCT players.player_id) AS player_entries,
  COUNT(DISTINCT players.competition_id) AS competition_count
FROM people
JOIN players ON players.person_id = people.person_id
GROUP BY people.person_id, people.name
ORDER BY LOWER(COALESCE(people.name, MIN(players.name))), people.person_id;
`;
}

export function buildPersonProfileSql(personId: number) {
  return `
WITH competition_names AS (
  SELECT GROUP_CONCAT(short_name, ', ') AS competitions
  FROM (
    SELECT DISTINCT competitions.short_name, competitions.sort_order
    FROM players
    JOIN competitions ON competitions.competition_id = players.competition_id
    WHERE players.person_id = ${personId}
    ORDER BY competitions.sort_order
  ) ordered_competitions
)
SELECT
  people.person_id,
  COALESCE(people.name, MIN(players.name)) AS person_name,
  COUNT(DISTINCT players.player_id) AS player_entries,
  competition_names.competitions
FROM people
LEFT JOIN players ON players.person_id = people.person_id
LEFT JOIN competition_names ON 1 = 1
WHERE people.person_id = ${personId}
GROUP BY people.person_id, people.name, competition_names.competitions;
`;
}

export function buildPersonPlayersSql(personId: number) {
  return `
WITH roster_summary AS (
  SELECT
    rosters.player_id,
    COUNT(DISTINCT rosters.season_id) AS seasons,
    COUNT(DISTINCT rosters.team_id) AS teams
  FROM rosters
  GROUP BY rosters.player_id
)
SELECT
  players.person_id,
  players.player_id,
  players.source_player_id,
  players.competition_id,
  competitions.short_name AS competition,
  players.name AS player_name,
  COALESCE(roster_summary.seasons, 0) AS seasons,
  COALESCE(roster_summary.teams, 0) AS teams
FROM players
LEFT JOIN competitions ON competitions.competition_id = players.competition_id
LEFT JOIN roster_summary ON roster_summary.player_id = players.player_id
WHERE players.person_id = ${personId}
ORDER BY competitions.sort_order, players.name, players.player_id;
`;
}
