import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createVertex } from '@ai-sdk/google-vertex';
import { generateText, Output } from 'ai';
import { extractNotificationData } from './notificationParse';

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

describe('extractNotificationData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.vertex.mockReturnValue(mocks.model);
    vi.stubEnv('GOOGLE_VERTEX_PROJECT', 'test-project');
    vi.stubEnv('GOOGLE_VERTEX_LOCATION', 'global');
    vi.stubEnv('GOOGLE_VERTEX_CREDENTIALS', JSON.stringify({
      client_email: 'ocr@test-project.iam.gserviceaccount.com',
      private_key: 'test-only-key',
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('모델의 결제 필드를 그대로 반환하고 기존 OCR과 같은 Vertex 설정을 사용한다', async () => {
    const output = {
      type: '결제',
      date: '2026-09-17',
      amount: 40495,
      merchant: '(주)오리온',
      categoryGuess: '식비',
      method: '현대 ZERO',
    };
    (generateText as any).mockResolvedValue({ output });

    const appName = '현대카드';
    const text = '[현대카드] 현대 ZERO 승인 40,495원 일시불, 9/17 13:09 (주)오리온 누적1,161,364원';
    const result = await extractNotificationData(appName, text);

    expect(createVertex).toHaveBeenCalledWith({
      project: 'test-project',
      location: 'global',
      googleAuthOptions: {
        credentials: {
          client_email: 'ocr@test-project.iam.gserviceaccount.com',
          private_key: 'test-only-key',
        },
      },
    });
    expect(mocks.vertex).toHaveBeenCalledWith('gemini-3.5-flash-lite');
    expect(Output.object).toHaveBeenCalledWith({ schema: expect.anything() });
    expect(generateText).toHaveBeenCalledWith({
      model: mocks.model,
      output: { schema: expect.anything() },
      messages: [{
        role: 'user',
        content: [{
          type: 'text',
          text: `앱 이름: ${appName}\n알림 원문: ${text}\n\n이 결제/계좌 알림에서 거래 유형, 날짜(YYYY-MM-DD), 금액(원, 숫자만), 가맹점명, 한국어 카테고리 추정, 결제수단을 추출해줘. 읽을 수 없는 필드는 null로 남겨줘.`,
        }],
      }],
    });
    expect(result).toEqual(output);
  });

  it.each(['결제', '입금', '취소', null] as const)(
    '거래 유형 %s와 일부 null 필드를 가공하지 않고 전달한다',
    async (type) => {
      const output = {
        type,
        date: null,
        amount: 8500,
        merchant: null,
        categoryGuess: null,
        method: '현대 ZERO',
      };
      (generateText as any).mockResolvedValue({ output });

      expect(await extractNotificationData('은행', '거래 알림')).toEqual(output);
    }
  );
});
