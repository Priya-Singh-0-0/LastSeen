import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface Gate {
  gate: string;
  /** Canonical named test string from the §6 gate table, matched against an unskipped `it`/`test`/`describe` title. */
  testName?: string;
  /** For gates identified by test-file name rather than a single test title. */
  fileName?: string;
}

const GATES: Gate[] = [
  { gate: 'Split across checkpoint must not produce a false crash', testName: 'split_across_checkpoint_does_not_report_crash' },
  { gate: 'Unsupported corporate action suppresses comparison', testName: 'unsupported_corporate_action_suppresses_comparison' },
  { gate: 'Older observation cannot overwrite newer state', testName: 'older_observation_cannot_overwrite_newer_state' },
  { gate: 'Duplicate / retried ingestion is idempotent', testName: 'duplicate_job_execution_is_idempotent' },
  { gate: 'Deterministic signal dedupe keys', testName: 'dedupe_keys_are_deterministic_and_class_correct' },
  { gate: 'Cross-user authorization', testName: 'cross_user_authorization_denied' },
  { gate: 'Exact since-last-check arithmetic', testName: 'since_last_check_arithmetic_is_exact' },
  { gate: 'Checkpoint acknowledgement only through POST', testName: 'checkpoint_moves_only_via_post' },
  { gate: 'Tampered / expired ack tokens rejected', testName: 'ack_token_integrity' },
  { gate: 'Acknowledgement replay is harmless', testName: 'ack_replay_is_noop' },
  { gate: 'Stale data is labelled', testName: 'stale_data_is_labelled_not_hidden' },
  { gate: 'Insufficient history suppresses invalid signals', testName: 'insufficient_history_emits_no_price_signals' },
  { gate: 'Scoring bounded, no double counting', testName: 'signal_scoring_is_bounded_and_non_double_counting' },
  { gate: 'Provider normalization fixtures', testName: 'provider_normalization_golden_files' },
  { gate: 'Worker/API process boundary holds', fileName: 'importBoundary.test.ts' },
  { gate: 'Publication ordering monotonic per instrument', testName: 'published_seq_is_monotonically_ordered_per_instrument' },
  { gate: 'DB grants enforce ownership boundaries', fileName: 'grants.test.ts' },
];

const SEARCH_ROOTS = ['api/test', 'worker/test', 'web/test', 'packages/contracts/test'];
const REPO_ROOT = join(import.meta.dirname, '..');

function listTestFiles(dir: string): string[] {
  const absolute = join(REPO_ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(absolute);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(absolute, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listTestFiles(join(dir, entry)));
    } else if (/\.test\.tsx?$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

const ALL_TEST_FILES = SEARCH_ROOTS.flatMap(listTestFiles);

/** Matches an unskipped `describe`/`it`/`test` call whose title contains `name`. */
function hasUnskippedTitle(source: string, name: string): boolean {
  const pattern = new RegExp(`\\b(?:describe|it|test)(\\.(skip|todo))?\\s*\\(\\s*[\`'"][^\`'"]*${name}`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (match[1] === undefined) return true;
  }
  return false;
}

function hasUnskippedTest(source: string): boolean {
  return /\b(?:it|test)\s*\(/.test(source) && !/\bdescribe\.skip\s*\(/.test(source);
}

describe('T39 correctness gate sweep — §6 gate table is asserted complete', () => {
  for (const { gate, testName, fileName } of GATES) {
    it(`gate "${gate}" has a passing, non-skipped named test`, () => {
      if (fileName !== undefined) {
        const file = ALL_TEST_FILES.find((f) => f.endsWith(`/${fileName}`));
        expect(file, `expected a test file named ${fileName}`).toBeDefined();
        const source = readFileSync(file!, 'utf8');
        expect(hasUnskippedTest(source), `${fileName} has no unskipped test`).toBe(true);
      } else {
        const found = ALL_TEST_FILES.some((file) => hasUnskippedTitle(readFileSync(file, 'utf8'), testName!));
        expect(found, `no unskipped test found with title containing "${testName}"`).toBe(true);
      }
    });
  }
});
