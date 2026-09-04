# Current State — Implementation Handoff

Read this after `CLAUDE.md` and before opening `implementation-plan.md`. This file is a
handoff/state snapshot, not an architecture document — do not add design rationale here.

## Next task

**T22 — Scoring v1**
Objective: a bounded, inspectable attention score (noisy-OR over phenomenon groups → band).

## Completed

T1–T21 (Phase 0–3: workspace/toolchain, contracts, worker/API skeletons, auth, watchlist CRUD,
job queue, provider adapter, market-state persistence, bars/calendar/FeatureExtractor, dedupe
keys, the eight detectors).

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

## Files/contracts for T22 (Scoring v1)

- Create: `worker/src/assembly/scoringV1.ts`
- Test: `worker/test/scoring.test.ts`
- Read first: `worker/src/signals/detectors.ts` (`SignalEvidence`, `SignalType` outputs),
  `packages/contracts/src/enums.ts` (`PhenomenonGroup`, `AttentionBand`)
- Architecture reference (already extracted, no need to re-read the whole doc): §G "Phenomenon
  grouping" and "Attention score" in `docs/architecture/initial-architecture.md` — groups
  `PRICE_MOVE` (signals 1–4, max), `PARTICIPATION` (5–6, max), `EVENT` (7–8, max); weights
  `w_PRICE_MOVE=0.70, w_PARTICIPATION=0.45, w_EVENT=0.60`; `score = 1 − Π(1 − w_g × strength_g)`;
  bands `≥0.75 URGENT | ≥0.50 NOTABLE | ≥0.25 MINOR | else QUIET`; per-signal strength ramps, e.g.
  signal 1 `clamp((multiple−2.0)/2.0, 0, 1)`, signal 5 `clamp((ratio−2.5)/3.5, 0, 1)` (see §G for
  the rest). Module header must state weights are calibration assumptions, not financial truth.
- Plan section: `docs/plans/implementation-plan.md` T22 (search `#### T22`).

## Verification for T22

```bash
cd worker
npx tsc --noEmit
npx vitest run test/scoring.test.ts
```

## Last completed task

T21 — The eight detectors. Commit: (this session, see `git log -1` after commit — update this line
post-commit).

## Known blocker

Sandbox `DATABASE_URL` env var points to an unrelated Postgres instance (`amr_rag`, not
stockwatch), and no local Docker daemon is reachable to run `docker-compose.yml`'s `postgres`
service. DB-backed tests (`bars.test.ts`, `marketState.ordering.test.ts`,
`enums.consistency.test.ts`, and any future DB-integration test) fail with `ECONNREFUSED` or
connect to the wrong database in this environment — not a code regression. Non-DB tests
(`describeWithDb`-gated suites correctly skip only when `DATABASE_URL` is unset entirely) pass.
To verify DB-touching work, run `docker compose up -d postgres` with a working Docker daemon and
an unset/correct `DATABASE_URL`, or point `DATABASE_URL` at a real stockwatch instance first.
