import { useEffect, useRef } from 'react';
import { EnvelopePrice, EnvelopeStatus } from '../components/EnvelopeBadge.js';
import { EvidencePanel } from '../components/EvidencePanel.js';
import { SinceLastChecked } from '../components/SinceLastChecked.js';
import { BackGlyph, StarGlyph } from '../components/icons.js';
import { PriceChart } from '../components/PriceChart.js';
import type { BarsResponse, InstrumentDetailResponse } from '../types.js';

export interface InstrumentDetailProps {
  readonly data: InstrumentDetailResponse;
  /** Whether this symbol is on the user's own watchlist — independent of `instrumentId`, since
   *  another user's star can already have registered the instrument (T-UI defect 2). */
  readonly watched: boolean;
  /** OHLCV history for the chart. Null while loading, or when the instrument has no bars yet. */
  readonly bars?: BarsResponse | null;
  readonly onToggleStar: () => void;
  readonly onAcknowledge: () => void;
  readonly onBack?: () => void;
}

/**
 * The handover sheet: the full unseen change set for one stock, with its evidence exposed
 * (architecture §F.6).
 *
 * Fires acknowledge exactly once — on an explicit countersign, or on unmount after the view has
 * been seen — never on a GET (CLAUDE.md: no GET mutates user state). That `useRef` latch is
 * behavioural and is restyled around, never rewritten.
 */
export function InstrumentDetail({
  data,
  watched,
  bars = null,
  onToggleStar,
  onAcknowledge,
  onBack,
}: InstrumentDetailProps) {
  const acknowledged = useRef(false);

  function acknowledgeOnce() {
    if (acknowledged.current) return;
    acknowledged.current = true;
    onAcknowledge();
  }

  const unseenCount = data.unseenChanges.length;
  useEffect(() => {
    return () => {
      if (unseenCount > 0) {
        acknowledgeOnce();
      }
    };
    // Intentionally mount/unmount only: acknowledging fires once when the view is left,
    // not on every prop change while it's open.
  }, []);

  const suppressed = data.comparisonStatus === 'SUPPRESSED_CORPORATE_ACTION';
  const companyName = data.name !== undefined && data.name !== data.symbol ? data.name : null;

  return (
    <div className="sheet">
      {onBack ? (
        <button type="button" className="sheet__back" onClick={onBack}>
          <BackGlyph />
          Back to your watchlist
        </button>
      ) : null}

      <header className="sheet__head">
        <div className="sheet__title">
          <button
            type="button"
            className="star sheet__star"
            aria-label={watched ? `Remove ${data.symbol} from your watchlist` : `Add ${data.symbol} to your watchlist`}
            onClick={onToggleStar}
          >
            <StarGlyph filled={watched} size={24} />
          </button>

          <div className="sheet__identity">
            <h1 className="sheet__symbol">{data.symbol}</h1>
            {companyName !== null ? <p className="sheet__name">{companyName}</p> : null}
            {data.exchange !== null ? <p className="sheet__exchange">{data.exchange}</p> : null}
          </div>
        </div>

        <div className="sheet__price">
          <EnvelopePrice envelope={data.current} />
          <EnvelopeStatus envelope={data.current} />
        </div>
      </header>

      {bars && bars.bars.length > 0 && (
        <section className="sheet__chart" aria-label="Price history">
          <PriceChart bars={bars.bars} range={bars.range} />
        </section>
      )}

      {/* Shared, worker-rendered copy. Displayed verbatim: it is already a
          formatted API value, and the frontend derives nothing (CLAUDE.md). */}
      {data.brief !== null ? (
        <section className="sheet__brief" aria-label="About this stock">
          <p className="sheet__brief-text">{data.brief}</p>
        </section>
      ) : null}

      <section className="sheet__since" aria-label="Since you last checked">
        <h2 className="sheet__label">Since you last checked</h2>
        {/* Spread rather than enumerated: an absent diff field must stay absent, not become an
            explicit `undefined` (the project compiles with exactOptionalPropertyTypes). */}
        <SinceLastChecked {...data} scale="sheet" awaitingData={data.current === null} />
      </section>

      {suppressed ? (
        <section className="sheet__suppressed">
          <p className="sheet__suppressed-note">
            Resetting the baseline starts the comparison again from this stock&apos;s current price.
          </p>
          <button type="button" className="action action--quiet" onClick={acknowledgeOnce}>
            Reset baseline
          </button>
        </section>
      ) : null}

      <section className="sheet__entries" aria-label="Unseen changes">
        <h2 className="sheet__label">Unseen changes</h2>
        {/* Rendered in the order the API sent them — published_seq ascending, the order the log
            was written in. The frontend never re-sorts what the API ranked (CLAUDE.md). */}
        <EvidencePanel changes={data.unseenChanges} />
      </section>

      {/* No control when there is nothing to commit: a permanently disabled button offers an
          action that does not exist. The empty case is a statement, so it is rendered as one. */}
      <div className="countersign">
        {unseenCount > 0 ? (
          <button type="button" className="action action--commit" onClick={acknowledgeOnce}>
            {`Mark ${unseenCount} change${unseenCount === 1 ? '' : 's'} as read`}
          </button>
        ) : (
          <p className="countersign__empty">You&apos;re up to date on this stock.</p>
        )}
      </div>
    </div>
  );
}
