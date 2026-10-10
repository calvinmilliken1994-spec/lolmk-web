# Riftbound tournament tool, v1 spec

## Scope

- Individual-player (1v1) Swiss with an optional single-elim top cut. The data model must not block 2v2 teams later.
- Multi-tournament, like SR (not a single event like Mayhem), so past events can feed the Hall of Champions.
- Rules source: Riftbound Tournament Rules dated 2026-07-16. Verify against Riot's official document before changing any rule here.

## Format defaults (configurable per event)

- Match: best of 3 (best of 1 available). Round length 60 min. Top cut has no time limit.
- Swiss rounds: "Auto" until Round 1 is paired, then fixed from `suggestedRoundsForPlayers()` in `src/lib/timer-schedule.ts`. The remaining round count stays editable until the final round is paired.
- Top cut "Auto": none for 4–6 players, top 4 for 7–16, top 8 for 17+. Options: none / 4 / 8.
- Power-pair the final Swiss round: on by default.
- Rules enforcement level (OPL): Casual by default. It must be Casual whenever staff are playing.
- Deck registration in v1: Legend name only, optional. No decklists.

## Scoring

- Match points: win 3, draw 1, loss 0.
- Result storage: games won by A, games won by B, drawn games, a `decided_on_time` flag.
- A game draw doesn't count toward the 2 wins. A time-out with equal game wins is a match draw. Intentional draws are allowed (reported as Draw).
- Bye: counts as a match win, recorded as 2–0 (configurable). Byes are excluded from opponents' win-percentage calculations.
- Tiebreakers in order: OMW%, GW%, OGW%, then random. Store the random seed so standings can be reproduced.
- Win-percentage floor: 0.33 (configurable), applied to MW% and GW% when computing opponent averages.

## Pairing

- Round 1: random, using a stored seed.
- Later rounds: maximum-weight matching across the whole field, not greedy top-down pairing.
  - Rematches are forbidden whenever a rematch-free pairing exists.
  - Minimise the match-point gap between opponents.
  - Penalise giving a second bye.
- Bye: the lowest-ranked player who hasn't had a bye yet, when the player count is odd.
- Final round with power pairing on: pair by rank (1v2, 3v4, ...), skipping rematches where possible.
- The operator may swap players in a draft round. The engine warns on rematches or point mismatches. Every override is audited.

## Round lifecycle

`draft → published → live → closed`

- "Time" is NOT stored. It's derived: a table is in time when now ≥ its end time (round end plus any table extension).
- A round can't close while any table has no result. The next round can't be paired until the current one is closed.
- Drops flagged on a result take effect before the next pairing. Dropped players are never paired again.
- Un-publishing a round is allowed only while it has no results.

## Clock

- Server timestamps only: `started_at`, `paused_at`, `paused_total_ms`, `duration_ms`, plus a per-match `extension_ms`. Never a client countdown.
- Clients compute the remaining time from these timestamps (same pattern as `countdown_ends_at` in `sr-db`).

## Top cut

- Use `buildKnockoutBracket` in `src/lib/bracket-engine.ts` with `single_elim`, seeded from the final Swiss standings (1 vs N).
- The higher seed is listed first and chooses who plays first in game 1.
- If a player drops after the cut, nobody replaces them; their opponent advances.

## Judges and auth

- Judges are normal tools admins (`isToolsSession`). There is no separate judge role.
- The floor view is a phone layout, not a permission boundary.
- Every mutation records the acting admin (Discord id + display name, from `getCurrentAdmin()`).
- Each match stores `reported_by` and `reported_at`.
- Result submissions carry a client idempotency key, and the server ignores duplicates.
- Reporting a table that already has a result fails with "Reported by <name> at <time>". Never overwrite silently.

## Data (Postgres, `rb_` prefix, following `sr-db.ts` conventions)

- `rb_tournaments`: slug, name, status, config jsonb, scene, auto_follow, timestamps.
- `rb_players`: display_name, member_discord_id (nullable, same guest/verified model as Mayhem), legend (nullable), status (`registered | checked_in | active | dropped | dq`), dropped_after_round.
- `rb_rounds`: number, stage (`swiss | top_cut`), status, clock fields, pairing_seed.
- `rb_matches`: round_id, table_number, player_a, player_b (null = bye), games_a, games_b, games_drawn, decided_on_time, extension_ms, status, reported_by_id, reported_by_name, reported_at, idempotency_key (unique), flags jsonb.
- `rb_audit_log`: tournament_id, action, detail jsonb, actor_discord_id, actor_name, created_at.
- Keep real-event records for at least 3 months (appeals). Provide a CSV/JSON export of games and matches.
- Admins can explicitly hard-delete test tournaments after a permanent-delete confirmation. This removes players, rounds, matches, audit entries and the champion history in one transaction. Archive remains the normal history-preserving option; archived records can be shown in the admin list for review or cleanup.

## Routes

- Desk: `/tools/riftbound` (list) and `/tools/riftbound/[slug]`.
- Floor (judges): `/tools/riftbound/[slug]/floor`.
- Venue screen: `/rblive/[slug]`. Supports `?scene=<id>&preview=1`, a client-side scene override for the desk's Preview frame that never writes anything.
- Public page: `/tournaments/riftbound/[slug]` with "find my table".
- APIs: mirror `/api/sr/state` (public projection) and `/api/sr/admin-state`.

## Public projection

- Never expose Discord ids, decklists, flags or audit data publicly.
- Use the `toPublic*` mapper pattern from `sr-db.ts`.

## Auto-follow (stored on the tournament, applied server-side inside actions)

- Round published → `pairings`.
- Clock started → `pairings_clock`.
- Round closed → `standings`.
- Cut made → `top_cut`.
- Event completed → `champion`.
- Clock expiry needs no write: the venue screen renders the `time-called` scene by itself when the program scene is `pairings_clock` or `clock` and the round end has passed.
- A manual scene change pauses auto-follow until the next phase change.

## Out of scope for v1

- 2v2.
- Decklist registration and validation.
- Player self-reporting.
- Penalty tracking beyond free-text flags.
