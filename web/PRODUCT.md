# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: an individual retail investor with a personal stock watchlist, checking in casually
(e.g. once a day, not continuously through the trading day) to see what changed in the instruments
they care about since they last looked. Not a professional/active day trader — the product is
explicitly not a dense real-time trading terminal.

## Product Purpose

LastSeen (internal engineering name: Stockwatch) answers one question: "what changed in the things
you care about since you last looked, ranked by how much it deserves your attention." It is not a
quote board. Success is a user landing on the inbox and immediately understanding, in ranked order,
which watched instruments moved in a way that matters, why (backed by inspectable evidence), and
whether that comparison is trustworthy right now (data freshness, corporate-action adjustment).

## Positioning

The mechanism a competing quote board could not truthfully copy: every displayed comparison is
anchored to the user's own last-seen checkpoint per (user, instrument) — not a generic daily
percent change — and every attention ranking is backed by deterministic, inspectable evidence
(signal type, threshold, group, strength) rather than an opaque score. Financial values are never
computed or invented by a model; the UI only renders values the API already computed.

## Operating Context

- **Inbox view**: the primary surface. Shows attention-ranked watched instruments with unseen-change
  badges, a "since you last checked" line, and a composed explanation.
- **Instrument detail view**: the full unseen change set for one instrument, an evidence panel
  exposing every contributing signal's inputs/thresholds/group/strength and the final attention
  band, and the action that acknowledges (marks as read) those changes — advancing the user's
  checkpoint via an explicit POST (either a manual "mark as read" action or on leaving the view
  after it has been seen).
- Watched instruments are tracked in one or more watchlists the user manages elsewhere in the
  product; a given instrument's "last seen" state is shared across every watchlist it appears in.

## Capabilities and Constraints

- The frontend renders values verbatim from the API; it must never compute percentages, baselines,
  scores, or freshness itself — that arithmetic belongs to the backend (`api`/`worker`), never the UI.
- Attention band vocabulary (backend-computed, UI renders only): `URGENT`, `NOTABLE`, `MINOR`,
  `QUIET`.
- Data freshness is a distinct concept from market status and value kind, and must be rendered
  honestly rather than hidden — a stale/unavailable item still appears in the inbox, just labelled
  and de-weighted, never suppressed.
- Some comparisons are suppressed outright (e.g. an unsupported corporate action) rather than shown
  with a guessed number — the UI must render "cannot compare" rather than fabricate a percentage.
- No GET request may mutate checkpoint state; only an explicit acknowledge action (POST) advances
  what the user has "last seen."
- Stack: TypeScript, React 18, Vite (already scaffolded in `web/`) — see `## Stack`.

## Brand Commitments

- Product name: **LastSeen**. (The codebase, docs, and internal engineering references still use
  the working name "Stockwatch" — treat "LastSeen" as the user-facing brand name for this surface.)
- No other existing brand assets, logo, palette, or voice commitments — visual identity is
  otherwise fully open.

## Evidence on Hand

No real user data, testimonials, case studies, or press exist. UI work proceeds against
API/fixture data (per `docs/plans/implementation-plan.md` T32's "full demo path clickable end to
end against fixture data").

## Product Principles

- Show the user's own comparison, never a generic market comparison — every number is anchored to
  what *this* user last saw.
- Never hide degraded trust — stale data, suppressed comparisons, and low-confidence states are
  labelled honestly, not smoothed over or hidden.
- Rank by deserved attention, not recency or magnitude alone — the inbox's ordering is the product.
- Evidence must be inspectable — a user can always drill from a ranked item down to the exact signal
  data that produced it.
- The UI is a renderer, not a calculator — no arithmetic, derivation, or financial judgment happens
  client-side.

## Accessibility & Inclusion

Standard WCAG AA — no product-specific accessibility requirement beyond typical good practice for a
financial web application.

## Stack

React 18 + Vite + TypeScript (already scaffolded in `web/package.json` — `@stockwatch/contracts`
for shared DTOs, `vitest` for tests). Not a greenfield stack decision; inherited from the existing
workspace.
