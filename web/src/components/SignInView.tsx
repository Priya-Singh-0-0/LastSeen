import { useState } from 'react';
import type { FormEvent } from 'react';

type Mode = 'signin' | 'register';

export interface SignInViewProps {
  readonly onSignIn: (email: string, password: string) => Promise<void>;
  readonly onRegister: (email: string, password: string) => Promise<void>;
  readonly error: string | null;
  readonly onModeChange?: () => void;
}

/**
 * The unauthenticated entry point: the top rule present but empty except the wordmark, and one
 * ruled entry block. The rules are the fields — there are no boxes anywhere in this product.
 */
export function SignInView({ onSignIn, onRegister, error, onModeChange }: SignInViewProps) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function toggleMode() {
    setMode((current) => (current === 'signin' ? 'register' : 'signin'));
    setPassword('');
    onModeChange?.();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (mode === 'register') {
        await onRegister(email, password);
      } else {
        await onSignIn(email, password);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const isRegister = mode === 'register';

  return (
    <div className="sign-in">
      <header className="top-rule top-rule--bare">
        <span className="wordmark">
          <img
            className="wordmark__mark"
            src="/logo-mark.png"
            srcSet="/logo-mark.png 1x, /logo-mark@2x.png 2x"
            alt=""
            aria-hidden="true"
            width={28}
            height={28}
          />
          LastSeen
        </span>
      </header>

      <main className="sign-in__body">
        <form className="entry" onSubmit={handleSubmit}>
          <img
            className="entry__mark"
            src="/logo-mark@2x.png"
            alt=""
            aria-hidden="true"
            width={72}
            height={72}
          />
          <p className="entry__tagline">What changed since you last checked.</p>

          <label className="field">
            <span className="field__label">Email</span>
            <input
              type="email"
              className="field__input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className="field">
            <span className="field__label">Password</span>
            <input
              type="password"
              className="field__input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              minLength={isRegister ? 8 : undefined}
              required
            />
          </label>

          {isRegister ? <p className="entry__hint">Passwords need at least 8 characters.</p> : null}
          {error !== null ? <p className="entry__error">{error}</p> : null}

          <button type="submit" className="action" disabled={submitting}>
            {isRegister
              ? submitting
                ? 'Creating account…'
                : 'Create account'
              : submitting
                ? 'Signing in…'
                : 'Sign in'}
          </button>

          <button type="button" className="entry__toggle" onClick={toggleMode}>
            {isRegister ? 'Already have an account? Sign in' : 'New here? Create an account'}
          </button>
        </form>
      </main>
    </div>
  );
}
