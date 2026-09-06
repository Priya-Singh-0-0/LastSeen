import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AccountGlyph } from './icons.js';

export interface TopBarProps {
  readonly onSignOut: () => void;
  /** The search line. Rendered here so it is operable while the ledger is still loading. */
  readonly search: ReactNode;
}

/**
 * The fixed top rule: wordmark left, the search line centred, the account glyph right.
 *
 * There is exactly one watchlist per user, created implicitly, so nothing here selects,
 * names, or manages one.
 */
export function TopBar({ onSignOut, search }: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocumentDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocumentDown);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onDocumentDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [menuOpen]);

  return (
    <header className="top-rule">
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

      <div className="top-rule__search">{search}</div>

      <div className="account" ref={menuRef}>
        <button
          type="button"
          className="account__button"
          aria-expanded={menuOpen}
          aria-label="Account"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <AccountGlyph />
        </button>
        {/* A plain disclosure, not `role="menu"`: menu semantics promise arrow-key navigation
            this one-item popover does not implement. */}
        {menuOpen ? (
          <div className="account__menu">
            <button type="button" className="account__item" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
