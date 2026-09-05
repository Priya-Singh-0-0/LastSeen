// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SignInView } from '../src/components/SignInView.js';

afterEach(cleanup);

describe('SignInView (T-UI-2)', () => {
  it('defaults to sign-in mode: submitting calls onSignIn with the typed email/password and never calls onRegister', () => {
    let signInCalls: readonly [string, string][] = [];
    let registerCalls = 0;
    render(
      <SignInView
        onSignIn={async (email, password) => {
          signInCalls = [...signInCalls, [email, password]];
        }}
        onRegister={async () => {
          registerCalls++;
        }}
        error={null}
      />,
    );
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password1' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(signInCalls).toEqual([['a@b.com', 'password1']]);
    expect(registerCalls).toBe(0);
  });

  it('after clicking the toggle, submitting calls onRegister and never calls onSignIn', () => {
    let signInCalls = 0;
    let registerCalls: readonly [string, string][] = [];
    render(
      <SignInView
        onSignIn={async () => {
          signInCalls++;
        }}
        onRegister={async (email, password) => {
          registerCalls = [...registerCalls, [email, password]];
        }}
        error={null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /create an account/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'new@user.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password1' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(registerCalls).toEqual([['new@user.com', 'password1']]);
    expect(signInCalls).toBe(0);
  });

  it('labels the register-mode submit button "Create account" and the sign-in one "Sign in"', () => {
    render(<SignInView onSignIn={async () => {}} onRegister={async () => {}} error={null} />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /create an account/i }));
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
  });

  it('renders the error prop in both modes', () => {
    const { rerender } = render(
      <SignInView onSignIn={async () => {}} onRegister={async () => {}} error="boom" />,
    );
    expect(screen.getByText('boom')).toBeInTheDocument();

    rerender(<SignInView onSignIn={async () => {}} onRegister={async () => {}} error="boom" />);
    fireEvent.click(screen.getByRole('button', { name: /create an account/i }));
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('gives both inputs accessible names in both modes', () => {
    render(<SignInView onSignIn={async () => {}} onRegister={async () => {}} error={null} />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /create an account/i }));
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('toggling to register mode clears the password field and calls onModeChange', () => {
    let modeChanges = 0;
    render(
      <SignInView
        onSignIn={async () => {}}
        onRegister={async () => {}}
        error={null}
        onModeChange={() => modeChanges++}
      />,
    );
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: /create an account/i }));
    expect((screen.getByLabelText(/password/i) as HTMLInputElement).value).toBe('');
    expect(modeChanges).toBe(1);
  });
});
