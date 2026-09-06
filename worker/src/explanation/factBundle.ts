import { BriefWindow, D, Decimal, toFixed, type DailyBar, type SessionDate } from '@stockwatch/contracts';

export { BriefWindow };

/**
 * Fact bundles for the brief renderers (architecture §F.7).
 *
 * Every number either renderer is allowed to utter is computed here, in
 * deterministic code, from bars the worker already holds — and then frozen as a
 * formatted string. The model receives strings, never raw values, and the
 * validator admits nothing outside this set. That is the mechanism behind
 * "LLMs never calculate or originate financial facts" (CLAUDE.md).
 */

/**
 * Calendar days of lookback per bucket.
 *
 * Deliberately calendar days, not trading sessions. The bucket approximates how
 * long ago someone last opened the stock, and that gap is wall-clock: a visitor
 * returning after a long weekend experienced three days, not one session. Copy
 * that answered in sessions would be describing a different span than the one
 * the reader has in mind.
 */
export const WINDOW_DAYS: Readonly<Record<Exclude<BriefWindow, BriefWindow.FIRST_VIEW>, number>> = {
  [BriefWindow.D1]: 1,
  [BriefWindow.D2]: 2,
  [BriefWindow.W1]: 7,
  [BriefWindow.M1]: 30,
};

/** The trailing window every brief quotes a trading range over, in calendar days. */
const RANGE_DAYS = 30;

/** Bars needed before any comparison is quoted at all (the §G history floor). */
const MIN_BARS = 20;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function sessionMs(date: SessionDate): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export interface BriefFacts {
  readonly window: BriefWindow;
  readonly symbol: string;
  readonly companyName: string | null;
  readonly exchange: string | null;
  readonly sessionDate: SessionDate;
  /**
   * Label → formatted value, in prompt order. The values are the complete set
   * of numbers permitted in the output; `factStrings` derives the validator's
   * allow-list from exactly this.
   */
  readonly values: ReadonlyArray<readonly [label: string, value: string]>;
  /**
   * Numbers the output may contain that are *not* figures to quote: the length
   * of the trailing range and the lookback span. They are named in the prompt's
   * own prose ("over the last 7 days"), so the validator has to allow them, but
   * listing them beside the prices invited the model to read them as data —
   * "Over the 30 trailing range, days, the price has traded…". Grounded here,
   * shown nowhere.
   */
  readonly spans: readonly number[];
  /** Present tense direction word, so the model never has to infer sign. */
  readonly direction: 'rose' | 'fell' | 'was unchanged';
  /**
   * Calendar days spanned by the comparison. Null on FIRST_VIEW, which compares
   * against the prior close and so has no elapsed span to name.
   */
  readonly lookbackDays: number | null;
}

export function factStrings(facts: BriefFacts): string[] {
  return [...facts.values.map(([, value]) => value), ...facts.spans.map(String)];
}

export interface BuildBriefFactsInput {
  readonly window: BriefWindow;
  readonly symbol: string;
  readonly companyName: string | null;
  readonly exchange: string | null;
  /** Daily bars, newest first — `loadRecentBars`' ordering. */
  readonly bars: readonly DailyBar[];
}

/**
 * Builds the bundle, or returns null when the instrument lacks the history the
 * window needs. Null means no brief is rendered at all: a comparison against a
 * baseline that does not exist is exactly the "3.5σ move from four bars" failure
 * §G exists to prevent.
 */
export function buildBriefFacts(input: BuildBriefFactsInput): BriefFacts | null {
  const { window, bars } = input;
  const lookbackDays = window === BriefWindow.FIRST_VIEW ? null : WINDOW_DAYS[window];

  if (bars.length < MIN_BARS) return null;

  const current = bars[0];
  if (!current) return null;

  // FIRST_VIEW compares against the prior close. Every other bucket compares
  // against the newest bar at or before the bucket's calendar cutoff — the close
  // that was on screen the last time someone looked, as nearly as shared data
  // can know it. Bars are newest-first, so `find` returns exactly that bar.
  const past =
    lookbackDays === null
      ? bars[1]
      : bars.find((b) => sessionMs(b.sessionDate) <= sessionMs(current.sessionDate) - lookbackDays * MS_PER_DAY);

  // No bar old enough to compare against. Reaching for the oldest bar we happen
  // to hold would silently describe a different span than the one named.
  if (!past) return null;

  const rangeCutoff = sessionMs(current.sessionDate) - RANGE_DAYS * MS_PER_DAY;
  const range = bars.filter((b) => sessionMs(b.sessionDate) >= rangeCutoff);
  const first = range[0];
  if (!first) return null;

  const zero = D.zero();
  if (D.eq(past.close, zero)) return null;

  const change = D.sub(current.close, past.close);
  // Percentage scale (×100), matching the DiffEngine's convention so the two
  // surfaces never disagree about what "3.10" means.
  const changePct = D.mul(D.div(change, past.close), new Decimal(100));

  const direction = D.eq(change, zero) ? 'was unchanged' : D.gt(change, zero) ? 'rose' : 'fell';

  const high = range.reduce((max, b) => (D.gt(b.high, max) ? b.high : max), first.high);
  const low = range.reduce((min, b) => (D.lt(b.low, min) ? b.low : min), first.low);

  // Magnitude only: direction is carried by `direction`, so the copy reads
  // "fell 3.10%" rather than "changed -3.10%".
  const values: Array<readonly [string, string]> = [
    ['last close', toFixed(current.close, 2)],
    [
      lookbackDays === null ? 'prior close' : `close ${lookbackDays} days earlier`,
      toFixed(past.close, 2),
    ],
    ['percent change', toFixed(D.abs(changePct), 2)],
    [`${RANGE_DAYS}-day high`, toFixed(high, 2)],
    [`${RANGE_DAYS}-day low`, toFixed(low, 2)],
  ];

  return {
    window,
    symbol: input.symbol,
    companyName: input.companyName,
    exchange: input.exchange,
    sessionDate: current.sessionDate,
    values,
    spans: lookbackDays === null ? [RANGE_DAYS] : [RANGE_DAYS, lookbackDays],
    direction,
    lookbackDays,
  };
}
