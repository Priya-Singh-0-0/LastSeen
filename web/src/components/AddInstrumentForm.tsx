import { useState } from 'react';
import type { FormEvent } from 'react';

export type AddInstrumentStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'added'; readonly symbol: string; readonly state: 'WARMING' | 'READY' };

export interface AddInstrumentFormProps {
  readonly onAdd: (symbol: string) => Promise<void>;
  readonly status: AddInstrumentStatus;
  readonly onDismissStatus: () => void;
}

/**
 * A blind add-by-symbol box, not a search box. There is no symbol-search endpoint, so this
 * never offers autocomplete or a client-side ticker list (CLAUDE.md — that would be a
 * fabricated financial fact). The API accepts any string and resolves it asynchronously, so a
 * successful submit can only ever report 'added' (READY or WARMING) — never a symbol-not-found
 * error, since the UI genuinely cannot tell "warming up" from "typo".
 */
export function AddInstrumentForm({ onAdd, status, onDismissStatus }: AddInstrumentFormProps) {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const symbol = value.trim().toUpperCase();
    setPending(true);
    try {
      await onAdd(symbol);
      setValue('');
    } catch {
      // The parent owns error presentation via `status`; the input is preserved for correction.
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="add-instrument-form" onSubmit={(event) => void handleSubmit(event)}>
      <input
        type="text"
        className="add-instrument-form__input"
        aria-label="Add a symbol"
        placeholder="Add a symbol — e.g. AAPL"
        maxLength={20}
        required
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={pending}
      />
      <button type="submit" className="button button--primary" disabled={pending}>
        Add
      </button>
      {status.kind === 'error' ? (
        <p className="add-instrument-form__status add-instrument-form__status--error" role="alert">
          {status.message}
          <button type="button" className="add-instrument-form__dismiss" onClick={onDismissStatus}>
            Dismiss
          </button>
        </p>
      ) : null}
      {status.kind === 'added' ? (
        <p className="add-instrument-form__status add-instrument-form__status--added">
          {status.state === 'READY'
            ? `Added ${status.symbol}.`
            : `Added ${status.symbol}. Market data is still warming up — it will appear here once the worker has ingested it.`}
        </p>
      ) : null}
    </form>
  );
}
