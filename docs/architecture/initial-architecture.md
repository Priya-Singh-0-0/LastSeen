# Stockwatch — Accepted Initial Architecture

**Status:** Accepted (rev. 3 — stack change: TypeScript/Node worker on the official Alpaca SDK)
**Scope:** Initial implementation. Authoritative for all work until explicitly superseded.

This document is the accepted architecture. Implementation must not deviate from it silently.
If a request conflicts with an invariant here, name the conflict and propose the smallest safe
alternative.

---

## A. Architecture Summary

Stockwatch is not a quote board with extra steps. The product claim is *"here is what changed in
the things you care about since you last looked, ranked by how much it deserves your attention."*
Everything follows from one observation: the expensive, interesting work is a property of the
**instrument**, and the cheap, personal work is a property of the **(user, instrument) pair**. If
that split is right, the system is both correct and cheap. If it is blurred, we have built a normal
watchlist with an LLM bolted on.

The system has two halves with a database between them. The **TypeScript/Node ingestion worker**
owns everything upstream of "what is true about AAPL": provider calls, validation, normalization, market
state and bars, events and corporate actions, deterministic features, a small catalogue of signal
predicates, assembly of those signals into published **change records**, and rendering of the shared
explanation text. It operates over *unique instruments* — a set whose size is the union of all
watchlists, not their sum. Ten thousand users watching AAPL cause exactly one fetch cycle.

The **TypeScript API** owns everything downstream. It authenticates users, manages watchlists, reads
already-ingested state, and performs the one genuinely personal computation: comparing a user's
checkpoint against the current published state of each instrument they follow, then ranking the
difference. Under normal operation it never calls a market provider — structurally it *cannot*,
because provider credentials exist only in the worker's runtime. A read that misses does not become
a provider request; it becomes an honest "warming up" response plus an enqueued backfill job.

The critical invariant: **the machine computes financial truth and the language layer only narrates
it.** Price deltas, percentages, elapsed time, volatility multiples, volume ratios, thresholds,
freshness, and attention scores are deterministic and inspectable. An `ExplanationRenderer`
interface sits at the end of the pipeline and receives an already-verified structured fact bundle.
The first — and for this build, only required — implementation is deterministic templating. A model
is optional enrichment behind the same interface; absent, slow, or wrong, the product works
identically minus prose polish.

The **checkpoint** is the whole product in one small table. It belongs to `(user, instrument)` —
not `(user, watchlist, instrument)` — because a user's knowledge of AAPL does not fork when they
file it into two lists. It stores what the user actually saw: the price displayed, that price's
market timestamp, the publication watermark read through, and the corporate-action version in force
at the time. That last field is what keeps a 4-for-1 split from being reported as a 75% crash.

Change records are shared and published with a **per-instrument publication sequence** assigned by
the worker at publish time. "Unseen" is then a trivial, index-friendly predicate:
`published_seq > checkpoint.seen_through_publication_seq`. The required property is **monotonic
ordering per instrument**, not gaplessness (see §F.3).

**PostgreSQL is the only stateful system.** No Redis. The hot shared table is one row per
instrument — thousands, maybe tens of thousands — a rounding error for Postgres with correct
indexes. Background jobs live in a `jobs` table drained with `FOR UPDATE SKIP LOCKED`, with
idempotency keys, lease expiry, and retry counts.

Every market value carries a **semantic envelope** rather than being a bare number. Three questions
are kept separate because they are separate: what the venue is doing (market status), what kind of
number this is (value kind), and whether its recency is trustworthy (data freshness). A price can
be a legitimate `SESSION_CLOSE` from a `CLOSED` market and be perfectly `FRESH`.

The seams that matter — `ProviderAdapter`, `ObservationSelector`, `AdjustmentPolicy`,
`ChangeAssembler` (versioned), `ExplanationRenderer` — exist from day one with deliberately trivial
implementations. The production machinery they will eventually host is explicitly not built. The
interface being versioned matters more than the first algorithm being clever.

---

## B. Architecture Diagram

```text
                         ┌─────────────────────────────┐
                         │   Alpaca Market Data        │
                         │   (external, untrusted)     │
                         └──────────────┬──────────────┘
                                        │ official Alpaca Node SDK, API key
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│╌╌ TRUST BOUNDARY 1 ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
   provider creds exist ONLY below      │  (all SDK types die at the adapter)
                                        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  TYPESCRIPT WORKER  (separate process/entrypoint; scheduled + job-driven)  │
│                                                                           │
│   ProviderAdapter ──► ObservationSelector ──► Normalizer                  │
│         │                                          │                      │
│         │                                          ▼                      │
│         │                              AdjustmentPolicy (splits v1)       │
│         ▼                                          ▼                      │
│   FeatureExtractor ──► SignalEvaluator ──► ChangeAssembler(v=1)           │
│                                                    │                      │
│                                                    ▼                      │
│                        Publisher (assigns published_seq, seals record)    │
│                                     + shared template explanation         │
└───────────────────────────────────────┬───────────────────────────────────┘
                    writes ▼            │ reads/writes jobs, instrument_tracking
┌───────────────────────────────────────┴───────────────────────────────────┐
│  POSTGRESQL       (sole authoritative state; sole inter-process contract) │
│                                                                           │
│  SHARED MARKET    instruments · instrument_symbols · instrument_market_   │
│  (worker-write)   state · instrument_bars · market_events ·               │
│                   corporate_actions · instrument_signals · change_records │
│                                                                           │
│  OPERATIONAL      instrument_tracking (API-write) · jobs                  │
│                                                                           │
│  PERSONAL         users · sessions · watchlists · watchlist_items ·       │
│  (api-write)      user_instrument_checkpoints                             │
└───────────────────────────────────────┬───────────────────────────────────┘
                     reads ▲            │ reads market; writes personal + tracking
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│╌╌╌╌╌╌╌╌╌╌╌╌│╌╌ TRUST BOUNDARY 2 ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
      DB role for API: NO provider creds, NO write on market-fact tables
                                        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  TYPESCRIPT API                                                           │
│                                                                           │
│   auth/session ─► authz (ownership on every user-owned row)               │
│   watchlist CRUD ─► instrument_tracking maintenance                       │
│   read-model assembly ─► DiffEngine ─► PersonalRanker                     │
│   AckToken mint (GET) / verify (POST)                                     │
│   ExplanationRenderer: shared cached text + deterministic personal clause │
└────────────────────────┬──────────────────────────────────────┬───────────┘
                         │ JSON over HTTPS                      │ (optional, later)
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│╌╌ TRUST BOUNDARY 3 ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│╌╌ EGRESS ╌╌
    (client fully untrusted; cannot author a watermark or baseline)         │
                         ▼                                      ▼
       ┌──────────────────────────────┐    ┌──────────────────────────────────┐
       │  TYPESCRIPT FRONTEND         │    │  Explanation model (OPTIONAL)    │
       │   watchlists                 │    │   shared facts only              │
       │   "changed since last check" │    │   no personal data               │
       │   attention-ranked inbox     │    │   no numeric authority           │
       │   evidence drill-down        │    │   timeout → template fallback    │
       │   formats; never derives     │    └──────────────────────────────────┘
       └──────────────────────────────┘
```

Data flows strictly downward. Nothing in the API or frontend writes a market fact; nothing in the
worker reads a user row.

---

## C. Responsibility Matrix

### TypeScript worker

Separate process, separate entrypoint, separate `.env`, separate DB role. It is **not** a module of
the API and must never be started from the API process. Sharing a language changes nothing about
this boundary.

| | |
|---|---|
| **Owns** | Provider contract; normalization; definition of a valid observation; features; signal predicates; change assembly, scoring, and publication; corporate-action adjustment factors; shared explanation text |
| **Reads** | `jobs`, `instrument_tracking`, `instruments`, `instrument_symbols`, `instrument_bars`, `instrument_market_state`, `corporate_actions`, `market_events`, its own prior `instrument_signals` / `change_records` |
| **Writes** | All shared market tables; `jobs`; `instrument_tracking.last_ingested_at` only |
| **Never does** | Read `users`, `sessions`, `watchlists`, `watchlist_items`, `user_instrument_checkpoints`. Serve HTTP to end users. Rank anything per user. Let Alpaca SDK types, DTOs, enums, or pagination concepts past the adapter. Overwrite newer market state with an older observation. Re-publish a sealed record. |

The worker's poll set comes from `instrument_tracking`, an aggregate containing no user identity.

### PostgreSQL

| | |
|---|---|
| **Owns** | All authoritative state; the inter-process contract; transactional integrity; the job queue |
| **Never does** | Contain business logic beyond constraints, indexes, and minimal integrity triggers. No stored-procedure signal engine — logic stays in versioned, testable application code. |

Two DB roles:
- `stockwatch_worker` — write on market-fact tables; read/write `jobs`; read `instrument_tracking`
  and write only its `last_ingested_at`. **No read grant** on any user/watchlist/checkpoint/session
  table.
- `stockwatch_api` — read on market-fact tables; read/write personal tables; read/write
  `instrument_tracking` (except `last_ingested_at`); `INSERT` on `instruments` /
  `instrument_symbols` for first-time symbol registration only; `INSERT` on `jobs`.
  **No write grant** on `instrument_market_state`, `instrument_bars`, `market_events`,
  `corporate_actions`, `instrument_signals`, `change_records`.

### TypeScript API

| | |
|---|---|
| **Owns** | Identity, sessions, authorization; watchlist lifecycle; `instrument_tracking`; checkpoint lifecycle; ack-token mint/verify; the read model; the personal diff; personal ranking; explanation composition |
| **Reads** | All market-fact tables (read-only); all personal tables; `instrument_tracking` |
| **Writes** | `users`, `sessions`, `watchlists`, `watchlist_items`, `user_instrument_checkpoints`, `instrument_tracking`, `jobs` (enqueue only), initial `instruments` / `instrument_symbols` registration |
| **Never does** | Import the Alpaca SDK. Call a market provider, ever. Hold provider credentials. Write market facts. Recompute a signal. Trust a user-supplied identity, cursor, baseline, or price. Mutate user state in a GET. Let a model produce a number that reaches a financial field. |

### Frontend

| | |
|---|---|
| **May** | Locale- and currency-format canonical values supplied by the API (separators, decimal conventions, currency placement, timezone rendering); use API-supplied precision hints; apply purely presentational logic (colour by sign, badge by band) |
| **May not** | Independently calculate any financial semantic — percentages, absolute changes, baselines, elapsed time or session counts, volatility multiples, volume ratios, attention scores or bands, freshness, comparison status. All arrive pre-computed. |
| **Never does** | Decide what counts as "seen." Author a watermark, cursor, or baseline. Receive a bare number without its envelope. |

The line: **formatting a canonical value is presentation; deriving a value is financial truth.**

### Explanation layer

| | |
|---|---|
| **Owns** | Turning a verified fact bundle into a sentence |
| **Reads** | Only the structured fact bundle handed to it |
| **Writes** | Nothing. The shared sentence is rendered by the worker at publish time and stored on `change_records`, cached by `(change_record_id, renderer_version)`. The personal clause is rendered by the API and never stored. |
| **Never does** | Compute, alter, or round a financial value. Invent an event. Assert causation. Predict. Advise. Block a response — timeout-bounded with template fallback. Receive personal data in the model path. |

---

## D. Shared vs Personal State

**Shared instrument state (authoritative).** `instruments`, `instrument_symbols`,
`instrument_market_state`, `instrument_bars`, `market_events`, `corporate_actions`. What the market
did. Identical for every user, so computed exactly once.

**Shared derived state (recomputable, but stored).** `instrument_signals`, `change_records`, and the
shared explanation text. Functions of shared state plus a versioned algorithm. Stored anyway because
publication order must be stable (a watermark must mean something permanent) and recomputing signals
per request would put CPU on the read path. Carries `detector_version` / `assembly_version` /
`renderer_version` so an algorithm change produces new rows rather than mutating history.

**Operational state.** `instrument_tracking` (which instruments require ingestion, and at what
priority) and `jobs`. Tracking is API-owned because it expresses *demand*, not market fact.

**Personal state (authoritative).** `users`, `sessions`, `watchlists`, `watchlist_items`,
`user_instrument_checkpoints`. The only thing that scales with users. Note what is absent: no
per-user copy of prices, bars, or signals. A user's entire market memory is one row per followed
instrument.

**Personal derived state (never stored).** Since-last-check delta, unseen count, attention rank, and
the personal explanation clause — computed per request from `(checkpoint, shared state)`. Storing
them would create a fan-out write on every market tick, which is the `users × instruments` explosion
this design exists to avoid.

**Rule:** anything expensive is shared; anything personal is a comparison, not a computation. A
feature requiring one write per user per market update is architecturally wrong and must be
redesigned as a read-time diff.

---

## E. Initial Domain Model

| Entity | Responsibility | Key relationships | Auth/Derived | Rough cardinality |
|---|---|---|---|---|
| **User** | Identity, credentials, timezone | 1→N watchlists, 1→N checkpoints | Authoritative | 10s–1000s |
| **Session** | Authenticated session | N→1 user | Authoritative | ~1–3 per active user |
| **Watchlist** | Named user-owned grouping | N→1 user, 1→N items | Authoritative | ~1–3 per user |
| **WatchlistItem** | Instrument membership in a list | N→1 watchlist, N→1 instrument | Authoritative | ~10–50 per user |
| **Instrument** | Canonical tracked thing; `corporate_action_version`, resolution status, `last_published_seq` | 1→N symbols, 1→1 market state, 1→1 tracking | Authoritative (worker-owned after registration) | 100s–10,000s |
| **InstrumentSymbol** | Ticker↔instrument mapping over time (symbol, exchange, validity window) | N→1 instrument | Authoritative | ~1–2 per instrument |
| **InstrumentTracking** | Operational ingestion demand: `follower_count`, `tracking_state`, `priority`, `last_ingested_at` | 1→1 instrument | Authoritative, **API-owned** except `last_ingested_at` | = instrument count |
| **InstrumentMarketState** | Current snapshot: last price + full semantic envelope, session context, `last_observed_market_ts` | 1→1 instrument | Authoritative (latest-wins by market ts) | = instrument count |
| **InstrumentBar** | Daily OHLCV history (v1: daily only) | N→1 instrument | Authoritative | instruments × ~400 |
| **MarketEvent** | Discrete dated occurrence: earnings, guidance, notable filing | N→1 instrument | Authoritative | a few per instrument per year |
| **CorporateAction** | Split (v1); others recorded-but-unsupported. `effective_date`, `adjustment_factor`, `is_supported`, `version_seq` | N→1 instrument | Authoritative | <1 per instrument per year |
| **InstrumentSignal** | One detected phenomenon with structured evidence, `detector_version`, `dedupe_key` | N→1 instrument, N→1 change_record | Derived-but-stored | ~0–5 per instrument per active day |
| **ChangeRecord** | Published, sealed bundle of grouped signals; `published_seq`, `score`, `band`, `assembly_version`, shared explanation | N→1 instrument, 1→N signals | Derived-but-stored | ~0–2 per instrument per active day |
| **UserInstrumentCheckpoint** | What this user last acknowledged about this instrument | N→1 user, N→1 instrument (unique pair) | Authoritative | ≈ distinct (user, instrument) pairs |
| **Job** | Queued worker unit with idempotency key, lease, retries | — | Operational | 100s–1000s live |

---

## F. Core Data Flows

### F.1 Instrument added to watchlist

```text
POST /watchlists/:id/items { symbol: "AAPL" }
  ↓ [API]  authenticate → authorize watchlist ownership → validate symbol shape
  ↓ [API]  resolve symbol → instrument_id via instrument_symbols
  ↓        ├─ hit  → continue
  ↓        └─ miss → INSERT Instrument (status=PENDING_RESOLUTION) + symbol row,
  ↓                  enqueue job{ resolve_instrument, key=symbol }
  ↓ [API]  INSERT watchlist_item
  ↓ [API]  UPSERT instrument_tracking: follower_count++, tracking_state=ACTIVE, priority
  ↓ [API]  create checkpoint IF NOT EXISTS  ← see §H
  ↓ [API]  if no market state, enqueue job{ backfill_bars, key=instrument_id }
  ↓ [API]  respond 201 with current envelope, or state=WARMING
```

No provider call on this path. A newly-added ticker shows "warming up" until the next ingestion
cycle — honest, and cheaper than a synchronous third-party call behind a spinner.

### F.2 Market ingestion cycle *(worker)*

```text
scheduler tick
  ↓ SELECT instruments from instrument_tracking WHERE tracking_state=ACTIVE
  ↓        ORDER BY staleness × priority              ← unique instruments only
  ↓ batch into provider-sized chunks (global token bucket; respect rate limit)
  ↓ ProviderAdapter.fetch(batch) → provider DTOs   ← AlpacaAdapter wraps the official Node SDK;
  ↓                                                  polling/batched HTTP, no streaming in v1
  ↓ validate: schema, required fields, plausibility (price>0, within N× of last,
  ↓           timestamp not beyond clock skew, volume non-negative)
  ↓ ObservationSelector.select(candidates) → admissible observation | reject+log
  ↓ Normalizer → internal Observation (decimal, UTC, internal enums)
  ↓ AdjustmentPolicy: detect corporate action → write CorporateAction,
  ↓                   bump instruments.corporate_action_version
  ↓ UPSERT instrument_market_state WHERE excluded.market_timestamp > existing.market_timestamp
  ↓ UPSERT instrument_bars ON CONFLICT (instrument_id, session_date) DO UPDATE
  ↓ UPSERT market_events by natural key
  ↓ UPDATE instrument_tracking.last_ingested_at
  ↓ mark job complete
```

Every write is an upsert with a natural key or a monotonic guard. The `WHERE` clause on market state
is the single line preventing a retried or reordered job from resurrecting an old price.

### F.3 Signal and change generation *(worker, same cycle, after persistence)*

```text
for each instrument with new observations:
  FeatureExtractor: returns_1d, sigma20, true_range, volume_median20, volume_ratio,
                    high20, low20, gap_pct, bars_available
  ↓ SignalEvaluator: evaluate the 8 predicates (§G); each emits structured evidence
  ↓                  and a deterministic dedupe_key (§G)
  ↓ UPSERT instrument_signals ON CONFLICT (instrument_id, detector_version, dedupe_key)
  ↓ ChangeAssembler v1:
  ↓    group signals ONLY into records that are not yet published
  ↓    (same session window, or ≤6h of latest_at); else open a new record
  ↓ score = noisy-OR over phenomenon groups (§G); band = threshold(score)
  ↓ render shared explanation (template, renderer_version)
  ↓ publish (first time only):
  ↓    BEGIN; SELECT instrument FOR UPDATE;
  ↓      published_seq := instrument.last_published_seq + 1
  ↓      UPDATE instruments SET last_published_seq = published_seq
  ↓      UPDATE change_record SET published_seq, published_at, shared_explanation
  ↓    COMMIT
```

**Publication invariant (monotonic ordering, not gaplessness).**

> No `change_record` may become visible to a reader with a `published_seq` lower than a watermark
> that reader has already been served for that instrument.

Gaps are harmless — a rolled-back transaction or discarded draft costs nothing, because the
watermark is a threshold, not an enumeration. Allocating the sequence under the instrument row lock
inside the inserting transaction makes sequence order match commit order per instrument, which is
what prevents the visibility race. **No complexity is introduced to guarantee gaplessness.**

**Sealing.** A `ChangeRecord` receives `published_seq` exactly once. After publication:
- the assembler groups new signals only into *unpublished* records;
- a signal arriving after its window's record was published **opens a new record** with its own
  `published_seq`, so late information still reaches users as a distinct item;
- mutable fields of a published record may be corrected in place, but this **never** touches
  `published_seq` and never re-surfaces the record to a user who has read past it.

Accepted v1 consequence: a burst spanning a publication boundary can yield two records where a
smarter assembler would yield one. Cosmetic. The alternative is materiality and re-notification
machinery, which is deferred.

### F.4 User returns later

```text
GET /watchlists/:id/inbox
  ↓ [API] authenticate; authorize
  ↓ ONE query: watchlist_items ⨝ instruments ⨝ market_state ⨝ checkpoints (this user)
  ↓ ONE query: change_records WHERE (instrument_id, published_seq) > per-user watermark
  ↓            bounded: LIMIT N per instrument, ORDER BY published_seq DESC
  ↓ [API] DiffEngine per item (§F.5)
  ↓ [API] PersonalRanker: (max unseen band, max unseen score, |since-check move|),
  ↓                        de-weighted by staleness
  ↓ [API] compose: stored shared explanation + deterministic personal clause
  ↓ respond
```

Two bounded queries for the whole page regardless of user count. No N+1, no provider call.

### F.5 Since-last-check calculation *(API, deterministic)*

```text
given checkpoint C and current market state S for instrument I:

  adjustment := AdjustmentPolicy.factorBetween(
                    I, C.baseline_corporate_action_version, I.corporate_action_version)

  if adjustment.hasUnsupportedAction:
      → comparison_status = SUPPRESSED_CORPORATE_ACTION
      → return labelled result, NO percentage        ← say "cannot compare", never guess

  adjusted_baseline := C.baseline_price × adjustment.factor
  absolute_change   := S.price − adjusted_baseline
  percentage_change := absolute_change / adjusted_baseline
  elapsed           := S.market_timestamp − C.baseline_market_timestamp
  sessions_elapsed  := trading sessions in that span
  vol_multiple      := |percentage_change| / (sigma20 × √sessions_elapsed)
  unseen_changes    := records with published_seq > C.seen_through_publication_seq
  freshness         := S.data_freshness   (propagated, never inferred)
```

If freshness is `STALE` or `UNAVAILABLE` the result is still returned but labelled, and the rank is
de-weighted rather than the row hidden — a stale instrument is itself information.

### F.6 Acknowledgement — GET offers, POST performs

**A GET never mutates a checkpoint or any other user state.**

```text
GET /instruments/:id
  ↓ [API] authenticate; authorize
  ↓ [API] compute diff + full unseen change set; render
  ↓ [API] mint AckToken — stateless HMAC-SHA256 over the payload with a server secret:
  ↓          { v, user_id, instrument_id,
  ↓            served_watermark,                  ← MAX(published_seq) actually rendered
  ↓            baseline_price, baseline_market_timestamp,
  ↓            corporate_action_version,
  ↓            issued_at, expires_at }            ← short TTL, ~15 min
  ↓ respond: rendered state + ack_token

POST /instruments/:id/acknowledge  { ack_token }
  ↓ [API] verify HMAC → reject if tampered
  ↓ [API] verify token.user_id == session.user_id      ← scope check, not payload identity
  ↓ [API] verify token.instrument_id == :id
  ↓ [API] verify not expired
  ↓ [API] UPSERT checkpoint SET
  ↓          seen_through_publication_seq = GREATEST(existing, token.served_watermark),
  ↓          baseline_price / baseline_market_timestamp / baseline_corporate_action_version
  ↓             ← from token, applied when the watermark advances, or when the token's
  ↓               baseline_market_timestamp is newer than the stored one
  ↓          updated_at = now()
  ↓ respond: new checkpoint position
```

All checkpoint-determining values are chosen by the server at render time; the client transports
them but cannot author them, because any edit breaks the signature. Verification is a single HMAC
computation — **no token table, no revocation list, no cleanup job**. Replay is a harmless no-op
via `GREATEST` plus the newer-timestamp guard, which also covers the two-device race without
locking. Expiry bounds how stale a landing baseline can be.

The client fires the POST when the user has actually viewed the detail (on unmount, or an explicit
"mark as read" — a UX decision, not an architectural one). If it never fires, the item stays unread,
which is the correct failure direction.

### F.7 Explanation generation

```text
ChangeRecord + FactBundle (verified, numeric, complete)
  ↓ ExplanationRenderer.render(bundle)
  ├─ [v1, always available] DeterministicTemplateRenderer
  │     selects template by dominant phenomenon group, interpolates formatted values
  │     → immediate, cannot fail
  └─ [optional, later] ModelRenderer
        input: shared facts ONLY (no user id, no watchlist, no personal timing)
        constrained prompt · bounded output · hard timeout (~1.5s)
        ↓ validator: every number in output must appear in the fact bundle;
        ↓            reject causal / predictive / advisory phrasing
        ↓ pass → use it   |   fail/timeout/unavailable → template output
```

The **shared** sentence is rendered by the worker at publish time and stored on the change record,
cached by `(change_record_id, renderer_version)` — once per record, never per user. The **personal**
clause ("since you last checked, three days ago") is always template-generated by the API and
concatenated. The model never sees personal data.

No renderer configuration may change a displayed number, a rank, a band, or a checkpoint.

---

## G. Meaningful Change v1

### Features (daily bars + current state)

`returns_1d`, `returns_since_prev_close`, `sigma20` (stdev of daily log returns, 20 sessions),
`true_range`, `volume`, `volume_median20`, `volume_ratio = volume / volume_median20`, `high20`,
`low20`, `gap_pct = (open − prev_close) / prev_close`, `bars_available`.

Every price/volume predicate requires `bars_available ≥ 20`. Below that the instrument reports
`INSUFFICIENT_HISTORY` and emits event-type signals only. Emitting a "3.5σ move" computed from four
bars is the most embarrassing available failure mode.

### Signal catalogue (8)

| # | Signal | Predicate (v1 constants) | Evidence carried |
|---|---|---|---|
| 1 | `VOLATILITY_ADJUSTED_MOVE` | `abs(returns_1d) ≥ 2.0 × sigma20` | pct_change, sigma20, multiple, window, market_ts |
| 2 | `LARGE_ABSOLUTE_MOVE` | `abs(returns_1d) ≥ 5%` | pct_change, abs_change, prev_close, market_ts |
| 3 | `SIGNIFICANT_GAP` | `abs(gap_pct) ≥ 3%` **and** `≥ 1.5 × sigma20` | gap_pct, prev_close, open, sigma20 |
| 4 | `RANGE_BREAKOUT` | `close > high20` or `close < low20` | close, high20/low20, window=20 |
| 5 | `ABNORMAL_VOLUME` | `volume_ratio ≥ 2.5` | volume, volume_median20, ratio |
| 6 | `VOLUME_ACCELERATION` | 3-session mean volume `≥ 1.8 ×` median20 and rising | 3d mean, median20, ratio |
| 7 | `EARNINGS_RELEASED` | a `MarketEvent(EARNINGS)` exists in window | event_ts, fiscal period, source |
| 8 | `CORPORATE_ACTION_APPLIED` | a `CorporateAction` became effective in window | action type, factor, effective_date, is_supported |

### Deterministic dedupe keys

`(instrument_id, type, market_ts)` does **not** uniquely identify every signal — two distinct events
can share a timestamp, and some signals are properties of a session rather than an instant. Each
detector emits an explicit `dedupe_key` computed as a pure function of its inputs. Uniqueness is
enforced on `(instrument_id, detector_version, dedupe_key)`.

| Signal class | Dedupe key basis |
|---|---|
| Session-scoped price signals (1–4) | signal type + `session_date` |
| Session-scoped volume signals (5–6) | signal type + `session_date` (+ window length for the multi-session one) |
| `EARNINGS_RELEASED` (7) | signal type + market-event identity (provider event id, else stable natural key: event type + normalized event timestamp + fiscal period) |
| `CORPORATE_ACTION_APPLIED` (8) | signal type + corporate-action identity (action type + effective date + factor) |

Including `detector_version` means a detector change produces new rows rather than silently
overwriting history, consistent with `assembly_version` and `renderer_version`.

### Phenomenon grouping

Signals 1–4 are largely the same underlying event seen four ways; summing them would triple-count.

| Group | Members | Group strength |
|---|---|---|
| `PRICE_MOVE` | 1, 2, 3, 4 | **max** of member strengths |
| `PARTICIPATION` | 5, 6 | max of member strengths |
| `EVENT` | 7, 8 | max of member strengths |

Each signal maps to a strength in `[0,1]` via a saturating ramp on its own headroom — e.g. signal 1:
`clamp((multiple − 2.0) / 2.0, 0, 1)`; signal 5: `clamp((ratio − 2.5) / 3.5, 0, 1)`.

### Attention score

```text
score = 1 − Π over groups g of (1 − w_g × strength_g)

w_PRICE_MOVE    = 0.70
w_PARTICIPATION = 0.45
w_EVENT         = 0.60

band:  ≥0.75 URGENT | ≥0.50 NOTABLE | ≥0.25 MINOR | else QUIET
```

Noisy-OR is bounded in `[0,1)`, monotonic, and cannot be inflated by piling on correlated signals.

**These weights are calibration assumptions, not financial truth.** Hand-set constants chosen to
make the ordering feel sensible; never validated against outcomes; never to be described to a user
as a probability or prediction. They live in one versioned module (`scoring_v1`).

### Structured reasons

Every ranked item exposes its full evidence chain to the UI: which signals fired, each one's inputs
and threshold, its group, group strengths, the combination, and the final band. A user can see
exactly why an instrument ranked where it did, with no model in the loop.

---

## H. Checkpoint Semantics

**Created:** on first add of the instrument to *any* watchlist by that user, if no checkpoint for
`(user, instrument)` exists.

**Initial baseline (initial-following policy):** created with
`seen_through_publication_seq = instruments.last_published_seq` and the current price as baseline.
**You start with a clean slate** — adding AAPL does not surface a backlog of changes from before you
were watching. If market state is unavailable (warming), the checkpoint is created with a null
baseline and `seen_through = 0`, and is populated on the first successful acknowledgement; the diff
reports `AWAITING_BASELINE` until then.

**Moves:** only via `POST /instruments/:id/acknowledge` with a valid, in-scope, unexpired ack token.
It does **not** move when the item appears in a list view, and it does **not** move on any GET.
Clearing the badge on list rendering would collapse the entire product promise.

**Baseline stored:** the exact price rendered, that price's `market_timestamp`, the publication
watermark actually served, and `instruments.corporate_action_version` at that moment. We store what
was displayed rather than reconstructing a historical bar later, because reconstruction guesses and
the user's memory does not.

**Same instrument in multiple watchlists:** exactly one checkpoint, shared. Reading AAPL from "Tech"
also marks it read in "Long-term" — correct, because you now know what AAPL did. This is why the key
is `(user, instrument)`.

**Removal and re-add:** removing a watchlist item does **not** delete the checkpoint. Re-adding
within a 30-day retention window resumes it, so you see what you missed. Beyond the window, or on an
explicit "reset," the checkpoint is re-initialized to current. Deleting on removal would let an
accidental remove-and-re-add silently destroy history — an irreversible loss from a reversible
action.

**Multiple devices:** no coordination, no locking. Every write is `GREATEST(existing, new)` on the
sequence; the baseline comes from the acknowledgement with the newest `market_timestamp`. The
checkpoint only ever moves forward; concurrent devices converge and the "loser" simply sees an
already-read item.

**Never:** the client cannot author a cursor, baseline price, or timestamp. All three originate
server-side and are integrity-protected in transit by the ack token.

---

## I. Market Data Semantics

Every exposed value is an envelope:

```text
{ value, currency, market_timestamp, ingested_at, source,
  market_status, value_kind, data_freshness, precision_hint }
```

- **`market_timestamp`** — when this was true *in the market*. The only timestamp valid for
  financial comparison, ordering, or elapsed-time math.
- **`ingested_at`** — when *we* learned it. Freshness, staleness alerting, debugging. Never used in
  a financial calculation.
- **`source`** — provider + endpoint + adapter version. Audit, and the future `ObservationSelector`.
- **`market_status`** — what the venue is doing: `PRE_OPEN`, `OPEN`, `POST`, `CLOSED`, `HALTED`,
  `SUSPENDED`, `DELISTED`.
- **`value_kind`** — what sort of number this is: `LIVE`, `DELAYED_FEED`, `SESSION_CLOSE`,
  `LAST_TRADE`, `LAST_KNOWN`, `INDICATIVE`.
- **`data_freshness`** — recency trust: `FRESH`, `DELAYED`, `STALE`, `UNAVAILABLE`, `CONFLICTED`.

`CONFLICTED` has no producer with a single provider; it exists so the enum need not widen when
`ObservationSelector` becomes real. That is a seam, not machinery.

| Situation | Envelope | UI |
|---|---|---|
| Market closed, Friday's close held | `CLOSED` / `SESSION_CLOSE` / `FRESH` | "Close, Fri 4:00pm ET"; no live indicator |
| Contractually delayed feed | `OPEN` / `DELAYED_FEED` / `DELAYED` | "15-min delayed" badge |
| Provider silent past threshold, market open | `OPEN` / `LAST_KNOWN` / `STALE` | Muted, "last updated 47m ago", de-weighted rank |
| No data for the instrument | `—` / `—` / `UNAVAILABLE` | "Warming up" / "Data unavailable"; comparison suppressed |
| Halted | `HALTED` / `LAST_TRADE` / `FRESH` | Status prominent, not the price |
| Stock split effective | New `CorporateAction(SPLIT, factor)`; `corporate_action_version` bumped | Baseline adjusted at read time; "adjusted for 4-for-1 split" |
| Unsupported action (merger, spin-off) | Action recorded with `is_supported = false` | `SUPPRESSED_CORPORATE_ACTION`; never estimated |

**Splits in detail:** stored checkpoint baselines are **not** rewritten when a split lands. We
compute `factorBetween(baseline_version, current_version)` at read time from `corporate_actions`.
Rewriting rows is a fan-out write across every affected user and is unrecoverable if the factor is
later corrected; read-time computation is a two-row lookup and trivially reversible.

---

## J. Worker / API Process Boundary

Both processes are TypeScript/Node. The boundary is **architectural, not linguistic**, and is
enforced by four independent mechanisms — none of which depends on the language:

1. **Separate entrypoints and processes.** `worker/` and `api/` build and start independently. The
   API never imports from `worker/src`; the worker never imports from `api/src`. Neither may spawn
   the other.
2. **Separate runtime configs.** Two `.env` files. `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY`
   exist only in the worker's environment. `ACK_TOKEN_SECRET` and the session secret exist only in
   the API's. Neither file is readable by the other process by convention or by deployment.
3. **Separate DB roles.** `stockwatch_worker` and `stockwatch_api` with the grants in §C. The API
   cannot write market facts; the worker cannot read user rows. This is the load-bearing control.
4. **Separate dependency sets.** The official Alpaca SDK is a dependency of `worker/` only. A
   lint/CI rule fails the build if `api/` or `web/` imports it, directly or transitively.

**What crosses:** nothing but rows in PostgreSQL. No RPC, no message bus, no shared runtime state.
The schema *is* the interface — a single, inspectable, migration-versioned contract.

- **Migration ownership** — one migrations directory, plain SQL, forward-only, **executed by the
  API**. The worker never runs migrations; it fails fast at startup if the applied migration version
  is below the one it requires.
- **Write ownership** — market-fact tables are worker-write; personal tables and
  `instrument_tracking` are API-write; `jobs` is shared. Enforced by grants (§C), not convention.
- **Decimals** — `NUMERIC(18,6)` in Postgres, a decimal library in Node, strings on the wire.
  **No binary floating point in any authoritative money or percentage path**, including JSON
  serialization. The `pg` driver is configured so `NUMERIC` parses to a string, never to a JS
  `number`. The exact library choice is recorded in the implementation plan.
- **Timestamps** — `TIMESTAMPTZ`, UTC, always. Sessions and trading-day boundaries come from an
  explicit exchange calendar with an IANA timezone, never server-local time. Display-time conversion
  only, in the frontend.
- **Enums** — Postgres native enum types are the source of truth, mirrored once in the shared
  contracts package (below). A schema-vs-code consistency test in CI keeps them honest.
- **Change-record representation** — shared explanation and ranking inputs are plain columns plus a
  `jsonb` evidence blob written by the worker and read by the API. Versioned by `assembly_version` /
  `detector_version`. The API treats the blob as **display-and-drill-down data only** — it never
  re-derives a decision from it, keeping signal logic single-homed in the worker.

### Shared contracts package

One small internal package, `packages/contracts`, holding **only** what both processes must agree on
and where duplication would cause real drift:

- canonical domain enums (mirroring the Postgres enum types)
- the decimal-safe value type and its wire-format helpers
- timestamp contracts (UTC-only branded types)
- provider-neutral domain DTOs (`Observation`, `ValueEnvelope`, `SignalEvidence`)
- validation schemas for those shapes

**It contains no financial or domain logic.** Ownership stays single-homed:

```text
worker owns: market normalization · feature extraction · signal detection ·
             ChangeAssembler · scoring · publication · shared explanation text
API owns:    authentication · authorization · checkpoint diff · personal ranking ·
             personal explanation clause · read-model assembly
```

Sharing a language must not become an excuse to move either side's logic into the other, or into the
shared package. The market domain and the user domain do not mix: no user type may be imported by
the worker, and no Alpaca-shaped type may exist outside the worker's provider adapter.

**Maintenance cost:** one toolchain, one CI path, one type system. The cross-language coordination
tax of the previous design is gone. The remaining risk is the opposite one — accidental coupling
between two processes that can now trivially import each other — which the import-boundary lint rule
and the DB grants exist to prevent.

---

## K. Explanation Architecture

Both model options operate **once per shared `ChangeRecord`**, with the result cached against
`(change_record_id, renderer_version)`. Neither scales with users × instruments; both scale with
published change records. The personal clause is template-generated in all cases.

| | Templates only | Local (Gemma-class) | API-hosted |
|---|---|---|---|
| **Invocation volume** | per change record | per change record | per change record |
| **Latency (cache miss)** | <1ms | 300ms–3s, spiky under concurrency | 500ms–2s + network |
| **Latency (cache hit)** | — | ~0 | ~0 |
| **RAM** | ~0 | **4–8GB resident, contends with Postgres** | ~0 |
| **Compute** | ~0 | sustained local CPU/GPU during generation | none locally |
| **Runtime cost** | free | hardware already owned | **per-token, bounded by change-record volume** |
| **Runtime complexity** | none | model fetch/versioning, inference runtime, resource limits, warmup | SDK, keys, retries, quota |
| **External dependency** | none | none — works offline | **hard dependency on a third party** |
| **Privacy / egress** | total | total; stays on the box | **market facts leave our infrastructure**; ToS / redistribution review needed |
| **Failure behavior** | cannot fail | timeout/OOM → template fallback | timeout/quota/outage → template fallback |

**Decision: templates only for the initial build**, behind the `ExplanationRenderer` interface.
Templates produce genuinely good output for this fact shape, and either model adds a dependency
(RAM contention locally; a third party and an egress boundary remotely) for prose polish on the
shared half of a sentence.

If a model is added later: **local buys privacy and independence at the price of RAM and runtime
complexity; hosted buys simplicity and zero RAM at the price of token cost, network latency, an
external availability dependency, and a data-egress boundary.** On a machine where Postgres is
load-bearing, RAM contention is the sharper constraint.

---

## L. Redis Decision

**No. Not in the initial build.** Not as cache, session store, queue, or rate limiter.

Postgres handles: the hot shared read (`instrument_market_state` is one row per instrument, a few
hundred KB, permanently resident in shared buffers, served by primary-key lookup); the inbox query
(two bounded index scans); sessions (an indexed lookup, cheaper than a network hop); the job queue
(`FOR UPDATE SKIP LOCKED`, transactionally correct at this scale); rate limiting (a per-identity
counter row, approximate but adequate for a single API instance).

Adding Redis now would cost RAM, add a second consistency domain, and create the specific hazard
this design most wants to avoid: application semantics depending on a non-durable store. Cache
invalidation on checkpoint writes is exactly where "why does it say I already read this?" comes from.

| Trigger | Measured condition | What Redis would do |
|---|---|---|
| Shared read pressure | p99 market-state read >50ms with correct indexes, sustained | Cache read model per instrument |
| Session scale | Session lookups a measurable fraction of DB load | Move sessions out |
| Exact rate limiting | >1 API instance and approximate limits proven insufficient | Distributed token bucket |
| Websocket fan-out | Real-time push added *and* multiple API instances | Pub/sub |
| Job throughput | `SKIP LOCKED` contention visible in `pg_stat_activity` at sustained rates | Dedicated queue (Redis probably still wrong) |

None can occur at initial scale.

---

## M. Failure Model

| Failure | User impact | System behavior | Initial mitigation |
|---|---|---|---|
| Provider unreachable / 5xx | Prices freeze at last known | Job retries with exponential backoff + jitter; market state untouched | Freshness decays `FRESH→DELAYED→STALE`; UI labels it; rank de-weighted |
| Provider rate-limits us | Slower refresh | Global token bucket; backoff on 429 | Prioritize by staleness × follower_count; never fan out per user |
| Malformed / implausible provider data | None visible | Observation rejected at validator; prior state retained | Rejection logged with reason + payload hash; counter exposed |
| Worker crashes mid-cycle | Prices freeze | Job lease expires; another attempt reclaims it | All writes idempotent; restart is safe |
| Duplicate / retried job | None | Upserts collapse on natural keys and dedupe keys | Idempotency key on job; signal uniqueness on `(instrument_id, detector_version, dedupe_key)` |
| Out-of-order observation | None | Older observation cannot overwrite newer state | `WHERE excluded.market_timestamp > existing.market_timestamp` |
| Event arrives late | A new unseen item appears, correctly dated | Signal emitted with the event's true `market_timestamp`; if its window's record is published, the assembler opens a **new** record with a fresh `published_seq` | No re-publication, no re-notification; late info still reaches the user |
| Stock split | Must not show −75% | Read-time baseline adjustment via `corporate_action_version` | Named regression test |
| Unsupported corporate action | "Unavailable", not a wrong number | `comparison_status = SUPPRESSED_CORPORATE_ACTION` | Explicit label + prompt to reset baseline |
| Model unavailable / slow / invalid | None | Timeout → template fallback | Renderer optional by construction |
| Tampered / expired ack token | Acknowledgement rejected | 400/401; checkpoint untouched | HMAC verification + scope + expiry checks |
| Replayed ack token | None | `GREATEST` makes it a no-op | Monotonic checkpoint |
| Postgres unavailable | Full outage | API 503; worker retries | Accepted single point of failure; stated explicitly |
| Instrument added, not yet ingested | "Warming up" for one cycle | Backfill job enqueued; checkpoint awaits baseline | Honest state, not a spinner over a synchronous fetch |
| Two devices acknowledge simultaneously | None | `GREATEST()` monotonic merge | No locking needed |
| Insufficient bar history | No price signals, events only | `INSUFFICIENT_HISTORY` flag | Predicates gated on `bars_available ≥ 20` |

---

## N. Security Boundaries

**Boundary 1 — provider.** The Alpaca key pair (`ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`)
exists in the worker's environment and nowhere else: not in the API env, not in the frontend, not in
shared config, not in source control. The official Alpaca SDK is a dependency of the worker package
only, enforced by an import-boundary rule in CI. Provider responses are untrusted input,
schema-validated and plausibility-checked before persistence. Payloads are
never logged in a form that could include credentials.

**Boundary 2 — database roles.** `stockwatch_api` has no write grant on market-fact tables and no
route to the provider, turning "the API must never fetch market data" from convention into an
enforced property. `stockwatch_worker` has no read grant on user, session, watchlist, or checkpoint
tables, so a worker bug cannot leak personal data in principle.

**Boundary 3 — client.** Fully untrusted. Identity comes from the authenticated server-side session,
never from a payload or path parameter. Every user-owned resource is authorized by ownership on
every request, including reads. Watchlist IDs are opaque, but that is defense in depth, not the
control. The client cannot author a read cursor, baseline, or price; the ack token is
integrity-protected by HMAC with a server-only secret, is scope-checked against the session user and
path instrument, and expires.

**Egress boundary — model.** If a model is added, it is an external data sink even when local:
shared market facts only, no user identifiers, no watchlist composition, no timing that could
identify individual behavior. A hosted model additionally requires review of whether market data may
contractually leave our infrastructure.

**Baseline hygiene:** parameterized queries only; all API inputs validated at the boundary with a
schema library; rate limits on auth and instrument-add routes; secrets from environment/secret store
with `.env` gitignored; passwords hashed with argon2id; session cookies `HttpOnly`, `Secure`,
`SameSite`; the ack-token HMAC secret in the API environment only, rotatable (rotation invalidates
outstanding tokens, acceptable given the short TTL); no secrets, tokens, or session IDs in logs;
dependency audit in CI.

Deliberately not an identity project — no external OAuth, no RBAC matrix, no MFA, no audit-log
subsystem.

---

## O. Testing Priorities

The small set protecting semantics whose failure is invisible or catastrophic.

1. **`split_across_checkpoint_does_not_report_crash`** — baseline $180 pre-split; 4-for-1 split;
   price $46. Must report ≈ +2.2%, never −74%.
2. **`unsupported_corporate_action_suppresses_comparison`** — action with `is_supported = false`;
   diff returns `SUPPRESSED`, not an estimate.
3. **`older_observation_cannot_overwrite_newer_state`** — apply T+10, then replay T+5; state remains
   T+10.
4. **`duplicate_job_execution_is_idempotent`** — run the same ingestion job twice; no duplicate bars,
   no duplicate signals **for each of the four dedupe-key classes**, including two distinct events
   sharing a timestamp; no second `published_seq` for an already-sealed record.
5. **`cross_user_authorization_denied`** — user A cannot read, modify, or acknowledge user B's
   watchlist, item, instrument view, or checkpoint. Parameterized across every user-owned route.
6. **`since_last_check_arithmetic_is_exact`** — table/property test over baseline, current, elapsed,
   sessions; decimal exactness, no float drift, correct sign, correct session counting across
   weekends and holidays.
7. **`checkpoint_moves_only_via_post`** — a GET of the detail view leaves the checkpoint untouched;
   only the POST advances it; the sequence never regresses under concurrent acknowledgement.
8. **`ack_token_integrity`** — tampered token rejected; expired token rejected; token scoped to
   another user or instrument rejected; replayed valid token is a no-op.
9. **`published_seq_is_monotonically_ordered_per_instrument`** — ordering holds under concurrent
   publication; gaps are explicitly tolerated.
10. **`provider_normalization_golden_files`** — recorded payloads (including malformed, null-price,
    and future-timestamped) → expected internal `Observation` or expected rejection reason.
11. **`stale_data_is_labelled_not_hidden`** — no update for N minutes during an open market yields
    `STALE`, a visible label, and a de-weighted rank; never a hidden row or a confident wrong number.
12. **`insufficient_history_emits_no_price_signals`** — 5 bars produces no σ-based signal, no NaN, no
    divide-by-zero.
13. **`signal_scoring_is_bounded_and_non_double_counting`** — all four price signals at maximum
    yields score `<1.0` and no more than the `PRICE_MOVE` group's weighted contribution.
14. **`explanation_renderer_falls_back`** — with the model renderer forced to throw, hang past
    timeout, and return a hallucinated number, the response is still correct and template-rendered.

Everything else gets ordinary light coverage.

---

## P. What We Build Now

**Scope:** one exchange group, US equities only, one provider, one worker, one API, one Postgres,
one frontend.

**TypeScript worker:** `ProviderAdapter` (`FixtureAdapter`, then `AlpacaAdapter` on the official
Alpaca Node SDK) · validation +
plausibility gate · `ObservationSelector` (trivial: accept if valid and admissible) · normalizer ·
daily-bar backfill and maintenance · market-state upsert with monotonic guard · earnings/event
ingestion · split detection + `AdjustmentPolicy` (splits supported; others recorded-and-flagged) ·
`FeatureExtractor` · 8 signal predicates with deterministic dedupe keys · `ChangeAssembler` v1 ·
noisy-OR scorer v1 · publisher with per-instrument `published_seq` and sealing · shared template
explanation · Postgres job runner with `SKIP LOCKED`, leases, idempotency keys, retries.

**Postgres:** the entities in §E including `instrument_tracking` · two DB roles with the grants in
§C · indexes for the two bounded read paths · unpartitioned tables designed so `instrument_bars` can
be partitioned later.

**TypeScript API:** session auth (email + password) · ownership authorization on every user-owned
route · watchlist and item CRUD · `instrument_tracking` maintenance · symbol resolution + backfill
enqueue · checkpoint lifecycle · ack-token mint on GET / verify on POST · read-model assembly (two
bounded queries) · `DiffEngine` · `PersonalRanker` · `ExplanationRenderer` interface +
`DeterministicTemplateRenderer` for the personal clause · input validation · rate limits on auth and
add-instrument.

**Frontend:** login · watchlist management · **the inbox view** (attention-ranked, "changed since you
last checked", unseen badges) · instrument detail with full evidence drill-down and explicit
acknowledgement POST · honest freshness/status/warming states · formatting only, no derivation.

**Tests:** the fourteen in §O.

**Demo path:** add AAPL → asynchronous ingestion → leave → earnings and an unusual move occur →
signals and a change record are published → return two days later → AAPL ranks top → see exactly
what changed against *your* baseline → drill into deterministic evidence → acknowledge → badge
clears and baseline advances.

Cut order if time runs short: model renderer (already optional) → signals 6 and 4 → multiple
watchlists per user → password reset. Do not cut the evidence drill-down.

---

## Q. What We Deliberately Defer

| Deferred | Trigger to build it |
|---|---|
| Redis (any use) | A measured condition from the §L table |
| Multi-provider consensus / failover / hysteresis | A second contracted provider exists |
| **Partial acknowledgement** (per-record dismissal, swipe-to-dismiss) | UX requires acknowledging a subset; extends the ack-token payload from a watermark to a record-id set |
| Materiality / revision / re-notification framework | Published records must be corrected in a user-visible way |
| Episode revision state machine / supersession graph | Same |
| Historical episode regrouping | `assembly_version` 2 ships *and* re-deriving history matters to users |
| Reprocessing blast-radius system | A detector bug requires bounded, auditable recomputation |
| Full corporate-action engine (dividends, spin-offs, mergers) | Users hit the "suppressed" label often enough to complain — instrumented, so we will know |
| Intraday bars / tick data | A signal genuinely requires sub-daily resolution |
| Table partitioning | `instrument_bars` reaches millions of rows *and* retention is measurably slow |
| Read replicas | Read load measurably affects write latency |
| Push notifications / websockets to the browser | Users ask to be interrupted rather than to check |
| **Alpaca WebSocket market-data streaming** | A signal genuinely requires sub-minute latency that polling cannot meet; lands behind the existing `ProviderAdapter` seam |
| ML / personalized ranking | Deterministic ranking is demonstrably wrong, with data to show it |
| User-configurable thresholds | Users articulate specific, differing thresholds |
| Multi-asset-class, multi-exchange | The single-market slice is complete and compelling |
| Kafka / K8s / microservices / CQRS / event sourcing | No candidate trigger at any foreseeable scale |

Each lands behind an existing seam: `ObservationSelector` for providers, `AdjustmentPolicy` for
actions, `assembly_version` for episodes, `ExplanationRenderer` for models, the `jobs` table for
queueing, the ack-token payload for partial acknowledgement.

---

## R. Time/Risk Analysis

1. **Alpaca capability reality.** Rate limits, pagination, feed tiers (IEX vs SIP), half-populated
   fields, non-obvious timestamp semantics, and — most importantly — **whether the account's tier
   exposes corporate actions and earnings dates at all**. *Constrain:* spike one symbol through the
   official SDK and dump the raw response before designing the adapter; record real payloads as
   golden fixtures immediately. *Simplify:* if earnings dates are unavailable, seed a static events
   table for the demo universe with `source` explicitly marked as seeded — never silently faked.
2. **Schema freeze.** The first migration is never right, and every table is consumed by two
   processes. *Constrain:* freeze the schema in one session before either service is written; single
   plain-SQL migrations directory executed by the API. *Simplify:* start over-permissive (nullable,
   `jsonb` evidence) and tighten later. Cheaper than in the previous design — one language, one
   toolchain, no rebuild round-trip.
3. **Corporate-action / split correctness.** Touches ingestion, adjustment, checkpoint, and diff at
   once, and is the thing most likely to produce a −75% on stage. *Constrain:* splits only; write
   test §O.1 first and let it drive implementation. *Simplify:* read-time adjustment, never baseline
   rewriting.
4. **Signal tuning rabbit-holing.** Thresholds are endlessly adjustable and adjusting them feels like
   progress. *Constrain:* ship the §G constants as written; touch only if output is visibly absurd;
   timebox any tuning to 30 minutes. *Simplify:* pick the demo universe first (30–50 liquid tickers
   with a known recent earnings event), then sanity-check once.
5. **The optional model.** Highest ratio of hours to judged value. *Constrain:* stretch goal only,
   after the slice is demo-solid. *Simplify:* demo the `ExplanationRenderer` interface with the
   template implementation and show the seam.

**Net effect of the stack change:** the 4–8 hours of cross-language coordination overhead is
removed, as is the Rust-fluency schedule risk. The dominant remaining risk moves to item 1 — Alpaca
capability verification — which now deserves the first hour of implementation time.

Honorable mention: frontend polish. The inbox view is the product and deserves care; everything else
should be plain.

---

## S. Acceptance Checklist (accepted)

**Product**
- [x] The primary view answers "what changed since I last looked," not "what is the price"
- [x] Attention ranking is explainable without a model, with evidence drill-down
- [x] The demo path in §P works end to end

**Shared vs personal**
- [x] Market ingestion scales with unique instruments, never users × instruments
- [x] No table receives one write per user per market update
- [x] One popular ticker cannot cause provider amplification
- [x] Explanation rendering runs once per ChangeRecord and is cached, in every renderer

**Read path**
- [x] User reads never call a market provider under normal operation
- [x] The API is structurally incapable of provider calls (credentials + DB role)
- [x] Watchlist reads are bounded — two queries, no N+1, no per-user fan-out
- [x] No GET request mutates a checkpoint or any other user state

**Financial truth**
- [x] Every financial value is computed deterministically by the system
- [x] No float anywhere in a money or percentage path, including the wire format
- [x] The frontend formats canonical API values but derives no financial semantics
- [x] The model is optional, outside financial truth, and cannot alter a number, rank, or band
- [x] The product is fully functional with the model absent, slow, or wrong

**Semantics**
- [x] Since-last-check semantics are explicit and defined for every edge case in §H
- [x] Checkpoint is keyed `(user, instrument)` and only ever moves forward
- [x] Acknowledgement requires a POST carrying a server-signed token; the client cannot author the
      watermark, baseline, or corporate-action version
- [x] Token verification is stateless HMAC — no token storage, revocation list, or cleanup job
- [x] Token scope is validated against the session user and path instrument, and is expiry-bounded
- [x] Market status, value kind, and freshness are three distinct fields
- [x] Split handling is defined and covered by a named regression test
- [x] Unsupported corporate actions suppress-and-label rather than guess

**Publication**
- [x] `published_seq` is assigned exactly once per ChangeRecord; published records are sealed
- [x] In-place updates to a published record never advance `published_seq` and never re-surface it
- [x] Signals arriving after publication open a new record, so late information still reaches users
- [x] The invariant is monotonic ordering per instrument, not gaplessness; gaps are tolerated
- [x] No materiality, revision, or re-notification logic exists in v1

**Reliability**
- [x] An older observation cannot overwrite newer market state
- [x] Every ingestion write is retry-safe and idempotent
- [x] Every signal carries a deterministic, class-appropriate `dedupe_key`; uniqueness is
      `(instrument_id, detector_version, dedupe_key)`
- [x] Repeated acknowledgement POSTs are idempotent no-ops
- [x] Provider unavailability degrades to labelled staleness, not wrong numbers

**Ownership**
- [x] The API writes no market facts — only personal state, `instrument_tracking`, job enqueues, and
      initial instrument registration
- [x] `instrument_tracking` carries ingestion demand only, never market data
- [x] The worker's poll set comes from `instrument_tracking`; it holds no read grant on any user or
      watchlist table
- [x] Database grants enforce both directions, not convention

**Boundaries**
- [x] Provider types terminate at the adapter; no provider JSON in application code
- [x] The worker/API contract is the database schema and nothing else; neither imports the other
- [x] The Alpaca SDK is a dependency of the worker only, enforced by an import-boundary rule
- [x] No domain logic is implemented twice; each domain has one owning process
- [x] Every abstraction has a current owner and a concrete first implementation
- [x] Deferred mechanisms have seams, not partial implementations

**Infrastructure**
- [x] Postgres is sufficient; no Redis, no queue broker, no distributed infrastructure
- [x] Deferred items each have a written, measurable trigger
- [x] Nothing built now blocks evolution toward the production architecture

---

## T. Open Questions (resolve before or during implementation)

1. **Alpaca account tier and feed** (IEX vs SIP), and whether it exposes **corporate actions** and
   **earnings dates**. If it does not, the seeded-events fallback in §R.1 becomes part of the plan
   rather than a contingency. This is the only remaining question that blocks a task.
2. **Available time and headcount.** §P is sized for roughly a full hackathon with 2–3 people.
   Materially less means cutting to 4 signals and a single watchlist per user.
3. **Auth expectation** — assumed email + password sessions. A magic link or external OAuth is a
   scope change.
