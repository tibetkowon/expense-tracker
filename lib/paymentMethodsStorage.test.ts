import { beforeEach, expect, it, vi } from 'vitest';
import { listPaymentMethodEntries, updatePaymentMethod, deletePaymentMethod, createPaymentMethod, rememberPaymentMethodAlias } from './sheets';
const mocks = vi.hoisted(() => ({ get: vi.fn(), read: vi.fn(), update: vi.fn(), batch: vi.fn(), structure: vi.fn(), append: vi.fn() }));
vi.mock('googleapis', () => ({ google: {
  auth: { OAuth2: class { setCredentials() {} } },
  sheets: () => ({ spreadsheets: { get: mocks.get, batchUpdate: mocks.structure, values: { get: mocks.read, update: mocks.update, batchUpdate: mocks.batch, append: mocks.append } } }),
} }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue({ data: { sheets: ['설정', '2026-09', '2026-10', '대기', '기타'].map((title, sheetId) => ({ properties: { title, sheetId } })) } });
  mocks.read.mockImplementation(async ({ range }) => ({ data: { values: range === "'설정'!A2:B" ? [['이전', '1234, , deep dream'], [], ['다른', '']] : range.includes('E2:E') ? [['이전'], ['이전 카드'], [], ['이전']] : range === "'설정'!A2:A" ? [['이전']] : [['결제수단']] } }));
});
it('기존 빈 B열과 실제 행 번호를 보존합니다', async () => {
  expect(await listPaymentMethodEntries('token', 'id')).toEqual([
    { name: '이전', aliases: ['1234', 'deep dream'], rowNumber: 2 }, { name: '다른', aliases: [], rowNumber: 4 },
  ]);
});
it('월과 대기의 정확히 일치하는 셀만 바꾸고 설정은 마지막에 씁니다', async () => {
  expect(await updatePaymentMethod('token', 'id', '이전', '새 이름')).toBe(6);
  expect(mocks.batch).toHaveBeenCalledTimes(3);
  expect(mocks.batch.mock.calls[0][0].requestBody.data).toEqual([
    { range: "'2026-09'!E2", values: [['새 이름']] }, { range: "'2026-09'!E5", values: [['새 이름']] },
  ]);
  expect(mocks.update.mock.calls.at(-1)![0]).toMatchObject({ range: "'설정'!A2:B2", valueInputOption: 'RAW', requestBody: { values: [['새 이름', '1234, deep dream']] } });
  expect(mocks.update.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.batch.mock.invocationCallOrder[2]);
});
it('중간 실패 시 설정을 남기고 재시도 시 남은 셀만 갱신합니다', async () => {
  mocks.batch.mockRejectedValueOnce(new Error('실패'));
  await expect(updatePaymentMethod('token', 'id', '이전', '새 이름')).rejects.toThrow('실패');
  expect(mocks.update).not.toHaveBeenCalled();
  mocks.read.mockImplementation(async ({ range }) => ({ data: { values: range === "'설정'!A2:B" ? [['이전', '1234']] : range === "'대기'!E2:E" ? [['이전']] : [['새 이름']] } }));
  expect(await updatePaymentMethod('token', 'id', '이전', '새 이름')).toBe(1);
});
it('다른 결제수단 이름으로 변경하거나 중복 추가할 수 없습니다', async () => {
  await expect(updatePaymentMethod('token', 'id', '이전', '다른')).rejects.toMatchObject({ status: 409 });
  await expect(createPaymentMethod('token', 'id', '이전', [])).rejects.toMatchObject({ status: 409 });
  expect(mocks.batch).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
});
it('별칭만 수정할 때 기록을 건드리지 않고 헤더를 보완합니다', async () => {
  expect(await updatePaymentMethod('token', 'id', '이전', undefined, [])).toBe(0);
  expect(mocks.batch).not.toHaveBeenCalled();
  expect(mocks.update.mock.calls[0][0]).toMatchObject({ range: "'설정'!B1", requestBody: { values: [['알림 표기']] } });
});
it('삭제는 설정의 해당 행만 제거합니다', async () => {
  await deletePaymentMethod('token', 'id', '다른');
  expect(mocks.structure).toHaveBeenCalledWith({ spreadsheetId: 'id', requestBody: { requests: [{ deleteDimension: { range: { sheetId: 0, dimension: 'ROWS', startIndex: 3, endIndex: 4 } } }] } });
  expect(mocks.batch).not.toHaveBeenCalled();
});
it('별칭 기억은 정확한 중복을 제거합니다', async () => {
  await rememberPaymentMethodAlias('token', 'id', '이전', '1234');
  expect(mocks.append).not.toHaveBeenCalled();
  expect(mocks.update.mock.calls.at(-1)![0].requestBody.values).toEqual([['이전', '1234, deep dream']]);
});
it('없는 결제수단을 먼저 등록한 다음 별칭을 기록합니다', async () => {
  mocks.read.mockImplementation(async ({ range }) => ({ data: { values: range === "'설정'!A2:A" ? [] : range === "'설정'!A2:B" ? [['새 카드', '']] : [['결제수단']] } }));
  await rememberPaymentMethodAlias('token', 'id', '새 카드', '0123');
  expect(mocks.append).toHaveBeenCalled();
  expect(mocks.update.mock.calls.at(-1)![0].requestBody.values).toEqual([['새 카드', '0123']]);
});
