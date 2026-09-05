import { useState } from 'react';
import type { FormEvent } from 'react';

export interface SignInViewProps {
  readonly onSignIn: (email: string, password: string) => Promise<void>;
  readonly error: string | null;
}

export function SignInView({ onSignIn, error }: SignInViewProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onSignIn(email, password);
    } finally {
      setSubmitting(false);
    }
  }

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
            autoComplete="current-password"
            required
          />
        </label>
        {error !== null ? <p className="sign-in__error">{error}</p> : null}
        <button type="submit" className="button button--primary" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
