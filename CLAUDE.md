# Stockwatch Engineering Rules

## Authoritative context

- `docs/architecture/initial-architecture.md` — the **accepted architecture**.
- `docs/plans/implementation-plan.md` — the **accepted implementation plan**.
- Read both before any non-trivial implementation change. Do not silently deviate from either.
- If a request conflicts with an architectural invariant, name the conflict and propose the
  smallest safe alternative.
- Do not create additional planning documents. What matters lives in this file, those two
  documents, or the code and tests.

## Rules

- This repository is intended to evolve beyond the hackathon.
- Prefer the simplest implementation that preserves established architectural boundaries.
- Do not introduce infrastructure without a concrete current requirement.
- Market ingestion scales with unique instruments, never users × instruments.
- User-facing reads must not synchronously call market-data providers.
- Provider-specific types must terminate at the provider adapter boundary.
- Market-provider credentials belong only to the worker runtime.
- PostgreSQL is the initial authoritative datastore. Do not introduce Redis unless a measured requirement justifies it.
- Financial calculations are deterministic. LLMs never calculate or originate financial facts.
- Every financial value must preserve source and relevant timestamps.
- Market status, value kind, and data freshness are distinct concepts.
- User knowledge/checkpoints are per (user, instrument), not per watchlist.
- No GET mutates user state. Checkpoints move only via POST with a valid signed acknowledgement token.
- ChangeRecords are sealed: published_seq is assigned once. Ordering is monotonic per instrument; gaps are fine.
- The API writes no market facts; the worker reads no user, watchlist, or checkpoint rows.
- The frontend formats canonical API values; it never derives percentages, baselines, scores, or freshness.
- Older market observations must never overwrite newer state.
- Background ingestion must be retry-safe and idempotent.
- Unsupported corporate-action comparisons must be suppressed rather than guessed.
- The TypeScript worker owns provider ingestion and shared market intelligence.
- The TypeScript API owns user-facing/personal application responsibilities.
- Worker and API separation is architectural, not linguistic: separate processes, entrypoints, configs, dependency sets, and DB roles. Neither imports the other.
- The Alpaca SDK and Alpaca credentials are worker-only. The API must never import the SDK or call Alpaca.
- Do not create abstractions for hypothetical future requirements.
- Do not claim work is complete until relevant tests/typechecks/linting pass.