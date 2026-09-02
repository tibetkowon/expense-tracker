import { describe, it, expect } from 'vitest';
import { summarizeByMonth } from './summary';
import type { ExpenseRow } from './sheets';

const rows: ExpenseRow[] = [
  { date: '2026-09-01', amount: 10000, category: '식비', memo: '', method: '카드' },
  { date: '2026-09-15', amount: 5000, category: '교통', memo: '', method: '카드' },
  { date: '2026-08-30', amount: 99999, category: '식비', memo: '', method: '카드' },
];

describe('summarizeByMonth', () => {
  it('sums only rows within the given month', () => {
    expect(summarizeByMonth(rows, '2026-09')).toEqual({ total: 15000, count: 2 });
  });

  it('returns zero for a month with no rows', () => {
    expect(summarizeByMonth(rows, '2026-01')).toEqual({ total: 0, count: 0 });
  });
});
