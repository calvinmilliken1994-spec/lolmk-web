# ARAM Mayhem saved tournaments

## Routes and operator workflow

- `/tools/mayhem` is the authenticated saved-tournament list.
- Create takes a name and opens `/tools/mayhem?t=<event-id>`. Every tournament has independent players, teams, groups, matches, applications and audit history.
- New tournaments are drafts. Publish/Unpublish controls access through `/tournaments/aram`, `/mayhemlive`, and public signup actions. Admin preview remains available before publication and requires the existing tools session.
- Archive confirms the selection, closes registration, increments the registration generation and freezes the reveal count. All child records and completed results remain intact. Show archived exposes read-only history and permanent Delete.
- Delete requires native confirmation describing the irreversible removal of the selected tournament and its children. It runs transactionally; the event foreign keys cascade players, teams, groups, matches, audit rows and pending applications, whose own foreign key cascades invite slots.
- `/tournaments/aram?t=<event-id>` and `/mayhemlive?t=<event-id>` select exactly that published, non-archived event. A missing explicit event never falls through to another one. Compatibility requests without `t` select the newest published, non-archived event deterministically, with id as the ordering tie-breaker.

## Migration and write safety

Schema migration is additive. It preserves the legacy `mayhem-main` row and every child. A one-time migration marks that existing event published, matching its prior public behavior. Schema setup never inserts an event, including on a cold start after the legacy event has been deleted.

Every Server Action requires an explicit `{eventId, generation}` selection. A request-local `AsyncLocalStorage` operation supplies that exact id to the existing implementation helpers; it is not a global current-event setting. Every mutating action locks the event row and checks existence, archive state and registration generation before writing. All SQL and audit writes in the operation use the same transaction client. Public paths additionally require publication and retain their existing verified-member identity/ownership checks.

Discord send/retry actions release the lock before network delivery. Each later delivery-status write reacquires the lock and revalidates the same selection. If Archive/Delete/Reset wins while delivery is in flight, the already-sent external message cannot be recalled, but no subsequent write can mutate the archived/deleted/reset tournament.

Invite links carry `t` and `g`. Old links without these fields resolve the event and generation from the persisted slot/application, never the compatibility default. Confirmation and decline both verify that the slot belongs to the selected event and to the signed-in recipient.

Public payloads exclude Discord identity fields and withheld team rosters. Venue reveal tiles use anonymous placeholders for unrevealed teams, retaining the total count without shipping hidden team identities. Private preview endpoints require tools auth.

## Isolated verification

These tests use no live database, Discord or production mutations:

```bash
node scripts/test-mayhem-tournaments.mjs
node scripts/test-mayhem-admin-list.mjs
node --experimental-strip-types scripts/test-mayhem-deck-model.ts
```

The PostgreSQL test imports the actual production persistence/actions via TypeScript transpilation and executes actual production DDL and SQL in PGlite. Auth, Discord delivery and Next cache invalidation are stubbed. It covers legacy preservation, no resurrection, named creation, isolation, publication/reveal privacy, archive preservation and denial across all mutation paths, hard-deletion cascades, real database-trigger rollback, invalid/missing/unauthorized/stale selections, reset generation, verified-member signup/withdrawal, pinned invitations and archive-during-delivery bookkeeping.

The JSX test exercises actual list handlers, confirmation cancellation, selected event/generation payloads, archived visibility/deletion, typed error display, named creation navigation, and list-versus-selected-desk page routing.

The model test retains existing deck behavior coverage. These isolated tests do not establish live Discord OAuth, real DM delivery or browser rendering. Any local browser/HTTP verification must use `http://100.114.67.61:3001`.
