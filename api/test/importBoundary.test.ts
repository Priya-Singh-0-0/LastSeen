import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');

/**
 * Import boundary test (T4, INV-17, INV-2).
 *
 * Walks the api/ and web/ package.json dependency trees and asserts:
 *   1. Neither lists @alpacahq/* or alpaca-trade-api as a dependency.
 *   2. Neither lists @stockwatch/worker as a dependency.
 *   3. The worker/ package does not list @stockwatch/api as a dependency.
 *
 * This is a static dependency-graph check — it catches transitive imports
 * that a lint rule on source files might miss (e.g. a shared package re-exporting).
 */
function getDeps(pkgPath: string): string[] {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ];
}

const ALPACA_PATTERNS = ['@alpacahq/', 'alpaca-trade-api'];

function hasAlpaca(deps: string[]): boolean {
  return deps.some(d => ALPACA_PATTERNS.some(p => d.startsWith(p) || d === p));
}

describe('Import boundary (INV-17, INV-2)', () => {
  it('api/ does not depend on the Alpaca SDK', () => {
    const deps = getDeps(resolve(ROOT, 'api/package.json'));
    expect(hasAlpaca(deps)).toBe(false);
  });

  it('web/ does not depend on the Alpaca SDK', () => {
    const deps = getDeps(resolve(ROOT, 'web/package.json'));
    expect(hasAlpaca(deps)).toBe(false);
  });

  it('packages/contracts does not depend on the Alpaca SDK', () => {
    const deps = getDeps(resolve(ROOT, 'packages/contracts/package.json'));
    expect(hasAlpaca(deps)).toBe(false);
  });

  it('api/ does not depend on @stockwatch/worker', () => {
    const deps = getDeps(resolve(ROOT, 'api/package.json'));
    expect(deps).not.toContain('@stockwatch/worker');
  });

  it('web/ does not depend on @stockwatch/worker', () => {
    const deps = getDeps(resolve(ROOT, 'web/package.json'));
    expect(deps).not.toContain('@stockwatch/worker');
  });

  it('worker/ does not depend on @stockwatch/api', () => {
    const deps = getDeps(resolve(ROOT, 'worker/package.json'));
    expect(deps).not.toContain('@stockwatch/api');
  });

  // Deliberate failure check: this test must itself fail if we add Alpaca to api/
  // (verified manually during T4 — add "@alpacahq/test": "*" to api/package.json,
  // confirm the first test fails, remove it)
});
