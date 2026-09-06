// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PriceChart } from '../src/components/PriceChart.js';
import type { BarWire } from '../src/types.js';

afterEach(cleanup);

/**
 * The hover readout is the only place the chart puts a *number* on screen that isn't in
 * `range`. It must render the API's own `close` string verbatim at display precision — the
 * frontend derives no price (CLAUDE.md), and reading a value off the plotted geometry would
 * be exactly that.
 */

/** Five sessions, one bar per day, closes chosen so every one is distinguishable. */
const BARS: BarWire[] = [
  { sessionDate: '2026-09-01', open: '100.00', high: '101.00', low: '99.00', close: '100.00', volume: '1000' },
  { sessionDate: '2026-09-02', open: '101.00', high: '102.00', low: '100.00', close: '102.50', volume: '1000' },
  { sessionDate: '2026-09-03', open: '102.00', high: '103.00', low: '101.00', close: '101.25', volume: '1000' },
  { sessionDate: '2026-09-04', open: '103.00', high: '104.00', low: '102.00', close: '105.75', volume: '1000' },
  { sessionDate: '2026-09-05', open: '105.00', high: '106.00', low: '104.00', close: '104.00', volume: '1000' },
];

/**
 * jsdom lays nothing out, so `getBoundingClientRect` returns zeroes and the pointer-to-index
 * mapping would always resolve to 0. Pinning a 500px-wide box makes clientX meaningful.
 */
function renderChart() {
  const view = render(<PriceChart bars={BARS} range={null} />);
  const plot = view.container.querySelector('.chart__plot') as HTMLElement;
  plot.getBoundingClientRect = () =>
    ({ left: 0, width: 500, top: 0, height: 180, right: 500, bottom: 180, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return { ...view, plot };
}

describe('PriceChart — hover readout', () => {
  it('shows nothing until the chart is actually pointed at', () => {
    renderChart();
    expect(document.querySelector('.chart__readout')).toBeNull();
    expect(document.querySelector('.chart__crosshair')).toBeNull();
  });

  it('reads out the close and date of the bar under the pointer', () => {
    const { plot } = renderChart();
    // Far right edge of a 500px box across 5 bars → the last session.
    fireEvent.pointerMove(plot, { clientX: 500 });
    expect(screen.getByText('104.00')).toBeInTheDocument();
    // Month abbreviation is ICU's ("Sep" vs "Sept" varies by build), so match loosely.
    expect(screen.getByText(/^5 Sept? 2026$/)).toBeInTheDocument();
  });

  it('tracks the pointer to a different bar', () => {
    const { plot } = renderChart();
    fireEvent.pointerMove(plot, { clientX: 500 });
    // Exactly halfway across 4 intervals → index 2.
    fireEvent.pointerMove(plot, { clientX: 250 });
    expect(screen.getByText('101.25')).toBeInTheDocument();
    expect(screen.queryByText('104.00')).toBeNull();
  });

  it('quotes the API close verbatim rather than a value read off the plotted line', () => {
    const { plot } = renderChart();
    fireEvent.pointerMove(plot, { clientX: 375 });
    // Index 3's close is 105.75 — above this window's own high, which the geometry could not
    // have produced. Only the wire value can.
    expect(screen.getByText('105.75')).toBeInTheDocument();
  });

  it('clears the readout when the pointer leaves', () => {
    const { plot } = renderChart();
    fireEvent.pointerMove(plot, { clientX: 250 });
    fireEvent.pointerLeave(plot);
    expect(document.querySelector('.chart__readout')).toBeNull();
  });

  it('is readable by keyboard, starting at the latest session', () => {
    const { plot } = renderChart();
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(screen.getByText('105.75')).toBeInTheDocument();
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(screen.getByText('101.25')).toBeInTheDocument();
  });

  it('does not run off either end of the series', () => {
    const { plot } = renderChart();
    for (let i = 0; i < 10; i += 1) fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(screen.getByText('100.00')).toBeInTheDocument();
    for (let i = 0; i < 10; i += 1) fireEvent.keyDown(plot, { key: 'ArrowRight' });
    expect(screen.getByText('104.00')).toBeInTheDocument();
  });

  it('still refuses to chart a series too short to have a shape', () => {
    render(<PriceChart bars={BARS.slice(0, 1)} range={null} />);
    expect(screen.getByText(/not enough history/i)).toBeInTheDocument();
    expect(document.querySelector('.chart__plot')).toBeNull();
  });
});
