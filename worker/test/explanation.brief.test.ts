import { describe, it, expect } from 'vitest';
import { Decimal, toSessionDate, type DailyBar } from '@stockwatch/contracts';
import { BriefWindow, buildBriefFacts, factStrings, WINDOW_DAYS } from '../src/explanation/factBundle.js';
import { renderBriefTemplate } from '../src/explanation/briefTemplate.js';
import { renderBrief } from '../src/explanation/modelRenderer.js';
import { validateModelBrief } from '../src/explanation/validator.js';
import type { GeminiClient } from '../src/explanation/gemini.js';

const LATEST = Date.parse('2026-08-28T00:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 40 bars on consecutive calendar dates, newest first — `loadRecentBars`'
 * ordering. Dates must be real and descending: the lookback is now resolved by
 * date, not by array index.
 */
function makeBars(count = 40): DailyBar[] {
  return Array.from({ length: count }, (_, i) => {
    const close = new Decimal(180).minus(new Decimal(i).times('0.5'));
    const date = new Date(LATEST - i * MS_PER_DAY).toISOString().slice(0, 10);
    return {
      instrumentId: '1',
      sessionDate: toSessionDate(date),
      open: close,
      high: close.plus('1.25'),
      low: close.minus('1.25'),
      close,
      volume: new Decimal(1_000_000),
    };
  });
}

function factsFor(window: BriefWindow, bars = makeBars()) {
  const facts = buildBriefFacts({
    window,
    symbol: 'AAPL',
    companyName: 'Apple Inc.',
    exchange: 'NASDAQ',
    bars,
  });
  if (!facts) throw new Error('expected a fact bundle');
  return facts;
}

const ALL_WINDOWS: BriefWindow[] = Object.values(BriefWindow);

describe('buildBriefFacts', () => {
  it('compares against the close from the bucket many calendar days back', () => {
    const facts = factsFor(BriefWindow.W1);
    // Each older bar closes 0.50 lower, so 7 calendar days back sits at 176.50
    // and the price has risen into the present.
    expect(facts.direction).toBe('rose');
    expect(facts.lookbackDays).toBe(7);
    expect(facts.values).toContainEqual(['last close', '180.00']);
    expect(facts.values).toContainEqual(['close 7 days earlier', '176.50']);
    expect(facts.values).toContainEqual(['percent change', '1.98']);
  });

  it('resolves the lookback by date, not by array position', () => {
    // A gap in the bars (a weekend, a holiday) must not shift the comparison to
    // a different span: the bar chosen is the newest at or before the cutoff.
    const bars = makeBars().filter((_, i) => i !== 1 && i !== 2);
    const facts = buildBriefFacts({
      window: BriefWindow.W1,
      symbol: 'AAPL',
      companyName: null,
      exchange: null,
      bars,
    });
    expect(facts!.values).toContainEqual(['close 7 days earlier', '176.50']);
  });

  it('names no elapsed span on the first-view surface', () => {
    const facts = factsFor(BriefWindow.FIRST_VIEW);
    expect(facts.lookbackDays).toBeNull();
    expect(facts.values).toContainEqual(['prior close', '179.50']);
    expect(facts.values.map(([label]) => label)).not.toContain('days compared');
  });

  it('never uses trading-session vocabulary in a fact label', () => {
    for (const window of Object.values(BriefWindow)) {
      for (const [label] of factsFor(window).values) {
        expect(label).not.toMatch(/session/i);
      }
    }
  });

  it('reports magnitude only, leaving direction to its own field', () => {
    // A signed figure in the bundle would let the model print "-1.37% lower".
    for (const [, value] of factsFor(BriefWindow.M1).values) {
      expect(value.startsWith('-')).toBe(false);
    }
  });

  it('returns null when history is too short for the window', () => {
    expect(
      buildBriefFacts({
        window: BriefWindow.M1,
        symbol: 'AAPL',
        companyName: null,
        exchange: null,
        bars: makeBars(10),
      }),
    ).toBeNull();
  });

  it('returns null rather than comparing against a zero baseline', () => {
    const bars = makeBars();
    bars[WINDOW_DAYS.D2] = { ...bars[WINDOW_DAYS.D2], close: new Decimal(0) };
    expect(
      buildBriefFacts({ window: BriefWindow.D2, symbol: 'AAPL', companyName: null, exchange: null, bars }),
    ).toBeNull();
  });
});

describe('renderBriefTemplate', () => {
  for (const window of ALL_WINDOWS) {
    it(`${window}: passes the same validator applied to model output`, () => {
      // A fallback that its own validator would reject is not a fallback.
      const facts = factsFor(window);
      const result = validateModelBrief(renderBriefTemplate(facts), factStrings(facts));
      expect(result.ok ? null : result.reason).toBeNull();
    });
  }

  it('names the company on the first-view surface', () => {
    expect(renderBriefTemplate(factsFor(BriefWindow.FIRST_VIEW))).toContain('Apple Inc. (AAPL)');
  });

  it('frames a returning-view brief around the elapsed window', () => {
    expect(renderBriefTemplate(factsFor(BriefWindow.D2))).toContain('over the last 2 days');
  });
});

describe('renderBrief — fallback contract (architecture test #14)', () => {
  const facts = factsFor(BriefWindow.FIRST_VIEW);
  const template = renderBriefTemplate(facts);

  const clientReturning = (text: string): GeminiClient => ({ generate: async () => text });
  const clientThrowing = (err: Error): GeminiClient => ({
    generate: async () => {
      throw err;
    },
  });

  it('falls back to the template when no model is configured', async () => {
    const result = await renderBrief(facts, null);
    expect(result).toMatchObject({ text: template, origin: 'template' });
  });

  it('falls back when the model call throws', async () => {
    const result = await renderBrief(facts, clientThrowing(new Error('boom')));
    expect(result).toMatchObject({ text: template, origin: 'template' });
    expect(result.fallbackReason).toMatch(/boom/);
  });

  it('falls back when the model call times out', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
    const result = await renderBrief(facts, clientThrowing(timeout));
    expect(result).toMatchObject({ text: template, origin: 'template' });
  });

  it('falls back when the model invents a number', async () => {
    const result = await renderBrief(facts, clientReturning('Apple Inc. closed at 999.99 today.'));
    expect(result).toMatchObject({ text: template, origin: 'template' });
    expect(result.fallbackReason).toMatch(/ungrounded number: 999.99/);
  });

  it('falls back when the model gives advice', async () => {
    const result = await renderBrief(
      facts,
      clientReturning('Apple Inc. makes consumer hardware. It closed at 180.00 and looks worth buying.'),
    );
    expect(result).toMatchObject({ text: template, origin: 'template' });
    expect(result.fallbackReason).toMatch(/advisory/);
  });

  it('never throws, whatever the client does', async () => {
    await expect(renderBrief(facts, clientThrowing(new Error('network down')))).resolves.toBeDefined();
  });

  it('uses valid model output when it passes every check', async () => {
    const good = 'Apple Inc. designs consumer hardware and software. The shares closed at 180.00 against a 30-day range of 163.75 to 181.25.';
    const result = await renderBrief(facts, clientReturning(good));
    expect(result).toMatchObject({ text: good, origin: 'model' });
    expect(result.fallbackReason).toBeUndefined();
  });

  it('hashes the fact bundle identically for identical facts', async () => {
    const a = await renderBrief(factsFor(BriefWindow.D1), null);
    const b = await renderBrief(factsFor(BriefWindow.D1), null);
    expect(a.factBundleHash).toBe(b.factBundleHash);
    expect(a.factBundleHash).not.toBe((await renderBrief(factsFor(BriefWindow.M1), null)).factBundleHash);
  });
});
