// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  extractReceiptData: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/ocr', () => ({ extractReceiptData: mocks.extractReceiptData }));

function request(imageBase64 = 'base64-image-data') {
  return new Request('http://localhost/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64 }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ accessToken: 'token' });
});

describe('영수증 OCR API', () => {
  it('추출 결과를 JSON으로 반환합니다', async () => {
    const extraction = {
      date: '2026-09-01',
      amount: 8500,
      merchant: '스타벅스',
      categoryGuess: '카페',
    };
    mocks.extractReceiptData.mockResolvedValue(extraction);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(extraction);
    expect(mocks.extractReceiptData).toHaveBeenCalledWith('base64-image-data');
  });

  it('제공자 오류의 자격 증명을 노출하지 않고 500 JSON을 반환합니다', async () => {
    mocks.extractReceiptData.mockRejectedValue(new Error('private_key: secret-test-key'));

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: '영수증 인식 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    });
  });

  it('로그인하지 않으면 OCR을 호출하지 않습니다', async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.extractReceiptData).not.toHaveBeenCalled();
  });

  it('이미지가 비어 있으면 OCR을 호출하지 않습니다', async () => {
    expect((await POST(request(''))).status).toBe(400);
    expect(mocks.extractReceiptData).not.toHaveBeenCalled();
  });
});
