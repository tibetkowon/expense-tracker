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
        range.startsWith('Sheet1!')
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
        if (range === 'Sheet1!A:E' || range === '2026-09!A2:E') {
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
