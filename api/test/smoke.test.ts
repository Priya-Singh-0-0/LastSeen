import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('API config (T1 smoke)', () => {
  it('parses valid env', () => {
    const config = loadConfig({
      DATABASE_URL:     'postgres://localhost/test',
      ACK_TOKEN_SECRET: 'a'.repeat(32),
      SESSION_SECRET:   'b'.repeat(32),
    });
    expect(config.DATABASE_URL).toBe('postgres://localhost/test');
    expect(config.PORT).toBe(3000);
    expect(config.NODE_ENV).toBe('development');
  });

  it('throws on missing DATABASE_URL', () => {
    expect(() =>
      loadConfig({
        ACK_TOKEN_SECRET: 'a'.repeat(32),
        SESSION_SECRET:   'b'.repeat(32),
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it('throws when ACK_TOKEN_SECRET is too short', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL:     'postgres://localhost/test',
        ACK_TOKEN_SECRET: 'short',
        SESSION_SECRET:   'b'.repeat(32),
      }),
    ).toThrow(/ACK_TOKEN_SECRET/);
  });
});
