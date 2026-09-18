// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, DELETE } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  find: vi.fn(),
  read: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/sheets', () => ({ findOrCreateSpreadsheet: mocks.find }));
vi.mock('@/lib/pending', () => ({
  readPendingRows: mocks.read,
  deletePendingRow: mocks.remove,
}));

function deleteRequest(body: unknown) {
  return new Request('http://localhost/api/pending', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ accessToken: 'token' });
  mocks.find.mockResolvedValue('sheet-id');
  mocks.read.mockResolvedValue([]);
  mocks.remove.mockResolvedValue(undefined);
});

describe('대기 API', () => {
  it.each([null, {}])('인증 토큰이 없으면 조회와 삭제를 거부합니다: %j', async (session) => {
    mocks.auth.mockResolvedValue(session);
    const responses = [
      await GET(new Request('http://localhost/api/pending')),
      await DELETE(deleteRequest({ rowNumber: 2 })),
    ];
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Not signed in' });
    }
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('조회 결과의 필드와 순서를 그대로 반환합니다', async () => {
    const items = [
      { rowNumber: 2, date: '2026-09-18', amount: 4500, category: '카페',
        memo: '커피', method: '현금', type: '결제', rawText: '결제 원문' },
      { rowNumber: 3, date: '', amount: 0, category: '',
        memo: '', method: '', type: '취소', rawText: '취소 원문' },
    ];
    mocks.read.mockResolvedValue(items);
    const query = new URLSearchParams({ folderId: 'folder-id', fileName: '내 가계부' });
    const response = await GET(new Request('http://localhost/api/pending?' + query));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items });
    expect(mocks.find).toHaveBeenCalledWith('token', 'folder-id', '내 가계부');
    expect(mocks.read).toHaveBeenCalledWith('token', 'sheet-id');
  });

  it('조회 위치를 생략하면 기본 파일의 빈 목록을 반환합니다', async () => {
    const response = await GET(new Request('http://localhost/api/pending'));
    expect(await response.json()).toEqual({ items: [] });
    expect(mocks.find).toHaveBeenCalledWith('token', undefined, undefined);
  });

  it.each([{}, null, { rowNumber: 1 }, { rowNumber: 2.5 }, { rowNumber: '2' }])(
    '잘못된 삭제 요청은 400을 반환합니다: %j', async (body) => {
      const response = await DELETE(deleteRequest(body));
      expect(response.status).toBe(400);
      expect(mocks.find).not.toHaveBeenCalled();
      expect(mocks.remove).not.toHaveBeenCalled();
    }
  );

  it('잘못된 JSON은 400을 반환합니다', async () => {
    const response = await DELETE(new Request('http://localhost/api/pending', {
      method: 'DELETE', body: '{',
    }));
    expect(response.status).toBe(400);
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each([
    { folderId: 'folder-id', fileName: 'ledger' },
    { folderId: undefined, fileName: undefined },
  ])('요청한 위치의 대기 행만 삭제합니다: %j', async (location) => {
    const response = await DELETE(deleteRequest({ ...location, rowNumber: 4 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.find).toHaveBeenCalledWith('token', location.folderId, location.fileName);
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('token', 'sheet-id', 4);
  });
});
