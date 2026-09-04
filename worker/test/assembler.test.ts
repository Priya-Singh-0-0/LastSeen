import { describe, it, expect } from 'vitest';
import { SignalType, toSessionDate, toUtcTimestamp, type SignalEvidence } from '@stockwatch/contracts';
import { assembleSignals, ASSEMBLY_VERSION, type ChangeRecordDraft } from '../src/assembly/assembler.js';

const session = toSessionDate('2024-07-02');
const nextSession = toSessionDate('2024-07-03');

function makeEvidence(
  signalType: SignalType,
  isoTimestamp: string,
  sessionDate = session,
  dedupeKey = 'k',
): SignalEvidence {
  return {
    signalType,
    detectorVersion: 1,
    dedupeKey,
    marketTimestamp: toUtcTimestamp(Date.parse(isoTimestamp)),
    sessionDate,
    evidence: {},
  };
}

describe('assembleSignals (T23 ChangeAssembler v1)', () => {
  it('groups two signals in the same session window into one record', () => {
    const first = makeEvidence(SignalType.LARGE_ABSOLUTE_MOVE, '2024-07-02T15:00:00Z', session, 'a');
    const second = makeEvidence(SignalType.ABNORMAL_VOLUME, '2024-07-02T15:30:00Z', session, 'b');

    const records = assembleSignals([], [first, second]);

    expect(records).toHaveLength(1);
    expect(records[0].signals).toHaveLength(2);
    expect(records[0].publishedSeq).toBeNull();
    expect(records[0].assemblyVersion).toBe(ASSEMBLY_VERSION);
  });

  it('opens a new record when a signal arrives after its window record was published', () => {
    const published: ChangeRecordDraft = {
      id: 'rec-1',
      publishedSeq: 1,
      assemblyVersion: ASSEMBLY_VERSION,
      sessionDate: session,
      latestAt: toUtcTimestamp(Date.parse('2024-07-02T15:00:00Z')),
      signals: [makeEvidence(SignalType.LARGE_ABSOLUTE_MOVE, '2024-07-02T15:00:00Z', session, 'a')],
    };
    const late = makeEvidence(SignalType.ABNORMAL_VOLUME, '2024-07-02T15:30:00Z', session, 'b');

    const records = assembleSignals([published], [late]);

    expect(records).toHaveLength(2);
    const originalStillIntact = records.find((r) => r.id === 'rec-1')!;
    expect(originalStillIntact.publishedSeq).toBe(1);
    expect(originalStillIntact.signals).toHaveLength(1);

    const newRecord = records.find((r) => r.id === null)!;
    expect(newRecord.publishedSeq).toBeNull();
    expect(newRecord.signals).toEqual([late]);
  });

  it('delivers a late-arriving earnings signal as a new record rather than mutating the published one', () => {
    const published: ChangeRecordDraft = {
      id: 'rec-1',
      publishedSeq: 5,
      assemblyVersion: ASSEMBLY_VERSION,
      sessionDate: session,
      latestAt: toUtcTimestamp(Date.parse('2024-07-02T15:00:00Z')),
      signals: [makeEvidence(SignalType.LARGE_ABSOLUTE_MOVE, '2024-07-02T15:00:00Z', session, 'a')],
    };
    const lateEarnings = makeEvidence(SignalType.EARNINGS_RELEASED, '2024-07-02T20:00:00Z', session, 'earnings');

    const records = assembleSignals([published], [lateEarnings]);

    expect(records).toHaveLength(2);
    const earningsRecord = records.find((r) => r.signals.some((s) => s.signalType === SignalType.EARNINGS_RELEASED))!;
    expect(earningsRecord.publishedSeq).toBeNull();
    expect(earningsRecord).not.toBe(published);
  });

  it('never clears or reassigns published_seq on an existing record', () => {
    const published: ChangeRecordDraft = {
      id: 'rec-1',
      publishedSeq: 3,
      assemblyVersion: ASSEMBLY_VERSION,
      sessionDate: session,
      latestAt: toUtcTimestamp(Date.parse('2024-07-02T15:00:00Z')),
      signals: [makeEvidence(SignalType.LARGE_ABSOLUTE_MOVE, '2024-07-02T15:00:00Z', session, 'a')],
    };
    const unrelated = makeEvidence(SignalType.RANGE_BREAKOUT, '2024-07-03T15:00:00Z', nextSession, 'c');

    const records = assembleSignals([published], [unrelated]);

    const stillPublished = records.find((r) => r.id === 'rec-1')!;
    expect(stillPublished.publishedSeq).toBe(3);
  });
});
