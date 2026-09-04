# Stockwatch — Implementation Plan

> **Status:** Accepted; implementation in progress (rev. 2 — TypeScript worker on the official
> Alpaca Node SDK).
> **For executors resuming work:** read `CLAUDE.md`, then `docs/plans/current-state.md` (task
> handoff — current task, decisions, exact files), then only the current task's section below.
> Read `docs/architecture/initial-architecture.md` in full only when the current task changes an
> architectural boundary, the plan explicitly points to a section, or there's an ambiguity/conflict
> — not to look up constants or contracts that `current-state.md` should already reference.

## Progress

| Range | Status |
|---|---|
| T1–T21 | Done |
| T22 | Next — see `docs/plans/current-state.md` |
| T23–T37 | Pending |

---

## 1. Goal

Build the initial vertical slice of **Stockwatch**: a market watchlist that answers *"what has
meaningfully changed in the instruments I care about since I last checked, and what deserves my
attention now?"*

The slice is complete when this path works end to end:

```text
user adds AAPL → asynchronous ingestion → user leaves → earnings + an unusual move occur
→ signals and a sealed change record are published → user returns two days later
→ AAPL ranks top of the inbox → they see exactly what changed against THEIR baseline
→ they drill into deterministic evidence → they acknowledge → badge clears, baseline advances
```

---

## 2. Accepted architecture

Authoritative document: **`docs/architecture/initial-architecture.md`**. Not duplicated here.

The invariants below are referenced by task. Violating one is a plan failure, not a judgement call.

| ID | Invariant | Arch ref |
|---|---|---|
| **INV-1** | Ingestion scales with unique instruments, never users × instruments | §A, §D |
| **INV-2** | User-facing reads never call a market provider; the Alpaca SDK and credentials exist only in the worker | §C, §J |
| **INV-3** | The API writes no market facts; the worker reads no user/watchlist/checkpoint rows | §C |
| **INV-4** | An older observation can never overwrite newer market state | §F.2 |
| **INV-5** | All ingestion writes are idempotent; signals dedupe on `(instrument_id, detector_version, dedupe_key)` | §F.3, §G |
| **INV-6** | `published_seq` is assigned once; records are sealed; ordering is monotonic per instrument (gaps tolerated) | §F.3 |
| **INV-7** | No GET mutates user state; the checkpoint moves only via `POST` with a valid signed ack token | §F.6, §H |
| **INV-8** | The checkpoint is keyed `(user, instrument)` and only ever moves forward | §H |
| **INV-9** | All financial values are computed deterministically by the system; no binary floating point in any authoritative money/percentage path; values cross the wire as strings | §A, §J |
| **INV-10** | The frontend formats canonical API values but derives no financial semantics | §C |
| **INV-11** | Every exposed market value carries the full semantic envelope; status, value kind, and freshness are distinct | §I |
| **INV-12** | Unsupported corporate actions suppress the comparison; splits are adjusted at read time, never by rewriting baselines | §I |
| **INV-13** | Alpaca SDK types, DTOs, enums, and pagination concepts terminate at the adapter boundary | §C, §F.2 |
| **INV-14** | The explanation layer is optional, renders once per shared ChangeRecord, and cannot originate a number | §F.7, §K |
| **INV-15** | Every user-owned resource is authorized by ownership on every request; identity comes from the session, never the payload | §N |
| **INV-16** | Postgres is the only stateful system. No Redis | §L |
| **INV-17** | Worker and API are separate processes with separate entrypoints, configs, dependency sets, and DB roles. Neither imports the other | §J |

---

## 3. Repository / runtime structure

Single repository (npm workspaces), three runtime units plus one small shared package, one schema.
**Do not create these files yet.**

```text
/
├── CLAUDE.md
├── docs/
│   ├── architecture/initial-architecture.md
│   └── plans/implementation-plan.md
│
├── db/                                  # the inter-process contract (§J)
│   ├── migrations/                      # NNNN_name.sql, forward-only, executed by the API
│   ├── roles/roles.sql                  # stockwatch_api / stockwatch_worker grants
│   └── seeds/demo.sql                   # demo instrument universe + seeded events
│
├── packages/contracts/                  # shared ONLY: enums, decimal type, timestamps,
│   └── src/                             #   provider-neutral DTOs, zod schemas. NO domain logic.
│       ├── enums.ts                     # mirrors the Postgres enum types
│       ├── decimal.ts                   # Decimal type + wire (string) helpers
│       ├── time.ts                      # UTC-branded timestamp contracts
│       └── dto.ts                       # Observation, ValueEnvelope, SignalEvidence
│
├── api/                                 # TypeScript — Node 22, Fastify, pg, zod, vitest
│   ├── src/
│   │   ├── server.ts                    # app assembly, route registration
│   │   ├── config.ts                    # env parsing; DATABASE_URL, ACK_TOKEN_SECRET
│   │   ├── db.ts                        # pg Pool, parameterized query helper
│   │   ├── migrate.ts                   # migration runner over db/migrations
│   │   ├── market/
│   │   │   ├── envelope.ts              # ValueEnvelope assembly from a market-state row
│   │   │   └── repo.ts                  # read-only market queries
│   │   ├── auth/
│   │   │   ├── password.ts              # argon2id hash/verify
│   │   │   ├── session.ts               # session create/lookup/destroy
│   │   │   ├── middleware.ts            # requireSession
│   │   │   └── routes.ts                # register / login / logout
│   │   ├── watchlists/
│   │   │   ├── repo.ts
│   │   │   ├── tracking.ts              # instrument_tracking maintenance
│   │   │   ├── resolve.ts               # symbol → instrument, registration + job enqueue
│   │   │   └── routes.ts
│   │   ├── checkpoints/
│   │   │   ├── repo.ts                  # GREATEST-based monotonic upsert
│   │   │   ├── ackToken.ts              # stateless HMAC mint/verify
│   │   │   └── routes.ts                # POST /instruments/:id/acknowledge
│   │   ├── diff/
│   │   │   ├── adjustment.ts            # AdjustmentPolicy.factorBetween (read side)
│   │   │   ├── sessions.ts              # exchange calendar, session counting
│   │   │   └── engine.ts                # DiffEngine — since-last-check computation
│   │   ├── ranking/ranker.ts            # PersonalRanker
│   │   ├── explanation/
│   │   │   ├── renderer.ts              # ExplanationRenderer interface
│   │   │   └── personalTemplate.ts      # deterministic personal clause
│   │   ├── instruments/routes.ts        # GET detail (mints ack token)
│   │   ├── inbox/routes.ts              # GET watchlist inbox
│   │   └── jobs/enqueue.ts              # INSERT-only job enqueue
│   └── test/                            # vitest; integration tests use a real test DB
│
├── worker/                              # TypeScript — Node 22, pg, zod, vitest,
│   │                                    #   @alpacahq/alpaca-trade-api (worker ONLY)
│   ├── src/
│   │   ├── main.ts                      # entrypoint: startup, scheduler loop, shutdown
│   │   ├── config.ts                    # env; DATABASE_URL(worker role),
│   │   │                                #   ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY
│   │   ├── db.ts                        # pg Pool (worker role), NUMERIC-as-string
│   │   ├── scheduler.ts                 # poll-set selection from instrument_tracking
│   │   ├── jobs/
│   │   │   ├── queue.ts                 # claim via FOR UPDATE SKIP LOCKED, lease, retry
│   │   │   └── handlers.ts              # job type dispatch
│   │   ├── provider/
│   │   │   ├── index.ts                 # ProviderAdapter interface — the boundary (INV-13)
│   │   │   ├── alpaca/
│   │   │   │   ├── client.ts            # the ONLY file importing the Alpaca SDK
│   │   │   │   ├── dto.ts               # Alpaca-shaped types; not exported past provider/
│   │   │   │   └── adapter.ts           # AlpacaAdapter: SDK → domain Observation
│   │   │   └── fixture.ts               # FixtureAdapter — deterministic, used by all tests
│   │   ├── normalize/
│   │   │   ├── validate.ts              # schema + plausibility gate
│   │   │   ├── selector.ts              # ObservationSelector (v1: accept if admissible)
│   │   │   └── index.ts                 # provider DTO → domain Observation
│   │   ├── persist/
│   │   │   ├── marketState.ts           # monotonic-guarded upsert (INV-4)
│   │   │   ├── bars.ts
│   │   │   ├── events.ts
│   │   │   └── actions.ts               # corporate actions + version bump
│   │   ├── adjustment/index.ts          # AdjustmentPolicy (write side: split detection)
│   │   ├── features/index.ts            # FeatureExtractor
│   │   ├── signals/
│   │   │   ├── detectors.ts             # the 8 predicates
│   │   │   ├── dedupe.ts                # deterministic dedupe keys per signal class
│   │   │   └── index.ts
│   │   ├── assembly/
│   │   │   ├── assembler.ts             # ChangeAssembler v1, grouping, sealing
│   │   │   ├── scoringV1.ts             # strengths, groups, noisy-OR, bands
│   │   │   └── publisher.ts             # per-instrument published_seq allocation
│   │   ├── calendar.ts                  # exchange calendar / session arithmetic
│   │   └── explanation/template.ts      # shared sentence, renderer_version
│   └── test/
│       ├── fixtures/                    # golden Alpaca payloads (incl. malformed)
│       └── *.test.ts                    # integration tests against a test DB
│
└── web/                                 # TypeScript — Vite + React
    └── src/
        ├── api/client.ts                # typed fetch; never computes
        ├── format/                      # locale/currency formatting only (INV-10)
        ├── pages/{Login,Watchlists,Inbox,InstrumentDetail}.tsx
        └── components/{EnvelopeBadge,EvidencePanel,AttentionBand}.tsx
```

**Runtime:** Postgres 16 in Docker for local dev. `api` and `worker` are separate processes with
separate entrypoints, separate `.env` files, separate dependency sets, and separate DB roles
(INV-17). `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY` appear only in `worker/.env`;
`ACK_TOKEN_SECRET` only in `api/.env`. Both are gitignored.

**Decimal strategy (INV-9).** Recorded here as the accepted choice:

- Postgres stores money and ratios as `NUMERIC(18,6)`.
- The `pg` driver is configured with a type parser so `NUMERIC` (OID 1700) returns a **string**,
  never a JS `number`, in both processes.
- `decimal.js` is the single arithmetic library, wrapped in `packages/contracts/src/decimal.ts`
  as a `Decimal` type with a fixed precision and an explicit rounding mode. Chosen over `big.js`
  for its precision control and over native `BigInt` minor units because percentages and
  volatility ratios are not integer-scaled quantities.
- Values cross the HTTP wire as strings. No authoritative money or percentage value is ever a JS
  `number` at any point.
- A lint rule and a unit test forbid `Number()`, `parseFloat`, and arithmetic operators on any
  value typed `Decimal` or read from a `NUMERIC` column.

**Test strategy:** unit tests are pure-function tests (features, scoring, dedupe keys, diff
arithmetic, token verification). Integration tests run against a disposable Postgres created from
`db/migrations`. The `FixtureAdapter` makes ingestion tests fully deterministic — no network in any
test, including in the Alpaca adapter's contract tests.

---

## 4. Build phases

Vertical-slice ordered: a runnable, demonstrable product exists from the end of Phase 2 and gains
depth thereafter.

| Phase | Delivers | Depends on |
|---|---|---|
| **0. Foundation** | Workspace skeleton, Postgres, migration runner, shared contracts, test harnesses | — |
| **1. Schema & roles** | The full schema and the two DB roles — the inter-process contract | 0 |
| **2. Thin vertical slice** | Auth → watchlist → tracking → fixture ingestion → envelope read → web list | 1 |
| **3. History, features, signals** | Bars, feature extraction, the 8 detectors, dedupe keys | 2 |
| **4. Assembly & publication** | Grouping, noisy-OR scoring, sealed publication, shared explanation | 3 |
| **5. The product** | Checkpoint diff, ack tokens, inbox ranking, detail + evidence UI | 4 |
| **6. Corporate actions** | Split detection, read-time adjustment, suppression | 5 |
| **7. Reality & demo** | Staleness lifecycle, real provider adapter, demo seed, gate sweep | 6 |

---

## 5. Tasks

Every task ends in an independently verifiable deliverable and a commit. TDD throughout: write the
failing test, watch it fail, implement minimally, watch it pass, commit.

---

### Phase 0 — Foundation

#### T1. Workspace skeleton and toolchains
- **Objective:** Create the npm workspace with working build/test commands and nothing else.
- **Files:** root `package.json` (workspaces: `packages/*`, `api`, `worker`, `web`),
  `tsconfig.base.json`, `docker-compose.yml` (Postgres 16 only), `api/package.json`,
  `worker/package.json`, `web/package.json`, `packages/contracts/package.json`, per-unit
  `tsconfig.json` and `vitest.config.ts`, `.gitignore`, `.env.example` × 2, root `README.md`.
- **Invariants:** INV-16 (no Redis, no broker, no orchestration in compose), INV-17.
- **Depends on:** —
- **Behavior:** `docker compose up -d` starts Postgres. `npm test -w api|worker|web` each runs an
  empty suite green. `api` and `worker` have distinct `main`/`start` entrypoints.
- **Tests:** One trivial passing test per unit, proving the harness works.
- **Done when:** All test commands pass from a clean clone; no secret is committed; `.env.example`
  documents `DATABASE_URL` per role, `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY` (worker only),
  `ACK_TOKEN_SECRET` (api only).

#### T2. Migration runner
- **Objective:** A forward-only SQL migration runner owned by the API (§J).
- **Files:** Create `api/src/migrate.ts`, `api/src/db.ts`, `db/migrations/.gitkeep`; Test
  `api/test/migrate.test.ts`.
- **Invariants:** INV-9 (pool configured so `NUMERIC` parses to a decimal type, never JS `number`).
- **Depends on:** T1
- **Behavior:** Applies `db/migrations/NNNN_*.sql` in filename order inside a transaction each,
  recording applied names in `schema_migrations`. Re-running applies nothing. Unknown-order or
  missing-file states fail loudly.
- **Tests:** Applying twice is a no-op; a failing migration rolls back and leaves
  `schema_migrations` unchanged; `pg` returns `NUMERIC` as a string, asserted explicitly.
- **Done when:** `npm run migrate` is idempotent against a fresh database and the tests pass.

#### T3. Shared contracts package: decimal, time, enums, DTOs
- **Objective:** One money/percentage representation and one set of domain contracts for both
  processes, with no float path.
- **Files:** Create `packages/contracts/src/{decimal,time,enums,dto,index}.ts`; Test
  `packages/contracts/test/decimal.test.ts`.
- **Invariants:** INV-9, INV-17.
- **Depends on:** T1
- **Behavior:** `decimal.ts` wraps `decimal.js` with fixed precision and an explicit rounding mode,
  parses from a Postgres `NUMERIC` string, exposes add/sub/mul/div and comparison, and serializes to
  string for the wire. `time.ts` provides UTC-branded timestamp types. `enums.ts` mirrors the
  Postgres enum types. `dto.ts` holds `Observation`, `ValueEnvelope`, and `SignalEvidence`.
  **The package contains no financial or domain logic** — no feature extraction, no signal
  predicates, no diff arithmetic, no ranking.
- **Tests:** Values that lose precision as `float64` (`0.1 + 0.2`; the `183.42 → 194.91` percentage)
  round-trip exactly; the module exports no function returning `number` for a money value; a
  structural test asserts the package has no dependency on `api/`, `worker/`, or the Alpaca SDK.
- **Done when:** Tests pass and both `api` and `worker` import the money type from here only.

#### T4. Worker skeleton and the import-boundary rule
- **Objective:** A worker process that connects, logs, and exits cleanly — and a CI rule that keeps
  the two processes apart now that they share a language.
- **Files:** Create `worker/src/main.ts`, `worker/src/config.ts`, `worker/src/db.ts`,
  `eslint.config.js` (boundary rules); Test `worker/test/smoke.test.ts`,
  `api/test/importBoundary.test.ts`.
- **Invariants:** INV-2, INV-16, INV-17.
- **Depends on:** T3
- **Behavior:** Reads env (rejecting a missing `DATABASE_URL` or Alpaca key pair), opens a `pg` pool
  as `stockwatch_worker` with the `NUMERIC`-as-string parser, emits a structured startup log, shuts
  down on SIGINT. Fails fast if the applied migration version is below the one it requires.
- **Tests:** Config parsing rejects missing env; smoke test connects to the test DB. **Boundary
  test:** `api/` and `web/` may not import `@alpacahq/alpaca-trade-api`, `worker/src/**`, or any
  Alpaca DTO; `worker/` may not import `api/src/**`. Asserted by walking the built dependency graph,
  not only by lint config, so a transitive import also fails.
- **Done when:** All tests pass and the boundary test fails when a deliberate cross-import is added.
  **Gate: INV-17.**

---

### Phase 1 — Schema and roles

#### T5. Core schema migration
- **Objective:** The full initial schema in one reviewed migration — the inter-process contract.
- **Files:** Create `db/migrations/0001_init.sql`; Test `api/test/schema.test.ts`.
- **Invariants:** INV-4 (guard-ready columns), INV-5 (unique constraint on signals), INV-6
  (`instruments.last_published_seq`), INV-8 (unique `(user_id, instrument_id)` on checkpoints),
  INV-9 (`NUMERIC(18,6)`, `TIMESTAMPTZ`), INV-11 (three separate enum columns).
- **Depends on:** T2
- **Behavior:** Creates the entities in architecture §E: `users`, `sessions`, `watchlists`,
  `watchlist_items`, `instruments` (with `corporate_action_version`, `last_published_seq`,
  `resolution_status`), `instrument_symbols`, `instrument_tracking`, `instrument_market_state`,
  `instrument_bars`, `market_events`, `corporate_actions`, `instrument_signals`, `change_records`,
  `user_instrument_checkpoints`, `jobs`. Postgres enum types for `market_status`, `value_kind`,
  `data_freshness`, `signal_type`, `attention_band`, `job_status`, `tracking_state`.
  Key constraints: `instrument_bars` unique `(instrument_id, session_date)`; `instrument_signals`
  unique `(instrument_id, detector_version, dedupe_key)`; `change_records` unique
  `(instrument_id, published_seq)` where published; checkpoints unique `(user_id, instrument_id)`;
  `jobs` unique on `idempotency_key`.
  No partitioning. Indexes for exactly two read paths: the inbox join and the unseen-changes scan.
- **Tests:** Schema introspection asserts every table, enum, unique constraint, and the two indexes
  exist; asserts no money column is `double precision`.
- **Done when:** Migration applies cleanly on a fresh DB and the introspection test passes.

#### T6. Database roles and grants
- **Objective:** Make INV-3 an enforced property rather than a convention.
- **Files:** Create `db/roles/roles.sql`, `db/migrations/0002_roles.sql`; Test
  `api/test/grants.test.ts`.
- **Invariants:** INV-2, INV-3.
- **Depends on:** T5
- **Behavior:** Creates `stockwatch_api` and `stockwatch_worker` with exactly the grants in
  architecture §C, including column-level grants so the API cannot write
  `instrument_tracking.last_ingested_at` and the worker can write only that column.
- **Tests:** Connected as `stockwatch_api`, an `INSERT` into `instrument_market_state`,
  `instrument_bars`, `market_events`, `corporate_actions`, `instrument_signals`, and
  `change_records` each raises a permission error. Connected as `stockwatch_worker`, a `SELECT` from
  `users`, `sessions`, `watchlists`, `watchlist_items`, and `user_instrument_checkpoints` each
  raises a permission error.
- **Done when:** Both negative-permission test groups pass. **This test file is a permanent gate —
  never weaken it to make a feature work.**

#### T7. Enum mirror consistency test
- **Objective:** Keep `packages/contracts/src/enums.ts` and the Postgres enum types in lockstep.
- **Files:** Modify `packages/contracts/src/enums.ts`; Test
  `packages/contracts/test/enums.consistency.test.ts`.
- **Invariants:** INV-11.
- **Depends on:** T5, T3
- **Behavior:** The test queries `pg_enum` and asserts the value sets match exactly in both
  directions for every enum type.
- **Done when:** The test passes, and adding a value to the DB without updating the mirror fails CI.
  One mirror, not two — the second language is gone.

---

### Phase 2 — Thin vertical slice

#### T8. Password hashing and sessions
- **Objective:** Server-side identity.
- **Files:** Create `api/src/auth/password.ts`, `api/src/auth/session.ts`,
  `api/src/auth/middleware.ts`; Test `api/test/auth.session.test.ts`.
- **Invariants:** INV-15.
- **Depends on:** T5, T3
- **Behavior:** argon2id hash/verify; opaque session tokens stored hashed with expiry; a
  `requireSession` decorator that populates `request.user` from the cookie and **never** from a
  body, query, or path value.
- **Tests:** Wrong password rejected; expired session rejected; a request supplying a `user_id` in
  the body is ignored; session cookie flags are `HttpOnly`, `Secure`, `SameSite=Lax`.
- **Done when:** Tests pass; no plaintext password or session token appears in any log.

#### T9. Auth routes and rate limiting
- **Objective:** Register / login / logout.
- **Files:** Create `api/src/auth/routes.ts`, `api/src/server.ts`; Test `api/test/auth.routes.test.ts`.
- **Invariants:** INV-15.
- **Depends on:** T8
- **Behavior:** `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`. All inputs validated
  with zod at the boundary. A per-identity counter row rate-limits login attempts (INV-16 — no
  Redis).
- **Tests:** Happy path; malformed payload rejected with 400 and no DB write; the rate limit trips
  after N attempts and recovers after the window.
- **Done when:** Tests pass and the server boots.

#### T10. Watchlist CRUD with ownership authorization
- **Objective:** User-owned lists, correctly authorized.
- **Files:** Create `api/src/watchlists/repo.ts`, `api/src/watchlists/routes.ts`; Test
  `api/test/watchlists.authz.test.ts`.
- **Invariants:** INV-15.
- **Depends on:** T9
- **Behavior:** Create, rename, list, delete. Every handler — **including reads** — verifies the row
  belongs to `request.user.id` and returns 404 (not 403) on mismatch.
- **Tests:** `cross_user_authorization_denied` — user A gets 404 for every verb against user B's
  watchlist. Written as a parameterized table over all routes so new routes must be added to it.
- **Done when:** The parameterized authorization test passes for every registered user-owned route.
  **Gate §O.5.**

#### T11. Symbol resolution, instrument registration, job enqueue
- **Objective:** Add an instrument to a watchlist without ever calling a provider.
- **Files:** Create `api/src/watchlists/resolve.ts`, `api/src/jobs/enqueue.ts`; Modify
  `api/src/watchlists/routes.ts`; Test `api/test/watchlists.additem.test.ts`.
- **Invariants:** INV-1, INV-2, INV-3.
- **Depends on:** T10, T6
- **Behavior:** `POST /watchlists/:id/items { symbol }` resolves via `instrument_symbols`; on miss,
  inserts an instrument in `PENDING_RESOLUTION` plus its symbol row and enqueues
  `resolve_instrument`; inserts the watchlist item; enqueues `backfill_bars` when no market state
  exists. Responds 201 with `state: WARMING` when data is not yet available.
- **Tests:** No outbound HTTP occurs (assert via a network-blocking test hook); a duplicate add is
  idempotent at the item level; the enqueued job carries an idempotency key; adding an unknown
  symbol yields `WARMING`, not an error.
- **Done when:** Tests pass and the API makes zero network calls on this path. **Gate: INV-2.**

#### T12. instrument_tracking maintenance
- **Objective:** The API's only write surface for ingestion demand (architecture §E, correction 4).
- **Files:** Create `api/src/watchlists/tracking.ts`; Modify `api/src/watchlists/routes.ts`; Test
  `api/test/tracking.test.ts`.
- **Invariants:** INV-1, INV-3.
- **Depends on:** T11
- **Behavior:** On add, upsert tracking with `follower_count + 1` (distinct users), `ACTIVE`, and a
  priority derived from follower count. On remove, decrement; at zero, set `IDLE`. Never writes
  `last_ingested_at`. Includes a reconciliation function that recomputes `follower_count` from
  watchlist items.
- **Tests:** The same user adding an instrument to two watchlists increments `follower_count` once;
  removing from one of the two leaves it at 1; removing from both sets `IDLE`; an attempted write to
  `last_ingested_at` as `stockwatch_api` raises a permission error; reconciliation is a no-op on
  consistent data and corrects a deliberately corrupted count.
- **Done when:** Tests pass. **Gate: INV-3.**

#### T13. Job queue
- **Objective:** Retry-safe, lease-based job draining on Postgres.
- **Files:** Create `worker/src/jobs/queue.ts`, `worker/src/jobs/handlers.ts`; Test
  `worker/test/jobs.queue.test.ts`.
- **Invariants:** INV-5, INV-16.
- **Depends on:** T5, T4
- **Behavior:** Claim with `SELECT ... FOR UPDATE SKIP LOCKED`, set a lease expiry, dispatch by job
  type, complete or fail with a retry count and exponential backoff. Expired leases are reclaimable.
  Insert respects the idempotency key.
- **Tests:** Two concurrent claimers never take the same job; an expired lease is reclaimed; a
  handler that throws marks the job failed and increments retries without losing it; an unhandled
  rejection does not silently drop a lease; inserting a duplicate idempotency key does not create a
  second job.
- **Done when:** Tests pass, including the concurrency test.

#### T14. ProviderAdapter boundary and FixtureAdapter
- **Objective:** Establish the provider seam and make every downstream test deterministic.
- **Files:** Create `worker/src/provider/index.ts`, `worker/src/provider/fixture.ts`,
  `worker/test/fixtures/*.json`; Test `worker/test/provider.normalization.test.ts`.
- **Invariants:** INV-13, INV-2, INV-17.
- **Depends on:** T4
- **Behavior:** A `ProviderAdapter` interface returning domain `Observation` values from
  `packages/contracts`. `FixtureAdapter` reads recorded JSON from `test/fixtures/`, including a
  malformed payload, a null-price payload, and a future-timestamped payload. The interface exposes
  only domain types — no pagination cursor, no SDK client, no provider enum.
- **Tests:** `provider_normalization_golden_files` — each fixture maps to an expected `Observation`
  or an expected rejection reason. A boundary test asserts nothing outside `worker/src/provider/`
  imports a provider DTO type.
- **Done when:** Golden tests pass. **Gate §O.10.**

#### T15. Validation, ObservationSelector, and market-state persistence
- **Objective:** The monotonic-guarded write that protects every downstream number.
- **Files:** Create `worker/src/normalize/{validate,selector,index}.ts`,
  `worker/src/persist/marketState.ts`; Test `worker/test/marketState.ordering.test.ts`.
- **Invariants:** INV-4, INV-5, INV-11, INV-13.
- **Depends on:** T14, T13
- **Behavior:** Validate schema, `price > 0`, plausibility versus last known, timestamp within clock
  skew, non-negative volume. `ObservationSelector` v1 accepts any admissible observation. Persist
  with `UPSERT ... WHERE excluded.market_timestamp > instrument_market_state.market_timestamp`,
  writing the full envelope (`market_status`, `value_kind`, `data_freshness`, `source`,
  `ingested_at`).
- **Tests:** `older_observation_cannot_overwrite_newer_state` — apply T+10, replay T+5, assert state
  is still T+10 including every envelope field. `duplicate_job_execution_is_idempotent` (first half)
  — running the same ingestion twice changes nothing. An implausible price is rejected and the prior
  state is retained.
- **Done when:** Both named tests pass. **Gates §O.3, §O.4 (partial).**

#### T16. Envelope read model, watchlist API, and the first web page
- **Objective:** Close the loop — a user sees a real, correctly-labelled price.
- **Files:** Create `api/src/market/envelope.ts`, `api/src/market/repo.ts`,
  `web/src/api/client.ts`, `web/src/format/*`, `web/src/pages/{Login,Watchlists}.tsx`; Test
  `api/test/envelope.test.ts`, `web/test/format.test.ts`.
- **Invariants:** INV-9, INV-10, INV-11.
- **Depends on:** T15, T12
- **Behavior:** `GET /watchlists/:id` returns items with a full `ValueEnvelope` per instrument,
  money and percentages as strings, plus `precision_hint`. The web pages render login, watchlist
  management, and the list with status/kind/freshness badges and a `WARMING` state.
- **Tests:** The API never emits a bare number for a financial field (schema assertion over the
  response); the web formatting module is asserted to contain no arithmetic on financial values —
  a test that the exported functions are pure formatters taking pre-computed strings.
- **Done when:** A user can register, create a watchlist, add a fixture-backed symbol, and see a
  correctly-labelled price in the browser. **Gates: INV-9, INV-10, INV-11.**

---

### Phase 3 — History, features, signals

#### T17. Daily bar backfill and maintenance
- **Objective:** The history every price signal depends on.
- **Files:** Create `worker/src/persist/bars.ts`; Modify `worker/src/jobs/handlers.ts`; Test
  `worker/test/bars.test.ts`.
- **Invariants:** INV-4, INV-5.
- **Depends on:** T15
- **Behavior:** `backfill_bars` fetches ~400 sessions via the adapter and upserts on
  `(instrument_id, session_date)`. Re-running corrects values without duplicating rows.
- **Tests:** Backfill twice yields the same row count; a corrected bar updates in place; a bar for a
  non-session date is rejected.
- **Done when:** Tests pass.

#### T18. Exchange calendar and session arithmetic
- **Objective:** One definition of a trading session, used by both processes.
- **Files:** Create `packages/contracts/src/calendar.ts`,
  `db/migrations/0003_exchange_calendar.sql` (a small seeded holiday table); Test
  `packages/contracts/test/calendar.test.ts`.
- **Invariants:** INV-9.
- **Depends on:** T5, T3
- **Behavior:** Given two timestamps, count intervening trading sessions for the single supported
  exchange group, reading the seeded holiday table. One implementation, imported by both processes —
  this is exactly the duplication the shared package exists to prevent. It is calendar arithmetic,
  not financial logic, so it does not violate the single-owner rule.
- **Tests:** Weekend spans, a holiday span, a same-day span, and a span crossing a DST boundary
  produce the expected counts.
- **Done when:** Tests pass and neither process defines its own session counter.

#### T19. FeatureExtractor
- **Objective:** Deterministic features with an explicit insufficient-history gate.
- **Files:** Create `worker/src/features/index.ts`; Test `worker/test/features.test.ts`.
- **Invariants:** INV-9.
- **Depends on:** T17
- **Behavior:** Computes `returns_1d`, `sigma20`, `true_range`, `volume_median20`, `volume_ratio`,
  `high20`, `low20`, `gap_pct`, `bars_available`. Returns `INSUFFICIENT_HISTORY` when
  `bars_available < 20`.
- **Tests:** Known-input fixtures produce known outputs to exact decimal precision using the shared
  `Decimal` type; five bars yields `INSUFFICIENT_HISTORY` with no NaN, no `Infinity`, and no
  divide-by-zero; a zero-volume session does not throw.
- **Done when:** Tests pass. **Gate §O.12 (producer half).**

#### T20. Deterministic dedupe keys
- **Objective:** Correct signal identity per signal class (correction 7).
- **Files:** Create `worker/src/signals/dedupe.ts`; Test `worker/test/dedupe.keys.test.ts`.
- **Invariants:** INV-5.
- **Depends on:** T5
- **Behavior:** Pure functions producing a key per architecture §G: session-scoped price signals
  (type + `session_date`); session-scoped volume signals (type + `session_date` + window);
  `EARNINGS_RELEASED` (type + provider event id, else type + normalized event timestamp + fiscal
  period); `CORPORATE_ACTION_APPLIED` (type + action type + effective date + factor).
- **Tests:** Same inputs → same key; **two distinct events sharing a timestamp produce different
  keys**; a different `detector_version` yields a distinct uniqueness tuple; keys are stable across
  process restarts (no hashing of memory addresses, iteration order, or wall-clock time).
- **Done when:** Tests pass. **Gate §O.4 (dedupe half).**

#### T21. The eight detectors
- **Objective:** Signals with structured evidence, persisted idempotently.
- **Files:** Create `worker/src/signals/detectors.ts`, `worker/src/signals/index.ts`; Test
  `worker/test/detectors.test.ts`.
- **Invariants:** INV-5, INV-9.
- **Depends on:** T19, T20
- **Behavior:** Evaluates the eight predicates in architecture §G with the stated v1 constants. Each
  emitted signal carries its evidence blob (inputs, threshold, window, market timestamp), its
  `detector_version`, and its dedupe key. Persisted with `ON CONFLICT (instrument_id,
  detector_version, dedupe_key) DO UPDATE`.
- **Tests:** One boundary test per predicate (just-below fires nothing, just-above fires); price and
  volume predicates emit nothing under `INSUFFICIENT_HISTORY` while event predicates still fire;
  re-running the detector over identical data produces no duplicate rows **for each of the four
  dedupe-key classes**.
- **Done when:** Tests pass. **Gates §O.4, §O.12.**

---

### Phase 4 — Assembly and publication

#### T22. Scoring v1
- **Objective:** A bounded, inspectable attention score.
- **Files:** Create `worker/src/assembly/scoringV1.ts`; Test `worker/test/scoring.test.ts`.
- **Invariants:** INV-9.
- **Depends on:** T21
- **Behavior:** Signal → strength via the saturating ramps in §G; group by phenomenon taking the
  **max** within a group; combine with noisy-OR using the stated weights; map to a band. The module
  header states in a comment that the weights are calibration assumptions, not financial truth.
- **Tests:** `signal_scoring_is_bounded_and_non_double_counting` — all four price signals at maximum
  yields a score strictly below 1.0 and no more than the `PRICE_MOVE` group's weighted contribution;
  adding a correlated price signal to an existing one does not increase the score; monotonicity
  holds as any single strength rises; the empty signal set scores 0 and bands `QUIET`.
- **Done when:** Tests pass. **Gate §O.13.**

#### T23. ChangeAssembler v1 with sealing
- **Objective:** Group signals into records; never regroup a published one (correction 2).
- **Files:** Create `worker/src/assembly/assembler.ts`; Test `worker/test/assembler.test.ts`.
- **Invariants:** INV-6.
- **Depends on:** T22
- **Behavior:** Groups new signals only into records with `published_seq IS NULL`, within the same
  session window or ≤6h of `latest_at`. A signal whose window's record is already published opens a
  **new** unpublished record. `assembly_version = 1` is stored on every record.
- **Tests:** Two signals in one window group into one record; a signal arriving after publication
  creates a second record rather than mutating the first; a late-arriving earnings signal is still
  delivered as a new record; no code path clears or reassigns `published_seq`.
- **Done when:** Tests pass. **Gate: INV-6 (sealing).**

#### T24. Publisher — monotonic per-instrument sequence
- **Objective:** Assign `published_seq` once, in commit order (correction 3).
- **Files:** Create `worker/src/assembly/publisher.ts`; Test `worker/test/publisher.test.ts`.
- **Invariants:** INV-6.
- **Depends on:** T23
- **Behavior:** In one transaction: `SELECT instruments ... FOR UPDATE`, allocate
  `last_published_seq + 1`, update the instrument, stamp the record with `published_seq` and
  `published_at`. A record already carrying a `published_seq` is never re-stamped.
- **Tests:** `published_seq_is_monotonically_ordered_per_instrument` — concurrent publication from
  two connections yields strictly increasing sequences per instrument and never a value below one already
  read. **A rolled-back publication leaves a gap and the test asserts this is tolerated, not
  repaired.** Attempting to publish a sealed record is a no-op.
- **Done when:** Tests pass, including the deliberate-gap case. **Gate §O.9.**

#### T25. Shared template explanation
- **Objective:** The shared sentence, rendered once per record at publish time.
- **Files:** Create `worker/src/explanation/template.ts`; Modify
  `worker/src/assembly/publisher.ts`; Test `worker/test/explanation.shared.test.ts`.
- **Invariants:** INV-14, INV-9.
- **Depends on:** T24
- **Behavior:** Selects a template by dominant phenomenon group and interpolates already-computed,
  already-formatted values into `change_records.shared_explanation`, stamped with
  `renderer_version`. Contains **no personal data** and **no arithmetic** — it may only interpolate
  values the fact bundle already holds.
- **Tests:** Every number in the output appears verbatim in the fact bundle; no output contains a
  causal ("because"), predictive, or advisory phrase (asserted against a forbidden-pattern list);
  the same record renders identically twice.
- **Done when:** Tests pass. **Gate: INV-14.**

---

### Phase 5 — The product

#### T26. AdjustmentPolicy read side (identity case)
- **Objective:** The seam the diff depends on, before splits exist.
- **Files:** Create `api/src/diff/adjustment.ts`; Test `api/test/adjustment.test.ts`.
- **Invariants:** INV-12.
- **Depends on:** T5
- **Behavior:** `factorBetween(instrument, fromVersion, toVersion)` reads `corporate_actions` with
  `version_seq` in range and returns `{ factor, hasUnsupportedAction, actions[] }`. With no actions
  it returns factor `1` and `hasUnsupportedAction: false`.
- **Tests:** The identity case; an unsupported action in range sets the flag regardless of factor.
- **Done when:** Tests pass. Split math arrives in T33.

#### T27. DiffEngine — since-last-check
- **Objective:** The core personal computation.
- **Files:** Create `api/src/diff/engine.ts`; Test `api/test/diff.engine.test.ts`.
- **Invariants:** INV-9, INV-11, INV-12.
- **Depends on:** T26, T18, T16
- **Behavior:** Implements architecture §F.5 exactly: adjustment first, suppression short-circuit,
  then adjusted baseline, absolute and percentage change, elapsed time, sessions elapsed,
  volatility multiple, unseen-change list, and propagated freshness. Emits
  `comparison_status ∈ { OK, SUPPRESSED_CORPORATE_ACTION, AWAITING_BASELINE, INSUFFICIENT_HISTORY }`.
- **Tests:** `since_last_check_arithmetic_is_exact` — a table test over baselines, currents, and
  spans asserting exact decimal results, correct sign, and correct session counts across weekends
  and holidays; `AWAITING_BASELINE` when the checkpoint has no baseline; freshness is propagated
  from market state and never recomputed.
- **Done when:** Tests pass. **Gate §O.6.**

#### T28. Ack token mint and verify
- **Objective:** Stateless, integrity-protected acknowledgement (correction 1).
- **Files:** Create `api/src/checkpoints/ackToken.ts`; Test `api/test/ackToken.test.ts`.
- **Invariants:** INV-7, INV-15.
- **Depends on:** T8
- **Behavior:** `mint(payload)` → base64url payload + HMAC-SHA256 over it with `ACK_TOKEN_SECRET`.
  Payload: `v`, `user_id`, `instrument_id`, `served_watermark`, `baseline_price`,
  `baseline_market_timestamp`, `corporate_action_version`, `issued_at`, `expires_at` (15 min).
  `verify(token, sessionUserId, pathInstrumentId)` checks signature (constant-time compare), scope,
  and expiry. **No token table, no revocation list, no cleanup job.**
- **Tests:** `ack_token_integrity` — round-trip succeeds; a flipped byte in the payload is rejected;
  an expired token is rejected; a token minted for another user or another instrument is rejected;
  a token signed with a different secret is rejected. Assert no table is created or read.
- **Done when:** Tests pass. **Gate §O.8.**

#### T29. Checkpoint repository — monotonic upsert
- **Objective:** A checkpoint that only ever moves forward.
- **Files:** Create `api/src/checkpoints/repo.ts`; Test `api/test/checkpoint.repo.test.ts`.
- **Invariants:** INV-7, INV-8.
- **Depends on:** T28
- **Behavior:** Create-if-absent on first add with the initial-following policy from architecture §H
  (`seen_through = instruments.last_published_seq`, current price as baseline, or null baseline when
  warming). Advance via `GREATEST(existing, served_watermark)`, applying the token's baseline only
  when the watermark advances or the token's `baseline_market_timestamp` is newer. Removal does not
  delete; re-add within 30 days resumes.
- **Tests:** Concurrent advances from two sessions converge and never regress; a replayed
  acknowledgement is a no-op; the same instrument in two watchlists shares one checkpoint row;
  remove-then-re-add within the window preserves the checkpoint and beyond it resets.
- **Done when:** Tests pass. **Gates §O.7, §O.8 (replay).**

#### T30. Instrument detail GET and acknowledge POST
- **Objective:** The acknowledgement flow, with a provably side-effect-free GET.
- **Files:** Create `api/src/instruments/routes.ts`, `api/src/checkpoints/routes.ts`; Test
  `api/test/acknowledge.test.ts`.
- **Invariants:** INV-7, INV-15.
- **Depends on:** T29, T27
- **Behavior:** `GET /instruments/:id` returns the diff, the full unseen change set with evidence,
  and a freshly minted ack token whose `served_watermark` is the maximum `published_seq` actually
  rendered. `POST /instruments/:id/acknowledge { ack_token }` verifies and advances.
- **Tests:** `checkpoint_moves_only_via_post` — issuing the GET repeatedly leaves the checkpoint
  byte-identical (asserted over the whole row, including `updated_at`); only the POST advances it; a
  POST with another user's token is rejected and the checkpoint is untouched; a POST whose path
  instrument differs from the token's is rejected.
- **Done when:** Tests pass. **Gates §O.7, §O.5 (acknowledge route added to the T10 authorization
  table).**

#### T31. Inbox read model, ranking, and personal explanation
- **Objective:** The product's primary view, in two bounded queries.
- **Files:** Create `api/src/inbox/routes.ts`, `api/src/ranking/ranker.ts`,
  `api/src/explanation/renderer.ts`, `api/src/explanation/personalTemplate.ts`; Test
  `api/test/inbox.test.ts`.
- **Invariants:** INV-1, INV-2, INV-14, INV-9.
- **Depends on:** T30, T25
- **Behavior:** `GET /watchlists/:id/inbox` issues exactly two queries (the item join and the
  bounded unseen-changes scan, `LIMIT N` per instrument), runs the DiffEngine per item, ranks by
  `(max unseen band, max unseen score, |since-check move|)` with a staleness de-weight, and composes
  the stored shared explanation with a deterministically templated personal clause.
- **Tests:** Query count is asserted at exactly two regardless of item count (no N+1); ranking order
  is asserted over a fixture set; the personal clause contains no value the API did not compute; the
  response makes zero outbound network calls.
- **Done when:** Tests pass. **Gates: INV-1, INV-2, INV-14.**

#### T32. Inbox and detail UI with evidence drill-down
- **Objective:** Make the product visible and its reasoning inspectable.
- **Files:** Create `web/src/pages/{Inbox,InstrumentDetail}.tsx`,
  `web/src/components/{EnvelopeBadge,EvidencePanel,AttentionBand}.tsx`; Test
  `web/test/inbox.test.tsx`.
- **Invariants:** INV-10, INV-11.
- **Depends on:** T31
- **Behavior:** The inbox shows attention-ranked items with unseen badges, the since-last-check
  line, and the composed explanation. The detail view shows the full unseen set, an evidence panel
  exposing every signal's inputs, thresholds, group, strengths, and the final band, and fires the
  acknowledge POST on explicit "mark as read" or on unmount after the view has been seen.
- **Tests:** Rendering asserts that every displayed financial value came from an API field
  verbatim — a test that fails if a component performs arithmetic on a financial value; the evidence
  panel renders without any model output present.
- **Done when:** The full demo path is clickable end to end against fixture data. **Gate: INV-10.**

---

### Phase 6 — Corporate actions

#### T33. Split detection and AdjustmentPolicy write side
- **Objective:** Record splits and version them.
- **Files:** Create `worker/src/adjustment/index.ts`, `worker/src/persist/actions.ts`; Test
  `worker/test/splits.test.ts`.
- **Invariants:** INV-12, INV-5.
- **Depends on:** T21
- **Behavior:** Detects a split from provider data, writes a `CorporateAction` with
  `adjustment_factor`, `effective_date`, `is_supported = true`, and an incrementing `version_seq`,
  and bumps `instruments.corporate_action_version`. Unsupported action types are recorded with
  `is_supported = false` and **no** factor. **Stored checkpoint baselines are never rewritten.**
- **Tests:** A 4-for-1 split writes factor `0.25` and bumps the version once; re-ingesting the same
  split is idempotent; a merger is recorded unsupported with a null factor; a `CORPORATE_ACTION_APPLIED`
  signal is emitted with the correct dedupe key.
- **Done when:** Tests pass. Assert no query in the worker touches `user_instrument_checkpoints`.

#### T34. Split-adjusted comparison across a checkpoint
- **Objective:** The single most dangerous number in the product.
- **Files:** Modify `api/src/diff/adjustment.ts`, `api/src/diff/engine.ts`; Test
  `api/test/split.regression.test.ts`.
- **Invariants:** INV-12, INV-9.
- **Depends on:** T33, T27
- **Behavior:** `factorBetween` multiplies the factors of all supported actions in the version range
  and applies them to the baseline at read time.
- **Tests:** `split_across_checkpoint_does_not_report_crash` — baseline $180.00 at version 3,
  4-for-1 split, current price $46.00 at version 4; asserts ≈ **+2.22%**, explicitly asserts the
  result is **not** ≈ −74%, and asserts the response carries a "adjusted for 4-for-1 split" label.
  Also covers two sequential splits and a split with no intervening price change (0.00%).
- **Done when:** The named test passes. **Gate §O.1. This test must never be skipped or weakened.**

#### T35. Unsupported-action suppression
- **Objective:** Say "cannot compare" rather than guess.
- **Files:** Modify `api/src/diff/engine.ts`, `web/src/pages/InstrumentDetail.tsx`; Test
  `api/test/suppression.test.ts`.
- **Invariants:** INV-12.
- **Depends on:** T34
- **Behavior:** Any unsupported action in the version range short-circuits to
  `comparison_status = SUPPRESSED_CORPORATE_ACTION` with **no** percentage, absolute change, or
  volatility multiple in the payload, plus an option to reset the baseline.
- **Tests:** `unsupported_corporate_action_suppresses_comparison` — the response contains no
  percentage field at all (not a null, not a zero); the UI renders the label and the reset action;
  a supported split alongside an unsupported action still suppresses.
- **Done when:** The named test passes. **Gate §O.2.**

---

### Phase 7 — Reality and demo

#### T36. Freshness lifecycle and staleness labelling
- **Objective:** Degrade honestly when the provider goes quiet.
- **Files:** Modify `worker/src/persist/marketState.ts`, `api/src/market/envelope.ts`,
  `api/src/ranking/ranker.ts`; Test `worker/test/freshness.test.ts`, `api/test/staleness.test.ts`.
- **Invariants:** INV-11.
- **Depends on:** T31
- **Behavior:** Freshness decays `FRESH → DELAYED → STALE` on configured thresholds relative to
  `ingested_at` during an open market; `UNAVAILABLE` when there is no state at all. Stale items are
  labelled and de-weighted in ranking but never hidden.
- **Tests:** `stale_data_is_labelled_not_hidden` — after the threshold with the market open, the
  envelope reads `LAST_KNOWN` / `STALE`, the row still appears in the inbox, and its rank is
  de-weighted; a `CLOSED` market holding a `SESSION_CLOSE` remains `FRESH`.
- **Done when:** The named test passes. **Gate §O.11.**

#### T37. AlpacaAdapter on the official Node SDK
- **Objective:** Replace fixtures with live Alpaca data, changing nothing downstream.
- **Files:** Create `worker/src/provider/alpaca/{client,dto,adapter}.ts`; Modify
  `worker/src/config.ts`, `worker/package.json` (add `@alpacahq/alpaca-trade-api`); Test
  `worker/test/provider.alpaca.contract.test.ts`.
- **Invariants:** INV-2, INV-13, INV-17.
- **Depends on:** T14, T36
- **Behavior:** Implements `ProviderAdapter` using the **official Alpaca Node/JavaScript SDK**,
  following official Alpaca documentation only. `client.ts` is the sole file importing the SDK.
  Batched multi-symbol snapshot and historical-bar requests over HTTP with a global token bucket and
  backoff on 429/5xx. **Polling only — no WebSocket streaming** (deferred, §7). Alpaca types, enums,
  and pagination cursors are consumed inside `alpaca/` and normalized to domain `Observation` values
  before returning. Newly recorded real payloads are added to the golden fixture set.

  **Step 1 of this task is capability verification** (architecture §T.1): run a one-symbol spike
  through the SDK and record, in the task's commit message and in `README.md`, which of these the
  account tier actually returns — snapshots/quotes, historical daily bars, corporate actions
  (splits), and earnings/calendar events. Signals 7 (`EARNINGS_RELEASED`) and 8
  (`CORPORATE_ACTION_APPLIED`) and task T33 are gated on this result. If a capability is absent, use
  the seeded-events fallback (T38) with `source` marked as seeded — never silently faked.
- **Tests:** The Alpaca adapter satisfies the **same** golden-file contract test as the fixture
  adapter; rate-limit backoff is exercised against a stubbed 429; the boundary test from T4 confirms
  the SDK is imported nowhere outside `worker/src/provider/alpaca/`; no test performs a live network
  call.
- **Done when:** Tests pass, no downstream module required a change, and the capability findings are
  recorded. **Gate §O.10 (extended), INV-13, INV-17.**

#### T38. Demo seed
- **Objective:** A reliable, reproducible demo.
- **Files:** Create `db/seeds/demo.sql`, `worker/test/fixtures/demo/*`; Modify `README.md`.
- **Invariants:** INV-9, INV-11.
- **Depends on:** T37
- **Behavior:** Seeds 30–50 liquid tickers, ~400 sessions of bars, at least one earnings event, one
  large volatility-adjusted move, one abnormal-volume episode, and one 4-for-1 split, plus a demo
  user with an existing checkpoint dated two days back. If the Alpaca tier verified in T37 lacks
  earnings dates or corporate actions, those are seeded with `source` explicitly marked as seeded —
  never silently faked.
- **Tests:** After seeding, the demo user's inbox ranks the intended instrument first and the split
  instrument shows an adjusted comparison.
- **Done when:** A single command reproduces the full demo state from an empty database.

#### T39. Correctness gate sweep
- **Objective:** Prove the whole gate set runs green together, in CI.
- **Files:** Create `.github/workflows/ci.yml` (or `Makefile` targets); Modify `README.md`.
- **Invariants:** all.
- **Depends on:** T38
- **Behavior:** One command runs: `npm test` across all workspaces (`packages/contracts`, `worker`,
  `api`, `web`), typecheck, lint including the import-boundary rules, and the migration + grants
  suites against a fresh database.
- **Tests:** The §6 gate table below is asserted complete — a checklist test that fails if any named
  gate test is missing or skipped.
- **Done when:** CI is green from a clean clone and every gate in §6 maps to a passing named test.

---

## 6. Required correctness gates

Each maps to a named test and a task. None may be skipped, weakened, or marked pending.

| Gate | Named test | Task |
|---|---|---|
| Split across checkpoint must not produce a false crash | `split_across_checkpoint_does_not_report_crash` | T34 |
| Unsupported corporate action suppresses comparison | `unsupported_corporate_action_suppresses_comparison` | T35 |
| Older observation cannot overwrite newer state | `older_observation_cannot_overwrite_newer_state` | T15 |
| Duplicate / retried ingestion is idempotent | `duplicate_job_execution_is_idempotent` | T13, T15, T21 |
| Deterministic signal dedupe keys | `dedupe_keys_are_deterministic_and_class_correct` | T20, T21 |
| Cross-user authorization | `cross_user_authorization_denied` | T10 (extended by T30) |
| Exact since-last-check arithmetic | `since_last_check_arithmetic_is_exact` | T27 |
| Checkpoint acknowledgement only through POST | `checkpoint_moves_only_via_post` | T30 |
| GET does not mutate checkpoint state | same test, GET half | T30 |
| Tampered / expired ack tokens rejected | `ack_token_integrity` | T28 |
| Acknowledgement replay is harmless | `ack_replay_is_noop` | T29 |
| Stale data is labelled | `stale_data_is_labelled_not_hidden` | T36 |
| Insufficient history suppresses invalid signals | `insufficient_history_emits_no_price_signals` | T19, T21 |
| Scoring bounded, no double counting | `signal_scoring_is_bounded_and_non_double_counting` | T22 |
| Provider normalization fixtures | `provider_normalization_golden_files` | T14, T37 |
| Worker/API process boundary holds | `importBoundary.test.ts` — API and web cannot import the Alpaca SDK or worker internals | T4, T37 |
| Publication ordering monotonic per instrument | `published_seq_is_monotonically_ordered_per_instrument` | T24 |
| DB grants enforce ownership boundaries | `grants.test.ts` negative-permission suites | T6 |

---

## 7. Deferred work — do not reintroduce

The following must **not** appear in any task, dependency, config file, or "while I'm here"
refactor. They are deferred with triggers in architecture §Q.

Redis · Kafka or any broker · Kubernetes · microservices · read replicas · multi-provider
failover, consensus, or hysteresis · episode revision state machines · supersession graphs ·
re-notification or materiality frameworks · historical regrouping · reprocessing blast-radius
machinery · comprehensive corporate-action support beyond splits · ML or personalized ranking ·
push notifications · websocket infrastructure to the browser · **Alpaca WebSocket market-data
streaming** · table partitioning · database-driven scoring configuration · user-configurable
thresholds · multi-asset-class or multi-exchange support · Alpaca trading/order endpoints (this is a
market-data integration only).

Present only as **seams with trivial implementations**, which must not grow:
`ObservationSelector` (accept-if-admissible) · `AdjustmentPolicy` (splits only) ·
`assembly_version` (constant 1) · `ExplanationRenderer` (template only) · the ack-token payload
(single watermark, not a record set) · `CONFLICTED` freshness (no producer).

The optional model renderer is a **stretch goal only**, attempted after T39 is green, and only
behind the existing `ExplanationRenderer` interface with a hard timeout and template fallback.

---

## 8. Definition of done

The implementation is complete when:

1. Every task T1–T39 is committed with its tests passing.
2. Every gate in §6 maps to a passing, non-skipped, named test.
3. CI is green from a clean clone in one command (T39).
4. The demo path in §1 runs end to end against the T38 seed.
5. No item from §7 has been introduced.
6. `docs/architecture/initial-architecture.md` still describes the system as built — any accepted
   deviation is recorded there, not left implicit in code.
7. The worker and API remain separately startable, separately credentialed, and separately
   permissioned; neither imports the other (INV-17).
