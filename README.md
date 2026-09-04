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

## Workspace structure

```
packages/contracts/   shared enums, Decimal type, domain DTOs — no domain logic
api/                  Fastify API — auth, watchlists, checkpoints, read model
worker/               ingestion worker — provider, signals, assembly, publication
web/                  Vite + React frontend — formatting only, no financial derivation
db/migrations/        forward-only SQL migrations, executed by the API
```