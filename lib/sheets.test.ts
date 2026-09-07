import { describe, it, expect, vi, beforeEach } from 'vitest';
import { google } from 'googleapis';
import {
  findOrCreateSpreadsheet,
  ensureMonthSheet,
  appendExpenseRow,
  readExpenseRows,
  updateExpenseRow,
  deleteExpenseRow,
  listAvailableMonths,
  renameSpreadsheetFile,
} from './sheets';

vi.mock('googleapis', () => {
  const files = {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
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
      auth: { OAuth2: vi.fn(function OAuth2() { return { setCredentials: vi.fn() }; }) },
      drive: vi.fn(() => ({ files })),
      sheets: vi.fn(() => ({ spreadsheets })),
    },
  };
});

describe('findOrCreateSpreadsheet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the existing file id when one is found', async () => {
    (google.drive as any)().files.list.mockResolvedValue({
      data: { files: [{ id: 'existing-id', name: 'expense-tracker' }] },
    });
    (google.sheets as any)().spreadsheets.get.mockResolvedValue({
      data: { sheets: [{ properties: { sheetId: 0, title: '2026-09' } }] },
    });

    const id = await findOrCreateSpreadsheet('token');
    expect(id).toBe('existing-id');
    expect((google.drive as any)().files.create).not.toHaveBeenCalled();
  });

  it('creates a new spreadsheet when none is found', async () => {
    (google.drive as any)().files.list.mockResolvedValue({ data: { files: [] } });
    (google.drive as any)().files.create.mockResolvedValue({ data: { id: 'new-id' } });

    const id = await findOrCreateSpreadsheet('token');
    expect(id).toBe('new-id');
    expect((google.drive as any)().files.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({ name: 'expense-tracker' }),
      })
    );
  });

  it('searches for and creates the file under a custom file name', async () => {
    (google.drive as any)().files.list.mockResolvedValue({ data: { files: [] } });
    (google.drive as any)().files.create.mockResolvedValue({ data: { id: 'new-id' } });

    await findOrCreateSpreadsheet('token', undefined, '가계부');

    expect((google.drive as any)().files.list).toHaveBeenCalledWith(
      expect.objectContaining({ q: expect.stringContaining("name='가계부'") })
    );
    expect((google.drive as any)().files.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({ name: '가계부' }),
      })
    );
  });

  it('escapes single quotes in the file name for the Drive query', async () => {
    (google.drive as any)().files.list.mockResolvedValue({ data: { files: [] } });
    (google.drive as any)().files.create.mockResolvedValue({ data: { id: 'new-id' } });

    await findOrCreateSpreadsheet('token', undefined, "O'Brien");

    expect((google.drive as any)().files.list).toHaveBeenCalledWith(
      expect.objectContaining({ q: expect.stringContaining("name='O\\'Brien'") })
    );
    expect((google.drive as any)().files.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({ name: "O'Brien" }),
      })
    );
  });
});

describe('findOrCreateSpreadsheet with a folderId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scopes the search query to the given folder', async () => {
    (google.drive as any)().files.list.mockResolvedValue({ data: { files: [] } });
    (google.drive as any)().files.create.mockResolvedValue({ data: { id: 'new-id' } });

    await findOrCreateSpreadsheet('token', 'folder-123');

    expect((google.drive as any)().files.list).toHaveBeenCalledWith(
      expect.objectContaining({
        q: expect.stringContaining("'folder-123' in parents"),
      })
    );
  });

  it('creates the spreadsheet inside the given folder', async () => {
    (google.drive as any)().files.list.mockResolvedValue({ data: { files: [] } });
    (google.drive as any)().files.create.mockResolvedValue({ data: { id: 'new-id' } });

    await findOrCreateSpreadsheet('token', 'folder-123');

    expect((google.drive as any)().files.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({ parents: ['folder-123'] }),
      })
    );
  });
});

describe('findOrCreateSpreadsheet legacy data migration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does nothing when the first sheet is already a month sheet', async () => {
    (google.drive as any)().files.list.mockResolvedValue({
      data: { files: [{ id: 'existing-id', name: 'expense-tracker' }] },
    });
    (google.sheets as any)().spreadsheets.get.mockResolvedValue({
      data: { sheets: [{ properties: { sheetId: 0, title: '2026-09' } }] },
    });

    await findOrCreateSpreadsheet('token');

    expect((google.sheets as any)().spreadsheets.values.get).not.toHaveBeenCalled();
    expect((google.sheets as any)().spreadsheets.batchUpdate).not.toHaveBeenCalled();
  });

  it('leaves an empty legacy sheet alone (nothing to migrate)', async () => {
    (google.drive as any)().files.list.mockResolvedValue({
      data: { files: [{ id: 'existing-id', name: 'expense-tracker' }] },
    });
    (google.sheets as any)().spreadsheets.get.mockResolvedValue({
      data: { sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }] },
    });
    (google.sheets as any)().spreadsheets.values.get.mockResolvedValue({ data: {} });

    await findOrCreateSpreadsheet('token');

    expect((google.sheets as any)().spreadsheets.batchUpdate).not.toHaveBeenCalled();
  });

  it('migrates legacy rows into month sheets, then deletes the legacy sheet', async () => {
    (google.drive as any)().files.list.mockResolvedValue({
      data: { files: [{ id: 'existing-id', name: 'expense-tracker' }] },
    });
    (google.sheets as any)().spreadsheets.get.mockResolvedValue({
      data: { sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }] },
    });
    (google.sheets as any)().spreadsheets.values.get.mockImplementation(
      ({ range }: { range: string }) =>
        (range.startsWith('Sheet1!') || range === "'Sheet1'")
          ? Promise.resolve({
              data: {
                values: [
                  ['2026-08-30', '5000', '식비', '점심', '카드'],
                  ['2026-09-01', '12000', '카페', '커피', '카드'],
                ],
              },
            })
          : Promise.resolve({ data: {} })
    );

    await findOrCreateSpreadsheet('token');

    expect((google.sheets as any)().spreadsheets.batchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: { requests: [{ addSheet: { properties: { title: '2026-08' } } }] },
      })
    );
    expect((google.sheets as any)().spreadsheets.batchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: { requests: [{ addSheet: { properties: { title: '2026-09' } } }] },
      })
    );
    expect((google.sheets as any)().spreadsheets.values.append).toHaveBeenCalledWith(
      expect.objectContaining({
        range: '2026-08!A:E',
        requestBody: { values: [['2026-08-30', 5000, '식비', '점심', '카드']] },
      })
    );
    expect((google.sheets as any)().spreadsheets.values.append).toHaveBeenCalledWith(
      expect.objectContaining({
        range: '2026-09!A:E',
        requestBody: { values: [['2026-09-01', 12000, '카페', '커피', '카드']] },
      })
    );
    expect((google.sheets as any)().spreadsheets.batchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: { requests: [{ deleteSheet: { sheetId: 0 } }] },
      })
    );
  });

  it('skips rows a prior, interrupted migration attempt already copied (idempotent retry)', async () => {
    (google.drive as any)().files.list.mockResolvedValue({
      data: { files: [{ id: 'existing-id', name: 'expense-tracker' }] },
    });
    (google.sheets as any)().spreadsheets.get.mockResolvedValue({
      data: {
        sheets: [
          { properties: { sheetId: 0, title: 'Sheet1' } },
          { properties: { sheetId: 1, title: '2026-09' } },
        ],
      },
    });
    (google.sheets as any)().spreadsheets.values.get.mockImplementation(
      ({ range }: { range: string }) => {
        if (range === 'Sheet1!A:E' || range === "'Sheet1'" || range === '2026-09!A2:E') {
          return Promise.resolve({
            data: { values: [['2026-09-01', '12000', '카페', '커피', '카드']] },
          });
        }
        return Promise.resolve({ data: {} });
      }
    );

    await findOrCreateSpreadsheet('token');

    expect((google.sheets as any)().spreadsheets.values.append).not.toHaveBeenCalledWith(
      expect.objectContaining({ range: '2026-09!A:E' })
    );
  });
});

describe('ensureMonthSheet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does nothing when the sheet exists and already has a header', async () => {
    (google.sheets as any)().spreadsheets.get.mockResolvedValue({
      data: { sheets: [{ properties: { sheetId: 0, title: '2026-09' } }] },
    });
    (google.sheets as any)().spreadsheets.values.get.mockResolvedValue({
      data: { values: [['날짜', '금액', '카테고리', '메모', '결제수단']] },
    });

    await ensureMonthSheet('token', 'sheet-id', '2026-09');

    expect((google.sheets as any)().spreadsheets.batchUpdate).not.toHaveBeenCalled();
    expect((google.sheets as any)().spreadsheets.values.update).not.toHaveBeenCalled();
  });

  it('creates the sheet and writes the header when it does not exist', async () => {
    (google.sheets as any)().spreadsheets.get.mockResolvedValue({
      data: { sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }] },
    });
    (google.sheets as any)().spreadsheets.values.get.mockResolvedValue({ data: {} });

    await ensureMonthSheet('token', 'sheet-id', '2026-09');

    expect((google.sheets as any)().spreadsheets.batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      requestBody: { requests: [{ addSheet: { properties: { title: '2026-09' } } }] },
    });
    expect((google.sheets as any)().spreadsheets.values.update).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      range: '2026-09!A1:E1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['날짜', '금액', '카테고리', '메모', '결제수단']] },
    });
  });

  it('self-heals a header-less sheet without recreating the tab', async () => {
    (google.sheets as any)().spreadsheets.get.mockResolvedValue({
      data: { sheets: [{ properties: { sheetId: 0, title: '2026-09' } }] },
    });
    (google.sheets as any)().spreadsheets.values.get.mockResolvedValue({ data: {} });

    await ensureMonthSheet('token', 'sheet-id', '2026-09');

    expect((google.sheets as any)().spreadsheets.batchUpdate).not.toHaveBeenCalled();
    expect((google.sheets as any)().spreadsheets.values.update).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      range: '2026-09!A1:E1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['날짜', '금액', '카테고리', '메모', '결제수단']] },
    });
  });
});

describe('빈 기본 시트 정리', () => {
  const header = ['날짜', '금액', '카테고리', '메모', '결제수단'];
  const deletion = {
    spreadsheetId: 'sheet-id',
    requestBody: { requests: [{ deleteSheet: { sheetId: 0 } }] },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const api = (google.sheets as any)().spreadsheets;
    api.batchUpdate.mockResolvedValue({});
    api.values.update.mockResolvedValue({});
    api.values.append.mockResolvedValue({});
    api.values.get.mockResolvedValue({ data: {} });
  });

  it('첫 지출 입력 시 월 시트를 생성한 뒤 빈 기본 시트를 삭제한다', async () => {
    const api = (google.sheets as any)().spreadsheets;
    api.get.mockResolvedValue({ data: { sheets: [
      { properties: { sheetId: 0, title: '시트1' } },
    ] } });

    await appendExpenseRow('token', 'sheet-id', '2026-09', {
      date: '2026-09-01', amount: 5000, category: '식비', memo: '', method: '카드',
    });

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.batchUpdate).toHaveBeenNthCalledWith(1, {
      spreadsheetId: 'sheet-id',
      requestBody: { requests: [{ addSheet: { properties: { title: '2026-09' } } }] },
    });
    expect(api.batchUpdate).toHaveBeenNthCalledWith(2, deletion);
    expect(api.values.update).toHaveBeenCalledWith(expect.objectContaining({
      range: '2026-09!A1:E1', requestBody: { values: [header] },
    }));
    expect(api.values.append).toHaveBeenCalledWith(expect.objectContaining({
      range: '2026-09!A:E',
      requestBody: { values: [['2026-09-01', 5000, '식비', '', '카드']] },
    }));
  });

  it.each([
    { values: [], shouldDelete: true },
    { values: [['2026-09-01', 5000, '식비']], shouldDelete: false },
    { values: [header], shouldDelete: false },
    { values: [['', '', '', '', '', '보존할 메모']], shouldDelete: false },
    { values: [['=""']], shouldDelete: false },
  ])('기존 월 시트가 있을 때 데이터 유무에 따라 정리한다: $shouldDelete', async ({ values, shouldDelete }) => {
    const api = (google.sheets as any)().spreadsheets;
    api.get.mockResolvedValue({ data: { sheets: [
      { properties: { sheetId: 0, title: "사용자 '시트'" } },
      { properties: { sheetId: 7, title: '2026-09' } },
    ] } });
    api.values.get.mockImplementation(({ range }: { range: string }) =>
      Promise.resolve({ data: { values: range === '2026-09!A1:E1' ? [header] : values } })
    );

    await ensureMonthSheet('token', 'sheet-id', '2026-09');

    expect(api.values.get).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id', range: "'사용자 ''시트'''", valueRenderOption: 'FORMULA',
    });
    if (shouldDelete) {
      expect(api.batchUpdate).toHaveBeenCalledTimes(1);
      expect(api.batchUpdate).toHaveBeenCalledWith(deletion);
    } else {
      expect(api.batchUpdate).not.toHaveBeenCalled();
    }
    expect(api.values.update).not.toHaveBeenCalled();
  });

  it.each(['read', 'delete'])('동시 정리 중 %s 실패가 나도 이미 삭제됐다면 두 지출을 저장한다', async (failureStage) => {
    const api = (google.sheets as any)().spreadsheets;
    const monthSheet = { properties: { sheetId: 7, title: '2026-09' } };
    const initial = { data: { sheets: [
      { properties: { sheetId: 0, title: '시트1' } },
      monthSheet,
    ] } };
    api.get.mockResolvedValue({ data: { sheets: [monthSheet] } })
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(initial);
    let finishDeletion!: () => void;
    const deletionFinished = new Promise<void>((resolve) => {
      finishDeletion = resolve;
    });
    let reads = 0;
    let deleted = false;
    api.values.get.mockImplementation(async ({ range }: { range: string }) => {
      if (range === '2026-09!A1:E1') return { data: { values: [header] } };
      reads += 1;
      if (failureStage === 'read' && reads === 2) {
        await deletionFinished;
        throw new Error('시트가 이미 삭제됨');
      }
      return { data: {} };
    });
    api.batchUpdate.mockImplementation(async () => {
      if (deleted) throw new Error('시트가 이미 삭제됨');
      deleted = true;
      finishDeletion();
      return {};
    });
    const rows = [5000, 7000].map((amount) => ({
      date: '2026-09-01', amount, category: '식비', memo: '', method: '카드',
    }));

    await expect(Promise.all(rows.map((row) =>
      appendExpenseRow('token', 'sheet-id', '2026-09', row)
    ))).resolves.toEqual([undefined, undefined]);

    expect(reads).toBe(2);
    expect(api.get).toHaveBeenCalledTimes(3);
    expect(api.batchUpdate).toHaveBeenCalledTimes(failureStage === 'read' ? 1 : 2);
    expect(api.batchUpdate).toHaveBeenCalledWith(deletion);
    expect(api.values.append).toHaveBeenCalledTimes(2);
    for (const row of rows) {
      expect(api.values.append).toHaveBeenCalledWith(expect.objectContaining({
        range: '2026-09!A:E',
        requestBody: { values: [[row.date, row.amount, row.category, row.memo, row.method]] },
      }));
    }
  });

  it.each(['read', 'delete', 'recheck'])('정리 중 %s 실패 후 삭제를 확인하지 못하면 오류를 전달한다', async (failureStage) => {
    const api = (google.sheets as any)().spreadsheets;
    const initial = { data: { sheets: [
      { properties: { sheetId: 0, title: '시트1' } },
      { properties: { sheetId: 7, title: '2026-09' } },
    ] } };
    const cleanupError = new Error('정리 실패');
    const recheckError = new Error('목록 재조회 실패');
    api.get.mockResolvedValue(initial);
    if (failureStage === 'read') {
      api.values.get.mockRejectedValueOnce(cleanupError);
    } else {
      api.batchUpdate.mockRejectedValueOnce(cleanupError);
    }
    if (failureStage === 'recheck') {
      api.get.mockResolvedValueOnce(initial).mockRejectedValueOnce(recheckError);
    }

    await expect(appendExpenseRow('token', 'sheet-id', '2026-09', {
      date: '2026-09-01', amount: 5000, category: '식비', memo: '', method: '카드',
    })).rejects.toBe(failureStage === 'recheck' ? recheckError : cleanupError);

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.values.append).not.toHaveBeenCalled();
    expect(api.values.update).not.toHaveBeenCalled();
  });

  it('월 시트 생성 실패 시 마지막 기본 시트를 삭제하지 않는다', async () => {
    const api = (google.sheets as any)().spreadsheets;
    api.get.mockResolvedValue({ data: { sheets: [
      { properties: { sheetId: 0, title: '시트1' } },
    ] } });
    api.batchUpdate.mockRejectedValueOnce(new Error('생성 실패'));

    await expect(ensureMonthSheet('token', 'sheet-id', '2026-09')).rejects.toThrow('생성 실패');

    expect(api.batchUpdate).not.toHaveBeenCalledWith(deletion);
    expect(api.values.get).not.toHaveBeenCalled();
  });
});

describe('appendExpenseRow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ensures the month sheet exists, then appends a row to it', async () => {
    (google.sheets as any)().spreadsheets.get.mockResolvedValue({
      data: { sheets: [{ properties: { sheetId: 0, title: '2026-09' } }] },
    });
    (google.sheets as any)().spreadsheets.values.get.mockResolvedValue({
      data: { values: [['날짜', '금액', '카테고리', '메모', '결제수단']] },
    });

    await appendExpenseRow('token', 'sheet-id', '2026-09', {
      date: '2026-09-01',
      amount: 12000,
      category: '식비',
      memo: '점심',
      method: '카드',
    });

    expect((google.sheets as any)().spreadsheets.values.append).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: 'sheet-id',
        range: '2026-09!A:E',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['2026-09-01', 12000, '식비', '점심', '카드']] },
      })
    );
  });
});

describe('readExpenseRows', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads rows from the given month sheet, skipping the header row', async () => {
    (google.sheets as any)().spreadsheets.values.get.mockResolvedValue({
      data: { values: [['2026-09-01', '12000', '식비', '점심', '카드']] },
    });

    const rows = await readExpenseRows('token', 'sheet-id', '2026-09');

    expect((google.sheets as any)().spreadsheets.values.get).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      range: '2026-09!A2:E',
    });
    expect(rows).toEqual([
      { date: '2026-09-01', amount: 12000, category: '식비', memo: '점심', method: '카드', rowNumber: 2 },
    ]);
  });

  it('preserves actual row numbers across empty rows', async () => {
    (google.sheets as any)().spreadsheets.values.get.mockResolvedValue({
      data: { values: [
        ['2026-09-01', '12000', '식비', '점심', '카드'],
        [],
        ['2026-09-02', '3000', '카페'],
      ] },
    });

    expect(await readExpenseRows('token', 'sheet-id', '2026-09')).toEqual([
      { date: '2026-09-01', amount: 12000, category: '식비', memo: '점심', method: '카드', rowNumber: 2 },
      { date: '', amount: 0, category: '', memo: '', method: '', rowNumber: 3 },
      { date: '2026-09-02', amount: 3000, category: '카페', memo: '', method: '', rowNumber: 4 },
    ]);
  });

  it('returns an empty array when the sheet has no data rows', async () => {
    (google.sheets as any)().spreadsheets.values.get.mockResolvedValue({ data: {} });
    const rows = await readExpenseRows('token', 'sheet-id', '2026-09');
    expect(rows).toEqual([]);
  });
});

describe('listAvailableMonths', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns only month-shaped sheet titles, sorted descending', async () => {
    (google.sheets as any)().spreadsheets.get.mockResolvedValue({
      data: {
        sheets: [
          { properties: { sheetId: 0, title: 'Sheet1' } },
          { properties: { sheetId: 1, title: '2026-07' } },
          { properties: { sheetId: 2, title: '2026-09' } },
          { properties: { sheetId: 3, title: '2026-08' } },
        ],
      },
    });

    const months = await listAvailableMonths('token', 'sheet-id');
    expect(months).toEqual(['2026-09', '2026-08', '2026-07']);
  });
});

describe('renameSpreadsheetFile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renames the file via the Drive API', async () => {
    (google.drive as any)().files.update = vi.fn().mockResolvedValue({});

    await renameSpreadsheetFile('token', 'sheet-id', '가계부');

    expect((google.drive as any)().files.update).toHaveBeenCalledWith({
      fileId: 'sheet-id',
      requestBody: { name: '가계부' },
    });
  });
});

describe('updateExpenseRow', () => {
  beforeEach(() => vi.clearAllMocks());

  const row = { date: '2026-09-02', amount: 4500, category: '카페', memo: '', method: '현금' };

  it.each([2, 7])('overwrites only spreadsheet row %i', async (rowNumber) => {
    const spreadsheets = (google.sheets as any)().spreadsheets;
    spreadsheets.values.update.mockResolvedValue({});

    await updateExpenseRow('token', 'sheet-id', '2026-09', rowNumber, row);

    expect(spreadsheets.values.update).toHaveBeenCalledTimes(1);
    expect(spreadsheets.values.update).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      range: `2026-09!A${rowNumber}:E${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['2026-09-02', 4500, '카페', '', '현금']] },
    });
    expect(spreadsheets.values.append).not.toHaveBeenCalled();
    expect(spreadsheets.batchUpdate).not.toHaveBeenCalled();
  });

  it('propagates an update failure', async () => {
    (google.sheets as any)().spreadsheets.values.update.mockRejectedValueOnce(new Error('update failed'));
    await expect(updateExpenseRow('token', 'sheet-id', '2026-09', 2, row)).rejects.toThrow('update failed');
  });
});

describe('deleteExpenseRow', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([0, 42])('uses sheet ID %i and deletes a row so later rows shift up', async (sheetId) => {
    const spreadsheets = (google.sheets as any)().spreadsheets;
    spreadsheets.get.mockResolvedValue({ data: { sheets: [
      { properties: { sheetId: 8, title: '2026-08' } },
      { properties: { sheetId, title: '2026-09' } },
    ] } });
    spreadsheets.batchUpdate.mockResolvedValue({});

    await deleteExpenseRow('token', 'sheet-id', '2026-09', 4);

    expect(spreadsheets.get).toHaveBeenCalledWith({ spreadsheetId: 'sheet-id', fields: 'sheets.properties' });
    expect(spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    expect(spreadsheets.batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      requestBody: { requests: [{ deleteDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: 3, endIndex: 4 },
      } }] },
    });
    expect(spreadsheets.values.update).not.toHaveBeenCalled();
  });

  it('deletes the first data row without deleting the header', async () => {
    const spreadsheets = (google.sheets as any)().spreadsheets;
    spreadsheets.get.mockResolvedValue({ data: { sheets: [
      { properties: { sheetId: 9, title: '2026-09' } },
    ] } });
    await deleteExpenseRow('token', 'sheet-id', '2026-09', 2);
    expect(spreadsheets.batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      requestBody: { requests: [{ deleteDimension: {
        range: { sheetId: 9, dimension: 'ROWS', startIndex: 1, endIndex: 2 },
      } }] },
    });
  });

  it('throws a clear error without deleting anything when the month is missing', async () => {
    const spreadsheets = (google.sheets as any)().spreadsheets;
    spreadsheets.get.mockResolvedValue({ data: { sheets: [
      { properties: { sheetId: 8, title: '2026-08' } },
    ] } });
    await expect(deleteExpenseRow('token', 'sheet-id', '2026-09', 2)).rejects.toThrow('월 시트를 찾을 수 없습니다: 2026-09');
    expect(spreadsheets.batchUpdate).not.toHaveBeenCalled();
  });

  it('propagates a delete failure', async () => {
    const spreadsheets = (google.sheets as any)().spreadsheets;
    spreadsheets.get.mockResolvedValue({ data: { sheets: [
      { properties: { sheetId: 9, title: '2026-09' } },
    ] } });
    spreadsheets.batchUpdate.mockRejectedValueOnce(new Error('delete failed'));
    await expect(deleteExpenseRow('token', 'sheet-id', '2026-09', 2)).rejects.toThrow('delete failed');
  });
});
