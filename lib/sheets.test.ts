import { describe, it, expect, vi, beforeEach } from 'vitest';
import { google } from 'googleapis';
import { findOrCreateSpreadsheet, appendExpenseRow, readExpenseRows } from './sheets';

vi.mock('googleapis', () => {
  const files = {
    list: vi.fn(),
    create: vi.fn(),
  };
  const spreadsheets = {
    batchUpdate: vi.fn(),
    values: {
      append: vi.fn(),
      get: vi.fn(),
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

const FILE_NAME = 'expense-tracker';

describe('findOrCreateSpreadsheet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the existing file id when one is found', async () => {
    (google.drive as any)().files.list.mockResolvedValue({
      data: { files: [{ id: 'existing-id', name: FILE_NAME }] },
    });

    const id = await findOrCreateSpreadsheet('token');
    expect(id).toBe('existing-id');
    expect((google.drive as any)().files.create).not.toHaveBeenCalled();
    expect((google.sheets as any)().spreadsheets.batchUpdate).not.toHaveBeenCalled();
  });

  it('creates a new spreadsheet when none is found', async () => {
    (google.drive as any)().files.list.mockResolvedValue({ data: { files: [] } });
    (google.drive as any)().files.create.mockResolvedValue({ data: { id: 'new-id' } });

    const id = await findOrCreateSpreadsheet('token');
    expect(id).toBe('new-id');
    expect((google.sheets as any)().spreadsheets.batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'new-id',
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId: 0, title: 'Sheet1' },
              fields: 'title',
            },
          },
        ],
      },
    });
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

describe('appendExpenseRow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('appends a row with values in date/amount/category/memo/method order', async () => {
    await appendExpenseRow('token', 'sheet-id', {
      date: '2026-09-01',
      amount: 12000,
      category: '식비',
      memo: '점심',
      method: '카드',
    });

    expect((google.sheets as any)().spreadsheets.values.append).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: 'sheet-id',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['2026-09-01', 12000, '식비', '점심', '카드']] },
      })
    );
  });
});

describe('readExpenseRows', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps raw sheet rows back into ExpenseRow objects', async () => {
    (google.sheets as any)().spreadsheets.values.get.mockResolvedValue({
      data: { values: [['2026-09-01', '12000', '식비', '점심', '카드']] },
    });

    const rows = await readExpenseRows('token', 'sheet-id');
    expect(rows).toEqual([
      { date: '2026-09-01', amount: 12000, category: '식비', memo: '점심', method: '카드' },
    ]);
  });

  it('returns an empty array when the sheet has no data rows', async () => {
    (google.sheets as any)().spreadsheets.values.get.mockResolvedValue({ data: {} });
    const rows = await readExpenseRows('token', 'sheet-id');
    expect(rows).toEqual([]);
  });
});
