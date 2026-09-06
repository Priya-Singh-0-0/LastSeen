// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AddInstrumentForm } from '../src/components/AddInstrumentForm.js';

afterEach(cleanup);

describe('AddInstrumentForm (T-UI-3)', () => {
  it('submits the uppercased, trimmed symbol and clears the input on success', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddInstrumentForm onAdd={onAdd} status={{ kind: 'idle' }} onDismissStatus={() => {}} />);
    const input = screen.getByLabelText('Search stocks');
    fireEvent.change(input, { target: { value: '  aapl  ' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('AAPL'));
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('does not call onAdd when the input is whitespace-only (passes native "required" but trims to empty)', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddInstrumentForm onAdd={onAdd} status={{ kind: 'idle' }} onDismissStatus={() => {}} />);
    const input = screen.getByLabelText('Search stocks');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form')!);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onAdd).not.toHaveBeenCalled();
    expect(input).toHaveValue('   ');
  });

  it('preserves the input value when onAdd rejects', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('boom'));
    render(<AddInstrumentForm onAdd={onAdd} status={{ kind: 'idle' }} onDismissStatus={() => {}} />);
    const input = screen.getByLabelText('Search stocks');
    fireEvent.change(input, { target: { value: 'zzzz' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('ZZZZ'));
    expect(input).toHaveValue('zzzz');
  });

  it('disables the input and marks the line busy while the add is pending', async () => {
    let resolve: () => void = () => {};
    const onAdd = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    render(<AddInstrumentForm onAdd={onAdd} status={{ kind: 'idle' }} onDismissStatus={() => {}} />);
    const input = screen.getByLabelText('Search stocks');
    fireEvent.change(input, { target: { value: 'msft' } });
    fireEvent.submit(input.closest('form')!);
    expect(input).toBeDisabled();
    // The standalone Add button is gone (surface brief §6); the search line submits itself and
    // reports the pending add on the form.
    expect(input.closest('form')).toHaveAttribute('aria-busy', 'true');
    resolve();
    await waitFor(() => expect(input).not.toBeDisabled());
  });

  it('renders warming copy for a WARMING added status', () => {
    render(
      <AddInstrumentForm
        onAdd={vi.fn()}
        status={{ kind: 'added', symbol: 'ZZZZ', state: 'WARMING' }}
        onDismissStatus={() => {}}
      />,
    );
    expect(screen.getByText(/still warming up/i)).toBeInTheDocument();
  });

  it('renders ready copy for a READY added status, with no warming text', () => {
    render(
      <AddInstrumentForm
        onAdd={vi.fn()}
        status={{ kind: 'added', symbol: 'AAPL', state: 'READY' }}
        onDismissStatus={() => {}}
      />,
    );
    expect(screen.getByText('Added AAPL.')).toBeInTheDocument();
    expect(screen.queryByText(/warming up/i)).not.toBeInTheDocument();
  });

  it('renders an error status in a role="alert" element with a dismiss control', () => {
    const onDismiss = vi.fn();
    render(
      <AddInstrumentForm
        onAdd={vi.fn()}
        status={{ kind: 'error', message: 'Something went wrong.' }}
        onDismissStatus={onDismiss}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong.');
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe('AddInstrumentForm — symbol search', () => {
  const AAPL = { symbol: 'AAPL', name: 'Apple Inc. Common Stock', exchange: 'NASDAQ' };
  const APP = { symbol: 'APP', name: 'AppLovin Corporation Class A', exchange: 'NASDAQ' };

  function renderWithSearch(
    onSearch: (q: string, signal: AbortSignal) => Promise<readonly typeof AAPL[]>,
    onAdd = vi.fn().mockResolvedValue(undefined),
    onSelectSymbol = vi.fn(),
  ) {
    render(
      <AddInstrumentForm
        onAdd={onAdd}
        status={{ kind: 'idle' }}
        onDismissStatus={() => {}}
        onSearch={onSearch}
        onSelectSymbol={onSelectSymbol}
      />,
    );
    return { onAdd, onSelectSymbol, input: screen.getByLabelText('Search stocks') };
  }

  it('renders the API-provided symbol, name and exchange verbatim — no client-side ticker list', async () => {
    const onSearch = vi.fn().mockResolvedValue([AAPL, APP]);
    const { input } = renderWithSearch(onSearch);
    fireEvent.change(input, { target: { value: 'ap' } });

    await waitFor(() => expect(onSearch).toHaveBeenCalledWith('ap', expect.any(AbortSignal)));
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('AAPL');
    expect(options[0]).toHaveTextContent('Apple Inc. Common Stock');
    expect(options[0]).toHaveTextContent('NASDAQ');
  });

  it('opens the detail page for the suggestion the user picks, not the text they typed', async () => {
    const { onAdd, onSelectSymbol, input } = renderWithSearch(
      vi.fn().mockResolvedValue([AAPL, APP]),
    );
    fireEvent.change(input, { target: { value: 'appl' } });

    const options = await screen.findAllByRole('option');
    fireEvent.mouseDown(options[1]);
    fireEvent.click(options[1]);
    await waitFor(() => expect(onSelectSymbol).toHaveBeenCalledWith('APP'));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('stars a suggestion without navigating — the star is the only toggle, and stops the click from opening detail', async () => {
    const { onAdd, onSelectSymbol, input } = renderWithSearch(
      vi.fn().mockResolvedValue([AAPL, APP]),
    );
    fireEvent.change(input, { target: { value: 'appl' } });

    // Awaited only to let the listbox settle before the star is queried.
    await screen.findAllByRole('option');
    const star = screen.getAllByRole('button', { name: /add .* to your watchlist/i })[1];
    fireEvent.mouseDown(star);
    fireEvent.click(star);
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('APP'));
    expect(onSelectSymbol).not.toHaveBeenCalled();
  });

  it('is keyboard-operable — arrow keys move the highlight and Enter opens the highlighted result', async () => {
    const { onAdd, onSelectSymbol, input } = renderWithSearch(
      vi.fn().mockResolvedValue([AAPL, APP]),
    );
    fireEvent.change(input, { target: { value: 'ap' } });
    await screen.findAllByRole('option');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    await waitFor(() =>
      expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true'),
    );
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(onSelectSymbol).toHaveBeenCalledWith('APP'));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('Escape closes the list without adding anything', async () => {
    const { onAdd, input } = renderWithSearch(vi.fn().mockResolvedValue([AAPL]));
    fireEvent.change(input, { target: { value: 'aa' } });
    await screen.findAllByRole('option');

    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('option')).not.toBeInTheDocument());
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('debounces to one request per typing burst and aborts the superseded one', async () => {
    const onSearch = vi.fn().mockResolvedValue([AAPL]);
    const { input } = renderWithSearch(onSearch);
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'aa' } });
    fireEvent.change(input, { target: { value: 'aap' } });

    await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(1));
    expect(onSearch).toHaveBeenCalledWith('aap', expect.any(AbortSignal));
  });

  it('stays usable as a blind add-by-symbol box when the search request fails', async () => {
    const onSearch = vi.fn().mockRejectedValue(new Error('offline'));
    const { onAdd, input } = renderWithSearch(onSearch);
    fireEvent.change(input, { target: { value: 'zzzz' } });
    await waitFor(() => expect(onSearch).toHaveBeenCalled());
    expect(screen.queryByRole('option')).not.toBeInTheDocument();

    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('ZZZZ'));
  });

  it('issues no search request at all when no onSearch is provided', async () => {
    render(<AddInstrumentForm onAdd={vi.fn()} status={{ kind: 'idle' }} onDismissStatus={() => {}} />);
    fireEvent.change(screen.getByLabelText('Search stocks'), { target: { value: 'aapl' } });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
