import { beforeEach, describe, expect, it, vi } from 'vitest';
import { google } from 'googleapis';
import { DriveScopeError, listFolders } from './drive';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  setCredentials: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn(function OAuth2() {
        return { setCredentials: mocks.setCredentials };
      }),
    },
    drive: vi.fn(() => ({ files: { list: mocks.list } })),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockReset();
  mocks.list.mockResolvedValue({ data: { files: [] } });
});

describe('listFolders', () => {
  it('사용자 토큰으로 지정한 부모의 폴더 목록을 이름순으로 조회합니다', async () => {
    const folders = [{ id: 'folder-1', name: '가계부' }];
    mocks.list.mockResolvedValue({ data: { files: folders } });

    await expect(listFolders('token', 'parent-id')).resolves.toEqual(folders);
    expect(mocks.setCredentials).toHaveBeenCalledWith({ access_token: 'token' });
    expect(google.drive).toHaveBeenCalledWith({
      version: 'v3',
      auth: expect.objectContaining({ setCredentials: mocks.setCredentials }),
    });
    expect(mocks.list).toHaveBeenCalledWith({
      q: "mimeType='application/vnd.google-apps.folder' and 'parent-id' in parents and trashed=false",
      fields: 'files(id,name)',
      orderBy: 'name',
      pageSize: 100,
    });
  });

  it('부모 ID를 생략하면 root를 조회합니다', async () => {
    await listFolders('token');
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({
      q: "mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false",
    }));
  });

  it('부모 ID의 따옴표와 역슬래시를 이스케이프합니다', async () => {
    await listFolders('token', "a\\b'c");
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({
      q: "mimeType='application/vnd.google-apps.folder' and 'a\\\\b\\'c' in parents and trashed=false",
    }));
  });

  it('폴더가 없으면 빈 배열을 반환합니다', async () => {
    mocks.list.mockResolvedValue({ data: {} });
    await expect(listFolders('token')).resolves.toEqual([]);
  });

  it.each([
    { response: { status: 403 } },
    { code: 403 },
    { code: '403' },
  ])('403 응답 %j를 DriveScopeError로 변환합니다', async (error) => {
    mocks.list.mockRejectedValue(error);
    await expect(listFolders('token')).rejects.toBeInstanceOf(DriveScopeError);
  });

  it('그 외 오류는 그대로 전달합니다', async () => {
    const error = Object.assign(new Error('서버 오류'), { response: { status: 500 } });
    mocks.list.mockRejectedValue(error);
    await expect(listFolders('token')).rejects.toBe(error);
  });
});
