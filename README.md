# LastSeen

A market watchlist that answers *"what has meaningfully changed in the instruments I care about since I last checked, and what deserves my attention now?"*

## Prerequisites

- Node 22+
- Postgres 16, with a database `stockwatch` owned by a superuser role you have credentials for.

  Docker is **optional** — it is just the zero-setup way to get that Postgres:

  ```bash
  docker compose up -d          # creates db `stockwatch`, user/password `stockwatch`
  ```

  If `:5432` is already taken on your machine, pick another host port —
  `POSTGRES_PORT=5433 docker compose up -d` — and use it in every `DATABASE_URL` below.

  If you already run Postgres natively, skip Docker entirely and create the `stockwatch`
  database yourself; nothing else in the project needs Docker.

## Quick start

```bash
npm install

# Migrations must run as the superuser — they create the restricted
# stockwatch_api / stockwatch_worker roles the apps then log in as.
# Re-running is a no-op.
DATABASE_URL=postgres://stockwatch:stockwatch@localhost:5432/stockwatch npm run migrate -w api

# Demo data: ~33 tickers, a demo user, a watchlist with unseen changes.
# NOT idempotent — run once, against a freshly migrated database.
DATABASE_URL=postgres://stockwatch:stockwatch@localhost:5432/stockwatch npm run seed -w api

cp api/.env.example api/.env
cp worker/.env.example worker/.env
```

Then edit those two files by hand:

- `api/.env` — in `DATABASE_URL`, replace the `password` placeholder with `stockwatch_api`
  (`0002_roles.sql` gives each role a password equal to its name). Replace both `change-me`
  secrets with 32+ character values.
- `worker/.env` — same substitution, with `stockwatch_worker`. Alpaca and Gemini keys are
  optional; without them the demo seed still works and briefs fall back to templates.

Three processes, three terminals:

```bash
env -u DATABASE_URL npm run dev -w api      # :3000
env -u DATABASE_URL npm run dev -w worker   # no port; optional for exploring the demo seed
npm run dev -w web                          # :5173, proxies /api to :3000
```

Open <http://localhost:5173> and sign in as `demo@stockwatch.dev` / `demo12345`, or create a
fresh account from the sign-in screen.

> The `env -u DATABASE_URL` prefix matters: `dev` loads `.env` via `tsx --env-file`, and Node
> will not let that override a `DATABASE_URL` already exported in your shell (e.g. by direnv),
> so the API would silently connect to the wrong database. Drop the prefix only if your shell
> has none set. `web` never touches Postgres.

### Optional: full symbol search

Out of the box, search covers the demo seed's ~33 tickers. To search the whole US market
(~14k symbols, one provider call), put real Alpaca paper-trading keys in `worker/.env` and run:

```bash
env -u DATABASE_URL npm run sync:catalog -w worker
```

Idempotent and retry-safe. The API never calls Alpaca — it reads only the synced table.

## Tests

Most suites need a live Postgres, via two role-specific env vars:

```bash
# api + packages/contracts
export DATABASE_URL=postgres://stockwatch_api:stockwatch_api@localhost:5432/stockwatch
export TEST_DATABASE_URL=postgres://stockwatch:stockwatch@localhost:5432/stockwatch

# worker (writes market-fact tables directly, so it needs the superuser role)
export DATABASE_URL=postgres://stockwatch:stockwatch@localhost:5432/stockwatch
```

`api/.envrc` and `worker/.envrc` already set these — `direnv allow` in each, or `source` them.

```bash
npm test                # all workspaces (needs the env vars above)
npm test -w web         # no DB needed
npm run typecheck
npm run lint            # includes the worker/api/web import-boundary rules
```

## Structure

```
packages/contracts/   shared enums, Decimal type, domain DTOs — no domain logic
api/                  Fastify API — auth, watchlists, checkpoints, read model
worker/               ingestion worker — provider, signals, assembly, publication
web/                  Vite + React frontend — formatting only, no financial derivation
db/migrations/        forward-only SQL migrations, executed by the API
```

Design docs: [architecture](docs/architecture/initial-architecture.md) ·
[implementation plan](docs/plans/implementation-plan.md)
