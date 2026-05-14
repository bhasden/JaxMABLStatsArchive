# JaxMABLStatsArchive

This repository is being initialized as the dedicated home for the Pointstreak archive and stats pipeline that was originally built inside `MayportCruisersV2`.

At the time this file was created:

- Source repository: `C:\Users\bhasd\source\repos\MayportCruisersV2`
- Target repository: `C:\Users\bhasd\source\repos\JaxMABLStatsArchive`
- The full raw archive import is actively running in the source repository.
- The next major step is to migrate the archive code out of the website repo and into this repo.

This README is intentionally written as both:

- the initial project brief for this repo
- an LLM handoff document that can be pasted into a fresh coding session

## What This Project Is Supposed To Do

Build a clean, accurate, queryable historical archive of JAX MABL / Mayport-adjacent Pointstreak baseball data in a repository that is separate from the website.

The user explicitly prioritized:

- correctness over backward compatibility
- preserving raw upstream data
- deterministic canonical outputs
- easy, accurate querying
- a clean representation of what Pointstreak actually returned
- no co-mingling of new data or newly calculated metrics with the historical archive

## High-Level Decisions Already Made

### Storage model

- Store raw XML per season and per game as the source of truth.
- Generate canonical NDJSON seed files per table.
- Merge season seed bundles into an all-seasons seed bundle.
- Build a separate SQLite archive database from the merged seeds.
- Keep the archive database separate from the website database.

### Identity rules

- Stable archive team identity is `team_id`; for Pointstreak seasons this is sourced from `teamlinkid`.
- Season-scoped source team IDs are preserved as `season_team_id`, but they are not the canonical cross-season key.
- Players remain competition-scoped canonical entities keyed by `player_id`.
- `people.person_id` is the first-class cross-competition identity layer above canonical players.
- Same-competition player/team merges may combine duplicate stats and history within that competition only.
- Cross-competition person links must never merge batting, pitching, standings, or team-history data across age groups.
- Approved cross-competition rollups are limited to longevity-style identity surfaces.
- Do not infer permanent team affiliation across seasons.
- Players can and do move teams between seasons.

### Upstream semantics

- `stats` and `getteamstats` are full season stat tables.
- `battingleaders`, `pitchingleaders`, `teambattingleaders`, and `teampitchingleaders` are ranking feeds and must remain separate canonical tables.
- `getteamroster` is an official roster feed and must be stored separately from stat-derived participation.

### Historical Pointstreak request rules

- Historical team endpoints must be called with explicit `seasonid`.
- Team endpoints should use the stable `teamlinkid` in the `teamid` parameter.
- If `seasonid` is omitted on some endpoints, Pointstreak silently returns current-season data instead of the historical season.

## Current Source-Repo Architecture

The source repo currently writes and reads data using this layout:

- `data/raw/<seasonId>`: raw XML archive for a season
- `data/raw/<seasonId>/schedule.xml`: season schedule XML
- `data/raw/<seasonId>/game-<gameId>.xml`: individual boxscore XML
- `data/raw/<seasonId>/league/*`: league-wide supplemental XML
- `data/raw/<seasonId>/teams/<teamLinkId>/*`: team-wide supplemental XML
- `data/seeds/<seasonId>`: deterministic season seed bundle
- `data/seeds/all`: merged all-seasons seed bundle
- `data/archive.sqlite`: queryable archive database
- `data/jobs.sqlite`: durable archive job tracking database used by the website admin tools

## Canonical Tables Already In Play

The archive system in `MayportCruisersV2` already supports canonical outputs for the major archive entities, including:

- seasons
- teams
- players
- games
- standings
- lineups
- batting stats
- pitching stats
- innings
- rosters
- season batting stats
- season pitching stats
- season batting leaders
- season pitching leaders

The newer supplemental season tables were added specifically to keep season-level stats, leaderboards, and roster data distinct instead of trying to derive one from another.

## Important Source Files In `MayportCruisersV2`

These are the main files that matter when migrating the archive system into this repo.

### Core Pointstreak helpers

- `src/lib/pointstreak.ts`
  - Centralized Pointstreak URL builders.
  - Includes helpers for schedule, boxscore, standings, league stats, team stats, leaderboards, and rosters.
  - Important recent change: credentials are now read at call time from env, not snapshotted once at module load.

### Raw archive + seed generation

- `src/lib/pointstreak-archive.ts`
  - Fetches raw XML.
  - Archives season schedules, boxscores, and supplemental league/team XML.
  - Generates deterministic season seed bundles.

### Seed merge layer

- `src/lib/archive-seed-merge.ts`
  - Defines the canonical seed tables and required files.
  - Merges season seed bundles into a single all-seasons bundle.
  - Applies reviewed same-competition player/team merges, then assigns reviewed or generated `person_id` values.

### Reviewed identity inputs

Some Pointstreak players and teams have multiple IDs even though they represent the same canonical competition-local entity. Separately, the same human can appear as multiple canonical players across competitions. Neither should be inferred silently during import.

The current workflow is:

- Run `npm run archive:entity-merges-suggest` to generate separate suggestion files under `data/` by default:
  - `data/player-merge-candidates.json`
  - `data/team-merge-candidates.json`
  - `data/person-link-candidates.json`
- Review the suggested player/team groups manually.
- Review the suggested person-link groups manually.
- Copy confirmed player groups into `data/player-merge-approvals.json`.
- Copy confirmed team groups into `data/team-merge-approvals.json`.
- Copy rejected player groups into `data/player-merge-rejections.json`.
- Copy rejected team groups into `data/team-merge-rejections.json`.
- Copy rejected person-link groups into `data/person-link-rejections.json` when you want to suppress a reviewed identity suggestion without creating a confirmed person link.
- Maintain explicit cross-competition person groups in `data/person-link-approvals.json`.
- Re-run the normal seed/database build.

The approved and rejected inputs now have separate responsibilities:

- `data/player-merge-approvals.json` and `data/team-merge-approvals.json` are the only approved inputs allowed to change stat or history ownership, and they must stay within one competition.
- `data/person-link-approvals.json` is a separate first-class identity layer. It links canonical players across competitions under one `person_id`, but it only affects `players.person_id` and the `people` table.
- Canonical players that are not explicitly linked in `data/person-link-approvals.json` become deterministic singleton people during the merged-seed build.

Example player merge:

```json
{
  "merges": [
    {
      "competitionId": "18-plus",
      "canonicalSourceId": 148,
      "aliasSourceIds": [594472, 784824],
      "reason": "Confirmed same 18+ player"
    }
  ]
}
```

Example person links:

```json
{
  "people": [
    {
      "personId": 2,
      "displayName": "Joe Hellett",
      "members": [
        { "competitionId": "18-plus", "canonicalSourcePlayerId": 148 },
        { "competitionId": "30-plus", "canonicalSourcePlayerId": 1372291 },
        { "competitionId": "40-plus", "canonicalSourcePlayerId": 1783209 }
      ],
      "reason": "Confirmed same person across competitions"
    }
  ]
}
```

Candidate detection remains intentionally conservative. Player and team suggestions stay competition-local and must never cross competition levels. Person-link suggestions are separate review aids for cross-competition identity only and must never be used to merge stats or team history across competitions. `npm run archive:entity-merges-suggest` is a review aid, not an automatic merge or person-link decision.

### SQLite archive importer

- `src/lib/archive-db.ts`
  - Builds `data/archive.sqlite` from merged seeds.
  - Includes schema creation and row import logic for all canonical archive tables.
  - Imports `people` before `players` and requires resolved `person_id` values on canonical player rows.

### People and person browsing

The browser UI now treats `Person` as a first-class identity surface:

- `#/people` lists known people across competitions.
- `#/people/<personId>` shows identity-level context plus linked competition-local player entries.
- `#/players/<playerId>` remains the competition-scoped stat page and links back to the related person when `person_id` is present.

Person pages are identity and navigation surfaces, not cross-competition stat aggregates.

### Website-specific orchestration

- `src/lib/archive-job-manager.ts`
  - Durable archive jobs for the admin UI.
  - Useful as reference, but likely not core to this repo unless job orchestration is migrated too.

### CLI entrypoints

- `scripts/pointstreak-single-season.ts`
  - Single-season Pointstreak raw XML archive runner.
  - Prompts before replacing an existing XML file with overwrite, overwrite always, skip, and skip always choices.
- `scripts/pointstreak-all-seasons.ts`
  - Interactive all-seasons Pointstreak raw XML archive runner.
  - Prompts before replacing an existing XML file with overwrite, overwrite always, skip, and skip always choices.
- `scripts/seeds-generate-single-season.ts`
  - Generates one season seed bundle from archived raw XML.
- `scripts/seeds-generate-all-seasons.ts`
  - Generates every configured season seed bundle from archived raw XML.
- `scripts/seeds-merge.ts`
  - Merges season seed bundles into `data/seeds/all`, applies reviewed player/team merges, and assigns person identity.
- `scripts/entity-merges-suggest.ts`
  - Suggests human-reviewable player/team merge candidates and honors reviewed player/team rejection files.
- `scripts/db-build.ts`
  - Builds the SQLite archive DB from merged seeds.
- `scripts/db-build-full.ts`
  - Builds `public/archive.sqlite` from raw XML via season seeds, reviewed player/team merges, reviewed person links, and SQLite import.

### Tests

- `src/lib/pointstreak-archive.test.ts`
- `src/lib/archive-seed-merge.test.ts`
- `src/lib/archive-db.test.ts`
- `src/lib/archive-db-query.test.ts`

## Current Runtime / Tooling Lessons

### Next.js tsconfig vs CLI runtime

The source repo is a Next.js app with:

- `module: "esnext"`
- `moduleResolution: "bundler"`

Those settings are fine for the website, but they caused `ts-node` CLI runtime failures for archive scripts.

To work around that inside the website repo, a dedicated script config was added:

- `tsconfig.scripts.json`
  - `module: "commonjs"`
  - `moduleResolution: "node"`

This was necessary to keep the archive CLIs from falling into Node ESM resolution issues.

### Env loading lesson

`ts-node` does not automatically load Next.js `.env.local` files.

To fix that in the source repo:

- `scripts/pointstreak-all-seasons.ts` now calls `loadEnvConfig(...)` from `@next/env` before requiring env-dependent modules.
- `scripts/pointstreak-single-season.ts` now does the same.
- `src/lib/pointstreak.ts` now reads credentials at call time so late-loaded env vars are respected.

### CommonJS script scope lesson

Because the scripts were converted to CommonJS-style runtime imports under a shared TypeScript project, they needed `export {};` at the top level so TypeScript treats them as modules and does not merge their top-level declarations into one global script scope.

## Pointstreak Credentials

Pointstreak access must come from environment variables.

Use:

- `POINTSTREAK_USERNAME`
- `POINTSTREAK_PASSWORD`

Important:

- Do not hardcode these values in source files.
- Do not bake them into permanent repository code paths.
- The literal credential values are intentionally not written into this README.
- In the source repo, the CLI scripts now support loading them from `.env.local` and also support explicit CLI overrides for the interactive all-seasons script.

## Supplemental Endpoints Already Added

The archive effort expanded beyond schedule + boxscore and now also archives:

- league-wide `stats`
- league-wide `standings`
- league-wide `battingleaders`
- league-wide `pitchingleaders`
- team-wide `getteamstats`
- team-wide `teambattingleaders`
- team-wide `teampitchingleaders`
- team-wide `getteamroster`

This data is stored as raw XML and then normalized into the canonical season seed tables described above.

## Validated Behavior In The Source Repo

Before creating this handoff, the following had already been validated in `MayportCruisersV2`:

- `npx vitest run src/lib/pointstreak-archive.test.ts src/lib/archive-seed-merge.test.ts src/lib/archive-db.test.ts src/lib/archive-db-query.test.ts`
  - passed previously with 4 files / 9 tests
- `npx tsc --noEmit`
  - passed previously in the website repo after the archive changes
- `npm run archive:pointstreak-all-seasons -- --help`
  - works after the script runtime fixes
- `npm run archive:pointstreak-all-seasons`
  - reaches live archive execution and prompts between seasons
- `scripts/pointstreak-all-seasons.ts`
  - confirmed to load Pointstreak credentials from `.env.local` when shell vars were explicitly removed
- `scripts/pointstreak-single-season.ts`
  - confirmed to load Pointstreak credentials from `.env.local` when shell vars were explicitly removed

## Current State At Time Of Handoff

- The source repo contains a working raw archive flow.
- The source repo contains deterministic season seed generation.
- The source repo contains all-seasons seed merging.
- The source repo contains archive SQLite import logic.
- The source repo contains website-specific admin/job tooling around the archive.
- The source repo is still the place where the archive code currently lives.
- The user is now running the full raw archive import and wants to begin moving this work into this dedicated repository.

## Recommended Migration Order

When continuing this work in `JaxMABLStatsArchive`, the cleanest order is probably:

1. Create a standalone Node + TypeScript project structure in this repo.
2. Move the pure archive library code first.
3. Move the archive CLI scripts next.
4. Move and re-run the focused test suites.
5. Move seed merge logic.
6. Move SQLite import logic.
7. Decide whether website-specific job/admin tooling belongs here or should stay behind in `MayportCruisersV2`.

## Strong Recommendation For This New Repo

This new repo should probably not inherit unnecessary Next.js coupling from the website repo.

A better shape here is likely:

- plain Node + TypeScript
- dedicated archive-focused tsconfig
- direct env loading with something lightweight such as `dotenv`
- archive-specific scripts and tests
- no dependency on website admin routes or Turbopack-era workarounds unless truly needed

One example: the source repo uses `sql.js/dist/sql-asm.js` partly because of Next.js bundler constraints. In this dedicated archive repo, that decision can be revisited on technical merit instead of website bundler compatibility.

## What To Tell A New LLM Session

If you start a fresh LLM session in this repo, a good opening instruction is:

> This repository is the new dedicated home for the Pointstreak archive system that currently lives in `MayportCruisersV2`. Use this README as the migration handoff. Start by scaffolding a standalone Node/TypeScript archive project and migrate the raw archive library, scripts, and focused tests first.

## Why This Is In `README.md`

Because this repository was essentially empty, a root `README.md` is the most standard place for an initial handoff document.

If this repo becomes long-lived, a better follow-up structure would be:

- keep `README.md` short and project-facing
- move detailed migration notes into `docs/`
- add `AGENTS.md` or `copilot-instructions.md` for persistent agent guidance

For now, this single README is the right bootstrap artifact.

## Additional information about this website and what we're trying to make

I want this to be a static, navigable website that has the stats and content driven by browser-side rendering of data from the backing sqlite database. The raw XML files should be used to generate the seed NDJSON data via an npm script and then the NDJSON should be used to generate the SQLite db, also using an npm script. The pulling of Pointstreak data for the XML files isn't necessary since that API is going away and will be unavailable soon. This website will be served by GitHub pages in the JaxMABLStatsArchive repo. Additionally, I want a page where someone can do raw SQL queries against the database to try to do their own research.

One neat feature would be if the website would remember the last XX queries that were run (either through the raw SQL query page or just by browsing through the website). Ths would allow users to browse the website and then use the queries for some of the pages as baseline queries for doing additional, more complex work.

Some of the data being requested to show on the site isn't available directly in the raw data and will need to be calculated (for example, lifetime stats for players) using queries, views (materialized or otherwise), or calculated and saved to the DB (stored in tables separate from the archived pointstreak data). Additionally, try to make the various pages of the website as interlinked as possible. For example, the leaders pages should then link out to the players page, which would then list season stats and those season standing pages would be linked to the relevant seasons.

### League-wide pages

- Seasons list with roll-up stats of teams, games played, total players, etc. (maybe league-wide batting average, ERA, etc.)
- Rollup of all season stats (total number of unique teams based on teamlinkid including names and name history, total games played, total players, lifetime leaders in games played, avg, era, etc.)

Note: Let's come up with some interesting ideas here for historical style data and calling out highlights for the history of the league.

### Season-wide pages

- Standings (also used as "home page" for season)
- Leaders (batting leaders for AVG, HR and RBI; pitching leaders for W, SO, and ERA)
- Schedule
- Teams

Note: Again, let's come up with some interesting ideas here.

### Team pages

Leaders within team for same set of batting and pitching stats (also used as "home page" for team)
Stats
Schedule
Roster

Note: Once again, let's come up with some interesting ideas here. Maybe some stuff that cuts across multiple seasons or something like that.

### Player pages

Lifetime batting and pitching stats
Season batting and pitching stats
Game log patting and pitching stats (paginated)

### Known issues in data

Pointstreak does not calculate ERA properly in all instances. It does not properly account for the convention of using .1/.2 as representations for 1/3rd and 2/3rd of an inning in pitching stats. We can provide corrected ERA values if we want, but again, it will need to be stored separately from the archived pointstreak data if we pre-calculate the corrected value and want to store it.

### Known issues with the website

- For the individual game page, the batting lineup includes players who weren't in the batting lineup (looks like folks who pitched). However, sometimes pitchers are in the lineup and I'm unsure who to tell who to show/include.
- For games where a pitcher (maybe anyone) was announced in a lineup spot but never got an at bat, they're included in the lineup and batting stats, but Pointstreak is removing them from their rollups. See Collin Taylor, game 496360 as an example and compare his lifetime stats rollup in Pointstreak. Game 496360 was his only batting annoucement that season, but does not show in his Pointsreak batting stats/lineup. It's possible this was a situation where the batter never completed their at-bat and was at-plate for the last out of the game happening on the base paths. It's also possible that he was never supposed to be entered into the stats as a batter since he never completed an at-bat. Either way, I decided to leave this situation alone and allow his lone phantom at-bat to rollup into his 2019 batting stats instead of filtering it out like Pointstreak does because he's actually in batting stats for the season, even if he never completed an official at-bat. Another example is Jimmy Raupp for game 611050.

### Resources

- Special thanks for Paul Miller, past league president for his backup of the 2008-2010 stats.
- Thanks to the [SqlCeToolbox](https://github.com/ErikEJ/SqlCeToolbox/) project. The Export2SqlCE tool was used to work with the legacy 2008-2010 MSSQL backup and extract stats and other relevant information for this archive.
