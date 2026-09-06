import { ArrowLeft, Search, Star, UserRound } from 'lucide-react';

/**
 * The only icons in the product, kept in one place so stroke weight and size stay uniform.
 * Everything is `aria-hidden`: an icon here always sits beside a label or inside a control
 * that carries its own accessible name.
 */

const STROKE = 1.5;

export function StarGlyph({ filled, size = 17 }: { readonly filled: boolean; readonly size?: number }) {
  // Fill versus outline is the carrier — legible in greyscale and to any colour vision.
  return (
    <Star
      size={size}
      strokeWidth={STROKE}
      fill={filled ? 'currentColor' : 'none'}
      aria-hidden="true"
      focusable="false"
    />
  );
}

export function SearchGlyph() {
  return <Search size={16} strokeWidth={STROKE} aria-hidden="true" focusable="false" />;
}

export function AccountGlyph() {
  return <UserRound size={18} strokeWidth={STROKE} aria-hidden="true" focusable="false" />;
}

export function BackGlyph() {
  return <ArrowLeft size={15} strokeWidth={STROKE} aria-hidden="true" focusable="false" />;
}

/**
 * The direction mark beside a change figure. Drawn as a shape rather than a character so it
 * survives greyscale, needs no glyph coverage from the webfont, and cannot be confused with
 * the digits it sits next to. The sign (`+` / `−`) from format.ts is the other carrier.
 */
export function DirectionMark({ down }: { readonly down: boolean }) {
  return <span className={`direction-mark ${down ? 'is-down' : 'is-up'}`} aria-hidden="true" />;
}
