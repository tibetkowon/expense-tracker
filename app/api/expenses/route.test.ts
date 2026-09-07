// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  find: vi.fn(),
  months: vi.fn(),
  read: vi.fn(),
  methods: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/sheets', () => ({
  findOrCreateSpreadsheet: mocks.find,
  listAvailableMonths: mocks.months,
  readExpenseRows: mocks.read,
  listPaymentMethods: mocks.methods,
  appendExpenseRow: vi.fn(),
  updateExpenseRow: vi.fn(),
  deleteExpenseRow: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ accessToken: 'token' });
  mocks.find.mockResolvedValue('sheet-id');
  mocks.months.mockResolvedValue(['2026-09']);
  mocks.read.mockResolvedValue([
    { date: '2026-09-02', amount: 4500, category: '카페', memo: '', method: '현금', rowNumber: 2 },
  ]);
  mocks.methods.mockResolvedValue([]);
});

describe('지출 조회 결제수단', () => {
  it('기존 응답과 함께 등록된 결제수단을 순서대로 반환합니다', async () => {
    mocks.methods.mockResolvedValue(['신한카드', '현금']);
    const response = await GET(new Request(
      'http://localhost/api/expenses?month=2026-09&folderId=folder-id&fileName=ledger'
    ));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      expenses: [
        { date: '2026-09-02', amount: 4500, category: '카페', memo: '', method: '현금', rowNumber: 2 },
      ],
      monthlyTotal: 4500,
      availableMonths: ['2026-09'],
      selectedMonth: '2026-09',
      paymentMethods: ['신한카드', '현금'],
    });
    expect(mocks.find).toHaveBeenCalledWith('token', 'folder-id', 'ledger');
    expect(mocks.methods).toHaveBeenCalledWith('token', 'sheet-id');
  });

  it.each([{ months: ['2026-09'] }, { months: [] }])('등록된 결제수단이 없으면 기본값을 반환합니다: $months', async ({ months }) => {
    mocks.months.mockResolvedValue(months);
    const response = await GET(new Request('http://localhost/api/expenses?month=2026-09'));
    expect(response.status).toBe(200);
    expect((await response.json()).paymentMethods).toEqual(['체크카드', '신용카드', '현금', '계좌이체']);
  });

  it('로그인하지 않으면 설정을 읽지 않습니다', async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await GET(new Request('http://localhost/api/expenses'));
    expect(response.status).toBe(401);
    expect(mocks.methods).not.toHaveBeenCalled();
  });
});
