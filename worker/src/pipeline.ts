import type { Observation, SessionDate } from '@stockwatch/contracts';
import { toSessionDate } from '@stockwatch/contracts';
import type { PoolClient } from './db.js';
import { loadRecentBars } from './persist/bars.js';
import { extractFeatures } from './features/index.js';
import { evaluateDetectors, persistSignals } from './signals/index.js';
import { assembleSignals } from './assembly/assembler.js';
import { loadOpenDrafts, persistDraft } from './persist/changeRecords.js';
import { publishChangeRecord } from './assembly/publisher.js';

/**
 * The ingestion pipeline (§F.3) — the step that connects an ingested observation to a published
 * change record.
 *
 * Every stage below already existed and was unit-tested; nothing here re-implements detection,
 * scoring, or explanation. This module is the caller that was missing, which is why no signal
 * had ever been produced at runtime.
 *
 * Idempotency: this runs inside the caller's transaction and every write is an upsert on a
 * natural key — signals on `(instrument_id, detector_version, dedupe_key)`, drafts on their
 * record id, publication guarded by `published_seq IS NULL`. Re-running the same cycle produces
 * no duplicate rows and no second `published_seq`, so a retried job is safe.
 */

/** 20 sessions is the detector floor (§G); 60 gives the 20-session windows real headroom. */
const HISTORY_BARS = 60;

export interface PipelineResult {
  readonly signalsDetected: number;
  readonly recordsPublished: number;
}

/**
 * Run features → detectors → assembly → publication for one instrument's new observation.
 *
 * `newMarketEvents`/`newCorporateActions` are passed through to the event detectors unchanged;
 * scoping them to "new this cycle" is the caller's job, per the detectors' own contract.
 */
export async function runInstrumentPipeline(
  client: PoolClient,
  instrumentId: string,
  observation: Observation,
): Promise<PipelineResult> {
  const history = await loadRecentBars(client, instrumentId, HISTORY_BARS);

  // The observation's own market timestamp defines the session it belongs to — never wall-clock
  // server time, which would misattribute an after-hours or replayed observation.
  const sessionDate = toSessionDate(
    new Date(observation.marketTimestamp).toISOString().slice(0, 10),
  ) as SessionDate;

  const features = extractFeatures(observation, history);

  const signals = evaluateDetectors({
    instrumentId,
    observation,
    history,
    features,
    sessionDate,
    // Event ingestion is not wired into the polling loop yet; passing empty is honest.
    // Signals 7/8 simply do not fire rather than firing on invented events.
    newMarketEvents: [],
    newCorporateActions: [],
  });

  if (signals.length === 0) {
    return { signalsDetected: 0, recordsPublished: 0 };
  }

  await persistSignals(client, instrumentId, signals);

  const existing = await loadOpenDrafts(client, instrumentId);
  const drafts = assembleSignals(existing, signals);

  let recordsPublished = 0;
  for (const draft of drafts) {
    // Sealed records are never regrouped or re-published (INV-6). assembleSignals already
    // refuses them as group targets; this guard keeps that true if a sealed row ever arrives.
    if (draft.publishedSeq !== null) continue;

    const recordId = await persistDraft(client, instrumentId, draft);
    const result = await publishChangeRecord(client, BigInt(instrumentId), BigInt(recordId));
    if (!result.alreadyPublished) recordsPublished += 1;
  }

  return { signalsDetected: signals.length, recordsPublished };
}
