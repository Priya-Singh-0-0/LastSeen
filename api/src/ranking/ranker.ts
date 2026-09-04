import { D, Decimal, AttentionBand, DataFreshness } from '@stockwatch/contracts';

/**
 * PersonalRanker (T31, architecture §F.4 — INV-1, INV-2). A pure function: every input is
 * already computed by the caller (per-item unseen-change scan + T27's DiffEngine output).
 * Orders by `(max unseen band, max unseen score, |since-check move|)`, de-weighted for
 * staleness (F.5: "the result is still returned but labelled, and the rank is de-weighted
 * rather than the row hidden").
 */

export interface RankableItem<T> {
  readonly item: T;
  /** null when the instrument has no unseen change records — ranks below any that does. */
  readonly maxUnseenBand: AttentionBand | null;
  readonly maxUnseenScore: Decimal | null;
  /** |percentageChange| from DiffEngine; null when not computable (e.g. AWAITING_BASELINE). */
  readonly sinceCheckMove: Decimal | null;
  readonly dataFreshness: DataFreshness;
}

const BAND_RANK: Record<AttentionBand, number> = {
  [AttentionBand.URGENT]: 3,
  [AttentionBand.NOTABLE]: 2,
  [AttentionBand.MINOR]: 1,
  [AttentionBand.QUIET]: 0,
};

/**
 * De-weight factor applied to STALE/UNAVAILABLE items' sort key so a fresher, lower-band
 * item can still surface above them (labelled, never hidden — F.5). A judgment call, not
 * an architecture-quoted constant: halving keeps a STALE URGENT item generally still
 * visible above quiet fresh items, while letting a comparably-important fresh item win.
 */
const STALENESS_DEWEIGHT = 0.5;

function isStale(freshness: DataFreshness): boolean {
  return freshness === DataFreshness.STALE || freshness === DataFreshness.UNAVAILABLE;
}

function sortKey<T>(entry: RankableItem<T>): [Decimal, Decimal, Decimal] {
  const weight = isStale(entry.dataFreshness) ? STALENESS_DEWEIGHT : 1;
  const bandRank = entry.maxUnseenBand === null ? -1 : BAND_RANK[entry.maxUnseenBand];
  const score = entry.maxUnseenScore ?? D.zero();
  const move = entry.sinceCheckMove === null ? D.zero() : D.abs(entry.sinceCheckMove);
  const w = new Decimal(weight);
  return [D.mul(new Decimal(bandRank), w), D.mul(score, w), D.mul(move, w)];
}

/** Descending sort by (band, score, |move|); stable for ties (Array.prototype.sort). */
export function rankInboxItems<T>(items: readonly RankableItem<T>[]): readonly RankableItem<T>[] {
  return items
    .map((entry, index) => ({ entry, index, key: sortKey(entry) }))
    .sort((a, b) => {
      for (let i = 0; i < 3; i++) {
        if (D.gt(a.key[i]!, b.key[i]!)) return -1;
        if (D.lt(a.key[i]!, b.key[i]!)) return 1;
      }
      return a.index - b.index;
    })
    .map((r) => r.entry);
}
