export interface StatPairProps {
  readonly label: string;
  readonly value: string;
  readonly tone?: 'up' | 'down' | 'neutral';
}

/** A labelled value, mono/tabular for anything numeric. Used in the summary strip and detail card. */
export function StatPair({ label, value, tone = 'neutral' }: StatPairProps) {
  return (
    <div className="stat-pair">
      <span className="stat-pair__label">{label}</span>
      <span className={`stat-pair__value stat-pair__value--${tone}`}>{value}</span>
    </div>
  );
}
