import { SignalType } from '@stockwatch/contracts';
import { scoreSignals, signalStrength, type GroupScore, type ScorableSignal } from '../assembly/scoringV1.js';

/**
 * DeterministicTemplateRenderer (architecture §F.7, §K). Renders the shared sentence
 * once per ChangeRecord from an already-computed fact bundle: selects a template by
 * dominant phenomenon group, then interpolates already-formatted evidence values
 * verbatim. No arithmetic, no personal data (INV-14, INV-9).
 */
export const RENDERER_VERSION = 1;

const TEMPLATES: Record<SignalType, (evidence: Record<string, string | boolean>) => string> = {
  [SignalType.VOLATILITY_ADJUSTED_MOVE]: (e) =>
    `Price moved ${e.pct_change}, ${e.multiple}x its ${e.window}-session volatility (sigma20 ${e.sigma20}).`,
  [SignalType.LARGE_ABSOLUTE_MOVE]: (e) =>
    e.prev_close
      ? `Price changed ${e.pct_change} from a previous close of ${e.prev_close}.`
      : `Price changed ${e.pct_change}.`,
  [SignalType.SIGNIFICANT_GAP]: (e) =>
    e.prev_close
      ? `Opened at ${e.open}, a gap of ${e.gap_pct} from the prior close of ${e.prev_close}.`
      : `Opened at ${e.open}, a gap of ${e.gap_pct}.`,
  [SignalType.RANGE_BREAKOUT]: (e) =>
    `Closed at ${e.close}, breaking ${e.direction} the ${e.window}-session range of ${e.low20} to ${e.high20}.`,
  [SignalType.ABNORMAL_VOLUME]: (e) =>
    `Volume of ${e.volume} was ${e.ratio}x the 20-session median of ${e.volume_median20}.`,
  [SignalType.VOLUME_ACCELERATION]: (e) =>
    `Volume has been rising over the last 3 sessions, averaging ${e.mean_3d_volume}, ${e.ratio}x the 20-session median of ${e.volume_median20}.`,
  [SignalType.EARNINGS_RELEASED]: (e) =>
    e.fiscal_period
      ? `Earnings were released for ${e.fiscal_period} (source: ${e.source}).`
      : `Earnings were released (source: ${e.source}).`,
  [SignalType.CORPORATE_ACTION_APPLIED]: (e) =>
    `A ${e.action_type} took effect on ${e.effective_date} (adjustment factor ${e.factor}).`,
};

function pickDominantGroup(groups: readonly GroupScore[]): GroupScore {
  const withMembers = groups.filter((g) => g.memberSignals.length > 0);
  return withMembers.reduce((best, g) => (g.weight * g.strength > best.weight * best.strength ? g : best));
}

function pickDominantSignal(signals: readonly ScorableSignal[]): ScorableSignal {
  return signals.reduce((best, s) => (signalStrength(s) > signalStrength(best) ? s : best));
}

/**
 * Renders the shared explanation sentence for a record's full signal set. Pure and
 * deterministic: the same signals always render the same text.
 */
export function renderSharedExplanation(signals: readonly ScorableSignal[]): string {
  if (signals.length === 0) {
    throw new Error('cannot render an explanation for an empty signal set');
  }

  const { groups } = scoreSignals(signals);
  const dominantGroup = pickDominantGroup(groups);
  const signal = pickDominantSignal(dominantGroup.memberSignals);

  return TEMPLATES[signal.signalType](signal.evidence);
}
