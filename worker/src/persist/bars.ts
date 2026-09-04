import type { PoolClient } from '../db.js';
import type { DailyBar } from '@stockwatch/contracts';
import { toWireString } from '@stockwatch/contracts';

/**
 * Persist daily bars (T17).
 */
export async function upsertDailyBars(
  client: PoolClient,
  bars: DailyBar[],
  source: string,
): Promise<number> {
  for (const bar of bars) {
    const d = new Date(bar.sessionDate + 'T00:00:00Z');
    const day = d.getUTCDay();
    if (day === 0 || day === 6) {
      throw new Error(`non-session date rejected: ${bar.sessionDate}`);
    }
  }

  if (bars.length === 0) return 0;

  const instrumentIds = bars.map((b) => b.instrumentId);
  const sessionDates = bars.map((b) => b.sessionDate);
  const opens = bars.map((b) => toWireString(b.open));
  const highs = bars.map((b) => toWireString(b.high));
  const lows = bars.map((b) => toWireString(b.low));
  const closes = bars.map((b) => toWireString(b.close));
  const volumes = bars.map((b) => b.volume.toFixed(0)); // Convert to integer string for BIGINT

  const sources = bars.map(() => source);

  const query = `
    INSERT INTO instrument_bars (
      instrument_id, session_date, open, high, low, close, volume, source
    )
    SELECT
      u.instrument_id::BIGINT,
      u.session_date::DATE,
      u.open::NUMERIC,
      u.high::NUMERIC,
      u.low::NUMERIC,
      u.close::NUMERIC,
      u.volume::BIGINT,
      u.source
    FROM UNNEST(
      $1::TEXT[],
      $2::TEXT[],
      $3::TEXT[],
      $4::TEXT[],
      $5::TEXT[],
      $6::TEXT[],
      $7::TEXT[],
      $8::TEXT[]
    ) AS u(
      instrument_id, session_date, open, high, low, close, volume, source
    )
    ON CONFLICT (instrument_id, session_date) DO UPDATE SET
      open = EXCLUDED.open,
      high = EXCLUDED.high,
      low = EXCLUDED.low,
      close = EXCLUDED.close,
      volume = EXCLUDED.volume,
      source = EXCLUDED.source,
      ingested_at = NOW()
  `;

  const { rowCount } = await client.query(query, [
    instrumentIds,
    sessionDates,
    opens,
    highs,
    lows,
    closes,
    volumes,
    sources,
  ]);

  return rowCount ?? 0;
}
