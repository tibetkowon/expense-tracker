// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  find: vi.fn(),
  append: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/sheets', () => ({
  findOrCreateSpreadsheet: mocks.find,
  appendExpenseRow: mocks.append,
}));
vi.mock('@/lib/pending', () => ({ deletePendingRow: mocks.remove }));

const expense = {
  date: '2026-08-31',
  amount: 4500,
  category: '카페',
  memo: '수정한 메모',
  method: '현금',
};

function request(body: unknown) {
  return new Request('http://localhost/api/pending/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ accessToken: 'token' });
  mocks.find.mockResolvedValue('sheet-id');
  mocks.append.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
});

describe('대기 항목 확인 API', () => {
  it.each([null, {}])('인증 토큰이 없으면 401을 반환합니다: %j', async (session) => {
    mocks.auth.mockResolvedValue(session);
    const response = await POST(request({ ...expense, pendingRowNumber: 2 }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Not signed in' });
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each([undefined, 1, 2.5, '2', null])(
    '누락되거나 잘못된 대기 행 번호는 400을 반환합니다: %j', async (pendingRowNumber) => {
      const response = await POST(request({ ...expense, pendingRowNumber }));
      expect(response.status).toBe(400);
      expect(mocks.find).not.toHaveBeenCalled();
      expect(mocks.append).not.toHaveBeenCalled();
      expect(mocks.remove).not.toHaveBeenCalled();
    }
  );

  it.each([undefined, 0, -1, '4500'])(
    '지출 검증 실패는 Zod 상세 오류와 400을 반환합니다: %j', async (amount) => {
      const response = await POST(request({ ...expense, amount, pendingRowNumber: 2 }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: expect.arrayContaining([expect.objectContaining({ path: ['amount'] })]),
      });
      expect(mocks.find).not.toHaveBeenCalled();
      expect(mocks.append).not.toHaveBeenCalled();
      expect(mocks.remove).not.toHaveBeenCalled();
    }
  );

  it('잘못된 JSON은 400을 반환합니다', async () => {
    const response = await POST(new Request('http://localhost/api/pending/confirm', {
      method: 'POST', body: '{',
    }));
    expect(response.status).toBe(400);
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each([
    { folderId: 'folder-id', fileName: 'ledger' },
    { folderId: undefined, fileName: undefined },
  ])('저장이 완료된 후 대기 행을 삭제합니다: %j', async (location) => {
    let appended = false;
    mocks.append.mockImplementation(async () => {
      await Promise.resolve();
      appended = true;
    });
    mocks.remove.mockImplementation(async () => {
      expect(appended).toBe(true);
    });
    const response = await POST(request({ ...location, ...expense, pendingRowNumber: 4 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.find).toHaveBeenCalledWith('token', location.folderId, location.fileName);
    expect(mocks.append).toHaveBeenCalledExactlyOnceWith('token', 'sheet-id', '2026-08', expense);
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('token', 'sheet-id', 4);
  });

  it('저장이 실패하면 대기 행을 유지하고 오류를 전파합니다', async () => {
    const error = new Error('저장 실패');
    mocks.append.mockRejectedValue(error);
    await expect(POST(request({ ...expense, pendingRowNumber: 2 }))).rejects.toBe(error);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('대기 행 삭제 실패도 오류를 전파합니다', async () => {
    const error = new Error('삭제 실패');
    mocks.remove.mockRejectedValue(error);
    await expect(POST(request({ ...expense, pendingRowNumber: 2 }))).rejects.toBe(error);
    expect(mocks.append).toHaveBeenCalledExactlyOnceWith('token', 'sheet-id', '2026-08', expense);
  });
});
