# Current State — Implementation Handoff

Read this after `CLAUDE.md` and before opening `implementation-plan.md`. This file is a
handoff/state snapshot, not an architecture document — do not add design rationale here.

## Next task

**T24 — Publisher: monotonic per-instrument sequence**
Objective: assign `published_seq` under a per-instrument row lock and seal the record (INV-6).

## Completed

T1–T23 (Phase 0–3: workspace/toolchain, contracts, worker/API skeletons, auth, watchlist CRUD,
job queue, provider adapter, market-state persistence, bars/calendar/FeatureExtractor, dedupe
keys, the eight detectors, Scoring v1, ChangeAssembler v1).

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

## Files/contracts for T24 (Publisher — monotonic per-instrument sequence)

- Create: `worker/src/assembly/publisher.ts`
- Test: `worker/test/publisher.test.ts`
- Read first: `worker/src/assembly/assembler.ts` (`ChangeRecordDraft` shape from T23), `worker/src/db.ts`
  for the `PoolClient`/transaction pattern already used in `persist/bars.ts` and `persist/marketState.ts`.
- Plan section: `docs/plans/implementation-plan.md` T24 (search `#### T24`). Behavior: one transaction —
  `SELECT instruments ... FOR UPDATE`, allocate `last_published_seq + 1`, update the instrument, stamp
  the record with `published_seq`/`published_at`. A record already carrying a `published_seq` is never
  re-stamped (no-op). This is DB-backed (row locking + concurrency test), so it hits the known blocker
  below for the `published_seq_is_monotonically_ordered_per_instrument` concurrency test.

## Verification for T24

```bash
cd worker
npx tsc --noEmit
npx vitest run test/publisher.test.ts
```

## Last completed task

T23 — ChangeAssembler v1 with sealing. Not yet committed (worktree has
`worker/src/assembly/assembler.ts` and `worker/test/assembler.test.ts` untracked, plus T22's
`worker/src/assembly/scoringV1.ts` / `worker/test/scoring.test.ts` still untracked from the prior
handoff — all four should be committed together). `npx tsc --noEmit` and
`npx vitest run test/assembler.test.ts` (4/4) pass in this environment.

## Known blocker

Sandbox `DATABASE_URL` env var points to an unrelated Postgres instance (`amr_rag`, not
stockwatch), and no local Docker daemon is reachable to run `docker-compose.yml`'s `postgres`
service. DB-backed tests (`bars.test.ts`, `marketState.ordering.test.ts`,
`enums.consistency.test.ts`, and any future DB-integration test) fail with `ECONNREFUSED` or
connect to the wrong database in this environment — not a code regression. Non-DB tests
(`describeWithDb`-gated suites correctly skip only when `DATABASE_URL` is unset entirely) pass.
To verify DB-touching work, run `docker compose up -d postgres` with a working Docker daemon and
an unset/correct `DATABASE_URL`, or point `DATABASE_URL` at a real stockwatch instance first.
