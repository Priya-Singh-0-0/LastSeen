# LastSeen — UI Surface Brief

Companion to `web/PRODUCT.md`. That file says what the product is and how it should feel. This file
says what the codebase can actually do, and what must not be broken. Where they disagree, this file
wins on facts and `PRODUCT.md` wins on intent.

Read this before designing. Several constraints here will invalidate an otherwise reasonable design
if discovered late.

---

## 1. Scope

Wholesale visual redesign of three surfaces: **sign in**, **watchlist (root)**, **stock detail**.
`web/src/styles.css` may be replaced entirely. Component structure may be reorganised freely.

Out of scope, do not build: charts or sparklines of any kind, a discovery or "top stocks" board,
watchlist management, profile or settings pages, mobile layouts, a light theme, a landing page.

Behavioural logic is **not** in scope and must survive untouched:

- The acknowledge timing logic in `InstrumentDetail.tsx` (the `useRef` latch: fires at most once
  per mount, on explicit click or on unmount when there were unseen changes, never on mount).
- The debounce, abort, and keyboard handling in the search combobox (`AddInstrumentForm.tsx`),
  including `aria-activedescendant` and arrow/Enter/Escape operation.
- The `credentials: 'include'` and `ApiError` 401/403 distinction in `api/client.ts`.

You may restyle and restructure the markup around all of these. Do not rewrite what they do.

---

## 2. What the API actually returns

This is the constraint most likely to break a design. **If a field is not listed here, it does not
exist and must not be rendered.** Do not invent a field and leave it to be wired later.

**`GET /watchlists`** → the user's watchlists. The app resolves the first one and uses it forever.
If the user has none, create one silently. Never show the id, the name, or the fact that a
watchlist is an object.

**`GET /watchlists/:id/inbox`** → per watched stock, in rank order:

- `instrumentId`, `symbol`, `exchange`
- price envelope: `price`, `currency`, `marketStatus`, `valueKind`, `dataFreshness`,
  `marketTimestamp`
- diff fields: `comparisonStatus`, and when present `adjustedBaseline`, `absoluteChange`,
  `percentageChange`, `sessionsElapsed`, `volatilityMultiple`, `adjustmentLabels`
- `unseenCount`, `band`, `score`, `explanation`

**`GET /instruments/:id`** → the same envelope and diff fields for one stock, plus the full unseen
change list. Each change carries `publishedSeq`, `band`, `score`, `sharedExplanation`,
`sessionDate`, `latestAt`, and its `signals[]`. Each signal carries `signalType`,
`detectorVersion`, `dedupeKey`, `marketTimestamp`, and an `evidence` map of string keys to string
or boolean values. Also returns `ackToken`.

**`POST /instruments/:id/acknowledge`** with the detail response's `ackToken` verbatim.

**`POST /watchlists/:id/items`** `{ symbol }` to star. **`DELETE`** the corresponding item to
unstar.

**Stock search** returns `symbol`, `name`, `exchange` per result. Matches ticker or company name.

### Fields that do not exist

There is **no** per-signal `strength` and **no** `phenomenonGroup` on the wire — scoring is
ephemeral and only `band`/`score` survive, at the change-record level. There is **no** baseline
timestamp, so the "since you last checked" block cannot state when the baseline was taken. There
are **no** precision hints. There is no 52-week range, no volume, no market cap, no logo URL.

### The one authorized backend change

Project the stock's company name onto `GET /watchlists/:id/inbox` and `GET /instruments/:id`, via a
`LEFT JOIN` from `instruments` to `instrument_catalog` on symbol, falling back to the symbol string
when no catalogue row exists. Never null, never invented. This is authorized so the watchlist can
show "Apple Inc." under "AAPL" the way CoinGecko shows "Bitcoin" under "BTC". It must not add a
query — the inbox route's exactly-two-queries gate has to keep passing. Nothing else about the API
may change.

---

## 3. States that must be designed, not discovered

Each of these is real, reachable against the demo seed, and currently rendered badly or not at all.

| State | Meaning | Rule |
|---|---|---|
| `comparisonStatus: OK` | Normal comparison | Show the numbers |
| `AWAITING_BASELINE` | Just starred; no baseline yet | **No number anywhere.** Frequent — every newly starred stock passes through it |
| `SUPPRESSED_CORPORATE_ACTION` | Split etc. makes comparison unsafe | Render "can't compare". No percentage may appear on the row |
| `INSUFFICIENT_HISTORY` | Under 20 sessions of history | Show price change, omit volatility |
| `dataFreshness: STALE` / `UNAVAILABLE` | Data is old or missing | Row stays in position, dimmed and labelled. **Never filtered, never hidden, never re-sorted** |
| `unseenCount: 0` | Nothing new since last look | Must be visually quiet, not an error |
| Empty watchlist | Nothing starred | "Add stocks to your watchlist", pointing at the search field |
| Search returns nothing | No catalogue match | Distinct from the pre-typing state |
| Session expired (401) | Cookie gone | Falls to sign in |
| Refused ack token (403) | Expired token | Non-destructive; the changes simply stay unread |

`marketStatus`, `valueKind`, and `dataFreshness` are three orthogonal fields and must not be
merged into one chip. The current UI renders them as the run-on string "Closed Session close Fresh",
which is the wrong treatment.

---

## 4. Colour: two axes that must not collide

- **Price change sign** — green up, red down, CoinGecko-conventional. Applies to
  `percentageChange` and `absoluteChange`.
- **Attention band** — `URGENT` / `NOTABLE` / `MINOR` / `QUIET`. This must live on a **different
  hue axis entirely** (the prior pass used amber→slate). Red-for-urgent next to red-for-down in the
  same row is unreadable, and band must survive greyscale, so it needs a non-colour carrier as
  well — a rail, a weight, a label, your choice.

Green is the product accent, per CoinGecko. Take care that accent-green and up-green do not become
ambiguous.

---

## 5. Number formatting

The API sends full-precision decimal strings. The current UI prints them raw: `150.092106`,
`1.150344`, `+0.7664%`. Fix this with a display rule in `web/src/format.ts`:

- Prices, baselines, absolute changes: 2 decimal places.
- Percentages: 2 decimal places, explicit sign, `%` appended.
- Session counts: integers, already integers.

Rounding for display is presentation and is allowed. Deriving, summing, or converting a value is
not, under any circumstance. All numerals render in a tabular-figures face so columns align.

---

## 6. Known defects to fix

- The sticky table header overlaps the first row — row 1 renders underneath it. Visible in the
  current build.
- Watchlist controls (New / Rename / Delete) and the standalone Add button are all being removed;
  the top bar is rebuilt around logo / centered search / account icon.
- The per-row `×` delete control is replaced by the star.

---

## 7. Dependencies

**Permitted:** an icon library (e.g. lucide-react), self-hosted or CDN webfonts, and a router
library if you prefer real routes to the current hash routing.

**Not permitted:** a CSS framework of any kind (Tailwind, Bootstrap, MUI, shadcn) — the design
system you produce is the styling layer, and a utility framework would fight it. Also not
permitted: any charting library, since charts are out of scope.

State stays in React's own primitives; no state management library.

---

## 8. Invariants enforced by existing tests

`web/test/` holds 28 passing tests. They may be updated where a matcher is genuinely made stale by
formatting or markup changes (an exact `getByText('4.20')` becoming `/\+4\.20%/` is fine).
No assertion may be weakened in meaning, and none may be deleted. These in particular exist to
catch real regressions:

1. Rank order is never re-sorted client-side — a deliberately non-band-ordered fixture must render
   in array order.
2. `SUPPRESSED_CORPORATE_ACTION` renders no percentage text.
3. `STALE` rows remain present and in position.
4. Rows are keyboard-operable.
5. Acknowledge fires exactly once — on click, or on unmount with unseen changes; never twice, never
   on an empty-unseen unmount.
6. Every request sends `credentials: 'include'`; acknowledge POSTs the `ackToken` verbatim.

`npm run typecheck -w web`, `npm run lint`, `npm run test -w web`, and `npm run build -w web` must
all be clean when you finish.

---

## 9. Verification protocol

**Do not attempt to verify the result yourself, and do not claim it is verified.** When the build
is complete and the checks in §8 pass:

1. Report what changed, in a short list. Not a narrative.
2. Give the local URL to open.
3. Stop and wait.

The user will look at it in a real browser and reply with what to change. Iterate from their
response. Every prior pass on this UI shipped visually unverified; that is the failure mode this
protocol exists to prevent.