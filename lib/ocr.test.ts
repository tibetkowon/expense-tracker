import { describe, it, expect, vi } from 'vitest';
import { generateText } from 'ai';
import { extractReceiptData } from './ocr';

vi.mock('ai', () => ({
  generateText: vi.fn(),
  Output: { object: vi.fn((config) => config) },
}));

describe('extractReceiptData', () => {
  it('returns the structured fields from the model response', async () => {
    (generateText as any).mockResolvedValue({
      output: { date: '2026-09-01', amount: 8500, merchant: '스타벅스', categoryGuess: '카페' },
    });

    const result = await extractReceiptData('base64-image-data');

    expect(result).toEqual({
      date: '2026-09-01',
      amount: 8500,
      merchant: '스타벅스',
      categoryGuess: '카페',
    });
  });

  it('propagates nulls when the model cannot read a field', async () => {
    (generateText as any).mockResolvedValue({
      output: { date: null, amount: null, merchant: null, categoryGuess: null },
    });

    const result = await extractReceiptData('base64-image-data');
    expect(result.amount).toBeNull();
  });
});
