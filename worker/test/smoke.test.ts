import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('Worker config (T1/T4 smoke)', () => {
  it('parses valid env', () => {
    const config = loadConfig({
      DATABASE_URL:          'postgres://localhost/test',
      ALPACA_API_KEY_ID:     'key123',
      ALPACA_API_SECRET_KEY: 'secret456',
    });
    expect(config.DATABASE_URL).toBe('postgres://localhost/test');
    expect(config.ALPACA_API_KEY_ID).toBe('key123');
    expect(config.NODE_ENV).toBe('development');
    expect(config.ALPACA_FEED).toBe('iex');
  });

  it('accepts an explicit ALPACA_FEED override', () => {
    const config = loadConfig({
      DATABASE_URL:          'postgres://localhost/test',
      ALPACA_API_KEY_ID:     'key123',
      ALPACA_API_SECRET_KEY: 'secret456',
      ALPACA_FEED:           'sip',
    });
    expect(config.ALPACA_FEED).toBe('sip');
  });

  it('throws on missing DATABASE_URL', () => {
    expect(() =>
      loadConfig({
        ALPACA_API_KEY_ID:     'key',
        ALPACA_API_SECRET_KEY: 'secret',
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it('throws on missing ALPACA_API_KEY_ID', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL:          'postgres://localhost/test',
        ALPACA_API_SECRET_KEY: 'secret',
      }),
    ).toThrow(/ALPACA_API_KEY_ID/);
  });

  it('throws on missing ALPACA_API_SECRET_KEY', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL:      'postgres://localhost/test',
        ALPACA_API_KEY_ID: 'key',
      }),
    ).toThrow(/ALPACA_API_SECRET_KEY/);
  });
});
