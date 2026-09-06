export interface ErrorStateProps {
  readonly message: string;
  readonly onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="error-state">
      <p className="error-state__message">{message}</p>
      {onRetry ? (
        <button type="button" className="action action--quiet" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
