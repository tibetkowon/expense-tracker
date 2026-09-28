// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  getServiceAccountAuth: vi.fn(),
  findServiceAccountSpreadsheetId: vi.fn(),
  extractNotificationData: vi.fn(),
  appendPendingRow: vi.fn(),
}));
vi.mock('@/lib/serviceAccount', () => ({
  getServiceAccountAuth: mocks.getServiceAccountAuth,
  findServiceAccountSpreadsheetId: mocks.findServiceAccountSpreadsheetId,
}));
vi.mock('@/lib/notificationParse', () => ({
  extractNotificationData: mocks.extractNotificationData,
}));
vi.mock('@/lib/pending', () => ({ appendPendingRow: mocks.appendPendingRow }));

const auth = {};
const rawText = '  카드 승인 12,000원\n가맹점  ';
const extraction = {
  type: '결제',
  amount: 12000,
  merchant: '가맹점',
  categoryGuess: '식비',
  method: '신한카드',
};

function request(
  body: unknown = { appName: '신한카드', text: rawText },
  key: string | null = 'test-api-key'
) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (key !== null) headers.set('x-shortcut-api-key', key);
  return new Request('http://localhost/api/shortcuts/parse', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-17T15:00:00.000Z'));
  vi.stubEnv('SHORTCUT_API_KEY', 'test-api-key');
  mocks.getServiceAccountAuth.mockReturnValue(auth);
  mocks.findServiceAccountSpreadsheetId.mockResolvedValue('sheet-id');
  mocks.extractNotificationData.mockResolvedValue(extraction);
  mocks.appendPendingRow.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('단축어 알림 파싱 API', () => {
  it.each([null, '', 'wrong-key'])('키가 없거나 틀리면 401을 반환합니다: %s', async (key) => {
    const response = await POST(request(undefined, key));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: '인증에 실패했습니다.' });
    expect(mocks.extractNotificationData).not.toHaveBeenCalled();
    expect(mocks.getServiceAccountAuth).not.toHaveBeenCalled();
    expect(mocks.appendPendingRow).not.toHaveBeenCalled();
  });

  it.each([undefined, ''])('서버 키가 설정되지 않으면 인증을 거부합니다: %s', async (key) => {
    vi.stubEnv('SHORTCUT_API_KEY', key);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.extractNotificationData).not.toHaveBeenCalled();
  });

  it.each([
    null, {}, { appName: '카드' }, { appName: '카드', text: '' },
    { appName: '카드', text: 123 }, { text: '승인' }, { appName: 123, text: '승인' },
  ])('잘못된 본문은 파싱 전에 400을 반환합니다: %j', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.extractNotificationData).not.toHaveBeenCalled();
    expect(mocks.appendPendingRow).not.toHaveBeenCalled();
  });

  it('잘못된 JSON은 400을 반환합니다', async () => {
    const response = await POST(new Request('http://localhost/api/shortcuts/parse', {
      method: 'POST',
      headers: { 'x-shortcut-api-key': 'test-api-key', 'Content-Type': 'application/json' },
      body: '{',
    }));
    expect(response.status).toBe(400);
    expect(mocks.extractNotificationData).not.toHaveBeenCalled();
  });

  it.each([
    ['입금', 'deposit'],
    ['무관', 'not_transaction'],
  ])('%s은 서비스 계정 조회와 저장 없이 건너뜁니다', async (type, reason) => {
    mocks.extractNotificationData.mockResolvedValue({ ...extraction, type });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, skipped: true, reason });
    expect(mocks.getServiceAccountAuth).not.toHaveBeenCalled();
    expect(mocks.findServiceAccountSpreadsheetId).not.toHaveBeenCalled();
    expect(mocks.appendPendingRow).not.toHaveBeenCalled();
  });

  it.each(['결제', '취소', null])('추출 필드와 원문을 대기 행으로 저장합니다: %s', async (type) => {
    mocks.extractNotificationData.mockResolvedValue({ ...extraction, type });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.extractNotificationData).toHaveBeenCalledExactlyOnceWith('신한카드', rawText);
    expect(mocks.findServiceAccountSpreadsheetId).toHaveBeenCalledExactlyOnceWith(auth);
    expect(mocks.appendPendingRow).toHaveBeenCalledExactlyOnceWith(auth, 'sheet-id', {
      date: '2026-09-18', amount: 12000, category: '식비', memo: '가맹점',
      method: '신한카드', type: type === '취소' ? '취소' : '결제', rawText,
    });
  });

  it.each([
    ['2026-12-31T14:59:59.999Z', '2026-12-31'],
    ['2026-12-31T15:00:00.000Z', '2027-01-01'],
  ])('연도 없는 알림도 수신 시각 %s의 KST 날짜로 저장합니다', async (timestamp, date) => {
    vi.setSystemTime(new Date(timestamp));
    const text = '카드 승인 12,000원 12/31 13:09 가맹점';

    expect((await POST(request({ appName: '신한카드', text }))).status).toBe(200);
    expect(mocks.appendPendingRow).toHaveBeenCalledExactlyOnceWith(
      auth, 'sheet-id', expect.objectContaining({ date, rawText: text })
    );
  });

  it('본문 읽기와 모델 처리 중 KST 연도가 바뀌어도 수신 날짜를 저장합니다', async () => {
    vi.setSystemTime(new Date('2026-12-31T14:59:59.999Z'));
    const incoming = request();
    incoming.json = vi.fn(async () => {
      vi.setSystemTime(new Date('2026-12-31T15:00:00.000Z'));
      return { appName: '신한카드', text: rawText };
    });
    mocks.extractNotificationData.mockImplementation(async () => {
      vi.setSystemTime(new Date('2026-12-31T15:00:10.000Z'));
      return extraction;
    });

    expect((await POST(incoming)).status).toBe(200);
    expect(mocks.appendPendingRow).toHaveBeenCalledExactlyOnceWith(
      auth, 'sheet-id', expect.objectContaining({
        date: '2026-12-31',
        rawText,
      })
    );
  });

  it('모든 필드가 불명확해도 원문을 보존한 결제 초안을 저장합니다', async () => {
    mocks.extractNotificationData.mockResolvedValue({
      type: null, amount: null, merchant: null, categoryGuess: null, method: null,
    });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.appendPendingRow).toHaveBeenCalledExactlyOnceWith(auth, 'sheet-id', {
      date: '2026-09-18', amount: 0, category: '', memo: '', method: '', type: '결제', rawText,
    });
  });

  it('공유 파일이 없으면 구분 가능한 500 응답을 반환합니다', async () => {
    mocks.findServiceAccountSpreadsheetId.mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: '스프레드시트가 아직 서비스 계정과 공유되지 않았습니다.',
    });
    expect(mocks.appendPendingRow).not.toHaveBeenCalled();
  });

  it('파싱 오류를 노출하지 않고 500 응답을 반환합니다', async () => {
    mocks.extractNotificationData.mockRejectedValue(new Error('private_key: secret'));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: '알림 파싱 중 오류가 발생했습니다.' });
    expect(mocks.getServiceAccountAuth).not.toHaveBeenCalled();
    expect(mocks.appendPendingRow).not.toHaveBeenCalled();
  });

  it.each(['auth', 'lookup', 'append'])('서비스 계정/시트 오류를 500으로 반환합니다: %s', async (stage) => {
    const error = new Error('private_key: secret');
    if (stage === 'auth') mocks.getServiceAccountAuth.mockImplementation(() => { throw error; });
    if (stage === 'lookup') mocks.findServiceAccountSpreadsheetId.mockRejectedValue(error);
    if (stage === 'append') mocks.appendPendingRow.mockRejectedValue(error);
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: '알림 저장 중 오류가 발생했습니다.' });
    if (stage !== 'append') expect(mocks.appendPendingRow).not.toHaveBeenCalled();
  });
});
