import { DirectionMark } from './icons.js';
import { formatMultiple, formatPrice, formatSignedAmount, formatSignedPercent, isNegative } from '../format.js';
import type { ComparisonStatusValue, DiffFields } from '../types.js';

export interface SinceLastCheckedProps extends DiffFields {
  readonly comparisonStatus: ComparisonStatusValue;
  /** True when there is no market state at all yet — nothing to compare against. */
  readonly awaitingData: boolean;
  readonly scale?: 'row' | 'sheet';
}

/**
 * The dominant column: the comparison anchored to *this user's* checkpoint. Every figure here
 * was computed by the API — this renders and rounds, it never derives (CLAUDE.md).
 *
 * There is no baseline timestamp on the wire, so this block never states when the baseline was
 * taken. Suppressed and awaiting-baseline comparisons emit no numeral at all rather than a
 * guessed one.
 */
export function SinceLastChecked({
  comparisonStatus,
  awaitingData,
  scale = 'row',
  adjustedBaseline,
  absoluteChange,
  percentageChange,
  sessionsElapsed,
  volatilityMultiple,
  adjustmentLabels,
}: SinceLastCheckedProps) {
  const className = `since since--${scale}`;

  if (comparisonStatus === 'SUPPRESSED_CORPORATE_ACTION') {
    return (
      <div className={`${className} since--suppressed`}>
        <p className="since__flag">
          <span className="since__dagger" aria-hidden="true">
            †
          </span>
          Can&apos;t compare
        </p>
        <p className="since__note">Unsupported corporate action — no percentage can be trusted here.</p>
        {adjustmentLabels !== undefined && adjustmentLabels.length > 0 ? (
          <ul className="since__labels">
            {adjustmentLabels.map((label) => (
              <li key={label} className="since__label">
                {label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  if (comparisonStatus === 'AWAITING_BASELINE' || awaitingData) {
    return (
      <div className={`${className} since--awaiting`}>
        <p className="since__flag">No baseline yet</p>
        <p className="since__note">First reading arrives with the next update.</p>
      </div>
    );
  }

  if (percentageChange === undefined) {
    return (
      <div className={className}>
        <p className="since__flag since__flag--quiet">Nothing to compare</p>
      </div>
    );
  }

  const down = isNegative(percentageChange);

  return (
    <div className={className}>
      <p className={`since__figure numeral ${down ? 'is-down' : 'is-up'}`} title={`${percentageChange}%`}>
        <DirectionMark down={down} />
        {formatSignedPercent(percentageChange)}
      </p>
      {absoluteChange !== undefined ? (
        <p className={`since__absolute numeral ${down ? 'is-down' : 'is-up'}`} title={absoluteChange}>
          {formatSignedAmount(absoluteChange)}
        </p>
      ) : null}
      <p className="since__footnotes">
        {sessionsElapsed !== undefined ? (
          <span className="since__footnote">
            <span className="numeral">{sessionsElapsed}</span> session{sessionsElapsed === 1 ? '' : 's'}
          </span>
        ) : null}
        {/* Volatility is only meaningful with enough history behind it — omitted, never guessed. */}
        {comparisonStatus === 'OK' && volatilityMultiple !== undefined ? (
          <span className="since__footnote" title={volatilityMultiple}>
            <span className="numeral">{formatMultiple(volatilityMultiple)}×</span> typical
          </span>
        ) : null}
        {comparisonStatus === 'INSUFFICIENT_HISTORY' ? (
          <span className="since__footnote since__footnote--caution">Short history</span>
        ) : null}
        {adjustedBaseline !== undefined && scale === 'sheet' ? (
          <span className="since__footnote" title={adjustedBaseline}>
            from <span className="numeral">{formatPrice(adjustedBaseline)}</span>
          </span>
        ) : null}
      </p>
      {adjustmentLabels !== undefined && adjustmentLabels.length > 0 ? (
        <ul className="since__labels">
          {adjustmentLabels.map((label) => (
            <li key={label} className="since__label">
              {label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
