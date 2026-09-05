import { useState } from 'react';
import type { FormEvent } from 'react';

type Mode = 'signin' | 'register';

export interface SignInViewProps {
  readonly onSignIn: (email: string, password: string) => Promise<void>;
  readonly onRegister: (email: string, password: string) => Promise<void>;
  readonly error: string | null;
  readonly onModeChange?: () => void;
}

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
      <form className="sign-in__card" onSubmit={handleSubmit}>
        <h1 className="sign-in__wordmark">LastSeen</h1>
        <p className="sign-in__tagline">What changed since you last checked.</p>
        <label className="sign-in__field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label className="sign-in__field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            minLength={isRegister ? 8 : undefined}
            required
          />
        </label>
        {isRegister ? (
          <p className="sign-in__hint">Passwords need at least 8 characters.</p>
        ) : null}
        {error !== null ? <p className="sign-in__error">{error}</p> : null}
        <button type="submit" className="button button--primary" disabled={submitting}>
          {isRegister
            ? submitting
              ? 'Creating account…'
              : 'Create account'
            : submitting
              ? 'Signing in…'
              : 'Sign in'}
        </button>
        <button type="button" className="sign-in__toggle" onClick={toggleMode}>
          {isRegister ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
      </form>
    </div>
  );
}
