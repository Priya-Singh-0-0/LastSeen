# Current State — Implementation Handoff

Read this after `CLAUDE.md` and before opening `implementation-plan.md`. This file is a
handoff/state snapshot, not an architecture document — do not add design rationale here.

## Next task

All of T1–T39 are implemented and committed. Remaining work, if any, is post-T39: the optional
model-renderer stretch goal (§7), or picking up any gap this handoff flags below.

## Completed

T39 (Correctness gate sweep). `.github/workflows/ci.yml` (fresh-Postgres service, migrate →
typecheck → lint → per-workspace tests → gate sweep) + `test/gates.test.ts` (new root-level
vitest, `vitest.config.ts`, `vitest` added as a root devDependency) + `package.json`'s `test`
script now chains the root gate sweep after `--workspaces`; Modified `README.md`.
- **The checklist test is a plain file-scanning script, not a DB/app-level integration test:**
  `test/gates.test.ts` hardcodes the §6 gate table (18 entries) and, per gate, either greps
  every `*.test.ts`/`*.test.tsx` file under `api/test`, `worker/test`, `web/test`,
  `packages/contracts/test` for an unskipped `describe`/`it`/`test` call whose title contains
  the gate's canonical name (`hasUnskippedTitle` — regex-matches `(describe|it|test)(.skip|
  .todo)?(...)`, only counts a match when no `.skip`/`.todo` group was captured), or — for the
  two gates identified by filename rather than a title (`importBoundary.test.ts`,
  `grants.test.ts`) — confirms the file exists and contains at least one unskipped test. No AST
  parsing; a false negative is possible if a gate name is split across a template literal, but
  every real gate test in this codebase uses a plain string title.
- **Real gap found and fixed by this checklist, per its own stated purpose:** three gates
  existed as real, passing, behaviorally-correct tests but under titles that didn't contain the
  gate table's canonical name string — `worker/test/dedupe.keys.test.ts`'s `describe('dedupe
  keys', ...)` → `describe('dedupe_keys_are_deterministic_and_class_correct', ...)`;
  `api/test/checkpoint.repo.test.ts`'s `'a replayed acknowledgement (same watermark) is a
  no-op'` → prefixed with `'ack_replay_is_noop — '`; `worker/test/detectors.test.ts`'s
  `'price/volume predicates emit nothing under INSUFFICIENT_HISTORY'` → prefixed with
  `'insufficient_history_emits_no_price_signals — '`. No behavior changed, only titles —
  confirmed by re-running both suites in full afterward (worker 109/109, api 167/167).
- **Also found and fixed while making `npm run lint` gate-clean (a prerequisite for
  "CI is green," not previously enforced since no CI existed to enforce it):** the 11
  pre-existing `worker` eslint errors every handoff since T33 had been carrying forward as
  "unrelated" are now fixed, all root-cause not suppressed — `worker/src/db.ts`'s
  `1700 as any` (unnecessary, same as the equivalent `api/src/db.ts` fix from before T35);
  three genuinely-unused type/value imports (`normalize/validate.ts`'s `parseDecimal`,
  `provider/fixture.ts`'s `UtcTimestamp`/`MarketStatus`/`ValueKind`/`DataFreshness`); one
  intentionally-unused interface-shaped parameter (`normalize/selector.ts`'s `_obs`, given a
  targeted `eslint-disable-next-line` with a comment explaining the §7 seam, since no
  `argsIgnorePattern` convention exists elsewhere in this repo to lean on instead); four
  genuinely-unused local variables in `worker/test/jobs.queue.test.ts` (an unused `query`
  import, three `const id = await insertJob(...)` where the id was never read — the test
  already re-derives the id it needs from `claimJob`'s return value).
- **CI role split mirrors local dev, not a new convention:** the workflow does not attempt a
  single `npm test` run with one shared `DATABASE_URL` — `api`'s tests need the restricted
  `stockwatch_api` role (matching production) plus a superuser `TEST_DATABASE_URL` for
  fixture setup on worker-owned tables (T26's established split), while `worker`'s tests need
  to write market-fact tables directly and so run under the superuser role instead (matching
  the `worker/.envrc` convention documented above). `packages/contracts`'s
  `enums.consistency.test.ts` also needs a live DB (reads `pg_type` after migrations create
  the enums) and runs under the superuser role for the same reason. Each gets its own
  workflow step with its own `env:`, run after one shared `npm run migrate -w api` against the
  fresh service-container Postgres — not the single literal `npm test` the plan prose
  describes, since that would require collapsing a role separation CLAUDE.md treats as
  load-bearing. The root `package.json` `"test"` script (`npm run test --workspaces &&
  vitest run`) still exists for local single-command convenience; it only produces a fully
  green run locally when `DATABASE_URL`/`TEST_DATABASE_URL` are set correctly for every
  workspace in the invoking shell (unchanged pre-existing limitation — see "direnv only fires
  in interactive shells" below), not a CI regression.
- **Verification:** `npm run typecheck` clean across all 4 workspaces. `npm run lint` — 0
  errors (previously 11). `cd worker && direnv exec . npx vitest run` — 109/109. `cd api &&
  direnv exec . npx vitest run` — 167/167. `DATABASE_URL=... npx vitest run -w
  packages/contracts` — 25/25. `npm test -w web` — 22/22. Root `npx vitest run` (the gate
  sweep) — 17/17, all 18 gates covered (`importBoundary.test.ts`/`grants.test.ts` share one
  file-existence check each, `provider_normalization_golden_files` and the others matched by
  title). No `.github/workflows/ci.yml` run yet observed on GitHub Actions itself (this
  handoff only verifies every step locally against the same fresh-migrated Postgres the
  workflow targets) — flagging this as the one unverified link for whoever reviews the first
  real CI run after this push.

## Previously completed

T38 (Demo seed). `db/seeds/demo.sql` + `api/src/seed.ts` (the "single command", `npm run seed
-w api`) + `worker/test/fixtures/demo/{corporate-action,market-event}.json` + `api/test/
demoSeed.test.ts` + `worker/test/demoFixtures.test.ts`; Modified `README.md`,
`api/package.json`, `api/src/instruments/routes.ts`.
- **Seed shape:** one PL/pgSQL `DO` block, set-based per ticker (no per-day loop — bars are
  generated via `generate_series` + a deterministic sine-wave walk, keyed only by row number
  and ticker length, so the file has no external randomness dependency). ~33 real, liquid
  tickers (chosen for demo recognizability, not fetched — every synthetic row carries
  `source = 'seeded'`) get exactly 400 daily bars each, ending at the most recent trading day
  at-or-before seed-apply time (`CURRENT_DATE`, rolled back over a weekend) — not a fixed date,
  so the seed never goes stale relative to when it's actually run. `market_status =
  'CLOSED'`/`value_kind = 'SESSION_CLOSE'` throughout (never `OPEN`) so T36's freshness decay
  (which only downgrades an `OPEN` market) can never make seeded data look stale no matter how
  long after seeding a demo/test actually runs.
- **Three "interesting" instruments, one demo user, one watchlist, uniform checkpoint policy:**
  every seeded instrument gets a checkpoint baselined at the bar **two sessions before the
  latest** (`OFFSET 2`, not a literal calendar "two days" — guarantees a real trading-session
  bar exists regardless of weekends), `baseline_corporate_action_version = 0`,
  `seen_through_publication_seq = 0`. TSLA and GME additionally get `published_seq = 1` bumped
  onto their `instruments` row plus a hand-written `change_records`/`instrument_signals` pair
  (score/band/evidence set directly, not derived by running the real detector/scoring pipeline
  — this seed stands in for ingestion history, it doesn't replay it) so they have real unseen
  changes. AAPL's `instruments.corporate_action_version` is set to `1` at creation time (not
  bumped later) with a matching `corporate_actions` row (`SPLIT`, factor `0.25`,
  `is_supported = true`), while its checkpoint keeps the uniform `baseline_corporate_action_
  version = 0` — this mismatch is what makes `factorBetween` apply the split adjustment for
  real when the instrument detail route runs, without any special-cased "pretend this is
  unseen" logic. AAPL's checkpoint `baseline_price` is deliberately the bar-2-sessions-back
  close **× 4** (bars are stored already split-adjusted, matching how a real provider backfills
  history) — i.e. the pre-split price the user would actually have seen, exactly mirroring
  T34's regression scenario (`$180` pre-split baseline vs. `$46`-scale current price) with real
  seeded numbers instead of hand-picked literals.
- **Real bug found and fixed while wiring the acceptance test through the actual HTTP route:**
  `GET /instruments/:id` (`api/src/instruments/routes.ts`) computes `diff.adjustmentLabels`
  (T34) but never spread it into the response — the split label existed in `DiffResult` and
  was asserted at the unit level (`split.regression.test.ts`) but silently dropped before
  reaching the wire. No test had exercised the full HTTP route with an unsupported-vs-supported
  version mismatch until this task's seed did. Fixed with one added conditional spread line,
  same convention as every other optional `diffFields` entry.
- **`comparisonStatus` for the seeded AAPL split is `INSUFFICIENT_HISTORY`, not `OK` — this is
  correct, not a seed bug.** `GET /instruments/:id` always passes `sigma20: null` (a
  pre-existing, already-documented gap — see the T30 addendum above: `FeatureExtractor` isn't
  wired into any ingestion/persistence path yet, so no read path has a real `sigma20` to
  offer). Per T27, `INSUFFICIENT_HISTORY` still carries the real `percentageChange`/
  `adjustmentLabels` — only `volatilityMultiple` is omitted — so the split adjustment is
  genuinely exercised end-to-end regardless. The acceptance test asserts `INSUFFICIENT_HISTORY`
  explicitly (with a comment pointing here) rather than loosening to "any non-suppressed
  status," so a future fix to the `sigma20` gap that changes this to `OK` will be a deliberate,
  visible test update, not a silent pass-through.
- **Test isolation:** `api/test/demoSeed.test.ts` never touches the shared dev/test database.
  The seed is not idempotent (fixed demo-user email, fixed real-looking tickers that could
  collide with other tests' `instrument_symbols` rows), so the test creates a disposable
  `stockwatch_demo_seed_test_<timestamp>` database via a superuser admin pool, runs
  `runMigrations` + `runDemoSeed` against it, and drops it (`WITH (FORCE)`) in `afterAll`.
  **Found and fixed a pool leak while building this:** `runMigrations`/`runDemoSeed` both call
  `api/src/db.ts`'s `getPool()` — a module-level singleton — internally; failing to `.end()`
  that pool before the `FORCE` drop left a lingering superuser connection that Postgres killed
  out from under it, logging a spurious (but harmless) `[db] unexpected pool error` on every
  run. Fixed by explicitly ending that singleton's pool and calling `_resetPool()` before
  creating the test's own `stockwatch_api`-role pool against the scratch database.
- **`worker/test/fixtures/demo/*` role:** two small JSON fixtures documenting the seeded AAPL
  split and TSLA earnings event in provider-neutral shape, plus `worker/test/
  demoFixtures.test.ts` pinning `demo.sql`'s hand-written literals (the `0.25` factor, the
  `CORPORATE_ACTION_APPLIED:SPLIT:<date>:0.25` dedupe-key format) against the real
  `classifyCorporateAction`/`corporateActionDedupeKey`/`earningsDedupeKey` functions — so a
  future change to classification rules or dedupe-key format fails here instead of silently
  drifting from what `demo.sql` assumes. `effective_date`/`event_ts` are computed relative to
  seed-apply time in `demo.sql`, so the fixtures record the *relationship*
  (`daysBeforeLatestSession: 60`, `fiscalPeriod`) rather than a literal date.
- **Verification:** `cd api && direnv exec . npx vitest run` — 167/167 (3 new in
  `demoSeed.test.ts`). `cd worker && direnv exec . npx vitest run` — 109/109 (3 new in
  `demoFixtures.test.ts`). `npx tsc --noEmit` clean in both. `npx eslint src test` clean in
  `api`; `worker` has the same 11 pre-existing errors as before this task (`db.ts`,
  `normalize/selector.ts`, `normalize/validate.ts`, `provider/fixture.ts`, `test/
  jobs.queue.test.ts`), none in the two new files.

## Previously completed

T1–T37 (Phase 0–5: workspace/toolchain, contracts, worker/API skeletons, auth, watchlist
CRUD, job queue, provider adapter, market-state persistence, bars/calendar/FeatureExtractor,
dedupe keys, the eight detectors, Scoring v1, ChangeAssembler v1, Publisher, shared template
explanation, AdjustmentPolicy read side, ack token mint/verify, checkpoint repository monotonic
upsert, instrument detail GET and acknowledge POST, inbox read model/ranking/personal explanation,
inbox/detail UI with evidence drill-down — basic pass, visual polish deferred to impeccable;
Phase 6: split detection and AdjustmentPolicy write side, split-adjusted comparison across a
checkpoint, unsupported-action suppression; Phase 7: freshness lifecycle and staleness labelling,
AlpacaAdapter on the official Node SDK). T38 (demo seed) is detailed above as "Previously
completed" alongside T39's full entry under "Completed" — the definition of done (§8) is now
met: every task T1–T39 is committed with its tests passing, every §6 gate maps to a passing
named test (enforced by T39's sweep, not just asserted in prose), and CI runs from a clean
clone in one workflow trigger.

## Pre-existing `api` tsc/eslint cleanup (done between T34 and T35, not a numbered task)

All `tsc --noEmit`/`eslint src test` errors that earlier handoffs had been carrying forward as
"pre-existing, unrelated" are now fixed — `npx tsc --noEmit` and `npx eslint src test` are both
clean in `api`. Root causes, not suppressions:
- **`noUncheckedIndexedAccess` array-index errors** (`auth/routes.ts`, `auth/session.ts`,
  `watchlists/{repo,resolve,routes}.ts`): every site was a `rows[0]` access TS couldn't narrow —
  either a guaranteed-single-row `INSERT ... RETURNING` (fixed with a `rows[0]!` plus a comment
  recording the invariant) or a `rows.length > 0`/`=== 0` guard that TS's control-flow analysis
  doesn't apply to indexed access (fixed with a `!` after the already-performed length check, or by
  destructuring into a `const row = rows[0]; if (row === undefined) ...` where an early return was
  natural). `auth/routes.ts`'s login handler was actually restructured (`valid = user !== undefined
  && ...`, then `if (!valid || user === undefined) return 401`) so TS narrows `user` for real,
  rather than asserting past it.
- **`src/db.ts`'s `1700 as pg.TypeId`:** `pg.TypeId` isn't a public export of `@types/pg` (it's an
  internal alias inside `type-overrides.d.ts`); `setTypeParser`'s oid parameter already accepts a
  plain `number`, so the cast was both invalid and unnecessary. Removed.
- **eslint unused-import/var errors** (`auth/middleware.ts`'s `HookHandlerDoneFunction`; several
  test files' `beforeEach`/`afterEach`/`client`/`query`/`loginRes`/`ts` locals): all were genuine
  dead code (a `client`-based `BEGIN`/`ROLLBACK` isolation pattern that never actually isolated
  anything — see below — or leftover copy-paste), removed rather than suppressed.
- **`api/test/inbox.test.ts`'s two `as any` casts:** replaced with a narrow inline type for the
  dynamically-imported `package.json` shape instead of `any`.

**Real bug found and fixed while doing this: `auth.routes.test.ts` never actually isolated its
tests.** It used the same `beforeEach`/`afterEach` `BEGIN`/`ROLLBACK`-on-a-dedicated-`client`
pattern that T26's handoff already diagnosed and fixed once in `auth.session.test.ts`'s
`requireSession` suite — the request path goes through `app.inject`, which queries via `pool`
directly (a different connection that never sees the transactional client's uncommitted rows, and
whose own writes commit immediately regardless of what the client does). So every fixed-email
`register` call in this file (`route_test@example.com`, `dup@example.com`, `logintest@example.com`,
`badpw@example.com`, `logout_test@example.com`) permanently wrote a row that broke the *next* run
of the suite with a spurious 409 — this is the "stale rows" failure mode the DB-environment note
below already warned about, just not previously root-caused for this specific file. Fixed the same
way as the `requireSession` suite: dropped the client/BEGIN/ROLLBACK entirely, fixtures now commit
directly on `pool`, and a real `afterEach` does `DELETE FROM users WHERE email = ANY($1)` over the
fixed-email list. Verified by running `test/auth.routes.test.ts` three times back to back with no
manual truncation in between — all green every time. Full `api` suite: 158/158.

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

- **DiffEngine (T27) shape:** `computeSinceLastCheck(input)` in `api/src/diff/engine.ts` is a
  **pure function** — like T23's `assembleSignals`, it does no DB access itself. It takes an
  already-computed `AdjustmentResult` (T26's `factorBetween`, run by the caller beforehand), an
  already-bounded `unseenChanges` list (the caller's own query, `published_seq > seen_through`),
  and a `holidays` set (the caller's own query against `exchange_holidays`). This is deliberate:
  T31's inbox route must run this per watchlist item while staying at exactly two total queries, so
  the engine itself must not issue any I/O — batched fetching is the caller's concern (T30 for a
  single instrument, T31 for a bounded list). Order of checks mirrors §F.5's pseudocode:
  `AWAITING_BASELINE` (no baseline price/timestamp) short-circuits before `SUPPRESSED_CORPORATE_ACTION`
  (`adjustment.hasUnsupportedAction`), before the real arithmetic. `comparison_status` has a fourth
  value not spelled out in the §F.5 pseudocode text, `INSUFFICIENT_HISTORY` — used when
  `current.sigma20` is `null` (FeatureExtractor's own `bars_available < 20` gate, T19). This is a
  **judgment call, not an architecture quote**: `INSUFFICIENT_HISTORY` only omits
  `volatilityMultiple` — `absoluteChange`/`percentageChange`/`adjustedBaseline` are still returned,
  since the raw price comparison doesn't need a volatility baseline to be meaningful. Revisit only
  with a deliberate decision, not silently while wiring T30/T31. A zero `sigma20` or a
  `sessionsElapsed` of `0` also omits `volatilityMultiple` (divide-by-zero guard, same pattern as
  the worker's zero-variance detector guard) without changing `comparisonStatus` away from `OK`.
- **`exchange_holidays` grants gap (found and fixed while building T27):** `db/migrations/
  0003_exchange_calendar.sql` created the table before `0002_roles.sql`'s roles existed to grant
  against it, so neither role could `SELECT` from it. Added `db/migrations/
  0004_exchange_holidays_grants.sql` granting `SELECT` to both `stockwatch_api` and
  `stockwatch_worker` — it's a shared reference table (T18: "one calendar implementation, imported
  by both processes"), not user- or market-observation data, so this doesn't cross INV-2/INV-3.

## Implementation decisions already made (T33 addendum)

- **`CorporateActionCandidate` is a new worker-internal shape, not the `CorporateAction` DTO.**
  `worker/src/adjustment/index.ts` defines `CorporateActionCandidate` (instrumentId, actionType,
  effectiveDate, optional adjustmentFactor, source) — deliberately missing `isSupported`/
  `versionSeq`, since those are assigned by the write side, never by the caller. No
  `ProviderAdapter` method produces this yet (that's T37's job, gated on its capability-
  verification step); T33 only builds the classify+persist seam so T37 has somewhere to feed real
  Alpaca corporate-action data once it exists.
- **Classification (`classifyCorporateAction`) is pure and file-scoped to `adjustment/index.ts`:**
  only `actionType === 'SPLIT'` *with* a factor present is supported; anything else (a merger, or
  a `SPLIT` candidate missing a factor) is unsupported with no factor, never guessed (§F.6).
- **`version_seq` numbering is per-instrument and covers every action, supported or not** — reused
  `instruments.corporate_action_version` as the counter, locked `FOR UPDATE` and incremented in
  the same transaction, mirroring the Publisher's `last_published_seq` pattern (T24) exactly. This
  is required for T34/T35's `factorBetween`/suppression logic, which need a single monotonic
  version axis to walk a checkpoint-to-current range regardless of action type.
- **Idempotency is checked application-side, not solely via the DB unique constraint.** The
  `corporate_actions` unique constraint (`instrument_id, action_type, effective_date,
  adjustment_factor`) doesn't catch duplicate unsupported actions (NULL factor is distinct from
  NULL by default), so `persistCorporateAction` does its own `SELECT ... adjustment_factor IS NOT
  DISTINCT FROM $4` lookup before inserting, inside the same lock — a repeat candidate of any kind
  returns the existing row and leaves `corporate_action_version` untouched.
- **DATE columns are cast to `::text` in SQL rather than parsed from the pg driver's JS `Date`
  object**, to avoid a timezone-round-trip footgun (no existing code path in this repo reads a
  `DATE` column back into a `SessionDate` string, so there was no established pattern to follow) —
  narrower and more local than adding a global type-parser override in `worker/src/db.ts` (which
  would repeat T24's `1700` NUMERIC-parser pattern but wasn't necessary here).
- **Verification:** `cd worker && DATABASE_URL=postgres://stockwatch:stockwatch@localhost:5432/
  stockwatch npx vitest run` — 91/91 (7 new in `test/splits.test.ts`: 3 pure classification cases,
  4 DB-backed — version bump, idempotent re-ingest, unsupported merger, and a
  `CORPORATE_ACTION_APPLIED` signal wired through the existing T21 detector). `npx tsc --noEmit`
  clean (required dropping `adjustmentFactor: undefined` in favor of omitting the key, since
  `exactOptionalPropertyTypes` is on). `npx eslint src test` — same 11 pre-existing errors as
  before (`db.ts`, `normalize/selector.ts`, `normalize/validate.ts`, `provider/fixture.ts`,
  `test/jobs.queue.test.ts`), none in the three new files. Also found and cleared a pre-existing
  stale-rows DB state (see "stale rows" note below) that was failing `jobs.queue.test.ts` before
  this task's changes were even present — unrelated to T33, confirmed by re-running that file in
  isolation before truncating.

## Implementation decisions already made (T32 addendum)

- **Scope: basic pass only, visual polish deferred.** The user asked for a working T32 build
  now (TDD, via `superpowers`), with visual refinement to follow later through the `impeccable`
  design skill. `web/PRODUCT.md` was written (platform `web`; user is a casual retail investor,
  not a day trader; brand name is **LastSeen**, user-facing — the codebase/docs keep the working
  name "Stockwatch" internally; visual direction pinned by the user as "CoinGecko Android app
  style", dark-first, with sparklines called out as a keeper for a future pass) but no DESIGN.md/
  surface brief exists yet — that's the next impeccable session's job, not redone here.
  `web/src/styles.css` is a deliberately basic dark, card-list stylesheet (CoinGecko-inspired
  palette/rhythm) wired into both pages; it is presentational only and intentionally not
  TDD-covered (no behavior to test), same exception class as a config file.
- **Component shape:** `web/src/types.ts` defines wire-shape types (`InboxResponse`,
  `InstrumentDetailResponse`, `EnvelopeWire`, `UnseenChangeWire`, `SignalWire`, etc.) matching
  the *actual* JSON emitted by `api/src/inbox/routes.ts` (T31) and
  `api/src/instruments/routes.ts` (T30) verbatim — not `packages/contracts`' internal
  `Decimal`/`UtcTimestamp` types, since those never cross the wire as anything but strings.
  `AttentionBand`, `EnvelopeBadge`, `EvidencePanel` are pure presentational components: every
  financial value, band, freshness label, and evidence entry is rendered as given, with zero
  arithmetic — enforced by the test suite (`web/test/inbox.test.tsx`, 18 cases) asserting exact
  API-shaped fixture values appear verbatim in the DOM.
- **Known API gap surfaced, not fixed (out of T32's file scope):** neither the inbox nor the
  instrument-detail route returns a `symbol`/`name` for an instrument — only `instrumentId`.
  T32's UI has nothing to render as a human-readable label yet; this is a pre-existing gap in
  T30/T31's response shape (confirmed by grepping `api/src/**` for `symbol` — it only appears in
  watchlist add/resolve, never in the read routes), not something a UI-only task should silently
  patch. Flagging for whoever picks up polish: likely needs a `symbol` column joined into both
  routes' queries.
- **`EvidencePanel` renders what the API actually returns, not the plan prose's exact wording.**
  Implementation-plan T32 text says the evidence panel exposes "inputs, thresholds, group,
  strengths, and the final band" — but `instrument_signals`/`UnseenChangeWire.signals` (T30's
  actual shape) carries `signalType`, `detectorVersion`, `dedupeKey`, `evidence` (key/value),
  and `marketTimestamp`; `PhenomenonGroup` and per-signal `strength` are never persisted or
  returned anywhere in this codebase (scoring is ephemeral, computed at publish time only to
  produce `band`/`score` on the *record*, T31 addendum). Rendered the band/score at the
  change-record level (where they actually live) and every evidence key/value verbatim — not
  fabricated per-signal group/strength fields.
- **`InstrumentDetail` acknowledge wiring:** `onAcknowledge: () => void` is an injected callback,
  not an inline `fetch` — matches this codebase's DI-heavy style (ack token mint/verify, diff
  engine, etc. all take collaborators as params). Fires at most once per mount, guarded by a
  `useRef` latch: on explicit "Mark as read" click, or on unmount if there were unseen changes
  and the button was never clicked. No GET/mount-time fire — matches "no GET mutates user state."
  Wiring the real `POST /instruments/:id/acknowledge` call and ack-token plumbing is left to
  whoever adds routing/data-fetching (no `App.tsx`/router exists yet; out of T32's file list).
- **Dependencies added:** `web/package.json` devDependencies gained `jsdom`,
  `@testing-library/react`, `@testing-library/jest-dom` (none existed before this task — no
  component could be rendered/tested without them). Tests are annotated
  `// @vitest-environment jsdom` per-file (existing `vitest.config.ts` default is `node`).
- **Verification:** `cd web && npx vitest run` — 19/19 (18 new + T1's smoke test).
  `npx tsc --noEmit` — clean. `npx eslint web/src web/test` — clean. `npx vite build` fails
  (`Could not resolve entry module "index.html"`) — expected, not a regression: no app entrypoint
  exists yet, and T32's file list never included one.

## Implementation decisions already made (T31 addendum)

- **Publisher gap found and fixed while building T31:** `score`/`band` are `change_records`
  columns and the architecture text is explicit that they're assigned in the same publish step
  as `published_seq` (§F.3: "score = noisy-OR over phenomenon groups (§G); band =
  threshold(score)"), but `publishChangeRecord` (T24) only ever stamped `shared_explanation`/
  `renderer_version` — `score`/`band` were silently left `NULL` forever. Fixed in
  `worker/src/assembly/publisher.ts`: computes `scoreSignals(signals)` (already imported for
  `renderSharedExplanation`'s dominant-group pick) and stamps `score`/`band` in the same UPDATE,
  `NULL`/`NULL` for a zero-signal record — same pattern as the shared-explanation null case. This
  was necessary, not optional, because T31's primary ranking key (`max unseen band, max unseen
  score`) reads directly off these two columns; ranking every item as `(null, null, ...)` would
  have made the ranker untestable against real data. Two new cases added to
  `worker/test/publisher.test.ts`.
- **Inbox route (T31) shape:** `registerInboxRoutes(app, pool)` (`api/src/inbox/routes.ts`, `GET
  /watchlists/:id/inbox`) — no ack-token secret needed (this route never mints/verifies a token).
  Two queries total: `fetchItemJoin` (watchlist ⨝ items ⨝ instruments ⨝ market_state ⨝
  checkpoints, all `LEFT JOIN`ed **starting from `watchlists`**, not `watchlist_items` — this is
  what lets one row distinguish "watchlist not found/not owned" (zero rows) from "found but
  empty" (one row, `instrument_id IS NULL`) without a separate ownership query) and
  `fetchUnseenChanges` (one `UNNEST`-based query joining a per-instrument watermark array against
  `change_records`, windowed `ROW_NUMBER() ... PARTITION BY instrument_id ORDER BY published_seq
  DESC` capped at `UNSEEN_LIMIT_PER_INSTRUMENT = 20`). `instrument_signals` is never joined here —
  the inbox only needs `band`/`score`/`shared_explanation`, already columns on `change_records`;
  the evidence drill-down is T32's detail view, not this route.
- **Two judgment calls made to hold the 2-query budget (both suppress-rather-than-guess, same
  spirit as T30's `sigma20: null`), documented in a header comment in `inbox/routes.ts`:**
  - **No `factorBetween` call.** If a checkpoint's `baseline_corporate_action_version` still
    equals the instrument's current `corporate_action_version` (both plain columns already in the
    item-join row), the adjustment is the identity (T26: `factorBetween(id, v, v)` is always
    identity — proven, not assumed). If they differ, this route cannot verify without a
    `corporate_actions` query, so it sets `hasUnsupportedAction: true` unconditionally — the
    comparison is suppressed (`SUPPRESSED_CORPORATE_ACTION`) rather than guessed. The detail view
    (T30) is unaffected and still computes the real adjusted number with its own (unbounded)
    query budget.
  - **No `exchange_holidays` query.** `holidays: []` is passed into `computeSinceLastCheck`, so
    `sessionsElapsed` may overcount by the (typically 0-2) exchange holidays inside the window.
    This never changes `comparisonStatus` and doesn't affect the ranking's dominant key
    (band/score) — it only slightly overstates the personal clause's session count and the
    de-weighted `|move|` tiebreaker.
- **PersonalRanker (`api/src/ranking/ranker.ts`) shape:** pure function `rankInboxItems(items)`
  over `RankableItem<T>` (`{ item, maxUnseenBand, maxUnseenScore, sinceCheckMove,
  dataFreshness }`), stable descending sort by `(bandRank, score, |move|)`. `maxUnseenBand`/
  `maxUnseenScore` are computed as **independent maxes** across an instrument's unseen records
  (not necessarily from the same record) — a literal reading of "(max unseen band, max unseen
  score, ...)" as two separate maxima, not "the record with the highest band, and that record's
  score." An instrument with zero unseen changes gets `maxUnseenBand: null`, which sorts below
  every real band (rank `-1`). **Staleness de-weight is a judgment call, not an architecture
  quote:** `STALE`/`UNAVAILABLE` items have their entire sort key (band rank, score, move) scaled
  by a flat `0.5` before comparison — chosen so a stale `URGENT` item still generally outranks a
  quiet fresh one, while a comparably-important fresh item can win. `DELAYED` is not de-weighted
  (only `STALE`/`UNAVAILABLE`, matching F.5's "If freshness is STALE or UNAVAILABLE").
- **Explanation composition (`api/src/explanation/{personalTemplate,renderer}.ts`) shape:**
  `renderPersonalClause(input)` switches on `ComparisonStatus` (reusing T27's engine.ts type, not
  redefining it) — `AWAITING_BASELINE`/`SUPPRESSED_CORPORATE_ACTION` render a clause with **no
  digits at all** (asserted in the test), `OK`/`INSUFFICIENT_HISTORY` interpolate
  `sessionsElapsed`/`percentageChange` verbatim via `toWireString` (no arithmetic, no "%" — same
  no-unit-conversion rule as T25's shared-template renderer). `composeExplanation(input)`
  concatenates the dominant unseen record's stored `shared_explanation` (highest-score record
  among that instrument's unseen set; `null` if there is no unseen record with one) with the
  personal clause — falls back to just the personal clause when there's nothing shared to
  compose with. Both are pure, no DB, no model — matching F.7's "always template-generated by the
  API."
- **Verification:** `cd worker && npx vitest run` — 84/84 (2 new publisher cases).
  `cd api && npx tsc --noEmit` — same pre-existing unrelated strict-null errors as before, none in
  `inbox/`, `ranking/`, or `explanation/`. `cd api && npx vitest run test/inbox.test.ts` — 6/6;
  full `api` suite 154/154 (fresh truncate before each run — see "stale rows" note).

## Implementation decisions already made (T30 addendum)

- **Instrument/checkpoint routes (T30) shape:** `registerInstrumentRoutes(app, pool,
  ackTokenSecret)` (`api/src/instruments/routes.ts`, `GET /instruments/:id`) and
  `registerCheckpointRoutes(app, pool, ackTokenSecret)` (`api/src/checkpoints/routes.ts`, `POST
  /instruments/:id/acknowledge`) take the ack-token secret as an explicit third parameter rather
  than calling `loadConfig()` internally — matches T28's established DI-heavy style (`mint`/
  `verify` already take the secret as a param) and means these route modules don't require
  `SESSION_SECRET`/`PORT`/etc. to be present just to register routes in a test. `server.ts`'s
  `buildApp` now takes `ackTokenSecret` as a second parameter and passes
  `config.ACK_TOKEN_SECRET` at the real entry point.
- **Ownership check (INV-15):** `GET /instruments/:id` authorizes via `EXISTS` on
  `watchlist_items ⨝ watchlists WHERE user_id = session AND instrument_id = :id` — the same
  "instrument is on one of this user's watchlists" test used by `instrument_tracking`
  (T12's `onItemAdded`/`onItemRemoved`). Unowned/unknown instrument → 404, matching the
  never-reveal-existence convention from T10's watchlist routes. This is a read-only check; it
  does **not** call `ensureCheckpoint` — that only happens after ownership passes.
- **POST /acknowledge authorization is the ack token itself**, not a separate ownership query:
  `verify()` already scopes the token to `session.user_id` and the path `:id` (T28), so a
  mismatched user or instrument fails signature/scope verification. This returns **403** (not
  404) — deliberately different from the watchlist routes' 404 convention, because the failure
  here is "this token doesn't authorize this action" (an auth/token-scope response), not
  "resource doesn't exist for you." Both conventions satisfy `cross_user_authorization_denied`
  (§O.7 item 5); they're just not the same status code, and that's intentional — see the two new
  cases added to `api/test/watchlists.authz.test.ts`'s T10 authorization suite (§O.5 gate).
- **`sigma20` has no persistence path anywhere in this codebase yet** — not a T30-specific gap.
  `worker/src/features/index.ts`'s `extractFeatures` is a pure function only exercised by
  `worker/test/features.test.ts`; no job handler in `worker/src/jobs/` calls it, and no DB column
  stores its output (checked `instrument_market_state`, `instrument_bars`, `instrument_signals` —
  the closest thing is `sigma20` embedded inside a fired signal's `evidence` JSONB, which is
  per-signal-firing, not a general current-value store). Since architecture assigns "shared market
  intelligence" computation to the worker only (CLAUDE.md), and the API must not import worker
  code, `GET /instruments/:id` passes `current.sigma20: null` to `computeSinceLastCheck` — this is
  the suppress-rather-than-guess pattern (same as `SUPPRESSED_CORPORATE_ACTION`), not a bug: it
  yields `comparisonStatus: INSUFFICIENT_HISTORY` (not a false `OK`) until a future task wires
  `extractFeatures` into a real ingestion job and persists its output somewhere the API can read
  (likely a new nullable column on `instrument_market_state`, written by the worker at the same
  cycle that runs `FeatureExtractor` today only in tests). Flagging this explicitly since T31's
  ranking (`|since-check move|`, staleness de-weight) does not need `volatilityMultiple`, but any
  future consumer that does will hit the same null.
- **Response shape (not architecture-mandated, a judgment call):** `GET /instruments/:id` returns
  `{ instrumentId, comparisonStatus, dataFreshness, current, ...diffFields, unseenChanges,
  ackToken }`. `current` reuses T16's `assembleEnvelope`/`envelopeToWire` verbatim (no new
  envelope-construction code) and is `null` when WARMING (no market state row yet — `ensureCheckpoint`
  still runs and creates a null-baseline checkpoint in this case, matching T29's warming
  behavior). `unseenChanges` is `[]` on an unpublished/warming instrument, each entry carrying its
  `signals` array (the "evidence" — `signalType`, `detectorVersion`, `dedupeKey`, `evidence`,
  `marketTimestamp` verbatim from `instrument_signals`, per INV-9: evidence values are already
  strings/booleans in the DB, not re-derived here).
- **`servedWatermark`** is `MAX(unseenChanges[].publishedSeq)` when there are any, else the
  checkpoint's current `seenThroughPublicationSeq` unchanged (nothing new was rendered, so
  acknowledging is a safe no-op via T29's `GREATEST`). Computed with `BigInt` comparison, not
  string comparison (published_seq strings aren't zero-padded).
- **T30 does not have T31's two-query budget** — `GET /instruments/:id` issues one query each for
  ownership, the instrument row, the checkpoint (`ensureCheckpoint`), market state, corporate
  actions (`factorBetween`), change records, signals, and holidays (8 total). That budget is
  specific to the inbox route (F.4: "two bounded queries for the whole page regardless of user
  count"), which fans out per watchlist item — T30 is a single-instrument detail view with no such
  constraint in the architecture doc.

## Verification for T30 (all pass)

```bash
cd api
npx tsc --noEmit   # same pre-existing unrelated strict-null errors as before T30, none in new files
npx vitest run test/acknowledge.test.ts       # 5/5
npx vitest run test/watchlists.authz.test.ts  # 9/9 (2 new T30 cases)
npx vitest run                                # 134/134 (full api suite)
```

## Implementation decisions already made (T29 addendum)

- **Checkpoint repository (T29) shape:** `api/src/checkpoints/repo.ts` exports `getCheckpoint`,
  `ensureCheckpoint`, `advanceCheckpoint` — no class wrapper, `Pool | PoolClient` params, same
  style as `watchlists/repo.ts`. `ensureCheckpoint` is one `INSERT ... SELECT ... FROM (instruments
  LEFT JOIN instrument_market_state) ON CONFLICT (user_id, instrument_id) DO NOTHING RETURNING`,
  falling back to a plain `SELECT` when the conflict fires (already exists) — this is what makes
  "same instrument in two watchlists" and "re-add after removal" share one row for free: the table
  has no FK to `watchlist_items`, so removal was never capable of deleting the row, and a second
  `ensureCheckpoint` call just hits the `DO NOTHING` branch. `advanceCheckpoint` is a single
  `UPDATE ... SET seen_through_publication_seq = GREATEST(existing, $servedWatermark)`, with the
  three baseline columns (`baseline_price`/`baseline_market_timestamp`/
  `baseline_corporate_action_version`) gated behind one shared `CASE` condition: `incoming
  baselinePrice IS NOT NULL AND (servedWatermark > existing OR existing baseline_market_timestamp
  IS NULL OR incoming baselineMarketTimestamp > existing)`. The `IS NOT NULL` guard on the incoming
  price is a judgment call, not an architecture quote — it exists so a token minted while still
  `AWAITING_BASELINE` (null baseline) can never clobber an already-established baseline; only the
  very first acknowledgement legitimately carries a null baseline, and there's nothing worth
  overwriting with in that case. Returns `null` (not a throw) when no checkpoint row exists yet,
  matching `watchlists/repo.ts`'s not-found convention — T30's acknowledge route calling this
  without a prior `ensureCheckpoint` would be a caller bug, not an expected runtime state.

## Implementation decisions already made (T28 addendum)

- **Ack token (T28) shape:** `mint(input, secret, now?)` / `verify(token, sessionUserId,
  pathInstrumentId, secret, now?)` in `api/src/checkpoints/ackToken.ts` take the secret and an
  injectable `now: UtcTimestamp` (defaulting to `nowUtc()`) as explicit params — no hidden
  `loadConfig()` read inside the module — matching this codebase's DI-heavy pure-function style
  (`factorBetween`, `computeSinceLastCheck`) and making the "wrong secret" and "expired token"
  tests trivial without mocking the clock. Token format: `base64url(JSON payload).base64url(HMAC-
  SHA256 signature)`. Wire JSON keys are camelCase (not the architecture prose's `snake_case`
  `user_id`-style names) since the payload is an opaque internal blob, never inspected outside
  this module, and camelCase matches every other DTO in this codebase. `bigint` fields
  (`userId`, `instrumentId`, `servedWatermark`) are stringified for JSON, `Decimal` via
  `toWireString`; both are reconstructed on verify. Signature comparison uses
  `crypto.timingSafeEqual` after an explicit length check (mismatched-length buffers throw).
  No token table, no revocation list, no cleanup job — nothing is written or read from the DB.

## direnv only fires in interactive shells

`~/.bashrc` registers the direnv hook, but that hook only runs for *interactive* shells
(`PS1` set). A non-interactive `bash -c "cd worker && ..."` invocation never triggers it, even
though `cd`ing there manually in a terminal works fine — so `DATABASE_URL` silently falls back to
whatever the global environment has (wrong user/db), producing confusing auth errors that look
unrelated to env setup. Fix: run `direnv exec <dir> <command>` explicitly instead of relying on
`cd` when running commands non-interactively.

`worker/.envrc` also now exports `ALPACA_API_KEY_ID`/`ALPACA_API_SECRET_KEY` (paper-trading
credentials) — worker-only, per CLAUDE.md's "Market-provider credentials belong only to the
worker runtime." Never add these to `api/.envrc`.

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

T37 (AlpacaAdapter on the official Node SDK). Live capability spike first (per the plan's
mandatory Step 1), combining the official docs (`docs.alpaca.markets/us/docs/getting-started-
with-alpaca-market-data`, followed to `llms.txt` for reference pages) with real calls against the
paper account: snapshots ✓ (`GET /v2/stocks/snapshots`), historical daily bars ✓ (`GET
/v2/stocks/bars`), corporate actions/splits ✓ (`GET /v1/corporate-actions`, confirmed against
AAPL's real 2020 4-for-1 split), earnings/calendar events ✗ (no such endpoint exists at any tier —
only a deprecated, non-earnings-specific announcements endpoint). Findings recorded in `README.md`
("Alpaca capability verification (T37)"); the earnings gap is the documented justification for
T38's seeded-events fallback with `source: seeded`.
- **`worker/src/provider/alpaca/dto.ts`**: Alpaca-shaped raw types only (`AlpacaBar`,
  `AlpacaSnapshot`/`AlpacaSnapshotMap`, `AlpacaClock`) — not exported past this directory.
- **`worker/src/provider/alpaca/client.ts`**: the *sole* file importing `@alpacahq/alpaca-trade-
  api` (INV-13/INV-17), enforced by a new source-scan boundary test in the contract test file
  (recursively greps `worker/src/provider/**/*.ts` for `@alpacahq/` import strings — a
  finer-grained, file-level companion to T4's package-level import-boundary test).
  `createAlpacaClient(options)` wraps `new Alpaca({ keyId, secret, paper: true, fetchApi })`
  (`fetchApi` is test-only, letting tests stub HTTP responses with zero live network calls). The
  SDK's own proactive rate limiter (~200 req/min per host) and default retry/backoff (3 attempts,
  exponential 250ms–5s, on 429/5xx) are used at their documented defaults rather than
  reimplemented — this *is* "a global token bucket and backoff on 429/5xx" per T37's requirement,
  verified via a stubbed 429→200 sequence through `fetchApi` (no live network call). `StockHistoricalFeed`
  (bars) has no `delayed_sip` value, unlike the snapshot feed type — `toHistoricalFeed` maps
  `delayed_sip` to `undefined` (SDK default) rather than erroring, since bars simply don't offer
  that tier.
- **`worker/src/provider/alpaca/adapter.ts`**: `AlpacaAdapter implements ProviderAdapter`,
  constructor-injected with `AlpacaMarketDataClient`. `fetchSnapshots` calls `fetchSnapshots` +
  `fetchClock` in parallel; `marketStatus`/`valueKind` are derived from the clock's `isOpen`
  boolean alone (`OPEN`/`LIVE` vs. `CLOSED`/`SESSION_CLOSE`) — a **judgment call, not an
  architecture quote**: Alpaca's clock has no `PRE_OPEN`/`HALTED` signal, so this adapter has no
  producer for those states yet. Price prefers `latestTrade.p`, falling back to `dailyBar.c`;
  symbols with no usable price or timestamp are silently omitted (never thrown), matching T14's
  `FixtureAdapter` contract. `instrumentId` always defaults to `'0'` — same convention as
  `FixtureAdapter`, since the caller (`jobs/handlers.ts`) already stamps in the real id.
  `dataFreshness` is always emitted as `FRESH`, since T36's `classifyFreshness` recomputes it at
  persist time regardless of what the adapter supplies.
- **Scope boundary**: strictly the plan's named files. Did not touch `ProviderAdapter`,
  `jobs/handlers.ts`, `persist/actions.ts`, `adjustment/index.ts`, or `main.ts` — no ingestion
  scheduler loop exists yet to wire a live adapter into (still a placeholder in `main.ts`), and
  corporate-actions/earnings findings are recorded in prose (README/this file), not new code.
- **`worker/src/config.ts`**: added `ALPACA_FEED: z.enum(['iex','sip','delayed_sip','otc']).
  default('iex')` — paper accounts get `iex` by default; `worker/test/smoke.test.ts` gained 2 cases
  (default + explicit override).
- **Tests**: `worker/test/provider.alpaca.contract.test.ts` (10/10) — golden-file contract tests
  against real recorded Alpaca payloads under `worker/test/fixtures/alpaca/` (valid snapshot,
  market-closed, empty/missing-data snapshot, future-timestamp clock-skew rejection, no
  provider-specific keys leak, unknown symbol, `fetchDailyBars` normalization, unknown-symbol
  bars), 1 rate-limit-backoff test, 1 SDK-import-boundary test.
- **Verification**: `cd worker && direnv exec . npx vitest run` — 106/106. `npx tsc --noEmit`
  clean. `npx eslint src test` — same 11 pre-existing errors as before T37 (`db.ts`,
  `normalize/selector.ts`, `normalize/validate.ts`, `provider/fixture.ts`, `test/
  jobs.queue.test.ts`), none in the new/modified files.
- **Fixed a real cross-suite test-isolation bug found while verifying T37** (was initially
  misdiagnosed as a pre-existing, unrelated `jobs.queue.test.ts` flake — it wasn't):
  `api/test/tracking.test.ts` and `api/test/watchlists.additem.test.ts` exercise `POST
  /watchlists/:id/items`, which enqueues real, committed `resolve_instrument`/`backfill_bars` rows
  into the shared `jobs` table (INV-1) — neither file cleaned those up, so they silently
  accumulated across every `api` test run and were later claimed by `worker/test/
  jobs.queue.test.ts`'s tests (which assume an empty queue), causing nondeterministic id/count
  mismatches there. Fixed by adding an `afterAll` in both files that deletes everything with
  `created_at >= testsStartedAt` (a timestamp captured at the top of `beforeAll`) — safe because
  `api/vitest.config.ts` sets `fileParallelism: false` and root `npm test` runs workspaces
  sequentially, so no other suite's rows can fall in that window. The delete must run over
  `TEST_DATABASE_URL` (superuser), not the ordinary `DATABASE_URL` pool — `stockwatch_api` has no
  `DELETE` grant on `jobs` (T6), so both files gained the same `pool`/`setupPool` split already
  used by `adjustment.test.ts`/`checkpoint.repo.test.ts`/`inbox.test.ts`. Verified: fresh `api`
  suite run (164/164) leaves 0 rows in `jobs` (checked via `psql` under a superuser role), and the
  full `worker` suite (106/106, including `jobs.queue.test.ts`) then passes with **no manual
  truncation** — previously this required the "stale rows" `TRUNCATE` workaround documented below.

## Previously completed task

T36 (Freshness lifecycle and staleness labelling). Split into two independently-testable halves
across the write/read boundary, since the worker only writes on ingestion and can't itself notice
time passing while a provider stays silent (architecture §M: "market state untouched"):
- **Write-side classification (`worker/src/persist/marketState.ts`):** new exported pure
  `classifyFreshness(marketStatus, marketTimestamp, ingestedAt)` — the worker no longer trusts
  `obs.dataFreshness` verbatim from the provider (fixture-supplied, never decays); instead it
  derives `data_freshness` itself from the feed's own lag (`ingestedAt - marketTimestamp`),
  matching CLAUDE.md's "worker owns... shared market intelligence." Only an `OPEN` market can be
  downgraded (`DELAYED` past 5min lag, `STALE` past 20min) — any other `market_status` (`CLOSED`
  holding `SESSION_CLOSE`, `HALTED` holding `LAST_TRADE`, etc.) is always `FRESH`, per architecture
  §I's table. `upsertMarketState` now computes and writes this instead of the observation's own
  field. `worker/test/freshness.test.ts` (4/4, pure).
- **Read-side decay (`api/src/market/envelope.ts`):** `assembleEnvelope(row, now = nowUtc())` takes
  an injectable `now` and applies a private `decayFreshness` before constructing the envelope — an
  `OPEN` market whose `ingested_at` is ≥20min behind `now` is relabelled `STALE`/`LAST_KNOWN`
  (architecture §I: "Provider silent past threshold, market open" → `OPEN`/`LAST_KNOWN`/`STALE`),
  regardless of what was stored at ingestion. This is the actual "decay" (elapsed *read* time, not
  just ingestion-time feed lag) — since `assembleEnvelope` is the sole envelope constructor (T16)
  and both `instruments/routes.ts` and `inbox/routes.ts` already call it with no `now` argument,
  the decay flows through to `DiffResult.dataFreshness` and `PersonalRanker`'s de-weighting for
  free — no changes needed to `diff/engine.ts` or `ranking/ranker.ts` (T31's `isStale`/
  `STALENESS_DEWEIGHT` already de-weight `STALE`/`UNAVAILABLE` and leave `DELAYED` alone; this was
  verified against the existing `ranker.test.ts` suite, not re-implemented). `api/test/
  staleness.test.ts` (3/3, pure) — the named gate `stale_data_is_labelled_not_hidden`: an `OPEN`
  market past the stale threshold reads `LAST_KNOWN`/`STALE`; a `CLOSED` market holding
  `SESSION_CLOSE` stays `FRESH` even after 3 simulated days; a stale `URGENT` item is still present
  (never dropped) and de-weighted below a threshold in a ranked list built directly from
  `assembleEnvelope`'s output.
- **Threshold values (5min `DELAYED`, 20min `STALE`) are a judgment call, not an architecture
  quote** — architecture §M only names the transition (`FRESH→DELAYED→STALE`), not numbers. Two
  independent constants (one per file) rather than a shared export, since the worker's classifier
  measures feed lag (`ingestedAt - marketTimestamp`) and the API's decay measures read lag
  (`now - ingestedAt`) — different bases, so sharing a single "freshness" module across the
  worker/API boundary wasn't warranted (CLAUDE.md: "Worker and API separation is architectural...
  Neither imports the other").
- **Verification:** `cd worker && direnv exec . npx vitest run` — 95/95 (4 new in
  `freshness.test.ts`; a pre-existing unrelated `jobs.queue.test.ts` stale-rows failure was cleared
  by truncating first, per the DB environment note below — not caused by this task).
  `cd api && direnv exec . npx vitest run` — 164/164 (3 new in `staleness.test.ts`). `npx tsc
  --noEmit` clean in both. `npx eslint src test` clean in `api`; `worker` has the same 11
  pre-existing errors as before T36 (`db.ts`, `normalize/selector.ts`, `normalize/validate.ts`,
  `provider/fixture.ts`, `test/jobs.queue.test.ts`), none in the two new/modified files.

## Two tasks ago

T35 (Unsupported-action suppression). No changes were needed to `api/src/diff/engine.ts`'s
suppression logic itself — T27's `hasUnsupportedAction` short-circuit (return before computing
`adjustedBaseline`/`absoluteChange`/`percentageChange`/`volatilityMultiple`) already satisfied the
gate: those fields are omitted from `DiffResult` entirely (via conditional object-spread), not
nulled or zeroed, and this holds even with a supported split alongside the unsupported action in
the same version range, since `hasUnsupportedAction` is set by any unsupported row regardless of
order. Added `api/test/suppression.test.ts` (3/3, pure — mirrors `split.regression.test.ts`'s
style: asserts `'percentageChange' in result` etc. are all `false`) to make this gate explicit and
regression-proof, per plan naming (`unsupported_corporate_action_suppresses_comparison`). The real
new work was the UI side and the "reset baseline" option: `web/src/pages/InstrumentDetail.tsx` now
renders a suppression label plus a "Reset baseline" button when `comparisonStatus ===
'SUPPRESSED_CORPORATE_ACTION'`. The button reuses the existing `onAcknowledge` prop/ack-token flow
(T29/T30) rather than a new endpoint — `POST /instruments/:id/acknowledge` already advances the
checkpoint's baseline to the price/timestamp/corporate_action_version minted into the ack token at
GET time (`advanceCheckpoint`'s `baseline_market_timestamp` freshness check in `checkpoints/
repo.ts`), which is exactly "reset the baseline past the unsupported action." No new API field or
route was needed for this. 3 new cases added to `web/test/inbox.test.tsx` (label+button render,
button fires acknowledge once, and an OK-status render shows neither). `npx tsc --noEmit`/`npx
eslint src test` clean in both `api` and `web`. Full `api` suite: 161/161. Full `web` suite: 22/22.

## Three tasks ago

T34 (Split-adjusted comparison across a checkpoint). `api/src/diff/adjustment.ts` +
`api/src/diff/engine.ts` + `api/test/split.regression.test.ts` (4/4 — `split_across_checkpoint_
does_not_report_crash`: baseline $180.00 at version 3, 4-for-1 split, current $46.00 at version 4,
asserts ≈+2.22% and explicitly asserts it is not ≈−74%, asserts an "adjusted for 4-for-1 split"
label; plus two sequential splits and a split with no intervening price change). `factorBetween`
now also returns `splitLabels: readonly string[]` — one human-readable label per supported SPLIT
action in the version range, derived from `describeSplit(action)` (new export in `adjustment.ts`):
`factor <= 1` renders "adjusted for N-for-1 split" (ratio `1/factor`), `factor > 1` renders
"adjusted for 1-for-N split" (ratio `factor` itself) — the ratio is always derived from the stored
`adjustment_factor`, never a separately-stored string, so it can't drift from the number actually
multiplied into the baseline. `computeSinceLastCheck` (`engine.ts`) passes `adjustment.splitLabels`
through as `DiffResult.adjustmentLabels?: readonly string[]`, omitted entirely (not `[]`) when
empty, matching the existing optional-field convention (`volatilityMultiple`, etc.). Also did a
general `api` `tsc`/`eslint` cleanup in this same working session (see "Pre-existing `api`
tsc/eslint cleanup" section above) and fixed a real test-isolation bug in `auth.routes.test.ts`
found while doing it. `npx tsc --noEmit` and `npx eslint src test` both clean. Full `api` suite:
158/158.

## Four tasks ago

T33 (Split detection and AdjustmentPolicy write side). `worker/src/adjustment/index.ts` +
`worker/src/persist/actions.ts` + `worker/test/splits.test.ts` (7/7 — 3 pure classification
cases, 4 DB-backed: 4-for-1 split writes factor 0.25 and bumps `instruments.corporate_action_
version` once, re-ingesting the same split is idempotent, a merger is recorded unsupported with a
null factor, and a `CORPORATE_ACTION_APPLIED` signal wires through cleanly to the existing T21
detector). `npx tsc --noEmit` clean (worker). `npx eslint src test` — same 11 pre-existing errors
as before T33, none in the new files. Full `worker` suite: 91/91 (after clearing a pre-existing
stale-rows DB state — see "stale rows" note below — that was failing `jobs.queue.test.ts`
independently of this task's changes). See "Implementation decisions already made (T33 addendum)"
above for the `CorporateActionCandidate` shape, the classification rule, the shared per-instrument
`version_seq` counter, and the application-side idempotency check.

## Five tasks ago

T32 (Inbox and detail UI with evidence drill-down — basic pass). `web/src/pages/
{Inbox,InstrumentDetail}.tsx` + `web/src/components/{AttentionBand,EnvelopeBadge,
EvidencePanel}.tsx` + `web/src/types.ts` + `web/src/styles.css` + `web/PRODUCT.md` +
`web/test/inbox.test.tsx` (18/18, pure component tests via `@testing-library/react`/jsdom —
band/envelope/evidence rendered verbatim, empty/warming states, row-select callback, acknowledge
fires exactly once on click or unseen-unmount and never on an empty unseen set). `npx tsc --noEmit`
clean; `npx eslint web/src web/test` clean. Full `web` suite: 19/19 (18 new + T1's smoke test).
Deliberately basic styling — a CoinGecko-Android-inspired dark stylesheet — with real visual
polish deferred to a follow-up `impeccable` session (no DESIGN.md/surface brief written yet). See
"Implementation decisions already made (T32 addendum)" above for the wire-type shape, the
surfaced-but-unfixed `symbol`/name API gap, the evidence-panel field mismatch vs. the plan
prose, and the acknowledge-wiring design.

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
