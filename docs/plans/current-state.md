# Current State — Implementation Handoff

Read this after `CLAUDE.md` and before opening `implementation-plan.md`. This file is a
handoff/state snapshot, not an architecture document — do not add design rationale here.

## Next task

**T27 — DiffEngine: since-last-check**
Objective: implement architecture §F.5 exactly in `api/src/diff/engine.ts` — adjustment first
(via T26's `factorBetween`), suppression short-circuit on `hasUnsupportedAction`, then adjusted
baseline, absolute/percentage change, elapsed time, sessions elapsed (via T18's calendar),
volatility multiple, unseen-change list, and propagated (never recomputed) freshness. Emits
`comparison_status ∈ { OK, SUPPRESSED_CORPORATE_ACTION, AWAITING_BASELINE, INSUFFICIENT_HISTORY }`.
Depends on T26, T18, T16.

## Completed

T1–T26 (Phase 0–5 start: workspace/toolchain, contracts, worker/API skeletons, auth, watchlist
CRUD, job queue, provider adapter, market-state persistence, bars/calendar/FeatureExtractor,
dedupe keys, the eight detectors, Scoring v1, ChangeAssembler v1, Publisher, shared template
explanation, AdjustmentPolicy read side).

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

- **AdjustmentPolicy read side (T26) shape:** `factorBetween(client, instrumentId, fromVersion,
  toVersion)` in `api/src/diff/adjustment.ts` reads `corporate_actions` where `version_seq` is in
  `(fromVersion, toVersion]` (exclusive/inclusive — a row exactly at `fromVersion` is excluded, so
  `factorBetween(id, v, v)` is always the identity regardless of what's stored at version `v`).
  Multiplies only `is_supported` actions' `adjustment_factor` into the returned `factor`; an
  unsupported action in range sets `hasUnsupportedAction: true` but never blocks the multiply of
  supported ones, and is always the caller's cue to suppress the comparison entirely (that
  short-circuit is T27's job, not this function's). `effective_date` is cast to `text` in SQL
  (`effective_date::text`) before being wrapped with `toSessionDate` — avoids relying on
  `pg`'s default `DATE` → JS `Date` (UTC-midnight) parsing, which is one more implicit conversion
  than necessary here. Takes `Pool | PoolClient` directly (no repo-wrapper module) since this is a
  single read query, matching `market/repo.ts`'s style, not `watchlists/repo.ts`'s.
- **API DB-backed test role split (established by T26, applies to all future API DB tests):** the
  `stockwatch_api` role is SELECT-only on worker-owned tables (`corporate_actions`,
  `instrument_signals`, `change_records`, `instrument_market_state`, `instrument_bars`,
  `market_events` — see T6 grants). Any test needing to *seed* rows in those tables must open a
  second pool against `TEST_DATABASE_URL` (superuser) for setup/fixture writes, while the function
  under test still runs against the `DATABASE_URL` (`stockwatch_api`) pool — see
  `api/test/adjustment.test.ts` for the pattern. `describeWithDb` must gate on **both** env vars
  being set when a test needs this split.

## Files/contracts for T27 (DiffEngine — since-last-check)

- Create: `api/src/diff/engine.ts`
- Test: `api/test/diff.engine.test.ts`
- Read first: `api/src/diff/adjustment.ts` (T26 — call `factorBetween` first, per §F.5),
  `packages/contracts/src/calendar.ts` (T18 — session-counting for `sessions_elapsed`),
  `api/src/market/envelope.ts` (T16 — where `data_freshness` already lives; propagate, don't
  recompute).
- Plan section: `docs/plans/implementation-plan.md` T27 (search `#### T27`).

## Verification for T27

```bash
cd api
npx tsc --noEmit
npx vitest run test/diff.engine.test.ts
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

T26 (AdjustmentPolicy read side). `api/src/diff/adjustment.ts` + `api/test/adjustment.test.ts`
(4/4). `npx tsc --noEmit` passes (pre-existing unrelated `exactOptionalPropertyTypes`/strict-null
errors remain in `auth/routes.ts`, `auth/session.ts`, `db.ts`, `watchlists/{repo,resolve,routes}.ts`
— present on `main` before this task, not introduced by it). Full `api` suite: 95/96 — the one
failure is the pre-existing documented `auth.session.test.ts` transactional-client isolation bug
below, unrelated to T26.

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

**Fixed test-isolation bug (was "known blocker" as of T26 handoff):**
- `api/test/auth.session.test.ts`, `T8 — requireSession middleware` describe block previously
  seeded the session/user via a transactional `client` (`BEGIN`, never committed within the test),
  but the actual HTTP request goes through `requireSession(pool)` — a different connection that
  cannot see the uncommitted rows — so the request 401'd instead of succeeding. Fixed by seeding
  fixtures as committed writes directly on `pool` and cleaning them up with explicit `DELETE`s in
  `afterEach`, instead of a rolled-back transaction (that pattern only works when the code under
  test also runs on the same transactional client, as in the other two `describeWithDb` blocks in
  this file). Full `api` suite is 96/96 after this fix (run against a freshly truncated DB — see
  "stale rows" note above; a `route_test@example.com`-style fixed-email collision from a prior run
  can otherwise cause one unrelated `auth.routes.test.ts` failure).
