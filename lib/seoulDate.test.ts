import { describe, expect, it } from 'vitest';
import { formatSeoulDate } from './seoulDate';

describe('formatSeoulDate', () => {
  it.each([
    ['2026-09-17T14:59:59.999Z', '2026-09-17'],
    ['2026-09-17T15:00:00.000Z', '2026-09-18'],
    ['2026-09-30T15:00:00.000Z', '2026-10-01'],
    ['2026-12-31T14:59:59.999Z', '2026-12-31'],
    ['2026-12-31T15:00:00.000Z', '2027-01-01'],
    ['2028-02-28T15:00:00.000Z', '2028-02-29'],
    ['2028-02-29T15:00:00.000Z', '2028-03-01'],
  ])('%s를 KST 날짜 %s로 변환합니다', (timestamp, expected) => {
    const date = new Date(timestamp);

    expect(formatSeoulDate(date)).toBe(expected);
    expect(date.toISOString()).toBe(timestamp);
  });
});
