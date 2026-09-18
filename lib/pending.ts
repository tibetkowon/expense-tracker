import { google } from 'googleapis';

export const PENDING_SHEET_TITLE = '대기';

export type PendingRow = {
  date: string;
  amount: number;
  category: string;
  memo: string;
  method: string;
  type: '결제' | '취소';
  rawText: string;
};
export type PendingRowWithNumber = PendingRow & { rowNumber: number };

const HEADER_ROW = ['날짜', '금액', '카테고리', '메모', '결제수단', '유형', '원문'];

function authClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

async function findPendingSheet(
  sheetsApi: ReturnType<typeof google.sheets>,
  spreadsheetId: string
) {
  const result = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });
  return (result.data.sheets ?? []).find(
    (sheet) => sheet.properties?.title === PENDING_SHEET_TITLE
  );
}

async function ensurePendingSheet(
  sheetsApi: ReturnType<typeof google.sheets>,
  spreadsheetId: string
): Promise<void> {
  if (!await findPendingSheet(sheetsApi, spreadsheetId)) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: PENDING_SHEET_TITLE } } }],
      },
    });
  }

  // 탭 생성 후 헤더 쓰기가 실패해도 다음 요청에서 복구합니다.
  const header = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${PENDING_SHEET_TITLE}!A1:G1`,
  });
  if ((header.data.values ?? []).length > 0) return;

  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `${PENDING_SHEET_TITLE}!A1:G1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADER_ROW] },
  });
}

export async function readPendingRows(
  accessToken: string,
  spreadsheetId: string
): Promise<PendingRowWithNumber[]> {
  const sheetsApi = google.sheets({ version: 'v4', auth: authClient(accessToken) });
  if (!await findPendingSheet(sheetsApi, spreadsheetId)) return [];

  const result = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${PENDING_SHEET_TITLE}!A2:G`,
  });
  return (result.data.values ?? []).map((row, index) => ({
    rowNumber: index + 2,
    date: String(row[0] ?? ''),
    amount: Number(row[1] ?? 0),
    category: String(row[2] ?? ''),
    memo: String(row[3] ?? ''),
    method: String(row[4] ?? ''),
    type: row[5] === '취소' ? '취소' : '결제',
    rawText: String(row[6] ?? ''),
  }));
}

export async function deletePendingRow(
  accessToken: string,
  spreadsheetId: string,
  rowNumber: number
): Promise<void> {
  const sheetsApi = google.sheets({ version: 'v4', auth: authClient(accessToken) });
  const sheet = await findPendingSheet(sheetsApi, spreadsheetId);
  if (!sheet) throw new Error('대기 시트를 찾을 수 없습니다');

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: sheet.properties!.sheetId!,
            dimension: 'ROWS',
            startIndex: rowNumber - 1,
            endIndex: rowNumber,
          },
        },
      }],
    },
  });
}

export async function appendPendingRow(
  auth: InstanceType<typeof google.auth.JWT>,
  spreadsheetId: string,
  row: PendingRow
): Promise<{ added: boolean }> {
  const sheetsApi = google.sheets({ version: 'v4', auth });
  await ensurePendingSheet(sheetsApi, spreadsheetId);

  const existing = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${PENDING_SHEET_TITLE}!G2:G`,
  });
  if ((existing.data.values ?? []).some((value) => value[0] === row.rawText)) {
    return { added: false };
  }

  await sheetsApi.spreadsheets.values.append({
    spreadsheetId,
    range: `${PENDING_SHEET_TITLE}!A:G`,
    // 날짜와 원문을 수식이나 숫자로 해석하지 않고 그대로 보존합니다.
    valueInputOption: 'RAW',
    requestBody: {
      values: [[row.date, row.amount, row.category, row.memo, row.method, row.type, row.rawText]],
    },
  });
  return { added: true };
}
