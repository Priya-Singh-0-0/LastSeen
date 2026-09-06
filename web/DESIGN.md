# LastSeen — Design Direction

**Status: proposed, awaiting approval. No code written.**

This document is the direction round put in a file, because that is what you asked for. Two
process notes, stated up front rather than at the end:

- Impeccable normally serves this decision as an interactive page and writes `DESIGN.md` at the
  *end*, derived from the built artifact. You asked to read the direction before any code, so the
  file is standing in for the page. Disclosed as a substitution, not skipped.
- If you approve, this file gets **rewritten at finish** from the world that actually shipped —
  a rulebook written before the build describes intentions, not reality. Treat everything below as
  the contract, not the final system record.

Seed key `a92a3fb8` · scope `direction` · mode **Operate** · assigned index **4**.

---

## 0. What the roll did

Mode is **Operate**: you land, you read a ranked list, you decide whether to open one. Expression
may never obscure the task, the state, or a familiar affordance.

The category rut, held out of the candidate list: **the market terminal** (Bloomberg amber, ticker
tape, dense real-time grid) and its predictable opposite, **the pastel fintech card app**. Two
candidates were spent on the brief's own literal readings — CoinGecko itself, and the read-receipt
metaphor the product name paints — and the rest derived from elsewhere in the audience's world.

Seven grounded directions, ordered by resonance:

1. Broadsheet agate stock tables — the printed close-of-day quotation page
2. The CoinGecko crypto data table — the pinned canon, played straight
3. The unread inbox — bold dots, the "new since here" divider
4. **The watch log and its handover** ← assigned
5. The clinical handover board — vitals since last rounds, triage banding
6. The darkroom contact sheet — grease pencil, crossed frames, circled keepers
7. The tide gauge and its event log

The assignment landed on **4**, and it is the right one on the merits, not just by dice. The
product's actual mechanic — a checkpoint per (user, stock), changes that stay *open* until you
explicitly sign them off, a POST that is the only thing which moves the mark — is a watch handover.
Not a metaphor laid over the product. The same object.

---

## 1. The direction: **The Watch Log**

A ship's watch log is a ruled ledger that records what happened during the hours you were not
there. You come on watch, you read the entries since the last mark, and you countersign — and only
your signature moves the mark. Entries are never deleted, never re-ordered, and never quietly
smoothed: an instrument that was unreliable during the watch gets *said so*, in the margin, in the
same hand as everything else.

Every constraint in the surface brief is already native to that object:

| Product truth | The log's own device |
|---|---|
| Checkpoint per (user, stock) | The standing mark in each entry's margin |
| Acknowledge is an explicit POST | The countersign. Nothing else moves the mark |
| `unseenCount` | Open entries, counted in the margin |
| Rank order is the product, never re-sorted | The log is ruled; entries hold their line |
| `STALE` / `UNAVAILABLE` never hidden | The instrument was unreliable and the log says so |
| `SUPPRESSED_CORPORATE_ACTION` | The footnote dagger — a mark that means *do not read this figure* |
| Evidence is inspectable | Entries carry their readings, not a summary of them |

### Refusal

This direction refuses the arrangement this category always ships: **the quote board**, where every
row is a live price and the row's meaning is its number. Here the number is not the point. The
**margin** is the point — the mark, the count, the rail — and the price is supporting evidence
inside the entry. A user who reads only the left 120px of this page has already got the product.

### Brief-pin scope — an explicit decision, not a drift

The previous draft claimed "a pin beats the roll, always" and then shipped hairline ruling, no
boxes, condensed caps and margin rails, which is a ledger and not CoinGecko. Both claims cannot
stand. Here is the decision, made rather than absorbed:

**The CoinGecko pin binds palette, density, and dark theme. Structure is the ledger's.**

Specifically, the pin is authoritative over: the near-black blue-tinted ground, the green-up /
red-down convention, green as the single accent hue, dark theme only, and the row density of a
data-forward list. The pin is *not* authoritative over: row containment (rules, not cards), column
grammar, the margin rail, label typography, or the checkpoint mechanic's expression.

This is a real narrowing of what `PRODUCT.md` currently says. **On approval, `PRODUCT.md`'s brand
commitment gets edited to say exactly this** — "visual direction pinned to CoinGecko's colour
temperament, density and green accent; structure is LastSeen's own" — so the next agent to read it
inherits the decision instead of re-deriving it. If you would rather the pin stay whole and the
ledger structure yield, say so and the build becomes the standing exit in §7. What will not happen
is both claims sitting in the file at once.

The translated materials, then: cream paper and iron-gall ink become a true-dark instrument ground
with light ruling; printed hairlines are kept at 1px as the structural device; ledger red for
corrections is withdrawn so red does one job only. No book texture, no paper grain, no
skeuomorphism — the translation is structural.

### Raises taken from the hands it beat

Each declined challenger donated one discipline the assigned direction lacked. Ambition and system
discipline transfer; clothes do not.

- **Raise (from the gravity-rain garden): one dominant field.** A single column governs the whole
  list and everything else visibly defers to it. Here that is the *since you last checked* column —
  widest, brightest, first in the reading order after the margin. The price column is deliberately
  quieter than it wants to be.
- **Raise (from the drawcord cape): the accent is a control, never decoration.** The gold cord is
  the only non-neutral in that world and it is always the thing you pull. Green appears on operable
  things, on things pointing at an operable thing, and on the price-change axis. Nowhere else. No
  green headings, no green rules, no green decoration.
- **Raise (from the poster wall): focus expands, neighbours recede.** Keyboard focus lifts one row
  and quiets the rest of the ledger — the product is keyboard-operable under test, so focus gets a
  real designed state, not a browser outline.
- **Raise (from the creator-hardware bench): one committed action, physically distinct.** The
  sign-off control on the detail surface is the single most physically present element on the page.
  It should look like the one key on the bench you actually press.

### Honest risk

The band axis is **amber → brass → slate → grey**. Amber sits off the red/green axis entirely, so
it does not collide with price direction, and it reads as alarm on first glance, which is what
`URGENT` needs to do. The earlier draft rejected amber because the surface brief recorded it as the
prior pass — that was novelty-avoidance dressed as a design argument, and it produced an ice-blue
`URGENT` that would read wrong every single time. Amber is the correct answer and it is taken.

What differentiates this from the prior pass is the **carrier**, not the hue: band is encoded first
by rail extent, second by the caps word, and only third by colour. The prior pass used amber→slate
as a chip colour, where hue was doing all the work.

The remaining real exposure is narrower and stays named: amber at `#FFB020` and red at `#FF6257`
are **1.61:1** against each other, so a user with a red-yellow deficiency will not separate the
`URGENT` rail from a down-move by hue. They are never adjacent — the rail is in the left margin,
the change figure is three columns right — and both carry a non-colour signal (the caps word
`URGENT`; the `▼` glyph and `−` sign). The design does not depend on telling them apart by colour.

---

## 2. Direction contract

*(This is the block that goes into the surface brief on approval, verbatim.)*

**THESIS** — The watch log: what happened while you were away, held open in the margin until you
countersign. Refuses the quote board, where the row's meaning is its live number.

**OWN-WORLD** — True-dark instrument ground, 1px light ruling as the only structural device, no
boxes or cards. Archivo / Archivo Narrow, caps labels, tabular figures throughout. A left margin
rail carrying band by extent on an amber→grey ramp, a standing flag carrying unseen count, and the
star. One green, in two grammars: a numeral in the change column, a filled surface in chrome.

**STORY** — The user sees, in the API's order, which watched stocks moved in a way that deserves
attention, reads why in plain language, trusts or distrusts each figure because the log says which,
opens one, and signs it off. Stocks enter and leave by the same star.

**FIRST VIEWPORT** — Fixed top rule: wordmark left, ruled search line centered, account glyph
right. Beneath it a full-bleed ledger: caps column heads over a hairline, then rows. Each row reads
margin-first — band rail, unseen flag and count, star — then symbol over company name, then the
dominant *since you last checked* column, then price with its three separate status marks, then the
explanation clamped to two lines. No primary action on this surface; the search line is the only
way in, the margin star the only way out.

**FORM** — The watch log and its handover. Position 4 of 7 on the grounded list. Seed `a92a3fb8`.

**FINISH** — unreviewed and undocumented is unfinished; this build ends with the finish review, the
verdict, DESIGN.md, and every shipping raster carrying its provenance.

---

## 3. The system

Concrete enough to argue with. Values are the proposal, not yet measured off a build.

### Colour

Strategy: **Restrained** — neutrals plus one accent. Correct for Operate; the visitor came to read
a list, not to be persuaded.

Every ratio below is **computed**, not asserted. The previous draft claimed AA for two tokens that
failed it: `--ink-3` at `#5F6C7A` was 3.61:1 while carrying 12px caps micro-labels, and the QUIET
rail at `#2A343D` was 1.53:1, far under the 3:1 floor for a graphical object — it was not
functioning as a carrier at all. Both are corrected here.

| Token | Value | vs `--ground` | vs `--ground-raised` | Requirement | Use |
|---|---|---|---|---|---|
| `--ground` | `#0B0E11` | — | — | — | Page |
| `--ground-raised` | `#12161B` | 1.07 | — | none | Top rule, focused row, detail panels |
| `--rule` | `#262E38` | **1.41** | 1.32 | exempt † | Every hairline |
| `--rule-strong` | `#3A4550` | **1.98** | 1.86 | exempt † | Column-head rule, section breaks |
| `--ink` | `#E8EDF2` | **16.43** | 15.42 | 4.5 | Body, numerals |
| `--ink-2` | `#9AA6B2` | **7.81** | 7.33 | 4.5 | Company names, secondary figures |
| `--ink-3` | `#808C99` | **5.65** | 5.30 | 4.5 | 11–12px caps labels, footnotes |
| `--green` | `#16C784` | **8.79** | 8.25 | 4.5 | Up-changes; primary action fills; focus ring |
| `--red` | `#FF6257` | **6.58** | 6.17 | 4.5 | Down-changes |
| `--band-urgent` | `#FFB020` | **10.58** | 9.93 | 3.0 | Band label; the star's fill (see below) |
| `--band-notable` | `#B8903F` | **6.54** | 6.14 | 3.0 | Rail + label |
| `--band-minor` | `#6B7785` | **4.24** | 3.98 | 3.0 | Rail + label |
| `--band-quiet` | `#5A6673` | **3.30** | 3.10 | 3.0 | Rail + label |
| `--hatch` | `#3A4550` | 1.98 | 1.86 | exempt ‡ | STALE / UNAVAILABLE hatch |

† Rules are non-informational structure. No rule anywhere in this product is the sole carrier of
any state, value, or grouping — remove every rule and the page still parses. WCAG 1.4.11 applies to
objects that convey information; decorative separators are outside it. This is a claim the build
must not quietly break: the moment a rule starts meaning something, it needs 3:1.

‡ The hatch is redundant texture behind a cell that is *also* labelled with a caps chip and has its
numerals dropped to `--ink-2`. It carries no information alone.

**Axis one — price change sign.** The only place hue encodes a numeric value.

| Role | Token | Non-colour carriers |
|---|---|---|
| Up | `--green` | `▲` glyph **and** an explicit `+` from `format.ts` |
| Down | `--red` | `▼` glyph **and** an explicit `−` from `format.ts` |

Green is more luminous than red (8.79 vs 6.58) because red cannot go higher without turning pink.
The asymmetry is inherent to the hue, is small enough not to bias reading, and is named rather than
papered over.

**Axis two — attention band.** Amber → brass → slate → grey.

**Extent carries the ramp; luminance supports it; hue is the weakest carrier.** Stated precisely,
because the earlier draft overclaimed: adjacent steps are only 1.62 (urgent/notable), 1.54
(notable/minor) and 1.28 (minor/quiet) against each other, and at 1.28 `MINOR` and `QUIET` are
effectively identical in greyscale. Luminance separates the ends of the ramp, not neighbours. What
actually distinguishes all four in greyscale is rail extent — full height, two thirds, one third,
an 8px tick — and the caps word. That is the stated carrier hierarchy doing its job, so the design
holds; the claim that luminance alone survived greyscale did not.

| Band | Rail extent | Rail colour | Ratio | Label |
|---|---|---|---|---|
| `URGENT` | Full row height, 3px | `--ink` (was `--band-urgent`) | 16.43 | `URGENT` |
| `NOTABLE` | Two thirds, 3px | `--band-notable` | 6.54 | `NOTABLE` |
| `MINOR` | One third, 3px | `--band-minor` | 4.24 | `MINOR` |
| `QUIET` | 8px tick, 1px | `--band-quiet` | 3.30 | `QUIET` |

The `URGENT` rail moved off `--band-urgent` onto `--ink` (defect 10). Once the star took the
product's one deliberate yellow, the rail and the star sat adjacent in the same margin cell,
both amber — a collision on the exact axis this section already argues hue is too weak to carry
alone. The rail loses nothing by giving up hue here: extent (full row height) and the `URGENT`
label were already doing the real work, hue was already named the weakest carrier above, and the
label chip keeps `--band-urgent` since it is text, not a shape sitting beside the star.

**One green, not two.** The previous draft had `--accent: #4BCC00` beside `--up: #4BCC4B` — the
same hue at different saturation, defended on placement while the search list put accent-green
stars directly above up-green figures. That was the failure. There is now a **single green token**,
`--green`, and it earns two grammars rather than two hexes:

- In the change column it is a **numeral** with a sign glyph.
- In chrome it is a **filled surface or ring** — the sign-off bar, the submit button, the focus
  outline — never a numeral.

Different shape, different job, one hue: this is how CoinGecko is unambiguous, and the ambiguity
came from inventing a second green rather than from sharing one.

**The star does not use green, and — as of defect 10 — it is the one deliberate hue outside both
axes.** It sits in the margin of the same rows that carry green figures, which is the one
adjacency the two-grammar rule cannot cover, so it was already excluded from `--green`. The
original hueless rule (filled star in `--ink`) is superseded: starred is now a **filled** star in
`--band-urgent` (10.58:1), reusing the existing amber token rather than adding a new hex; unstarred
is still an **outline** star in `--ink-3` (5.65:1). Fill versus outline remains the real carrier —
legible in greyscale and to any colour vision — colour is layered on top of that shape difference,
not a replacement for it. Because the star now carries this hue, the `URGENT` rail was moved off
`--band-urgent` onto `--ink` (see Axis two, above) so the two shapes sitting in the same margin
cell are never both amber at once.

**Trust marks — no hue at all.** `STALE` and `UNAVAILABLE` are deliberately kept off both hue axes,
because a third colour meaning would be the collision the surface brief is trying to prevent. They
render as a 4px diagonal `--hatch` behind the price cell, plus a caps chip in `--ink-3`, with the
cell's numerals dropped from `--ink` to `--ink-2` (7.81:1 — dimmed, still comfortably AA). The row
holds its rank position, its band rail, and its full opacity everywhere else. Dimmed and labelled,
never filtered, never hidden, never re-sorted.

`UNAVAILABLE` additionally renders no price numeral — there is no value to show — and the cell
carries `NO PRICE` in caps rather than a dash, which would read as zero.

### Type

**Archivo** (text, UI, all numerals) and **Archivo Narrow** (caps labels, column heads, rail
words). One family, two widths — exactly the relationship between a ledger's printed headings and
its written entries. Self-hosted variable woff2, both widths, `swap`.

`font-variant-numeric: tabular-nums` is set globally on the numeral class and never opted out of.
Every column of figures aligns; this is non-negotiable and is a stated requirement in the brief.

| Token | Face | Size / line | Use |
|---|---|---|---|
| `--t-symbol` | Archivo 600 | 17 / 22 | `AAPL` |
| `--t-name` | Archivo 400 | 13 / 18, `--ink-2` | `Apple Inc.` |
| `--t-figure` | Archivo 500 tnum | 20 / 24 | The change column |
| `--t-figure-sm` | Archivo 400 tnum | 15 / 20 | Price, baseline, sessions |
| `--t-body` | Archivo 400 | 14 / 21 | The explanation |
| `--t-label` | Archivo Narrow 600 | 11 / 12, `0.08em`, caps | Column heads, bands, chips |

No display face. Operate surfaces do not get one, and a headline face here would be a costume.

### Structure

8px base. Row height 76px at rest. Ledger is full-bleed to a 1440 max, gutter 32px. Rules, not
boxes: **there are no cards anywhere in this product.** A card is a box drawn around content that
was already delimited by its row.

Sticky column head is `position: sticky; top: <top-rule-height>` on the head row itself with the
scroll container owning the offset — the current build's overlap defect (§6) is a stacking and
offset bug and gets fixed structurally, not with a magic margin.

### Motion

Operate register: almost none, and all of it functional.

- Focus lift: 120ms, focused row to `--ground-raised`, siblings' `--ink` → `--ink-2`.
- Sign-off: the margin flag strikes through and the count clears, 180ms. This is the one moment
  the product has, and it earns motion because it is the only irreversible thing a user does here.
- Star toggle: 100ms fill/unfill. Optimistic — it moves on click, before the POST settles.
- Nothing else. No hover elevation, no entrance staggers, no shimmer.

`prefers-reduced-motion` collapses all three to instant state changes.

---

## 4. The three surfaces

### Sign in

Dark ground, the top rule present but empty except the wordmark. A single ruled entry block,
centered, ~380px: two underlined fields (no boxes — the ruling *is* the field), one solid `--green`
button (chrome fill, per §3's two-grammar rule). Errors sit as a caps line under the rule they belong to. That is the whole surface.

### Watchlist (root)

Top rule, then the ledger. Column heads in caps: `WATCH · STOCK · SINCE YOU LAST CHECKED · PRICE ·
WHAT CHANGED`.

Reading order per row, margin first:

1. **Margin (`WATCH`)** — band rail at its extent, band word beneath it, the standing flag with
   `unseenCount` when non-zero, and **the star**. `unseenCount: 0` renders no flag at all: quiet,
   not an error state, not a zero badge.

   The star lives here, in the column already named `WATCH`, and it is the only way a stock leaves
   the watchlist. The previous draft omitted it entirely, which left removal possible only by
   searching for a stock you already hold and unstarring it in the results — a functional hole, and
   the one place the `×` control was removed on the understanding that the star replaced it.
   CoinGecko unstars from the watchlist row; so does this.

   Star states in the ledger margin:

   Every ledger row is watched by definition, so the resting state is *always* filled. That makes
   the hover state's job specific: it cannot be "filled, but more so" — the earlier draft's
   "filled star lifts to `--ink` at full opacity" was a no-op against a resting state that was
   already filled `--ink`. Hover has to **preview the outcome**, which is removal.

   | State | Render |
   |---|---|
   | Watched (the resting state of every ledger row) | Filled star, `--ink` |
   | Hover / focus | Star switches to **outline** `--ink`, and a 28px round `--ground-raised` pad appears behind the hit area. The shape previews exactly what the click produces; the pad supplies the delta that a colour change alone would not, and marks the hit target |
   | Focus (keyboard) | As hover, plus a 2px `--green` focus ring on the pad |
   | Mid-flight | Star stays outline, row dims to `--ink-2`, row holds its rank position |
   | Failed | Star returns to filled, caps `COULDN'T REMOVE` under the symbol. Non-destructive, no dialog |

   Accessible name `Remove {symbol} from your watchlist`, on the button, not a `title`.

   The removed row disappears on the next successful list read — it is never animated out from
   under the cursor, and the list is never re-sorted client-side to close the gap.

   **The row is not an anchor, and the star is a sibling button.** The earlier draft said both "the
   whole row is a link" and "the star is inside the row but not inside the row's link," which
   cannot both hold — a `<button>` inside an `<a>` is invalid HTML and behaves unpredictably under
   screen readers.

   The current build already resolves this correctly and the redesign inherits it rather than
   replacing it: `InboxRow` renders `<tr role="row" tabIndex={0} onClick onKeyDown>` inside a
   table — no anchor anywhere — and that is precisely what invariant 4 tests
   (`fireEvent.keyDown(getAllByRole('row')[1], { key: 'Enter' })`). The star becomes a sibling
   `<button>` in the margin cell calling `stopPropagation`, which is the pattern the existing
   remove control already uses and which `inbox.test.tsx` already covers with "does not activate
   the row when Enter is pressed on the remove button itself."

   So: tab order is row, then star. Enter on the row opens detail; Enter or Space on the star
   unstars and does not navigate. No nesting, no stretched pseudo-element, no anchor — and
   invariant 4 keeps testing the same element it tests today.

   **One flagged test consequence.** The current remove control has a two-step confirm (`Yes,
   remove AAPL` / `Cancel removing AAPL`), covered by about five assertions. The star replaces that
   flow per §6 of the surface brief, so those assertions are genuinely stale markup, not weakened
   meaning — but the protection they encode (a mis-click must not silently destroy watchlist
   state) has to survive. It survives by reversibility rather than by confirmation: unstarring is
   undone by clicking the same star again, and the row holds its position until the next list read
   so the target does not move. I will replace those tests with equivalents asserting that, not
   delete them. Calling it out because §8 forbids weakening an assertion's meaning, and this is the
   one place in the redesign where that judgement is being exercised.
2. **Stock** — `symbol` at `--t-symbol` over the company name at `--t-name`. The company name is
   the one authorized backend change (`LEFT JOIN instrument_catalog`, fall back to the symbol
   string), and it is what makes this read as a list of companies rather than a list of codes.
3. **Since you last checked** — the dominant column. `percentageChange` at `--t-figure` with sign
   glyph and colour, `absoluteChange` beneath at `--t-figure-sm`, `sessionsElapsed` as a caps
   footnote, `adjustmentLabels` as caps chips when present. `volatilityMultiple` appears here only
   when `comparisonStatus` is `OK`. **This block cannot state when the baseline was taken** — there
   is no baseline timestamp on the wire — so it never implies one.
4. **Price** — `price` and `currency` at `--t-figure-sm`, then three *separately rendered* marks
   for `marketStatus`, `valueKind`, and `dataFreshness`. Three orthogonal fields, three marks,
   never concatenated into one chip. The current run-on "Closed Session close Fresh" is exactly the
   defect being fixed.
5. **What changed** — `explanation` at `--t-body`, clamped to **two lines** with
   `-webkit-line-clamp: 2` and a soft fade on the second. **No `title` attribute**: it does not
   open on keyboard focus, does nothing on touch, and screen readers treat it inconsistently —
   unacceptable for the field this document calls the product's voice.

   Overflow is handled by *destination*, not by tooltip. When the text is clamped, the row's
   trailing edge shows a caps `MORE` affordance, and the full untruncated `explanation` renders on
   the detail surface, which is one click or one Enter away and is where the full change set lives
   anyway. Nothing is reachable only by hover. Two lines at 14/21 across the column's width holds
   the great majority of seeded explanations uncut; the clamp is the exception path, not the norm.

Whole row is a link to detail, focusable, Enter-operable. Rank order is rendered in array order,
full stop — no client sort, no grouping, no "unseen first" divider, because a divider would imply
an ordering the API did not send.

**Comparison states, in the change column:**

| `comparisonStatus` | Renders |
|---|---|
| `OK` | The figures |
| `AWAITING_BASELINE` | `NO BASELINE YET` in caps at `--ink-3`, and one line: "First reading arrives with the next update." **No numeral anywhere in the column.** |
| `SUPPRESSED_CORPORATE_ACTION` | A `†` in the margin and `CAN'T COMPARE` in caps, with the `adjustmentLabels` beneath. **No percentage text is emitted at all** — the test asserts this |
| `INSUFFICIENT_HISTORY` | The change figures, `volatilityMultiple` omitted entirely, caps footnote `SHORT HISTORY` |

**Empty watchlist** — the ledger's ruled head over a blank field, one line of body copy, "Add
stocks to your watchlist", with a thin `--green` leader pointing up at the search line. The ruling
stays: an empty log is still a log.

**Loading the ledger** — this is the first thing every user sees on every visit, and the previous
draft designed it in five words inside the motion section. Designed properly:

The top rule renders immediately and completely — wordmark, search line, account glyph — because
none of it depends on the fetch. The search line is **operable during the load**; a user who knows
they want to add a stock should not wait on a list they are not reading.

Below it, the ledger draws its **column heads and its rules first**, then eight placeholder rows at
the real 76px row height: in each, a `--rule` bar at the width the symbol will occupy, a shorter one
for the company name, and one at the change column's width. No shimmer, no pulse, no spinner. A log
that has not been written in yet is a ruled blank page, which is exactly what this is, and holding
the real row height and the real column positions means **nothing moves when the data lands** — the
rows fill in place rather than reflowing the page under a cursor that is already moving.

The container carries `aria-busy="true"` and a visually-hidden `Loading your watchlist`; the
placeholder rows themselves are `aria-hidden`. Under `prefers-reduced-motion` nothing changes,
because there was no motion to remove.

If the fetch is still open after ~600ms nothing additional appears — the ruled page is already an
honest statement. If it fails, the placeholder rows are replaced by a single ruled line carrying
`COULDN'T LOAD YOUR WATCHLIST` in caps and a `Try again` control in the chrome grammar. A 401 does
not render here at all; it falls to sign in, per §3 of the surface brief.

### Search

The centered search line in the top rule expands downward into a ruled result list on the same
ground — same row grammar as the ledger so the two read as one object. Each result: `symbol`,
`name`, `exchange`, and a star at the right. **The search star uses the same fill-vs-outline
grammar as the ledger star** — filled `--ink` when the stock is on the watchlist, outline `--ink-3`
when it is not. It is the same control two inches from the ledger and it cannot mean two different
things; the earlier draft had it rendering green here and fill-vs-outline there. Starred renders
**immediately** on click, before the POST settles. No results is its own state — `NO MATCH` in caps plus one body
line — and is visually distinct from the pre-typing state, which shows nothing at all. The existing
debounce, abort, `aria-activedescendant`, and arrow/Enter/Escape behaviour is restyled and not
rewritten.

### Stock detail

The handover sheet. Top: the stock's identity and its full envelope, the same *since you last
checked* block at larger scale.

Then the unseen changes as log entries in `publishedSeq` order, each one ruled off:
`publishedSeq` as the entry number in the margin, `sessionDate` and `latestAt` as caps, the band
rail continuing the ledger's vocabulary, `sharedExplanation` as body copy, and the signals beneath
as an evidence table — `signalType`, `detectorVersion`, `marketTimestamp`, `dedupeKey`, and the
`evidence` map as literal key/value rows. Evidence is rendered as *readings*, not prose: keys in
`--t-label`, values in tabular figures. There is no `strength` and no `phenomenonGroup` on the
wire and neither is rendered or implied.

The countersign: a full-width solid `--green` bar, **Mark as read**, the most physically present
element on any of the three surfaces. The existing `useRef` acknowledge latch — fires at most once
per mount, on click or on unmount with unseen changes, never on mount — is restyled around and not
touched. A 403 refused token leaves the changes unread and says so in a quiet line; it is not an
error dialog.

---

## 5. Dependencies

- **lucide-react** — star, chevron, account glyph. Permitted.
- **Archivo / Archivo Narrow** — self-hosted variable woff2, subset latin.
- **No router.** Hash routing stays; a router library is permitted but buys nothing here and would
  churn behaviour that is under test.
- No CSS framework, no charting library, no state library. `styles.css` is replaced wholesale and
  is itself the design system.

---

## 6. What this direction does not do

Named so approval is informed:

- No charts or sparklines, in any form, anywhere. Out of scope, and the API carries no series.
- No 52-week range, volume, market cap, or logo imagery — none of it exists on the wire, so none
  of it is designed around.
- No light theme, no toggle, no mobile breakpoints below 1024px.
- No watchlist management, no settings, no discovery board.

---

## 7. The alternates

Two challengers held one of the two axes (audience identification, product clarity) and stay live
alternates. Say the word and either becomes the build.

### Competitive — **One-bit desktop**
*(`medium-native-one-bit-desktop`)*
Black and white at 1-bit, 50% dither for disabled, marching-ants selection, Chicago-style caps,
whole-pixel scaling. **Holds product clarity**: dither-for-unavailable is the best greyscale-safe
trust carrier on the table, and "state is a pattern, not a hue" solves the two-axis collision
outright. **Loses audience identification**: a retail investor checking a watchlist does not live in
System 6, and it collides head-on with the pinned CoinGecko dark-and-green.
Board: `impeccable.style/worlds/cards/medium-native-one-bit-desktop.webp`

### Competitive — **Cutting bench, select rail**
*(`operate-a-cutting-bench-select-rail`)*
A perforated select rail across a grain-orange-on-black field, punched frame windows, grease cross
for done, a folded tape flag where you stopped, discards hanging on pins below. **Holds product
clarity**, strongly — "the folded flag where you stopped" is this product's mechanic almost exactly,
and rank-by-cell-count rather than by size is a genuinely better attention encoding. **Loses
audience identification**: film editing is not the retail investor's world, and one-orange-on-black
fights the pinned green. Closest sibling to the assigned direction; if the watch log reads too
sober to you, this is the warmer version of the same idea.
Board: `impeccable.style/worlds/cards/operate-a-cutting-bench-select-rail.webp`

### Declined, and what was taken from each

Not silently dropped — each donated a discipline, listed as a named raise in §1. Still adoptable
on request.

- **Gravity-rain garden** — declined on both axes. Kept: one dominant field.
- **Drawcord transforming cape** — declined on both axes. Kept: the accent is a control, not decoration.
- **Streaming title-card wall** — declined; fails product truth outright, since there is no artwork
  on the wire. Kept: focus expands, neighbours recede.
- **Creator-hardware bench** — declined on both axes. Kept: one committed action, physically distinct.

### The standing exit — **CoinGecko, played straight**

Permanently available, and yours to take without justification. To be clear about what this is
after the §1 correction: this exit is **not** "honour the pin" — the assigned direction already
honours the pin at its narrowed scope. This exit is the *whole canon*: drop the ledger entirely and
execute the CoinGecko data table at full fidelity — rank number, symbol-over-name, chips for
status, card containment, its type and its spacing, not just its palette.

Taking it is the answer to §1's open question in its other direction: the pin stays whole and the
ledger structure yields. If you take it, I will ask which two or three products should set the
craft bar, execute it without irony and without smuggling the log back in, and record the choice as
a brand commitment in `PRODUCT.md`.

### Re-roll

Available in three registers, and the register is your steer, not mine: **plain** (a fresh hand,
same spread), **safer** (the remaining conventional grounded candidates plus the canon), **bolder**
(foreign forms only, at full commitment). A re-roll eliminates every direction shown above.

---

## 8. On approval

The build follows §9 of `UI_SURFACE_BRIEF.md` exactly: `npm run typecheck -w web`, `npm run lint`,
`npm run test -w web`, and `npm run build -w web` all clean; the 28 tests updated only where a
matcher is genuinely made stale by formatting, never weakened, never deleted. Then a short list of
what changed, the local URL, and stop. I will not screenshot it, will not judge it, and will not
call it verified.

---

## 9. The wordmark's standing mark

The `.wordmark__mark` slot — previously a bare 2px `--ink` tick — now carries an authored logo
raster: a clock ring (white/pale-blue arc) paired with a rising green line-chart and dot, cropped
tight to its visible pixels and exported at 28px (1x/2x) to sit left of the "LastSeen" text at the
top rule's own rhythm, vertically centred by the wordmark's existing flex row.

**Colour note, on the record:** the source asset's green is not `--green` (`#16C784`) — it is a
brighter, more saturated emerald. §3 above documents "one green, not two" as a shipped failure
mode precisely on this axis (`--accent` vs `--up` at the same hue, different saturation). Shipping
the mark unmodified is a knowing exception to that rule, made at explicit instruction rather than
by default, and named here so the next reader does not mistake it for an oversight. If the mark is
revisited, recolouring its green to the literal `--green` token remains the correct fix.

The mark is decorative next to a text wordmark that already says "LastSeen": `alt=""` and
`aria-hidden="true"`, so it is not announced twice. Also wired as the favicon (`web/index.html`,
16px/32px PNGs in `web/public/`) so the same standing mark identifies the tab.

**Two placements, two sizes.** `SignInView` carries its own copy of the top rule
(`.top-rule--bare`) rather than mounting `TopBar`, so the mark had to be added there too — the
28px slot is not inherited. The sign-in page additionally opens with the mark at **72px**,
centred above the tagline (`.entry__mark`, `align-self: center` inside the existing 380px
`.entry` column; the tagline centres with it). This widens §5's sign-in spec, which described the
entry block as fields-and-tagline only: unauthenticated is the one screen with no data on it, so
it is the one place the mark can carry size without competing with a figure. Everywhere past
sign-in it stays 28px in the rule. Both instances are `aria-hidden` — on sign-in the 72px mark
sits above a form whose heading already names the product.
