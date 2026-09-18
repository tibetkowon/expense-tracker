import { describe, it, expect, vi, beforeEach } from 'vitest';
import { google } from 'googleapis';
import {
  PENDING_SHEET_TITLE,
  readPendingRows,
  deletePendingRow,
  appendPendingRow,
  type PendingRow,
} from './pending';

vi.mock('googleapis', () => {
  const spreadsheets = {
    get: vi.fn(),
    batchUpdate: vi.fn(),
    values: {
      append: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
    },
  };
  return {
    google: {
      auth: {
        OAuth2: vi.fn(function OAuth2() { return { setCredentials: vi.fn() }; }),
        JWT: vi.fn(function JWT() { return {}; }),
      },
      sheets: vi.fn(() => ({ spreadsheets })),
    },
  };
});

const api = google.sheets({ version: 'v4' }).spreadsheets;
const header = ['날짜', '금액', '카테고리', '메모', '결제수단', '유형', '원문'];
const existingSheet = {
  data: { sheets: [{ properties: { sheetId: 42, title: '대기' } }] },
};
const row: PendingRow = {
  date: '2026-09-18',
  amount: 12000,
  category: '식비',
  memo: '점심',
  method: '신한카드',
  type: '결제',
  rawText: '신한카드 12,000원 승인',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockReset().mockResolvedValue(existingSheet as never);
  vi.mocked(api.batchUpdate).mockReset().mockResolvedValue({} as never);
  vi.mocked(api.values.get).mockReset().mockResolvedValue({ data: {} } as never);
  vi.mocked(api.values.update).mockReset().mockResolvedValue({} as never);
  vi.mocked(api.values.append).mockReset().mockResolvedValue({} as never);
});

describe('readPendingRows', () => {
  it('대기 탭이 없으면 생성하지 않고 빈 배열을 반환합니다', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: {} } as never);

    expect(await readPendingRows('token', 'sheet-id')).toEqual([]);
    expect(PENDING_SHEET_TITLE).toBe('대기');
    expect(api.get).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id', fields: 'sheets.properties',
    });
    expect(api.values.get).not.toHaveBeenCalled();
    expect(api.batchUpdate).not.toHaveBeenCalled();
    expect(api.values.update).not.toHaveBeenCalled();
    const auth = vi.mocked(google.auth.OAuth2).mock.results[0].value;
    expect(auth.setCredentials).toHaveBeenCalledWith({ access_token: 'token' });
    expect(google.sheets).toHaveBeenCalledWith({ version: 'v4', auth });
    expect(google.auth.JWT).not.toHaveBeenCalled();
  });

  it('빈 행을 포함해 실제 행 번호와 컬럼 값을 순서대로 반환합니다', async () => {
    vi.mocked(api.values.get).mockResolvedValue({
      data: { values: [
        [row.date, '12000', row.category, row.memo, row.method, row.type, row.rawText],
        [],
        ['2026-09-19', '3000', '', '', '', '취소', '승인취소'],
      ] },
    } as never);

    expect(await readPendingRows('token', 'sheet-id')).toEqual([
      { ...row, rowNumber: 2 },
      { date: '', amount: 0, category: '', memo: '', method: '', type: '결제', rawText: '', rowNumber: 3 },
      { date: '2026-09-19', amount: 3000, category: '', memo: '', method: '', type: '취소', rawText: '승인취소', rowNumber: 4 },
    ]);
    expect(api.values.get).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id', range: '대기!A2:G',
    });
    expect(api.values.update).not.toHaveBeenCalled();
    expect(api.batchUpdate).not.toHaveBeenCalled();
  });

  it('데이터 행이 없으면 빈 배열을 반환합니다', async () => {
    expect(await readPendingRows('token', 'sheet-id')).toEqual([]);
  });

  it('조회 오류를 빈 목록으로 숨기지 않습니다', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('조회 실패'));
    await expect(readPendingRows('token', 'sheet-id')).rejects.toThrow('조회 실패');
  });
});

describe('appendPendingRow', () => {
  it('탭 생성과 헤더 쓰기를 마친 후 새 행을 추가합니다', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: {} } as never);
    const auth = new google.auth.JWT();

    expect(await appendPendingRow(auth, 'sheet-id', row)).toEqual({ added: true });
    expect(google.sheets).toHaveBeenCalledWith({ version: 'v4', auth });
    expect(google.auth.OAuth2).not.toHaveBeenCalled();
    expect(google.auth.JWT).toHaveBeenCalledTimes(1);
    expect(api.batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      requestBody: { requests: [{ addSheet: { properties: { title: '대기' } } }] },
    });
    expect(api.values.update).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id', range: '대기!A1:G1',
      valueInputOption: 'RAW', requestBody: { values: [header] },
    });
    expect(vi.mocked(api.batchUpdate).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(api.values.update).mock.invocationCallOrder[0]);
    expect(vi.mocked(api.values.update).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(api.values.get).mock.invocationCallOrder[1]);
    expect(vi.mocked(api.values.get).mock.invocationCallOrder[1])
      .toBeLessThan(vi.mocked(api.values.append).mock.invocationCallOrder[0]);
    expect(api.values.append).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id', range: '대기!A:G',
      valueInputOption: 'RAW',
      requestBody: { values: [[row.date, row.amount, row.category, row.memo, row.method, row.type, row.rawText]] },
    });
  });

  it('원문이 정확히 일치하면 추가하지 않으며 기존 헤더도 유지합니다', async () => {
    vi.mocked(api.values.get)
      .mockResolvedValueOnce({ data: { values: [header] } } as never)
      .mockResolvedValueOnce({ data: { values: [[], ['다른 원문'], [row.rawText]] } } as never);

    expect(await appendPendingRow(new google.auth.JWT(), 'sheet-id', row))
      .toEqual({ added: false });
    expect(api.values.get).toHaveBeenNthCalledWith(2, {
      spreadsheetId: 'sheet-id', range: '대기!G2:G',
    });
    expect(api.values.append).not.toHaveBeenCalled();
    expect(api.values.update).not.toHaveBeenCalled();
    expect(api.batchUpdate).not.toHaveBeenCalled();
  });

  it('공백이 다른 원문은 별개로 취급하고 수식 형태의 원문도 그대로 저장합니다', async () => {
    const rawText = '=1+2';
    vi.mocked(api.values.get)
      .mockResolvedValueOnce({ data: { values: [header] } } as never)
      .mockResolvedValueOnce({ data: { values: [[rawText + ' ']] } } as never);

    expect(await appendPendingRow(new google.auth.JWT(), 'sheet-id', {
      ...row, type: '취소', rawText,
    })).toEqual({ added: true });
    expect(api.values.append).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id', range: '대기!A:G',
      valueInputOption: 'RAW',
      requestBody: { values: [[row.date, row.amount, row.category, row.memo, row.method, '취소', rawText]] },
    });
  });

  it('헤더 쓰기 실패 후 재시도하면 기존 탭의 헤더를 복구합니다', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: {} } as never);
    vi.mocked(api.values.update).mockRejectedValueOnce(new Error('헤더 실패'));
    const auth = new google.auth.JWT();

    await expect(appendPendingRow(auth, 'sheet-id', row)).rejects.toThrow('헤더 실패');
    expect(api.values.append).not.toHaveBeenCalled();
    expect(await appendPendingRow(auth, 'sheet-id', row)).toEqual({ added: true });
    expect(api.batchUpdate).toHaveBeenCalledTimes(1);
    expect(api.values.update).toHaveBeenCalledTimes(2);
    expect(api.values.append).toHaveBeenCalledTimes(1);
  });

  it('중복 조회 실패 시 추가하지 않습니다', async () => {
    vi.mocked(api.values.get)
      .mockResolvedValueOnce({ data: { values: [header] } } as never)
      .mockRejectedValueOnce(new Error('원문 조회 실패'));

    await expect(appendPendingRow(new google.auth.JWT(), 'sheet-id', row))
      .rejects.toThrow('원문 조회 실패');
    expect(api.values.append).not.toHaveBeenCalled();
  });

  it('추가 실패를 호출자에게 전달합니다', async () => {
    vi.mocked(api.values.append).mockRejectedValueOnce(new Error('추가 실패'));
    await expect(appendPendingRow(new google.auth.JWT(), 'sheet-id', row))
      .rejects.toThrow('추가 실패');
  });
});

describe('deletePendingRow', () => {
  it('대기 탭이 없으면 생성하지 않고 오류를 반환합니다', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: {} } as never);

    await expect(deletePendingRow('token', 'sheet-id', 2))
      .rejects.toThrow('대기 시트를 찾을 수 없습니다');
    expect(api.batchUpdate).not.toHaveBeenCalled();
    expect(api.values.update).not.toHaveBeenCalled();
    expect(api.values.get).not.toHaveBeenCalled();
  });

  it.each([[0, 2], [42, 7]])('시트 %i의 행 %i만 삭제합니다', async (sheetId, rowNumber) => {
    vi.mocked(api.get).mockResolvedValue({ data: { sheets: [
      { properties: { sheetId: 9, title: '2026-09' } },
      { properties: { sheetId, title: '대기' } },
    ] } } as never);

    await deletePendingRow('token', 'sheet-id', rowNumber);

    const auth = vi.mocked(google.auth.OAuth2).mock.results[0].value;
    expect(auth.setCredentials).toHaveBeenCalledWith({ access_token: 'token' });
    expect(google.sheets).toHaveBeenCalledWith({ version: 'v4', auth });
    expect(google.auth.JWT).not.toHaveBeenCalled();
    expect(api.batchUpdate).toHaveBeenCalledTimes(1);
    expect(api.batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      requestBody: { requests: [{ deleteDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber },
      } }] },
    });
    expect(api.values.update).not.toHaveBeenCalled();
    expect(api.values.get).not.toHaveBeenCalled();
  });

  it('삭제 실패를 호출자에게 전달합니다', async () => {
    vi.mocked(api.batchUpdate).mockRejectedValueOnce(new Error('삭제 실패'));
    await expect(deletePendingRow('token', 'sheet-id', 2)).rejects.toThrow('삭제 실패');
  });
});
