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
    const input = screen.getByLabelText('Add a symbol');
    fireEvent.change(input, { target: { value: '  aapl  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('AAPL'));
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('preserves the input value when onAdd rejects', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('boom'));
    render(<AddInstrumentForm onAdd={onAdd} status={{ kind: 'idle' }} onDismissStatus={() => {}} />);
    const input = screen.getByLabelText('Add a symbol');
    fireEvent.change(input, { target: { value: 'zzzz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('ZZZZ'));
    expect(input).toHaveValue('zzzz');
  });

  it('disables the input and button while the add is pending', async () => {
    let resolve: () => void = () => {};
    const onAdd = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    render(<AddInstrumentForm onAdd={onAdd} status={{ kind: 'idle' }} onDismissStatus={() => {}} />);
    const input = screen.getByLabelText('Add a symbol');
    fireEvent.change(input, { target: { value: 'msft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
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
