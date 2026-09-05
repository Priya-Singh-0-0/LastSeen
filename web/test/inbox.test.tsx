// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AttentionBand } from '../src/components/AttentionBand.js';
import { EnvelopeBadge } from '../src/components/EnvelopeBadge.js';
import { EvidencePanel } from '../src/components/EvidencePanel.js';
import { Inbox } from '../src/pages/Inbox.js';
import { InstrumentDetail } from '../src/pages/InstrumentDetail.js';
import type {
  EnvelopeWire,
  InboxResponse,
  InstrumentDetailResponse,
  UnseenChangeWire,
} from '../src/types.js';

afterEach(cleanup);

describe('AttentionBand (T32)', () => {
  it('renders the band value verbatim as text', () => {
    render(<AttentionBand band="URGENT" />);
    expect(screen.getByText('URGENT')).toBeInTheDocument();
  });

  it('renders nothing but a neutral placeholder when band is null (no unseen changes)', () => {
    render(<AttentionBand band={null} />);
    expect(screen.queryByText('URGENT')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('EnvelopeBadge (T32)', () => {
  const envelope: EnvelopeWire = {
    value: '187.42',
    currency: 'USD',
    marketTimestamp: '2026-09-04T20:00:00.000Z',
    ingestedAt: '2026-09-04T20:00:05.000Z',
    source: 'alpaca',
    marketStatus: 'OPEN',
    valueKind: 'LIVE',
    dataFreshness: 'FRESH',
    precisionHint: 2,
  };

  it('renders the value and currency verbatim, with no arithmetic applied', () => {
    render(<EnvelopeBadge envelope={envelope} />);
    expect(screen.getByText('187.42')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
  });

  it('renders market status, value kind, and data freshness as distinct labels', () => {
    render(<EnvelopeBadge envelope={envelope} />);
    expect(screen.getByText('OPEN')).toBeInTheDocument();
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.getByText('FRESH')).toBeInTheDocument();
  });

  it('renders a warming placeholder when envelope is null', () => {
    render(<EnvelopeBadge envelope={null} />);
    expect(screen.getByText('Warming up…')).toBeInTheDocument();
  });
});

describe('EvidencePanel (T32)', () => {
  const changes: readonly UnseenChangeWire[] = [
    {
      id: '1',
      publishedSeq: '5',
      publishedAt: '2026-09-04T20:00:00.000Z',
      band: 'URGENT',
      score: '0.91',
      latestAt: '2026-09-04T20:00:00.000Z',
      sharedExplanation: 'AAPL moved sharply on high volume.',
      signals: [
        {
          signalType: 'LARGE_ABSOLUTE_MOVE',
          detectorVersion: 1,
          dedupeKey: 'AAPL:LARGE_ABSOLUTE_MOVE:2026-09-04',
          evidence: { percentageChange: '4.20', threshold: '3.00' },
          marketTimestamp: '2026-09-04T20:00:00.000Z',
        },
      ],
    },
  ];

  it('renders every change record, its band, score, and shared explanation verbatim', () => {
    render(<EvidencePanel changes={changes} />);
    expect(screen.getByText('URGENT')).toBeInTheDocument();
    expect(screen.getByText('0.91')).toBeInTheDocument();
    expect(screen.getByText('AAPL moved sharply on high volume.')).toBeInTheDocument();
  });

  it('renders every signal contributing to a change, with its type, detector version, and evidence entries', () => {
    render(<EvidencePanel changes={changes} />);
    expect(screen.getByText('LARGE_ABSOLUTE_MOVE')).toBeInTheDocument();
    expect(screen.getByText(/detector v1/i)).toBeInTheDocument();
    expect(screen.getByText('percentageChange')).toBeInTheDocument();
    expect(screen.getByText('4.20')).toBeInTheDocument();
    expect(screen.getByText('threshold')).toBeInTheDocument();
    expect(screen.getByText('3.00')).toBeInTheDocument();
  });

  it('renders an empty state with no model output present when there are no unseen changes', () => {
    render(<EvidencePanel changes={[]} />);
    expect(screen.getByText(/no unseen changes/i)).toBeInTheDocument();
  });
});

describe('Inbox page (T32/T40)', () => {
  const response: InboxResponse = {
    watchlistId: '42',
    items: [
      {
        instrumentId: '101',
        symbol: 'AAPL',
        exchange: 'NASDAQ',
        comparisonStatus: 'OK',
        dataFreshness: 'FRESH',
        current: {
          value: '187.42',
          currency: 'USD',
          marketTimestamp: '2026-09-04T20:00:00.000Z',
          ingestedAt: '2026-09-04T20:00:05.000Z',
          source: 'alpaca',
          marketStatus: 'OPEN',
          valueKind: 'LIVE',
          dataFreshness: 'FRESH',
          precisionHint: 2,
        },
        percentageChange: '4.20',
        sessionsElapsed: 1,
        unseenCount: 3,
        maxUnseenBand: 'URGENT',
        maxUnseenScore: '0.91',
        explanation: 'AAPL moved sharply on high volume, up 4.20% since you last checked.',
      },
      {
        instrumentId: '102',
        symbol: 'MSFT',
        exchange: 'NASDAQ',
        comparisonStatus: 'AWAITING_BASELINE',
        dataFreshness: 'UNAVAILABLE',
        current: null,
        unseenCount: 0,
        maxUnseenBand: null,
        maxUnseenScore: null,
        explanation: 'Still warming up — nothing to compare yet.',
      },
    ],
  };

  it('renders every item in ranked order, with its attention band, unseen count, and explanation verbatim', () => {
    render(<Inbox data={response} />);
    // header row + one row per item
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(response.items.length + 1);
    expect(screen.getByText('URGENT')).toBeInTheDocument();
    expect(screen.getByText(/\b3\b/)).toBeInTheDocument();
    expect(
      screen.getByText('AAPL moved sharply on high volume, up 4.20% since you last checked.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/4\.20/).length).toBeGreaterThan(0);
  });

  it('renders items in the exact order the API returned them, with no client-side re-sort', () => {
    // A response deliberately not in band order (QUIET/URGENT ahead of the MINOR item) — if
    // the UI ever re-sorted by band, this order would change.
    const unsorted: InboxResponse = {
      watchlistId: '7',
      items: [
        { ...response.items[0]!, instrumentId: 'z', symbol: 'ZETA', maxUnseenBand: 'QUIET' },
        { ...response.items[0]!, instrumentId: 'a', symbol: 'ALPHA', maxUnseenBand: 'URGENT' },
        { ...response.items[0]!, instrumentId: 'm', symbol: 'MID', maxUnseenBand: 'MINOR' },
      ],
    };
    render(<Inbox data={unsorted} />);
    const symbolCells = screen.getAllByText(/ZETA|ALPHA|MID/);
    expect(symbolCells.map((el) => el.textContent)).toEqual(['ZETA', 'ALPHA', 'MID']);
  });

  it('renders the warming placeholder for an item with no market state, performing no arithmetic', () => {
    render(<Inbox data={response} />);
    expect(screen.getByText('Warming up…')).toBeInTheDocument();
    expect(screen.getByText('Still warming up — nothing to compare yet.')).toBeInTheDocument();
  });

  it('keeps a STALE item present in the DOM, dimmed and labelled rather than hidden', () => {
    const withStale: InboxResponse = {
      watchlistId: '9',
      items: [
        {
          ...response.items[0]!,
          instrumentId: '999',
          symbol: 'STLE',
          dataFreshness: 'STALE',
          current: { ...response.items[0]!.current!, dataFreshness: 'STALE' },
        },
      ],
    };
    render(<Inbox data={withStale} />);
    expect(screen.getByText('STLE')).toBeInTheDocument();
    expect(screen.getByText('STALE')).toBeInTheDocument();
  });

  it('renders "Can\'t compare" with no percentage for a suppressed corporate-action comparison', () => {
    const suppressedItem: InboxResponse = {
      watchlistId: '9',
      items: [
        {
          instrumentId: '55',
          symbol: 'SPLT',
          exchange: null,
          comparisonStatus: 'SUPPRESSED_CORPORATE_ACTION',
          dataFreshness: 'FRESH',
          current: response.items[0]!.current,
          unseenCount: 0,
          maxUnseenBand: null,
          maxUnseenScore: null,
          explanation: 'A stock split affected this instrument.',
        },
      ],
    };
    render(<Inbox data={suppressedItem} />);
    expect(screen.getByText(/can't compare/i)).toBeInTheDocument();
    expect(screen.queryByText('4.20')).not.toBeInTheDocument();
  });

  it('calls onSelectInstrument with the instrument id when a row is clicked', () => {
    let selected: string | null = null;
    render(<Inbox data={response} onSelectInstrument={(id) => (selected = id)} />);
    fireEvent.click(screen.getAllByRole('row')[1]!);
    expect(selected).toBe('101');
  });

  it('activates a row via the Enter key, not just click', () => {
    let selected: string | null = null;
    render(<Inbox data={response} onSelectInstrument={(id) => (selected = id)} />);
    fireEvent.keyDown(screen.getAllByRole('row')[1]!, { key: 'Enter' });
    expect(selected).toBe('101');
  });

  it('renders an empty-watchlist state when there are no items', () => {
    render(<Inbox data={{ watchlistId: '42', items: [] }} />);
    expect(screen.getByText(/nothing on this watchlist yet/i)).toBeInTheDocument();
  });

  describe('removing an instrument (T-UI-3)', () => {
    function rowForSymbol(symbol: string): HTMLElement {
      return screen.getByText(symbol).closest('tr')!;
    }

    it('renders a remove button per row with an accessible name naming the symbol', () => {
      render(<Inbox data={response} />);
      expect(screen.getByRole('button', { name: 'Remove AAPL from this watchlist' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Remove MSFT from this watchlist' })).toBeInTheDocument();
    });

    it('does not call onRemoveInstrument or onSelectInstrument when the remove button is clicked (confirm first)', () => {
      let removed: string | null = null;
      let selected: string | null = null;
      render(
        <Inbox
          data={response}
          onRemoveInstrument={(id) => (removed = id)}
          onSelectInstrument={(id) => (selected = id)}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Remove AAPL from this watchlist' }));
      expect(removed).toBeNull();
      expect(selected).toBeNull();
      expect(within(rowForSymbol('AAPL')).getByText('Remove?')).toBeInTheDocument();
    });

    it('calls onRemoveInstrument exactly once with the instrument id when "Yes" is clicked', () => {
      let removed: string | null = null;
      let removeCalls = 0;
      render(
        <Inbox
          data={response}
          onRemoveInstrument={(id) => {
            removed = id;
            removeCalls++;
          }}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Remove AAPL from this watchlist' }));
      fireEvent.click(within(rowForSymbol('AAPL')).getByRole('button', { name: 'Yes, remove AAPL' }));
      expect(removed).toBe('101');
      expect(removeCalls).toBe(1);
    });

    it('restores the remove control and calls nothing when "Cancel" is clicked', () => {
      let removed: string | null = null;
      render(<Inbox data={response} onRemoveInstrument={(id) => (removed = id)} />);
      fireEvent.click(screen.getByRole('button', { name: 'Remove AAPL from this watchlist' }));
      fireEvent.click(within(rowForSymbol('AAPL')).getByRole('button', { name: 'Cancel removing AAPL' }));
      expect(removed).toBeNull();
      expect(screen.getByRole('button', { name: 'Remove AAPL from this watchlist' })).toBeInTheDocument();
      expect(screen.queryByText('Remove?')).not.toBeInTheDocument();
    });

    it('does not activate the row (navigate) when Enter is pressed on the remove button itself', () => {
      let selected: string | null = null;
      render(<Inbox data={response} onSelectInstrument={(id) => (selected = id)} />);
      const removeButton = screen.getByRole('button', { name: 'Remove AAPL from this watchlist' });
      fireEvent.keyDown(removeButton, { key: 'Enter' });
      expect(selected).toBeNull();
    });

    it('does not let a keydown on "Yes" or "Cancel" bubble up to navigate the row', () => {
      let removed: string | null = null;
      let selected: string | null = null;
      render(
        <Inbox
          data={response}
          onRemoveInstrument={(id) => (removed = id)}
          onSelectInstrument={(id) => (selected = id)}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Remove AAPL from this watchlist' }));
      const yesButton = within(rowForSymbol('AAPL')).getByRole('button', { name: 'Yes, remove AAPL' });
      const cancelButton = within(rowForSymbol('AAPL')).getByRole('button', { name: 'Cancel removing AAPL' });
      fireEvent.keyDown(yesButton, { key: 'Enter' });
      fireEvent.keyDown(cancelButton, { key: ' ' });
      // Neither keydown should have bubbled to the row and triggered navigation via activate().
      expect(selected).toBeNull();
      // And the row's own handler must not have run onRemove either (only the button's own click handler may).
      expect(removed).toBeNull();
    });
  });
});

describe('InstrumentDetail page (T32)', () => {
  const withUnseen: InstrumentDetailResponse = {
    instrumentId: '101',
    symbol: 'AAPL',
    exchange: 'NASDAQ',
    comparisonStatus: 'OK',
    dataFreshness: 'FRESH',
    current: {
      value: '187.42',
      currency: 'USD',
      marketTimestamp: '2026-09-04T20:00:00.000Z',
      ingestedAt: '2026-09-04T20:00:05.000Z',
      source: 'alpaca',
      marketStatus: 'OPEN',
      valueKind: 'LIVE',
      dataFreshness: 'FRESH',
      precisionHint: 2,
    },
    percentageChange: '4.20',
    sessionsElapsed: 1,
    unseenChanges: [
      {
        id: '1',
        publishedSeq: '5',
        publishedAt: '2026-09-04T20:00:00.000Z',
        band: 'URGENT',
        score: '0.91',
        latestAt: '2026-09-04T20:00:00.000Z',
        sharedExplanation: 'AAPL moved sharply on high volume.',
        signals: [
          {
            signalType: 'LARGE_ABSOLUTE_MOVE',
            detectorVersion: 1,
            dedupeKey: 'AAPL:LARGE_ABSOLUTE_MOVE:2026-09-04',
            evidence: { percentageChange: '4.20', threshold: '3.00' },
            marketTimestamp: '2026-09-04T20:00:00.000Z',
          },
        ],
      },
    ],
    ackToken: 'opaque-token',
  };

  const noUnseen: InstrumentDetailResponse = {
    ...withUnseen,
    unseenChanges: [],
  };

  it('renders the current envelope and since-last-check diff fields verbatim', () => {
    render(<InstrumentDetail data={withUnseen} onAcknowledge={() => {}} />);
    expect(screen.getByText('187.42')).toBeInTheDocument();
    expect(screen.getAllByText(/4\.20/).length).toBeGreaterThan(0);
  });

  it('renders the full unseen set via the evidence panel, with no model output present', () => {
    render(<InstrumentDetail data={withUnseen} onAcknowledge={() => {}} />);
    expect(screen.getByText('LARGE_ABSOLUTE_MOVE')).toBeInTheDocument();
    expect(screen.getByText('threshold')).toBeInTheDocument();
  });

  it('fires acknowledge exactly once when "Mark as read" is clicked', () => {
    let calls = 0;
    render(<InstrumentDetail data={withUnseen} onAcknowledge={() => calls++} />);
    fireEvent.click(screen.getByRole('button', { name: /as read/i }));
    expect(calls).toBe(1);
  });

  it('fires acknowledge on unmount when there were unseen changes and no explicit acknowledge happened', () => {
    let calls = 0;
    const { unmount } = render(<InstrumentDetail data={withUnseen} onAcknowledge={() => calls++} />);
    unmount();
    expect(calls).toBe(1);
  });

  it('does not fire acknowledge twice when the button was already clicked before unmount', () => {
    let calls = 0;
    const { unmount } = render(<InstrumentDetail data={withUnseen} onAcknowledge={() => calls++} />);
    fireEvent.click(screen.getByRole('button', { name: /as read/i }));
    unmount();
    expect(calls).toBe(1);
  });

  it('does not fire acknowledge on unmount when there was nothing unseen to acknowledge', () => {
    let calls = 0;
    const { unmount } = render(<InstrumentDetail data={noUnseen} onAcknowledge={() => calls++} />);
    unmount();
    expect(calls).toBe(0);
  });

  const suppressed: InstrumentDetailResponse = {
    ...noUnseen,
    comparisonStatus: 'SUPPRESSED_CORPORATE_ACTION',
    percentageChange: undefined,
  };

  it('renders a suppression label and a reset-baseline action when the corporate action is unsupported (T35)', () => {
    render(<InstrumentDetail data={suppressed} onAcknowledge={() => {}} />);
    expect(screen.getByText(/unsupported corporate action/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset baseline/i })).toBeInTheDocument();
  });

  it('fires acknowledge when "Reset baseline" is clicked (T35)', () => {
    let calls = 0;
    render(<InstrumentDetail data={suppressed} onAcknowledge={() => calls++} />);
    fireEvent.click(screen.getByRole('button', { name: /reset baseline/i }));
    expect(calls).toBe(1);
  });

  it('does not render the suppression label or reset action for an OK comparison', () => {
    render(<InstrumentDetail data={withUnseen} onAcknowledge={() => {}} />);
    expect(screen.queryByText(/unsupported corporate action/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reset baseline/i })).not.toBeInTheDocument();
  });
});
