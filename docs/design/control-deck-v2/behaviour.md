# Behaviour

What the static screens can't show.

## Primary action (Riftbound)

| Phase / state | Label | Enabled when | Reason shown when blocked |
|---|---|---|---|
| Setup | Open check-in | Basics + Format complete | "Needs: <missing fields>" |
| Check-in | Close check-in & pair Round 1 | ≥ 2 checked-in players | "Need at least 2 players" |
| Round N · draft | Publish Round N | Always (pairings exist) | — |
| Round N · published | Start Round N clock | Always | — |
| Round N · live / time | Close Round N | All tables reported | "X tables outstanding" |
| Round N · closed (not last) | Pair Round N+1 | Always | — |
| Last Swiss round closed | Cut to Top X | Top cut configured | — |
| Top cut match pending | (none; desk works the bracket) | — | — |
| Final reported | Complete event | Always | — |

Undo (Activity log) covers result reports, un-publishing a round with no results, and drops. Cut, Complete and disqualification are one-way and get a confirm dialog.

## Auto-follow (default on)

| Event | Program switches to |
|---|---|
| Round published | Pairings |
| Clock started | Pairings + clock |
| Clock reaches 0 | Time called |
| Round closed | Standings |
| Cut made | Top 8 bracket |
| Event completed | Champion |

Manual TAKE always wins. A manual take pauses auto-follow until the next phase change, so the operator's choice isn't overwritten seconds later.

## Judge reporting flow

1. Judges are normal tools admins (`isToolsSession()`); no separate role. `/tools/riftbound/[slug]/floor` is a phone layout, not a permission boundary.
2. Tap table → score pad → review card → Submit. The review card is the one deliberate confirmation step: both players read it before submit.
3. "Decided on time" defaults on when the round is in the time state.
4. Each submit carries a client idempotency key; the server ignores duplicates. UI shows Sending / Sent / Failed, with retry on failure.
5. If the table already has a result: "Reported by <name> at <time>". Never overwrite silently.
6. Every report stores actor (Discord id + display name). The desk tile and activity log show it.
7. Flags (no-show, judge call, deck check, need head judge) appear in the desk `AlertStrip`. Extensions add per-table time and show on the tile and the time-called scene.

## Venue screen

- Clock is computed from server timestamps (start, paused-at, total paused, per-table extensions), never from a client countdown, following the existing `countdown_ends_at` pattern.
- Pairings sort alphabetically by display name; 3 columns × 11 rows per page; auto-page every 12s when there are more players than fit.
- Standings mid-event: top 16, no cut header. After the final Swiss round: left column header becomes "TOP X · ADVANCING" in `brand-red`.
- Top 8 bracket: higher seed listed first; LIVE tag on the in-progress match; losers dimmed.
- Public projection only: no decklists, no Discord ids.

## Open decisions (confirm before building)

- **Mayhem:** lock "Re-roll teams" once the reveal has started? The design assumes yes.
- **SR:** the queue's "Start next match · room free" assumes matches carry a room. If SR doesn't track rooms, add a nullable `room` column or fall back to "next match in bracket order".
- **Mayhem:** stay single-event (`"main"`) or become multi-event during the port.
