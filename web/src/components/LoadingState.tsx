export interface LoadingStateProps {
  readonly label: string;
}

/**
 * Every route previously returned `null` while fetching, which rendered as an unexplained
 * black screen. This states what is happening and reserves the space it will occupy.
 */
export function LoadingState({ label }: LoadingStateProps) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <span className="loading-state__pulse" aria-hidden="true" />
      <span className="loading-state__label">{label}</span>
    </div>
  );
}
