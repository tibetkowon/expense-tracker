import { describe, it, expect } from 'vitest';
import { validateExpenseInput } from './expense';

describe('validateExpenseInput', () => {
  it('accepts a well-formed expense', () => {
    const result = validateExpenseInput({
      date: '2026-09-01',
      amount: 12000,
      category: '식비',
      memo: '점심',
      method: '카드',
    });
    expect(result.amount).toBe(12000);
  });

  it('rejects a negative amount', () => {
    expect(() =>
      validateExpenseInput({
        date: '2026-09-01',
        amount: -1,
        category: '식비',
        memo: '',
        method: '카드',
      })
    ).toThrow();
  });

  it('rejects a missing category', () => {
    expect(() =>
      validateExpenseInput({ date: '2026-09-01', amount: 1000, memo: '', method: '카드' })
    ).toThrow();
  });

  it('rejects a malformed date', () => {
    expect(() =>
      validateExpenseInput({
        date: 'not-a-date',
        amount: 1000,
        category: '식비',
        memo: '',
        method: '카드',
      })
    ).toThrow();
  });
});
