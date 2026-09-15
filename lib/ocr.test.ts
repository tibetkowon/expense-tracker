import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createVertex } from '@ai-sdk/google-vertex';
import { generateText } from 'ai';
import { extractReceiptData } from './ocr';

const mocks = vi.hoisted(() => ({
  model: { modelId: 'gemini-3.5-flash-lite' },
  vertex: vi.fn(),
}));

vi.mock('@ai-sdk/google-vertex', () => ({
  createVertex: vi.fn(() => mocks.vertex),
}));

vi.mock('ai', () => ({
  generateText: vi.fn(),
  Output: { object: vi.fn((config) => config) },
}));

describe('extractReceiptData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.vertex.mockReturnValue(mocks.model);
    vi.stubEnv('GOOGLE_VERTEX_PROJECT', 'test-project');
    vi.stubEnv('GOOGLE_VERTEX_LOCATION', 'us-central1');
    vi.stubEnv('GOOGLE_VERTEX_CREDENTIALS', JSON.stringify({
      client_email: 'ocr@test-project.iam.gserviceaccount.com',
      private_key: 'test-only-key',
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the structured fields from the model response', async () => {
    (generateText as any).mockResolvedValue({
      output: { date: '2026-09-01', amount: 8500, merchant: '스타벅스', categoryGuess: '카페' },
    });

    const result = await extractReceiptData('base64-image-data');

    expect(createVertex).toHaveBeenCalledWith({
      project: 'test-project',
      location: 'us-central1',
      googleAuthOptions: {
        credentials: {
          client_email: 'ocr@test-project.iam.gserviceaccount.com',
          private_key: 'test-only-key',
        },
      },
    });
    expect(mocks.vertex).toHaveBeenCalledWith('gemini-3.5-flash-lite');
    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
      model: mocks.model,
    }));

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
