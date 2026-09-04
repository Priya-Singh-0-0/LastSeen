import { toUtcTimestamp, type SignalEvidence, type SessionDate, type UtcTimestamp } from '@stockwatch/contracts';

/**
 * ChangeAssembler v1 (architecture §F.3). Groups newly detected signals into
 * `ChangeRecord` drafts, one per instrument per call. A record is sealed once it has a
 * `publishedSeq` (INV-6): the assembler only ever groups new signals into records where
 * `publishedSeq === null`, and never mutates `publishedSeq` on any record it returns.
 */
export const ASSEMBLY_VERSION = 1;

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export interface ChangeRecordDraft {
  /** Null until the record has been persisted (assigned by the persistence layer). */
  readonly id: string | null;
  /** Null until sealed by the Publisher (T24). Sealed records are never regrouped. */
  readonly publishedSeq: number | null;
  readonly assemblyVersion: number;
  readonly sessionDate: SessionDate;
  readonly latestAt: UtcTimestamp;
  readonly signals: readonly SignalEvidence[];
}

interface MutableDraft {
  id: string | null;
  publishedSeq: number | null;
  assemblyVersion: number;
  sessionDate: SessionDate;
  latestAt: UtcTimestamp;
  signals: SignalEvidence[];
}

function withinWindow(signal: SignalEvidence, record: MutableDraft): boolean {
  if (signal.sessionDate === record.sessionDate) return true;
  return Math.abs(signal.marketTimestamp - record.latestAt) <= SIX_HOURS_MS;
}

function openDraft(signal: SignalEvidence): MutableDraft {
  return {
    id: null,
    publishedSeq: null,
    assemblyVersion: ASSEMBLY_VERSION,
    sessionDate: signal.sessionDate,
    latestAt: signal.marketTimestamp,
    signals: [signal],
  };
}

/**
 * Groups `newSignals` into `existingRecords` for a single instrument. Records with a
 * non-null `publishedSeq` are sealed: never mutated, never chosen as a group target. A
 * signal that doesn't fit an open record (same `sessionDate`, or within 6h of the
 * record's `latestAt`) opens a new unpublished record — including when its only
 * candidate record is already published (late-arriving signal after publication).
 */
export function assembleSignals(
  existingRecords: readonly ChangeRecordDraft[],
  newSignals: readonly SignalEvidence[],
): ChangeRecordDraft[] {
  const records: MutableDraft[] = existingRecords.map((r) => ({ ...r, signals: [...r.signals] }));

  const ordered = [...newSignals].sort((a, b) => a.marketTimestamp - b.marketTimestamp);
  for (const signal of ordered) {
    const target = records.find((r) => r.publishedSeq === null && withinWindow(signal, r));
    if (target) {
      target.signals.push(signal);
      target.latestAt = toUtcTimestamp(Math.max(target.latestAt, signal.marketTimestamp));
    } else {
      records.push(openDraft(signal));
    }
  }

  return records;
}
