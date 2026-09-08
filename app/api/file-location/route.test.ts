// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  find: vi.fn(),
  location: vi.fn(),
  move: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/sheets', () => ({
  findOrCreateSpreadsheet: mocks.find,
  getSpreadsheetLocation: mocks.location,
  moveSpreadsheetFile: mocks.move,
}));

function request(body = JSON.stringify({ folderId: 'new-folder' })) {
  return new Request('http://localhost/api/file-location', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ accessToken: 'token' });
  mocks.find.mockResolvedValue('sheet-id');
  mocks.location.mockResolvedValue({
    folderId: 'folder-id', folderName: '생활비', fileName: '가계부',
  });
  mocks.move.mockResolvedValue(undefined);
});

describe('파일 위치 API', () => {
  it('GET은 정식 파일의 실제 위치와 이름을 반환합니다', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      folderId: 'folder-id', folderName: '생활비', fileName: '가계부',
    });
    expect(mocks.find).toHaveBeenCalledExactlyOnceWith('token');
    expect(mocks.location).toHaveBeenCalledWith('token', 'sheet-id');
    expect(mocks.move).not.toHaveBeenCalled();
  });

  it.each([null, {}])('GET은 토큰이 없으면 401을 반환합니다 (%j)', async (session) => {
    mocks.auth.mockResolvedValue(session);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: '로그인이 필요합니다.' });
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.location).not.toHaveBeenCalled();
  });

  it.each(['new-folder', 'root'])('POST는 정식 파일을 %s로 이동합니다', async (folderId) => {
    const response = await POST(request(JSON.stringify({ folderId })));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.find).toHaveBeenCalledExactlyOnceWith('token');
    expect(mocks.move).toHaveBeenCalledWith('token', 'sheet-id', folderId);
  });

  it.each([null, {}])('POST는 토큰이 없으면 401을 반환합니다 (%j)', async (session) => {
    mocks.auth.mockResolvedValue(session);
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: '로그인이 필요합니다.' });
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.move).not.toHaveBeenCalled();
  });

  it.each(['{', 'null', '[]', '{}', '{"folderId":42}', '{"folderId":" "}'])(
    'POST는 잘못된 요청 %s에 400을 반환합니다',
    async (body) => {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: expect.any(String) });
      expect(mocks.find).not.toHaveBeenCalled();
      expect(mocks.move).not.toHaveBeenCalled();
    }
  );

  it.each(['auth', 'find', 'location'] as const)('GET의 %s 실패는 500입니다', async (operation) => {
    mocks[operation].mockRejectedValue(new Error('internal error'));
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });

  it.each(['auth', 'find', 'move'] as const)('POST의 %s 실패는 500입니다', async (operation) => {
    mocks[operation].mockRejectedValue(new Error('internal error'));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });
});
