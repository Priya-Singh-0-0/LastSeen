# Stockwatch

A market watchlist that answers *"what has meaningfully changed in the instruments I care about since I last checked, and what deserves my attention now?"*

## Architecture

See [`docs/architecture/initial-architecture.md`](docs/architecture/initial-architecture.md).  
See [`docs/plans/implementation-plan.md`](docs/plans/implementation-plan.md).

## Prerequisites

- Node 22+
- Docker (for Postgres)

## Quick start

```bash
# 1. Start Postgres
docker compose up -d

# 2. Install dependencies
npm install

# 3. Copy env files and fill in secrets
cp api/.env.example api/.env
cp worker/.env.example worker/.env

# 4. Run migrations (API role)
npm run migrate -w api

# 5. Start API
npm run dev -w api

# 6. Start worker (separate terminal)
npm run dev -w worker

# 7. Start web
npm run dev -w web
```

## Test

```bash
npm test                   # all workspaces
npm test -w api            # API only
npm test -w worker         # worker only
npm test -w packages/contracts  # contracts only
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

`db/seeds/demo.sql` reproduces a full demo state from an empty (post-migration) database in
one command:

```bash
npm run migrate -w api
npm run seed -w api          # applies db/seeds/demo.sql against $DATABASE_URL
```

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