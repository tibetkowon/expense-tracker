// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  find: vi.fn(),
  share: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/sheets', () => ({
  findOrCreateSpreadsheet: mocks.find,
  shareSpreadsheetWithServiceAccount: mocks.share,
}));

function request(body = JSON.stringify({ folderId: 'folder-id', fileName: '가계부' })) {
  return new Request('http://localhost/api/shortcuts/link-sheet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('SHORTCUT_SERVICE_ACCOUNT_EMAIL', 'shortcuts@example.com');
  mocks.auth.mockResolvedValue({ accessToken: 'token' });
  mocks.find.mockResolvedValue('sheet-id');
  mocks.share.mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllEnvs());

describe('단축어 연동 API', () => {
  it.each([null, {}])('액세스 토큰이 없으면 401을 반환합니다: %j', async (session) => {
    mocks.auth.mockResolvedValue(session);
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: '로그인이 필요합니다.' });
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.share).not.toHaveBeenCalled();
  });

  it('서비스 계정 이메일이 없으면 공유하지 않고 500을 반환합니다', async () => {
    vi.stubEnv('SHORTCUT_SERVICE_ACCOUNT_EMAIL', undefined);
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: '서비스 계정 이메일이 설정되지 않았습니다.',
    });
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.share).not.toHaveBeenCalled();
  });

  it('파일을 찾은 뒤 공유하고 성공 JSON을 반환합니다', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.find).toHaveBeenCalledWith('token', 'folder-id', '가계부');
    expect(mocks.share).toHaveBeenCalledWith('token', 'sheet-id', 'shortcuts@example.com');
    expect(mocks.find.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.share.mock.invocationCallOrder[0]);
  });

  it.each(['{}', '{"folderId":null}'])('선택적 힌트를 생략할 수 있습니다: %s', async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(mocks.find).toHaveBeenCalledWith('token', undefined, undefined);
  });

  it.each(['{', 'null', '[]', '{"folderId":42}', '{"fileName":{}}'])(
    '잘못된 요청에는 400을 반환합니다: %s',
    async (body) => {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(mocks.find).not.toHaveBeenCalled();
      expect(mocks.share).not.toHaveBeenCalled();
    }
  );

  it.each(['auth', 'find', 'share'] as const)(
    '%s 실패에는 내부 오류를 노출하지 않고 500을 반환합니다',
    async (operation) => {
      mocks[operation].mockRejectedValueOnce(new Error('비공개 오류'));
      const response = await POST(request());
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: '단축어 연동에 실패했습니다. 잠시 후 다시 시도해 주세요.',
      });
      if (operation !== 'share') {
        expect(mocks.share).not.toHaveBeenCalled();
      }
    }
  );
});
