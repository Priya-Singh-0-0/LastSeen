# Current State — Implementation Handoff

Read this after `CLAUDE.md` and before opening `implementation-plan.md`. This file is a
handoff/state snapshot, not an architecture document — do not add design rationale here.

## Next task

**T34 — Split-adjusted comparison across a checkpoint**
Objective: Modify `api/src/diff/adjustment.ts`, `api/src/diff/engine.ts`; Test
`api/test/split.regression.test.ts`. Invariants INV-12, INV-9. Depends on T33 (done), T27 (done).

## Completed

T1–T33 (Phase 0–5: workspace/toolchain, contracts, worker/API skeletons, auth, watchlist
CRUD, job queue, provider adapter, market-state persistence, bars/calendar/FeatureExtractor,
dedupe keys, the eight detectors, Scoring v1, ChangeAssembler v1, Publisher, shared template
explanation, AdjustmentPolicy read side, ack token mint/verify, checkpoint repository monotonic
upsert, instrument detail GET and acknowledge POST, inbox read model/ranking/personal explanation,
inbox/detail UI with evidence drill-down — basic pass, visual polish deferred to impeccable;
Phase 6: split detection and AdjustmentPolicy write side).

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

## Previously completed task

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

## Two tasks ago

T31 (Inbox read model, ranking, and personal explanation). `api/src/inbox/routes.ts` +
`api/src/ranking/ranker.ts` + `api/src/explanation/{renderer,personalTemplate}.ts` +
`api/test/inbox.test.ts` (6/6, DB-backed — cross-user 404, empty-watchlist 200, exactly-3 total
queries for a 4-item watchlist (1 session lookup + 2 inbox), fixture-set ranking order, explanation
composition, no-Alpaca-dependency structural check) + `api/test/ranker.test.ts` (7/7, pure) +
`api/test/explanation.personal.test.ts` (7/7, pure). Also fixed a pre-existing Publisher gap
(`score`/`band` were never persisted — see T31 addendum) with 2 new cases in
`worker/test/publisher.test.ts`. `npx tsc --noEmit` passes in both packages (same pre-existing
unrelated strict-null errors in `api`, none new). Full `worker` suite: 84/84. Full `api` suite:
154/154 (fresh truncate before each run — see "stale rows" note below). See "Implementation
decisions already made (T31 addendum)" above for the Publisher fix, the two-query-budget
judgment calls (no `factorBetween`/no holidays query), and the ranker's staleness de-weight.

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
