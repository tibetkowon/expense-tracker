// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  find: vi.fn(),
  rename: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/sheets', () => ({
  findOrCreateSpreadsheet: mocks.find,
  renameSpreadsheetFile: mocks.rename,
}));

function request(body = JSON.stringify({ newFileName: ' 가계부 ' })) {
  return new Request('http://localhost/api/file-name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ accessToken: 'token' });
  mocks.find.mockResolvedValue('sheet-id');
  mocks.rename.mockResolvedValue(undefined);
});

describe('파일명 변경 API', () => {
  it('기존 파일 이름을 바꾸고 성공 JSON을 반환합니다', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.rename).toHaveBeenCalledWith('token', 'sheet-id', '가계부');
  });

  it('로그인하지 않으면 401 오류 JSON을 반환합니다', async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: '로그인이 필요합니다.' });
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it.each(['{', 'null', '{}', '{"newFileName":""}'])(
    '잘못된 요청 %s에 400 오류 JSON을 반환합니다',
    async (body) => {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: expect.any(String) });
      expect(mocks.find).not.toHaveBeenCalled();
    }
  );

  it.each(['auth', 'find', 'rename'] as const)(
    '%s 실패에 500 오류 JSON을 반환합니다',
    async (operation) => {
      mocks[operation].mockRejectedValue(new Error('internal error'));
      const response = await POST(request());
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: '파일명 변경 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
  );
});
