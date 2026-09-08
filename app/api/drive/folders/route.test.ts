// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriveScopeError } from '@/lib/drive';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  listFolders: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/drive', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/drive')>(),
  listFolders: mocks.listFolders,
}));

function request(parentId?: string) {
  const url = new URL('http://localhost/api/drive/folders');
  if (parentId !== undefined) url.searchParams.set('parentId', parentId);
  return new Request(url);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ accessToken: 'token' });
  mocks.listFolders.mockResolvedValue([]);
});

describe('Drive 폴더 조회 API', () => {
  it.each([null, {}])('인증 토큰이 없으면 401을 반환합니다 (%j)', async (session) => {
    mocks.auth.mockResolvedValue(session);
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: '로그인이 필요합니다.' });
    expect(mocks.listFolders).not.toHaveBeenCalled();
  });

  it('지정한 부모의 폴더 목록을 200으로 반환합니다', async () => {
    const folders = [{ id: 'folder-1', name: '가계부' }];
    mocks.listFolders.mockResolvedValue(folders);
    const response = await GET(request('parent-id'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ folders });
    expect(mocks.listFolders).toHaveBeenCalledWith('token', 'parent-id');
  });

  it('부모 ID를 생략하면 root를 조회합니다', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ folders: [] });
    expect(mocks.listFolders).toHaveBeenCalledWith('token', 'root');
  });

  it('스코프가 부족하면 403과 REAUTH_REQUIRED를 반환합니다', async () => {
    mocks.listFolders.mockRejectedValue(new DriveScopeError());
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'REAUTH_REQUIRED' });
  });

  it.each(['auth', 'listFolders'] as const)(
    '%s 실패 시 500 오류 JSON을 반환합니다',
    async (operation) => {
      mocks[operation].mockRejectedValue(new Error('internal error'));
      const response = await GET(request());
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: '폴더 목록 조회 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
  );
});
