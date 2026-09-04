# Current State — Implementation Handoff

Read this after `CLAUDE.md` and before opening `implementation-plan.md`. This file is a
handoff/state snapshot, not an architecture document — do not add design rationale here.

## Next task

**T26 — AdjustmentPolicy read side (identity case)**
Objective: `factorBetween(instrument, fromVersion, toVersion)` reads `corporate_actions` in range
and returns `{ factor, hasUnsupportedAction, actions[] }`; identity case (no actions) returns
factor `1`. This is the first API-side task (`api/src/diff/adjustment.ts`) — split math itself
arrives later in T33.

## Completed

T1–T25 (Phase 0–4: workspace/toolchain, contracts, worker/API skeletons, auth, watchlist CRUD,
job queue, provider adapter, market-state persistence, bars/calendar/FeatureExtractor, dedupe
keys, the eight detectors, Scoring v1, ChangeAssembler v1, Publisher, shared template
explanation).

## Implementation decisions already made (do not re-derive)

- **Detector version:** one `DETECTOR_VERSION = 1` constant covers all eight predicates
  (`worker/src/signals/detectors.ts`). Bump it, don't add per-signal versions.
- **Zero-variance guard:** `VOLATILITY_ADJUSTED_MOVE` and `SIGNIFICANT_GAP` suppress (do not fire)
  when `sigma20` is zero, rather than treating any nonzero move as an infinite multiple.
- **`VOLUME_ACCELERATION` "rising":** defined as non-decreasing across the 3 sessions
  (`today >= yesterday >= day-before`), not strictly increasing.
- **`MarketEvent` / `CorporateAction` DTOs** live in `packages/contracts/src/dto.ts` (added in
  T21) — provider-neutral, mirror the `market_events` / `corporate_actions` tables. Detectors
  receive them pre-scoped to "new this cycle" by the caller; they don't query the DB themselves.
- **Evidence values are strings** (`toWireString`) or booleans only, per INV-9 — never raw
  Decimal/number in `SignalEvidence.evidence`.
- **DB-backed tests** follow the existing `describeWithDb` pattern (`process.env.DATABASE_URL ?
  describe : describe.skip`) — see known blocker below.
- **Scoring v1 ramp constants (T22):** §G only spells out ramps for signals 1 and 5; the other six
  were designed to match that pattern (threshold → 0, threshold+headroom → 1) rather than being
  quoted from the architecture doc. See `worker/src/assembly/scoringV1.ts::signalStrength` for the
  exact per-signal headrooms (e.g. `LARGE_ABSOLUTE_MOVE`/`SIGNIFICANT_GAP` saturate at 2× their
  emission threshold; `RANGE_BREAKOUT` ramps on extension past the 20-session range as a fraction
  of that range; `EARNINGS_RELEASED` is always strength 1; `CORPORATE_ACTION_APPLIED` is 1 if
  `is_supported`, else 0 (suppressed, not guessed)). Revisit only with a deliberate calibration
  change, not silently while doing T23+.

- **ChangeAssembler v1 (T23) shape:** `assembleSignals(existingRecords, newSignals)` in
  `worker/src/assembly/assembler.ts` is a pure function — no DB access. `ChangeRecordDraft` (worker-
  internal, not a `packages/contracts` DTO) mirrors the `change_records` columns needed for grouping:
  `id` (null until persisted), `publishedSeq` (null until sealed), `assemblyVersion`, `sessionDate`,
  `latestAt`, `signals`. A record is a valid group target only if `publishedSeq === null` AND
  (`signal.sessionDate === record.sessionDate` OR within 6h of `record.latestAt`); otherwise a new
  draft opens. Persisting drafts / diffing against DB rows is not yet wired — that lands with the
  Publisher (T24) or a dedicated persistence step, since T23 only had to prove grouping+sealing logic.

- **Shared template explanation (T25) shape:** `renderSharedExplanation(signals)` in
  `worker/src/explanation/template.ts` picks the dominant `PhenomenonGroup` (via `scoreSignals`,
  reusing T22's group weights — a group with no member signals is never chosen as dominant), then
  the highest-`signalStrength` signal within it, then renders that signal's fixed per-`SignalType`
  template by interpolating its `evidence` fields verbatim (no arithmetic, no unit conversion —
  e.g. fractions are not turned into "%"). `scoringV1.ts`'s `scoreSignals`/`signalStrength`/
  `GroupScore` were retyped from `SignalEvidence` to the narrower `ScorableSignal` (`Pick<...,
  'signalType' | 'evidence'>`) since that's all scoring ever reads — this lets the Publisher build
  the input straight from `instrument_signals` DB rows without fabricating an unused
  `dedupeKey`/`marketTimestamp`/`sessionDate`. `publishChangeRecord` (T24) now reads that record's
  `instrument_signals` rows and stamps `shared_explanation`/`renderer_version` in the same UPDATE
  that assigns `published_seq` — a record with zero signals gets `NULL`/`NULL`, not a thrown error.

## Files/contracts for T26 (AdjustmentPolicy read side)

- Create: `api/src/diff/adjustment.ts`
- Test: `api/test/adjustment.test.ts`
- Plan section: `docs/plans/implementation-plan.md` T26 (search `#### T26`).
- This is the first API-side task in this handoff sequence — read `api/src/db.ts` (if present) or
  the existing `api/src/` pattern for pool/query conventions before assuming they match `worker/`'s.

## Verification for T26

```bash
cd api
npx tsc --noEmit
npx vitest run test/adjustment.test.ts
```

## Local Postgres access (env vars now automated via direnv)

`direnv` is installed and hooked into `~/.bashrc` (`eval "$(direnv hook bash)"`). `worker/.envrc`
and `api/.envrc` (both gitignored) export the correct `DATABASE_URL`/`TEST_DATABASE_URL` for each
package automatically on `cd` — no more manually re-exporting per shell. This was added because
the sandbox's global `~/.bashrc` already exports an unrelated `DATABASE_URL` (points at a
different project's `amr_rag` database) — do not change that global export; the per-directory
`.envrc` files override it locally instead. If a new shell doesn't pick up the right
`DATABASE_URL`, run `direnv allow` in `worker/` or `api/` (direnv refuses unreviewed `.envrc`
files by default).

## Last completed task

T25 (Shared template explanation). `worker/src/explanation/template.ts` +
`worker/test/explanation.shared.test.ts`, plus the `publisher.ts` (T24) wiring above.
`npx tsc --noEmit` passes; full worker suite 82/82 against a real local Postgres instance (see
"DB environment" below).

## DB environment (resolved — was previously a blocker)

A local Postgres 16 is now running natively (not via `docker-compose.yml`; the Docker daemon in
this sandbox is unreachable). Setup used:
- DB: `stockwatch`, owned by role `stockwatch` (superuser, password `stockwatch`) — mirrors the
  docker-compose `POSTGRES_USER`/`POSTGRES_PASSWORD` defaults and is the right role for
  superuser-ish test setup (creating/dropping rows across all tables) and for running migrations.
- Migrations applied via `DATABASE_URL=postgres://postgres:5002@localhost:5432/stockwatch npx tsx
  api/src/migrate.ts` (or any superuser).
- `worker` test suite: run with `DATABASE_URL=postgres://stockwatch:stockwatch@localhost:5432/stockwatch`.
- `api` test suite needs **two** roles: `DATABASE_URL` set to the `stockwatch_api` role (the
  app's real runtime role — required for `tracking.test.ts`'s permission-boundary test) and
  `TEST_DATABASE_URL` set to the `stockwatch` superuser (used by `schema.test.ts`/`grants.test.ts`,
  which run `runMigrations` themselves and need elevated privilege). Role passwords match role
  names per `db/migrations/0002_roles.sql` (e.g. `stockwatch_api:stockwatch_api`).
- Tests leave rows behind on failure (fixed emails/idempotency keys in a few files aren't always
  timestamped) — a stale row can cause unrelated tests to fail on the next run. If a suite reports
  unexpected failures, `TRUNCATE users, sessions, watchlists, watchlist_items,
  user_instrument_checkpoints, instruments, instrument_tracking, jobs RESTART IDENTITY CASCADE;`
  (as the `stockwatch` superuser) before re-running.

**Bugs found and fixed while first getting these DB-backed tests to actually run (T5/T6/T13 —
predate T24, never previously exercised against a live DB):**
- `db/migrations/0002_roles.sql`: two `GRANT INSERT (...)`/`GRANT UPDATE (...)` column-grants on
  `instrument_tracking` were missing `ON instrument_tracking`, making them invalid statements
  (parsed as role grants, not table grants) — migrations couldn't apply at all.
- Same file: a `GRANT ... ON SEQUENCE instrument_market_state_id_seq` referenced a sequence that
  doesn't exist (`instrument_market_state`'s PK is `instrument_id`, not a `BIGSERIAL id`).
- `db/migrations/0001_init.sql`: `change_records_published_seq_unique` used
  `UNIQUE NULLS NOT DISTINCT (instrument_id, published_seq)`, which wrongly forbids more than one
  *unpublished* (`published_seq IS NULL`) draft per instrument — contradicting the architecture's
  stated assembler behavior (multiple unpublished drafts may coexist before the Publisher seals
  them one at a time). Fixed by dropping `NULLS NOT DISTINCT` (default: NULLs are distinct from
  each other; real `published_seq` values still can't repeat per instrument).
- `worker/src/jobs/queue.ts`: `drainOne`'s `ROLLBACK` on a handler throw undid `claimJob`'s
  `attempts = attempts + 1` increment, and `failJob` never re-wrote the `attempts` column in its
  own (post-rollback) transaction — so `attempts` silently reset to 0 after every failure, forever.
  Fixed by having `failJob` write `attempts = $N` explicitly in both its PENDING and FAILED
  branches, since it may be the only durable writer of that value.

**Known bug found, not yet fixed (flag before touching T8/auth session tests):**
- `api/test/auth.session.test.ts`, `T8 — requireSession middleware` describe block: the test
  inserts the session/user via a transactional `client` (`BEGIN`, never committed within the
  test), but the actual HTTP request goes through the route's separate `pool` — a different
  connection that cannot see the uncommitted rows — so the request 401s instead of succeeding.
  Test-isolation bug, not a product bug; every other test in the file passes.
