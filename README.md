# Stockwatch

A market watchlist that answers *"what has meaningfully changed in the instruments I care about since I last checked, and what deserves my attention now?"*

## Architecture

See [`docs/architecture/initial-architecture.md`](docs/architecture/initial-architecture.md).  
See [`docs/plans/implementation-plan.md`](docs/plans/implementation-plan.md).

## Prerequisites

- Node 22+
- Postgres 16 — either via `docker compose up -d` (`docker-compose.yml`), or a native local
  install. Either way you need a database named `stockwatch` owned by a superuser role whose
  credentials you know (the compose file uses `stockwatch` / `stockwatch`).

## Quick start

Three workspaces run as separate processes: `api` (port 3000), `worker` (no port — a polling
job runner), and `web` (port 5173, Vite dev server, proxies `/api` to `:3000`). `web` has no
`.env` of its own; it only ever talks to `api`, never to Postgres or a market-data provider
directly.

```bash
# 1. Start Postgres (skip if you already have one running locally)
docker compose up -d

# 2. Install dependencies
npm install

# 3. Run migrations AS A SUPERUSER — this is the step that creates the restricted
#    stockwatch_api / stockwatch_worker roles migration 0002_roles.sql defines, so it
#    can't itself run as either of them yet.
DATABASE_URL=postgres://stockwatch:stockwatch@localhost:5432/stockwatch npm run migrate -w api

# 4. Seed demo data (~33 tickers, a demo user, a watchlist, some interesting unseen changes —
#    see "Demo seed" below). Not idempotent; re-run only against a freshly migrated database.
DATABASE_URL=postgres://stockwatch:stockwatch@localhost:5432/stockwatch npm run seed -w api

# 5. Copy env files. The role passwords created by 0002_roles.sql match the role names —
#    api/.env.example and worker/.env.example ship a "password" placeholder; replace it.
cp api/.env.example api/.env
cp worker/.env.example worker/.env
sed -i 's/stockwatch_api:password/stockwatch_api:stockwatch_api/' api/.env
sed -i 's/stockwatch_worker:password/stockwatch_worker:stockwatch_worker/' worker/.env
# Also replace the two change-me secrets in api/.env — both must be at least 32 characters.
# worker/.env also needs real Alpaca paper-trading keys to ingest live data — the demo seed
# above works without them (all demo rows are pre-seeded with source = 'seeded').

# 6. Start the API
env -u DATABASE_URL npm run dev -w api

# 7. Start the worker (separate terminal — optional for just exploring the demo seed)
env -u DATABASE_URL npm run dev -w worker

# 8. Start the web UI (separate terminal)
npm run dev -w web

# 9. Optional — sync the real symbol catalog so search covers the whole market
#    (needs the Alpaca keys from step 5; see "Symbol search" below).
env -u DATABASE_URL npm run sync:catalog -w worker
```

`api`'s and `worker`'s `dev` scripts read their workspace `.env` via `tsx --env-file=.env`.
Node does **not** let a `--env-file` value override a variable that is already exported in your
shell, so if you have a `DATABASE_URL` exported for some other project (or by `direnv` in this
one) the API will silently connect to the wrong database and every request will fail with
`password authentication failed`. Hence the `env -u DATABASE_URL` prefix above — drop it only
if you know your shell has no `DATABASE_URL` set. `web` needs no such prefix; it never touches
Postgres.

Open `http://localhost:5173` and sign in with the demo seed's user (`demo@stockwatch.dev` /
`demo12345`), or use "Create one" on the sign-in screen for a fresh account. Either way you land
on the inbox, where you can create/rename/delete watchlists and add/remove instruments.

## Symbol search

The add-instrument box on the inbox is a typeahead over `instrument_catalog` — the provider's
tradable-asset master, synced by the worker:

```bash
env -u DATABASE_URL npm run sync:catalog -w worker   # ~14k US equities, one provider call
```

Idempotent and retry-safe: re-running upserts every row and refreshes `synced_at`; a symbol the
provider no longer lists is marked `status = 'inactive'` (search filters those out) rather than
deleted, and a provider response of zero assets leaves the catalog untouched instead of wiping
it. Run it on whatever schedule you like — daily is what the underlying data justifies. There is
no scheduler process yet, so it is a standalone command rather than a queued job.

`GET /instruments/search?q=` reads only that table. The API never calls Alpaca (it holds no
credentials and imports no SDK), so a keystroke in the search box never becomes a provider
request. Results are ranked exact ticker → ticker prefix (shortest ticker first) → company-name
prefix, capped at 20.

Without a sync you still get search, limited to the demo seed's ~33 tickers, whose catalog rows
carry the ticker as their `name` — the seed has no source for real company names and does not
invent them. A symbol missing from the catalog can still be added by typing it in full and
submitting; the API resolves symbols asynchronously either way.

## CI (T39)

`.github/workflows/ci.yml` runs on every push/PR to `main`: migrations against a fresh
Postgres, `typecheck`, `lint` (including the import-boundary rules), then each workspace's
tests against the same role split used locally (`api` under the restricted `stockwatch_api`
role, `worker` under the superuser role it writes market facts as), and finally the root
`test/gates.test.ts` sweep — a checklist that fails if any of the §6 gate table's named tests
is missing, renamed away from its canonical name, or skipped.

## Test

Most `api`/`worker`/`packages/contracts` tests talk to a live Postgres and need two roles set as
env vars (not the app roles from step 5 above — these are DB-role env vars the test suites read
directly, matching `docker-compose.yml`'s superuser):

```bash
export DATABASE_URL=postgres://stockwatch_api:stockwatch_api@localhost:5432/stockwatch      # api's real runtime role
export TEST_DATABASE_URL=postgres://stockwatch:stockwatch@localhost:5432/stockwatch         # superuser, for fixture setup + schema/grants tests
```

`worker`'s suite writes market-fact tables directly and needs the superuser role instead:

```bash
export DATABASE_URL=postgres://stockwatch:stockwatch@localhost:5432/stockwatch
```

(`api/.envrc` and `worker/.envrc` already have these — `direnv allow` in each directory if you
use direnv, or `source api/.envrc` / `source worker/.envrc` before running that workspace's
tests.)

```bash
npm test                        # all workspaces + the gate sweep (needs both env var sets above)
npm test -w api                 # API only — 175 tests
npm test -w worker               # worker only
npm test -w web                  # web only — 73 tests, no DB needed (jsdom + fetch mocks)
npm test -w packages/contracts   # contracts only


npm run typecheck               # all workspaces
npm run lint                    # eslint, including the worker/api/web import-boundary rules
```

Tests can leave rows behind on failure; if a suite reports unexpected failures on a re-run,
truncate and re-migrate rather than debugging stale fixtures:

```bash
DATABASE_URL=postgres://stockwatch:stockwatch@localhost:5432/stockwatch psql "$DATABASE_URL" \
  -c "TRUNCATE users, sessions, watchlists, watchlist_items, user_instrument_checkpoints, instruments, instrument_tracking, jobs RESTART IDENTITY CASCADE;"
```

## Alpaca capability verification (T37)

Verified live against a paper-trading account (2026-09), combining the [Alpaca market-data docs](https://docs.alpaca.markets/us/docs/getting-started-with-alpaca-market-data) with direct API calls through the official `@alpacahq/alpaca-trade-api` SDK:

| Capability | Available? | Endpoint | Notes |
|---|---|---|---|
| Snapshots / latest quote | ✓ | `GET /v2/stocks/snapshots` | `iex` feed on paper tier |
| Historical daily bars | ✓ | `GET /v2/stocks/bars` | via `getStockBarsFor` |
| Corporate actions (splits) | ✓ | `GET /v1/corporate-actions` | confirmed against AAPL's real 2020 4-for-1 split |
| Earnings / calendar events | ✗ | none | no such endpoint exists; the only historically-adjacent one (`corporate_actions/announcements`) is deprecated |

Because there is no earnings/calendar-events endpoint at any tier, `EARNINGS_RELEASED` events use T38's seeded fallback, with `source` always marked `seeded` — never silently faked as live data.

## Demo seed (T38)

`db/seeds/demo.sql` reproduces a full demo state from an empty (post-migration) database in one
command (see steps 3–4 of "Quick start" above — `npm run seed -w api` applies it against
`$DATABASE_URL`, run as the superuser role since it seeds worker-owned tables directly).

Seeds ~33 liquid tickers with 400 sessions of daily bars each, a demo user
(`demo@stockwatch.dev` / `demo12345`) with a watchlist following all of them and a checkpoint
baselined two trading sessions back, and three instruments that make the demo path in
architecture §1 visible immediately after seeding:

- **TSLA** — a large volatility-adjusted move plus an earnings event on the latest session
  (ranks top of the demo user's inbox)
- **AAPL** — a 4-for-1 split whose checkpoint baseline predates it, so the instrument detail
  view shows a real read-time-adjusted comparison rather than a suppressed or crashed one
  (architecture §I / INV-12, T34)
- **GME** — an abnormal-volume episode over the last few sessions

All synthetic rows carry `source = 'seeded'`, per the same never-silently-faked rule as the
earnings fallback above. Not idempotent — re-running against an already-seeded database fails
on the demo user's unique email; re-seed by dropping and recreating the database.

## Workspace structure

```
packages/contracts/   shared enums, Decimal type, domain DTOs — no domain logic
api/                  Fastify API — auth, watchlists, checkpoints, read model
worker/               ingestion worker — provider, signals, assembly, publication
web/                  Vite + React frontend — formatting only, no financial derivation
db/migrations/        forward-only SQL migrations, executed by the API
```