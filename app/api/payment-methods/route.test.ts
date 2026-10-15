// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { GET, POST, PATCH, DELETE } from './route';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), find: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/sheets', () => ({
  findOrCreateSpreadsheet: mocks.find, listPaymentMethodEntries: mocks.list,
  createPaymentMethod: mocks.create, updatePaymentMethod: mocks.update, deletePaymentMethod: mocks.remove,
  PaymentMethodError: class extends Error { constructor(message: string, public status: number) { super(message); } },
}));
import { PaymentMethodError } from '@/lib/sheets';
const request = (body: unknown) => new Request('http://localhost/api/payment-methods?folderId=folder&fileName=file', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ accessToken: 'token' }); mocks.find.mockResolvedValue('id'); mocks.list.mockResolvedValue([]); mocks.update.mockResolvedValue(3); });
it.each([GET, POST, PATCH, DELETE])('모든 메서드는 인증을 요구합니다', async (handler) => {
  mocks.auth.mockResolvedValue(null);
  expect((await handler(request({}))).status).toBe(401);
  expect(mocks.find).not.toHaveBeenCalled();
});
it('목록 조회 위치를 전달합니다', async () => {
  expect(await (await GET(request({}))).json()).toEqual({ entries: [] });
  expect(mocks.find).toHaveBeenCalledWith('token', 'folder', 'file');
});
it.each([[POST, { name: ' ' }], [POST, { name: '카드', aliases: '1234' }], [PATCH, { originalName: '카드' }], [PATCH, { originalName: '카드', name: '' }], [DELETE, {}], [POST, { name: '카드', folderId: 1 }]] as const)('잘못된 입력을 거부합니다', async (handler, body) => {
  expect((await handler(request(body))).status).toBe(400);
  expect(mocks.find).not.toHaveBeenCalled();
});
it('추가 시 이름과 별칭을 정리하고 위치를 전달합니다', async () => {
  expect((await POST(request({ name: ' 카드 ', aliases: [' 1234 ', '', '1234'], folderId: 'f', fileName: 'n' }))).status).toBe(200);
  expect(mocks.find).toHaveBeenCalledWith('token', 'f', 'n');
  expect(mocks.create).toHaveBeenCalledWith('token', 'id', '카드', ['1234']);
});
it('수정한 기록 수를 반환하고 별칭만 수정할 수 있습니다', async () => {
  expect(await (await PATCH(request({ originalName: '카드', aliases: [] }))).json()).toEqual({ ok: true, replacedCount: 3 });
  expect(mocks.update).toHaveBeenCalledWith('token', 'id', '카드', undefined, []);
});
it('설정 결제수단을 삭제합니다', async () => {
  expect((await DELETE(request({ name: '카드' }))).status).toBe(200);
  expect(mocks.remove).toHaveBeenCalledWith('token', 'id', '카드');
});
it('중복 이름은 409, 저장 실패는 500입니다', async () => {
  mocks.create.mockRejectedValueOnce(new PaymentMethodError('중복', 409));
  expect((await POST(request({ name: '카드' }))).status).toBe(409);
  mocks.update.mockRejectedValueOnce(new Error());
  expect((await PATCH(request({ originalName: '카드', name: '새 카드' }))).status).toBe(500);
});
