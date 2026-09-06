import { google } from 'googleapis';
import { DEFAULT_FILE_NAME } from './fileNameStorage';

export type ExpenseRow = {
  date: string;
  amount: number;
  category: string;
  memo: string;
  method: string;
};

function authClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

const HEADER_ROW = ['날짜', '금액', '카테고리', '메모', '결제수단'];
const MONTH_SHEET_TITLE_PATTERN = /^\d{4}-\d{2}$/;

function escapeForDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function rowKey(row: ExpenseRow): string {
  return `${row.date}|${row.amount}|${row.category}|${row.memo}|${row.method}`;
}

type SheetInfo = { sheetId: number; title: string };

async function listSheets(
  sheetsApi: ReturnType<typeof google.sheets>,
  spreadsheetId: string
): Promise<SheetInfo[]> {
  const result = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });

  return (result.data.sheets ?? []).map((sheet) => ({
    sheetId: sheet.properties?.sheetId ?? 0,
    title: sheet.properties?.title ?? '',
  }));
}

export async function ensureMonthSheet(
  accessToken: string,
  spreadsheetId: string,
  month: string
): Promise<void> {
  const auth = authClient(accessToken);
  const sheetsApi = google.sheets({ version: 'v4', auth });

  const sheets = await listSheets(sheetsApi, spreadsheetId);
  if (!sheets.some((sheet) => sheet.title === month)) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: month } } }] },
    });
  }

  // The tab and its header are two separate API calls, so a retry after a failure
  // between them must not skip the header just because the tab already exists.
  // Writing to the fixed A1:E1 range (rather than appending) keeps this idempotent.
  const headerCheck = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${month}!A1:E1`,
  });
  if ((headerCheck.data.values ?? []).length > 0) return;

  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `${month}!A1:E1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [HEADER_ROW] },
  });
}

export async function appendExpenseRow(
  accessToken: string,
  spreadsheetId: string,
  month: string,
  row: ExpenseRow
): Promise<void> {
  await ensureMonthSheet(accessToken, spreadsheetId, month);

  const auth = authClient(accessToken);
  const sheetsApi = google.sheets({ version: 'v4', auth });

  await sheetsApi.spreadsheets.values.append({
    spreadsheetId,
    range: `${month}!A:E`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[row.date, row.amount, row.category, row.memo, row.method]],
    },
  });
}

export async function readExpenseRows(
  accessToken: string,
  spreadsheetId: string,
  month: string
): Promise<ExpenseRow[]> {
  const auth = authClient(accessToken);
  const sheetsApi = google.sheets({ version: 'v4', auth });

  const result = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${month}!A2:E`,
  });

  const values = result.data.values ?? [];
  return values.map((row) => ({
    date: String(row[0] ?? ''),
    amount: Number(row[1] ?? 0),
    category: String(row[2] ?? ''),
    memo: String(row[3] ?? ''),
    method: String(row[4] ?? ''),
  }));
}

export async function listAvailableMonths(
  accessToken: string,
  spreadsheetId: string
): Promise<string[]> {
  const auth = authClient(accessToken);
  const sheetsApi = google.sheets({ version: 'v4', auth });

  const sheets = await listSheets(sheetsApi, spreadsheetId);
  return sheets
    .map((sheet) => sheet.title)
    .filter((title) => MONTH_SHEET_TITLE_PATTERN.test(title))
    .sort()
    .reverse();
}

export async function findOrCreateSpreadsheet(
  accessToken: string,
  folderId?: string,
  fileName: string = DEFAULT_FILE_NAME
): Promise<string> {
  const auth = authClient(accessToken);
  const drive = google.drive({ version: 'v3', auth });

  const folderClause = folderId ? ` and '${folderId}' in parents` : '';
  const existing = await drive.files.list({
    q: `name='${escapeForDriveQuery(fileName)}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false${folderClause}`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  const found = existing.data.files?.[0];
  if (found?.id) {
    await migrateLegacySheetIfPresent(accessToken, found.id);
    return found.id;
  }

  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      ...(folderId ? { parents: [folderId] } : {}),
    },
    fields: 'id',
  });

  if (!created.data.id) throw new Error('Failed to create spreadsheet');
  return created.data.id;
}

async function readLegacyRows(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string
): Promise<ExpenseRow[]> {
  const auth = authClient(accessToken);
  const sheetsApi = google.sheets({ version: 'v4', auth });

  const result = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetTitle}!A:E`,
  });

  const values = result.data.values ?? [];
  return values.map((row) => ({
    date: String(row[0] ?? ''),
    amount: Number(row[1] ?? 0),
    category: String(row[2] ?? ''),
    memo: String(row[3] ?? ''),
    method: String(row[4] ?? ''),
  }));
}

async function migrateLegacySheetIfPresent(
  accessToken: string,
  spreadsheetId: string
): Promise<void> {
  const auth = authClient(accessToken);
  const sheetsApi = google.sheets({ version: 'v4', auth });

  const sheets = await listSheets(sheetsApi, spreadsheetId);
  const legacy = sheets.find(
    (sheet) => sheet.sheetId === 0 && !MONTH_SHEET_TITLE_PATTERN.test(sheet.title)
  );
  if (!legacy) return;

  const legacyRows = await readLegacyRows(accessToken, spreadsheetId, legacy.title);
  // A spreadsheet always needs at least one sheet, so an empty legacy sheet is left
  // in place rather than deleted (there would be nothing to replace it with).
  if (legacyRows.length === 0) return;

  const byMonth = new Map<string, ExpenseRow[]>();
  for (const row of legacyRows) {
    const month = row.date.slice(0, 7);
    const rows = byMonth.get(month) ?? [];
    rows.push(row);
    byMonth.set(month, rows);
  }

  // Copying rows and deleting the legacy sheet isn't one atomic operation, so a
  // request that fails partway through must be safe to retry: skip rows a prior,
  // interrupted attempt already copied into their target month sheet.
  for (const [month, rows] of byMonth) {
    await ensureMonthSheet(accessToken, spreadsheetId, month);

    const alreadyMigrated = new Set(
      (await readExpenseRows(accessToken, spreadsheetId, month)).map(rowKey)
    );
    const rowsToAppend = rows.filter((row) => !alreadyMigrated.has(rowKey(row)));
    if (rowsToAppend.length === 0) continue;

    await sheetsApi.spreadsheets.values.append({
      spreadsheetId,
      range: `${month}!A:E`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: rowsToAppend.map((row) => [row.date, row.amount, row.category, row.memo, row.method]),
      },
    });
  }

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ deleteSheet: { sheetId: legacy.sheetId } }] },
  });
}

export async function renameSpreadsheetFile(
  accessToken: string,
  spreadsheetId: string,
  newName: string
): Promise<void> {
  const auth = authClient(accessToken);
  const drive = google.drive({ version: 'v3', auth });

  await drive.files.update({
    fileId: spreadsheetId,
    requestBody: { name: newName },
  });
}
