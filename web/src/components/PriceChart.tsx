import { useState } from 'react';
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { formatPrice, formatSessionDate } from '../format.js';
import type { BarWire, BarRangeWire } from '../types.js';

export interface PriceChartProps {
  readonly bars: readonly BarWire[];
  readonly range: BarRangeWire | null;
}

const VIEW_W = 1000;
const VIEW_H = 220;

/**
 * Hand-rolled SVG close-price line. No charting library — the original UI brief bans one, and
 * a polyline over a fixed viewBox is all this needs.
 *
 * **On the arithmetic here:** plotting requires turning prices into pixel coordinates, which
 * means arithmetic on price-derived values. That is presentational geometry, not financial
 * semantics — no displayed figure comes from it. Every number the user actually *reads* (the
 * window high, low, and change, and the hovered close) arrives from the API and is rendered
 * verbatim. The frontend still derives no financial value; it only decides where to put ink.
 *
 * Scaling uses the API's own `range.high`/`range.low` when present so the axis agrees with the
 * labels beside it, rather than a second independently-computed extent.
 */
export function PriceChart({ bars, range }: PriceChartProps) {
  // Index of the bar under the pointer, or null when the chart is not being inspected.
  const [active, setActive] = useState<number | null>(null);

  if (bars.length < 2) {
    return (
      <p className="chart__empty">
        Not enough history to chart yet.
      </p>
    );
  }

  const closes = bars.map((b) => Number(b.close));
  const high = range ? Number(range.high) : Math.max(...closes);
  const low = range ? Number(range.low) : Math.min(...closes);
  const span = high - low || 1;
  const lastIndex = closes.length - 1;

  const xFor = (i: number) => (i / lastIndex) * VIEW_W;
  const yFor = (close: number) => VIEW_H - ((close - low) / span) * VIEW_H;

  const points = closes.map((close, i) => `${xFor(i).toFixed(2)},${yFor(close).toFixed(2)}`).join(' ');

  const areaPath = `M0,${VIEW_H} L${points.split(' ').join(' L')} L${VIEW_W},${VIEW_H} Z`;

  // Direction is a sign test on an API-computed value, not a recomputed change.
  const up = range ? !range.absoluteChange.startsWith('-') : closes[closes.length - 1]! >= closes[0]!;

  /**
   * Pointer x → bar index. `preserveAspectRatio="none"` maps the viewBox width linearly onto
   * the element width, so a fraction of the box is the same fraction of the axis.
   */
  function indexFromPointer(event: ReactPointerEvent<HTMLDivElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return 0;
    const ratio = (event.clientX - rect.left) / rect.width;
    return Math.min(lastIndex, Math.max(0, Math.round(ratio * lastIndex)));
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    setActive((current) => {
      const from = current ?? lastIndex;
      return Math.min(lastIndex, Math.max(0, from + step));
    });
  }

  const activeBar = active === null ? null : bars[active];
  const activeClose = active === null ? null : closes[active];

  return (
    <figure className="chart">
      {/* The pointer surface is the wrapper, not the SVG: it keeps the readout in HTML (real
          text, selectable and legible at any chart height) while the marks stay in viewBox
          coordinates alongside the line they annotate. */}
      <div
        className="chart__plot"
        tabIndex={0}
        role="application"
        aria-label="Price chart. Use the left and right arrow keys to read individual closes."
        onPointerMove={(event) => setActive(indexFromPointer(event))}
        onPointerDown={(event) => setActive(indexFromPointer(event))}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={onKeyDown}
      >
        <svg
          className={`chart__svg ${up ? 'chart__svg--up' : 'chart__svg--down'}`}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={
            range
              ? `Close price over ${range.sessions} sessions, ${range.from} to ${range.to}`
              : 'Close price history'
          }
        >
          <path className="chart__area" d={areaPath} />
          <polyline className="chart__line" points={points} />

          {active !== null && activeClose !== undefined && activeClose !== null && (
            <g className="chart__cursor">
              <line
                className="chart__crosshair"
                x1={xFor(active)}
                y1={0}
                x2={xFor(active)}
                y2={VIEW_H}
              />
              <circle className="chart__dot" cx={xFor(active)} cy={yFor(activeClose)} r={3} />
            </g>
          )}
        </svg>

        {activeBar && active !== null && (
          <div
            className="chart__readout"
            style={{ left: `${(active / lastIndex) * 100}%` }}
            data-edge={active < lastIndex * 0.12 ? 'start' : active > lastIndex * 0.88 ? 'end' : null}
          >
            <span className="chart__readout-price">{formatPrice(activeBar.close)}</span>
            <span className="chart__readout-date">{formatSessionDate(activeBar.sessionDate)}</span>
          </div>
        )}
      </div>

      {range && (
        <figcaption className="chart__meta">
          <span className="chart__meta-item">
            <span className="chart__meta-label">High</span>
            <span className="chart__meta-value">{range.high}</span>
          </span>
          <span className="chart__meta-sep" />
          <span className="chart__meta-item">
            <span className="chart__meta-label">Low</span>
            <span className="chart__meta-value">{range.low}</span>
          </span>
          <span className="chart__meta-sep" />
          <span className="chart__meta-item">
            <span className="chart__meta-label">{range.sessions} sessions</span>
            <span className="chart__meta-value">
              {range.percentageChange === null ? '—' : `${range.percentageChange}%`}
            </span>
          </span>
        </figcaption>
      )}
    </figure>
  );
}
