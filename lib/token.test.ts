import { describe, it, expect, vi } from 'vitest';
import { isTokenExpired } from './token';

describe('isTokenExpired', () => {
  it('returns false when expiry is in the future', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const futureExpiry = Math.floor(new Date('2026-01-01T01:00:00Z').getTime() / 1000);
    expect(isTokenExpired(futureExpiry)).toBe(false);
  });

  it('returns true when expiry is in the past', () => {
    vi.setSystemTime(new Date('2026-01-01T02:00:00Z'));
    const pastExpiry = Math.floor(new Date('2026-01-01T01:00:00Z').getTime() / 1000);
    expect(isTokenExpired(pastExpiry)).toBe(true);
  });
});
