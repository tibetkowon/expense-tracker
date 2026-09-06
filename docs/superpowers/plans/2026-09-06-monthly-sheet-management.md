# 월별 시트 관리 (Monthly Sheet Management) Implementation Plan

> **For agentic workers:** Application code in this repo is implemented by Codex via the `codex-auto` skill (see project `CLAUDE.md` — "Development workflow: Claude Code + Codex"). Do NOT use `superpowers:subagent-driven-development` or `superpowers:executing-plans` in this repo. Steps use checkbox (`- [ ]`) syntax for tracking regardless of executor.

**Goal:** Replace the single flat `Sheet1` (no header, fixed file name) with one spreadsheet file containing per-month sheet tabs (`YYYY-MM`, header row included), a user-settable file name, and month-aware read/write APIs + UI.

**Architecture:** `lib/sheets.ts` gains month-scoped primitives (`ensureMonthSheet`, `listAvailableMonths`) and updated `appendExpenseRow`/`readExpenseRows` signatures that take a `month` argument; `findOrCreateSpreadsheet` gains a `fileName` parameter and a one-time legacy-data migration. `app/api/expenses/route.ts` exposes `month`/`fileName` in the GET/POST contract. The dashboard UI adds a month selector and a file-name setting, both following the existing `localStorage`-backed client-state pattern (`folderStorage.ts`).

**Tech Stack:** Next.js App Router + TypeScript, `googleapis` (Sheets/Drive v4/v3), Vitest for `lib/*.ts` unit tests (this repo does not unit-test API routes or components — see "Testing scope" below).

**Spec:** `docs/superpowers/specs/2026-09-06-monthly-sheet-management-design.md`

## Global Constraints

- File count stays at 1 spreadsheet per user; only sheet *tabs* are split by month (spec §2).
- Month sheet tab title format is exactly `YYYY-MM` (spec §2).
- Header row is exactly `날짜 | 금액 | 카테고리 | 메모 | 결제수단`, row 1 of every month sheet (spec §2).
- File name defaults to `expense-tracker`, user-editable, stored client-side only (spec §2, matches existing `folderId` pattern — no server DB).
- Legacy `Sheet1` migration is automatic, one-time, and idempotent; the legacy tab is deleted only after its rows are copied into month sheets (spec §3).
- `GET /api/expenses` must never create a new **month sheet** as a side effect of viewing a month with no data (only `POST` creates month sheets, via `ensureMonthSheet`). File-level find-or-create and the one-time legacy migration are fine on both `GET` and `POST` — this matches the pre-existing app behavior (the original `GET` handler already lazily created the spreadsheet file), so it is not a new side effect being introduced.
- Changing the file name (Task 7) must **rename the existing spreadsheet file** via the Drive API, never search-by-new-name-and-create — that would silently produce a second file and violate the "1 file" constraint above.
- Do not implement edit/delete (feedback item 1) or touch `FolderPicker`'s Google Picker rendering, the payment-method `<select>` styling, or the PWA manifest — out of scope (spec §6).
- OAuth scope stays `drive.file` + `spreadsheets` (project `CLAUDE.md` constraint) — no new Google API calls beyond Sheets/Drive v3/v4 already in use.
- For any Next.js compilation check, prefer `next build --webpack` if the normal build is blocked by sandbox restrictions (project `CLAUDE.md` — Codex environment constraints).

## Testing scope

This repo unit-tests `lib/*.ts` modules only (mocked `googleapis`, see `lib/sheets.test.ts`) and has a placeholder sanity test for `app/page.tsx`; there are no route-handler or component-level tests anywhere in the repo. Tasks that touch `lib/sheets.ts` and `lib/fileNameStorage.ts` follow full TDD (write failing test → implement → pass). Tasks that touch `app/api/expenses/route.ts` or components are verified with `npm run build` (type-check) — matching existing project convention, not introducing a new test layer unilaterally.

**Live verification note:** Codex's sandbox has no network access, so it cannot exercise real Google Sheets/Drive calls (project `CLAUDE.md` — Codex environment constraints). Once Codex reports all tasks below as PASS, the supervising Claude Code session must manually verify the actual flow (create a fresh file, add an expense, switch months, rename the file, and — if possible with a test account that still has legacy `Sheet1` data — confirm migration) against a real Google account before this is considered done.

---

### Task 1: `lib/fileNameStorage.ts` — client-side file name storage

**Files:**
- Create: `lib/fileNameStorage.ts`
- Test: `lib/fileNameStorage.test.ts`

**Interfaces:**
- Produces: `DEFAULT_FILE_NAME: string`, `getSavedFileName(): string`, `saveFileName(name: string): void` — consumed by Task 3 (`lib/sheets.ts`), Task 7 (`components/FileNameSetting.tsx`), Task 8 (`components/ExpenseForm.tsx`), Task 9 (`components/ExpenseDashboard.tsx`).

- [ ] **Step 1: Write the failing test**

```ts
// lib/fileNameStorage.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_FILE_NAME, getSavedFileName, saveFileName } from './fileNameStorage';

describe('fileNameStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns the default file name when nothing is saved', () => {
    expect(getSavedFileName()).toBe(DEFAULT_FILE_NAME);
  });

  it('returns a previously saved file name', () => {
    saveFileName('가계부');
    expect(getSavedFileName()).toBe('가계부');
  });

  it('overwrites a previously saved file name', () => {
    saveFileName('가계부');
    saveFileName('2026 지출');
    expect(getSavedFileName()).toBe('2026 지출');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/fileNameStorage.test.ts`
Expected: FAIL — `Cannot find module './fileNameStorage'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/fileNameStorage.ts
const STORAGE_KEY = 'expense-tracker:fileName';

export const DEFAULT_FILE_NAME = 'expense-tracker';

export function getSavedFileName(): string {
  if (typeof window === 'undefined') return DEFAULT_FILE_NAME;
  return window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_FILE_NAME;
}

export function saveFileName(name: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, name);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/fileNameStorage.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/fileNameStorage.ts lib/fileNameStorage.test.ts
git commit -m "feat: add client-side file name storage"
```

---

### Task 2: `lib/sheets.ts` — month-scoped sheet primitives

**Files:**
- Modify: `lib/sheets.ts` (add `ensureMonthSheet`, `listAvailableMonths`; change `appendExpenseRow`/`readExpenseRows` signatures to take a `month` argument)
- Modify: `lib/sheets.test.ts` (update existing `appendExpenseRow`/`readExpenseRows` tests for the new signature; add tests for `ensureMonthSheet`/`listAvailableMonths`)

**Interfaces:**
- Consumes: nothing new (still only `googleapis`).
- Produces: `ensureMonthSheet(accessToken, spreadsheetId, month): Promise<void>`, `appendExpenseRow(accessToken, spreadsheetId, month, row): Promise<void>`, `readExpenseRows(accessToken, spreadsheetId, month): Promise<ExpenseRow[]>`, `listAvailableMonths(accessToken, spreadsheetId): Promise<string[]>` — consumed by Task 3 (migration) and Task 4 (API route).

- [ ] **Step 1: Write the failing tests**

Replace the `appendExpenseRow` and `readExpenseRows` describe blocks in `lib/sheets.test.ts`, and add new ones, so the file's mock and relevant sections read:

```ts
// lib/sheets.test.ts — mock setup (add spreadsheets.get for sheet metadata)
vi.mock('googleapis', () => {
  const files = {
    list: vi.fn(),
    create: vi.fn(),
  };
  const spreadsheets = {
    get: vi.fn(),
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
```

```ts
// lib/sheets.test.ts — replace the existing appendExpenseRow describe block
describe('ensureMonthSheet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does nothing when a sheet with that month title already exists', async () => {
    (google.sheets as any)().spreadsheets.get.mockResolvedValue({
      data: { sheets: [{ properties: { sheetId: 0, title: '2026-09' } }] },
    });

    await ensureMonthSheet('token', 'sheet-id', '2026-09');

    expect((google.sheets as any)().spreadsheets.batchUpdate).not.toHaveBeenCalled();
  });

  it('creates the sheet with a header row when it does not exist', async () => {
    (google.sheets as any)().spreadsheets.get.mockResolvedValue({
      data: { sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }] },
    });

    await ensureMonthSheet('token', 'sheet-id', '2026-09');

    expect((google.sheets as any)().spreadsheets.batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      requestBody: { requests: [{ addSheet: { properties: { title: '2026-09' } } }] },
    });
    expect((google.sheets as any)().spreadsheets.values.append).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      range: '2026-09!A:E',
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
      { date: '2026-09-01', amount: 12000, category: '식비', memo: '점심', method: '카드' },
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
```

And update the import line at the top of the test file:

```ts
import {
  findOrCreateSpreadsheet,
  ensureMonthSheet,
  appendExpenseRow,
  readExpenseRows,
  listAvailableMonths,
} from './sheets';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/sheets.test.ts`
Expected: FAIL — `ensureMonthSheet`/`listAvailableMonths` not exported, and the updated `appendExpenseRow`/`readExpenseRows` call-shape assertions fail against the old 2-argument signature.

- [ ] **Step 3: Write minimal implementation**

In `lib/sheets.ts`, add a `SheetInfo` type and `listSheets` helper above `findOrCreateSpreadsheet`, and replace `appendExpenseRow`/`readExpenseRows` with month-aware versions, adding `ensureMonthSheet` and `listAvailableMonths`:

```ts
const HEADER_ROW = ['날짜', '금액', '카테고리', '메모', '결제수단'];
const MONTH_SHEET_TITLE_PATTERN = /^\d{4}-\d{2}$/;

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
  if (sheets.some((sheet) => sheet.title === month)) return;

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: month } } }] },
  });

  await sheetsApi.spreadsheets.values.append({
    spreadsheetId,
    range: `${month}!A:E`,
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
```

Leave `findOrCreateSpreadsheet` and `renameFirstSheet` untouched in this task — Task 3 replaces them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/sheets.test.ts`
Expected: PASS for the new/updated `ensureMonthSheet`, `appendExpenseRow`, `readExpenseRows`, `listAvailableMonths` blocks. The pre-existing `findOrCreateSpreadsheet` tests still pass unchanged since that function is untouched in this task.

- [ ] **Step 5: Commit**

```bash
git add lib/sheets.ts lib/sheets.test.ts
git commit -m "feat: add month-scoped sheet read/write primitives"
```

---

### Task 3: `lib/sheets.ts` — custom file name + legacy migration

**Files:**
- Modify: `lib/sheets.ts` (`findOrCreateSpreadsheet` gains a `fileName` parameter; remove `renameFirstSheet`; add `migrateLegacySheetIfPresent` and `readLegacyRows`)
- Modify: `lib/sheets.test.ts` (update `findOrCreateSpreadsheet` tests: drop the `renameFirstSheet`/`batchUpdate` rename assertions, add file-name and migration tests)

**Interfaces:**
- Consumes: `ensureMonthSheet`, `appendExpenseRow`, `listSheets` (from Task 2, same file).
- Produces: `findOrCreateSpreadsheet(accessToken, folderId?, fileName?): Promise<string>` (new 3rd parameter, defaults to `DEFAULT_FILE_NAME` from `lib/fileNameStorage.ts`) — consumed by Task 4 (`app/api/expenses/route.ts`).

- [ ] **Step 1: Write the failing tests**

Replace the two `describe('findOrCreateSpreadsheet', ...)` blocks in `lib/sheets.test.ts` (the ones asserting `renameFirstSheet`'s `batchUpdate` call) with:

```ts
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
    (google.sheets as any)().spreadsheets.values.get.mockResolvedValue({
      data: {
        values: [
          ['2026-08-30', '5000', '식비', '점심', '카드'],
          ['2026-09-01', '12000', '카페', '커피', '카드'],
        ],
      },
    });

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
    expect((google.sheets as any)().spreadsheets.batchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: { requests: [{ deleteSheet: { sheetId: 0 } }] },
      })
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/sheets.test.ts`
Expected: FAIL — `findOrCreateSpreadsheet` still calls the old `renameFirstSheet` unconditionally (extra `batchUpdate` call the new tests don't expect), doesn't accept a 3rd `fileName` argument, and never calls `spreadsheets.get`/`values.get` for migration.

- [ ] **Step 3: Write minimal implementation**

In `lib/fileNameStorage.ts` there is already `DEFAULT_FILE_NAME`. Import it into `lib/sheets.ts`:

```ts
import { google } from 'googleapis';
import { DEFAULT_FILE_NAME } from './fileNameStorage';
```

Delete the `renameFirstSheet` function and the `FILE_NAME`/`SHEET_RANGE` constants entirely, then replace `findOrCreateSpreadsheet` with:

```ts
export async function findOrCreateSpreadsheet(
  accessToken: string,
  folderId?: string,
  fileName: string = DEFAULT_FILE_NAME
): Promise<string> {
  const auth = authClient(accessToken);
  const drive = google.drive({ version: 'v3', auth });

  const folderClause = folderId ? ` and '${folderId}' in parents` : '';
  const existing = await drive.files.list({
    q: `name='${fileName}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false${folderClause}`,
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

  for (const [month, rows] of byMonth) {
    for (const row of rows) {
      await appendExpenseRow(accessToken, spreadsheetId, month, row);
    }
  }

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ deleteSheet: { sheetId: legacy.sheetId } }] },
  });
}
```

`migrateLegacySheetIfPresent` and `readLegacyRows` are not exported — they're only reached through `findOrCreateSpreadsheet`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/sheets.test.ts`
Expected: PASS — full file (all describe blocks from Task 2 and Task 3) green.

- [ ] **Step 5: Commit**

```bash
git add lib/sheets.ts lib/sheets.test.ts
git commit -m "feat: support custom file name and migrate legacy Sheet1 data"
```

---

### Task 4: `app/api/expenses/route.ts` — month/fileName-aware API

**Files:**
- Modify: `app/api/expenses/route.ts`

**Interfaces:**
- Consumes: `findOrCreateSpreadsheet(accessToken, folderId?, fileName?)`, `appendExpenseRow(accessToken, spreadsheetId, month, row)`, `readExpenseRows(accessToken, spreadsheetId, month)`, `listAvailableMonths(accessToken, spreadsheetId)` (all from Task 2/3).
- Produces: `GET` response shape `{ expenses: ExpenseRow[], monthlyTotal: number, availableMonths: string[], selectedMonth: string }` — consumed by Task 9 (`ExpenseDashboard`). `POST` response shape stays `{ ok: true }`; the client already knows which month it wrote (Task 8 derives it from the submitted `date`), so the server doesn't need to echo it back.

- [ ] **Step 1: Replace the route file**

```ts
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { validateExpenseInput } from '@/lib/expense';
import {
  findOrCreateSpreadsheet,
  appendExpenseRow,
  readExpenseRows,
  listAvailableMonths,
} from '@/lib/sheets';
import { summarizeByMonth } from '@/lib/summary';

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const url = new URL(request.url);
  const folderId = url.searchParams.get('folderId') ?? undefined;
  const fileName = url.searchParams.get('fileName') ?? undefined;
  const requestedMonth = url.searchParams.get('month') ?? undefined;

  const spreadsheetId = await findOrCreateSpreadsheet(session.accessToken, folderId, fileName);
  const availableMonths = await listAvailableMonths(session.accessToken, spreadsheetId);

  const thisMonth = currentMonth();
  const selectedMonth =
    (requestedMonth && availableMonths.includes(requestedMonth) && requestedMonth) ||
    (availableMonths.includes(thisMonth) && thisMonth) ||
    availableMonths[0] ||
    thisMonth;

  const expenses = availableMonths.includes(selectedMonth)
    ? await readExpenseRows(session.accessToken, spreadsheetId, selectedMonth)
    : [];
  const { total } = summarizeByMonth(expenses, selectedMonth);

  return NextResponse.json({
    expenses: expenses.reverse(),
    monthlyTotal: total,
    availableMonths,
    selectedMonth,
  });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const body = await request.json();
  const { folderId, fileName, ...expenseInput } = body;
  const expense = validateExpenseInput(expenseInput);

  const spreadsheetId = await findOrCreateSpreadsheet(
    session.accessToken,
    folderId ?? undefined,
    fileName ?? undefined
  );
  const month = expense.date.slice(0, 7);
  await appendExpenseRow(session.accessToken, spreadsheetId, month, expense);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Type-check**

Run: `next build --webpack` (per project `CLAUDE.md` — use this form if the sandboxed environment blocks the default Turbopack build)
Expected: build succeeds with no type errors in `app/api/expenses/route.ts`. (The supervising Claude Code session still owes this route a live end-to-end check per "Testing scope" above — Codex cannot reach the network to exercise it.)

- [ ] **Step 3: Commit**

```bash
git add app/api/expenses/route.ts
git commit -m "feat: add month and fileName support to expenses API"
```

---

### Task 5: `components/MonthlySummary.tsx` — accept a `month` prop

**Files:**
- Modify: `components/MonthlySummary.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `MonthlySummary({ total, month }: { total: number; month: string })` where `month` is `YYYY-MM` — consumed by Task 9 (`ExpenseDashboard`).

- [ ] **Step 1: Replace the component**

```tsx
export default function MonthlySummary({ total, month }: { total: number; month: string }) {
  const [year, monthNumber] = month.split('-');

  return (
    <section className="border-b border-gray-100 px-5 py-7">
      <div className="mb-1 text-[12px] text-gray-400">
        {year}년 {Number(monthNumber)}월 총 지출
      </div>
      <div className="text-[38px] font-bold tracking-tight text-gray-900">
        {total.toLocaleString('ko-KR')}원
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `next build --webpack`
Expected: fails at this point only because `ExpenseDashboard` (Task 9, not yet updated) still calls `<MonthlySummary total={...} />` without `month`. That's expected until Task 9 lands — do not fix `ExpenseDashboard` here.

- [ ] **Step 3: Commit**

```bash
git add components/MonthlySummary.tsx
git commit -m "feat: MonthlySummary displays the selected month, not just today"
```

---

### Task 6: `components/MonthSelector.tsx` — new month picker

**Files:**
- Create: `components/MonthSelector.tsx`

**Interfaces:**
- Produces: `MonthSelector({ months, selected, onChange }: { months: string[]; selected: string; onChange: (month: string) => void })` — consumed by Task 9 (`ExpenseDashboard`).

- [ ] **Step 1: Write the component**

```tsx
'use client';

type MonthSelectorProps = {
  months: string[];
  selected: string;
  onChange: (month: string) => void;
};

function formatMonthLabel(month: string): string {
  const [year, monthNumber] = month.split('-');
  return `${year}년 ${Number(monthNumber)}월`;
}

export default function MonthSelector({ months, selected, onChange }: MonthSelectorProps) {
  if (months.length === 0) return null;

  return (
    <select
      value={selected}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[13px] font-medium text-gray-700"
    >
      {months.map((month) => (
        <option key={month} value={month}>
          {formatMonthLabel(month)}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `next build --webpack`
Expected: succeeds (this component isn't wired into any page yet, but it's self-contained and type-checks on its own).

- [ ] **Step 3: Commit**

```bash
git add components/MonthSelector.tsx
git commit -m "feat: add MonthSelector component"
```

---

### Task 7: File rename endpoint + `components/FileNameSetting.tsx` + wire into `FolderPickerSection`

Changing the file name must rename the *existing* spreadsheet file (Drive API), not search for a file under the new name and create one when it's not found — that would silently leave two files behind, breaking the "1 file" constraint (spec §2, Global Constraints above).

**Files:**
- Modify: `lib/sheets.ts` (add `renameSpreadsheetFile`)
- Modify: `lib/sheets.test.ts` (test `renameSpreadsheetFile`)
- Create: `app/api/file-name/route.ts`
- Create: `components/FileNameSetting.tsx`
- Modify: `components/FolderPicker.tsx` (render `<FileNameSetting />` inside `FolderPickerSection`, per spec §7 — same section as the folder picker)

**Interfaces:**
- Consumes: `findOrCreateSpreadsheet` (Task 3), `DEFAULT_FILE_NAME`, `getSavedFileName`, `saveFileName` (Task 1), `getSavedFolderId` (existing `lib/folderStorage.ts`).
- Produces: `renameSpreadsheetFile(accessToken, spreadsheetId, newName): Promise<void>` (`lib/sheets.ts`); `POST /api/file-name` accepting `{ folderId?, currentFileName, newFileName }`, returning `{ ok: true }` or a 4xx with `{ error }`; `FileNameSetting()` — a self-contained client component, no props.

- [ ] **Step 1: Write the failing test for `renameSpreadsheetFile`**

Add to `lib/sheets.test.ts`:

```ts
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
```

Add `update: vi.fn()` to the `files` object in the `vi.mock('googleapis', ...)` block at the top of the test file (alongside the existing `list`/`create`), and add `renameSpreadsheetFile` to the import line.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/sheets.test.ts`
Expected: FAIL — `renameSpreadsheetFile is not a function`

- [ ] **Step 3: Implement `renameSpreadsheetFile`**

Add to `lib/sheets.ts`, near `findOrCreateSpreadsheet`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/sheets.test.ts`
Expected: PASS — full file green, including the new `renameSpreadsheetFile` block.

- [ ] **Step 5: Commit**

```bash
git add lib/sheets.ts lib/sheets.test.ts
git commit -m "feat: add renameSpreadsheetFile"
```

- [ ] **Step 6: Write the rename API route**

```ts
// app/api/file-name/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findOrCreateSpreadsheet, renameSpreadsheetFile } from '@/lib/sheets';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const body = await request.json();
  const { folderId, currentFileName, newFileName } = body;

  if (typeof newFileName !== 'string' || newFileName.trim() === '') {
    return NextResponse.json({ error: 'newFileName is required' }, { status: 400 });
  }

  const spreadsheetId = await findOrCreateSpreadsheet(
    session.accessToken,
    folderId ?? undefined,
    currentFileName ?? undefined
  );
  await renameSpreadsheetFile(session.accessToken, spreadsheetId, newFileName.trim());

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 7: Type-check**

Run: `next build --webpack`
Expected: succeeds.

- [ ] **Step 8: Commit**

```bash
git add app/api/file-name/route.ts
git commit -m "feat: add file rename API route"
```

- [ ] **Step 9: Write `FileNameSetting`**

```tsx
// components/FileNameSetting.tsx
'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_FILE_NAME, getSavedFileName, saveFileName } from '@/lib/fileNameStorage';
import { getSavedFolderId } from '@/lib/folderStorage';

export default function FileNameSetting() {
  const [fileName, setFileName] = useState(DEFAULT_FILE_NAME);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(DEFAULT_FILE_NAME);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = getSavedFileName();
    setFileName(saved);
    setDraft(saved);
  }, []);

  async function commit() {
    const next = draft.trim() || DEFAULT_FILE_NAME;

    if (next === fileName) {
      setEditing(false);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const folderId = getSavedFolderId();
      const response = await fetch('/api/file-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId, currentFileName: fileName, newFileName: next }),
      });

      if (!response.ok) throw new Error('파일명 변경에 실패했습니다.');

      saveFileName(next);
      setFileName(next);
      setDraft(next);
      setEditing(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '파일명 변경에 실패했습니다.');
      setDraft(fileName);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <input
          autoFocus
          disabled={saving}
          className="border-b border-indigo-500 bg-transparent text-[14px] font-medium text-gray-800 outline-none disabled:opacity-60"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
          }}
        />
        {error ? <span className="text-[11px] text-red-500">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] text-gray-400">파일명</span>
        <span className="text-[14px] font-medium text-gray-800">{fileName}</span>
      </div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-[13px] font-semibold text-indigo-600"
      >
        변경
      </button>
    </div>
  );
}
```

- [ ] **Step 10: Wire it into `FolderPickerSection`**

In `components/FolderPicker.tsx`, add the import:

```ts
import FileNameSetting from '@/components/FileNameSetting';
```

And add `<FileNameSetting />` as a second row inside the existing wrapping `<div className="border-b border-gray-100 px-5 py-4">` in `FolderPickerSection`, directly below the existing folder-picker `<div className="flex items-center justify-between">...</div>` block (same file, so this becomes two stacked rows under the one "저장 위치" section):

```tsx
export function FolderPickerSection({ accessToken, apiKey }: Omit<FolderPickerProps, 'onPicked'>) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);

  useEffect(() => {
    setFolderId(getSavedFolderId());
    setFolderName(window.localStorage.getItem(FOLDER_NAME_STORAGE_KEY));
  }, []);

  return (
    <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] text-gray-400">저장 위치</span>
          <span className="text-[14px] font-medium text-gray-800">
            {folderName ?? (folderId ? `저장된 Drive 폴더 (${folderId})` : 'Drive 루트')}
          </span>
        </div>
        <FolderPicker
          accessToken={accessToken}
          apiKey={apiKey}
          onPicked={(id, name) => {
            saveFolderId(id);
            window.localStorage.setItem(FOLDER_NAME_STORAGE_KEY, name);
            setFolderId(id);
            setFolderName(name);
          }}
        />
      </div>
      <FileNameSetting />
    </div>
  );
}
```

(Note the outer `<div>`'s className changes from `"border-b border-gray-100 px-5 py-4"` to `"flex flex-col gap-3 border-b border-gray-100 px-5 py-4"` to stack the two rows with spacing.)

- [ ] **Step 11: Type-check**

Run: `next build --webpack`
Expected: succeeds.

- [ ] **Step 12: Commit**

```bash
git add components/FileNameSetting.tsx components/FolderPicker.tsx
git commit -m "feat: add file name setting to the storage location section"
```

---

### Task 8: `components/ExpenseForm.tsx` — send `fileName`, report saved month

**Files:**
- Modify: `components/ExpenseForm.tsx`

**Interfaces:**
- Consumes: `getSavedFileName` (Task 1).
- Produces: `ExpenseForm`'s `onSubmitted` prop changes from `() => void` to `(month: string) => void` — consumed by Task 9 (`ExpenseDashboard`).

- [ ] **Step 1: Update the component**

Change the prop type:

```ts
type ExpenseFormProps = {
  onSubmitted: (month: string) => void;
  onSuccess?: (message: string) => void;
  initialValues?: Partial<ExpenseInput>;
};
```

Add the import:

```ts
import { getSavedFileName } from '@/lib/fileNameStorage';
```

Update `handleSubmit`:

```ts
async function handleSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  setError(null);
  setSubmitting(true);

  try {
    const folderId = getSavedFolderId();
    const fileName = getSavedFileName();
    const response = await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, amount: Number(amount), category, memo, method, folderId, fileName }),
    });

    if (!response.ok) throw new Error('지출 저장에 실패했습니다.');

    onSubmitted(date.slice(0, 7));
    onSuccess?.('저장했습니다');
  } catch (caughtError) {
    setError(caughtError instanceof Error ? caughtError.message : '지출 저장에 실패했습니다.');
  } finally {
    setSubmitting(false);
  }
}
```

- [ ] **Step 2: Type-check**

Run: `next build --webpack`
Expected: fails at this point only because `ExpenseDashboard` (Task 9, not yet updated) still passes `onSubmitted={() => void refetch()}`, a `0`-argument function, to a prop now typed `(month: string) => void`. That's expected — a `0`-arg function is assignable where a `1`-arg callback is expected in TypeScript's function parameter bivariance, so this actually still compiles. Confirm the build has no *new* errors beyond what Task 9 will address.

- [ ] **Step 3: Commit**

```bash
git add components/ExpenseForm.tsx
git commit -m "feat: send fileName with new expenses, report the saved month"
```

---

### Task 9: `components/ExpenseDashboard.tsx` — wire month selection end to end

**Files:**
- Modify: `components/ExpenseDashboard.tsx`

**Interfaces:**
- Consumes: `MonthSelector` (Task 6), `MonthlySummary({ total, month })` (Task 5), `ExpenseForm`'s `onSubmitted(month)` (Task 8), `getSavedFileName` (Task 1), API response shape `{ expenses, monthlyTotal, availableMonths, selectedMonth }` (Task 4).

- [ ] **Step 1: Replace the component**

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExpenseRow } from '@/lib/sheets';
import { getSavedFolderId } from '@/lib/folderStorage';
import { getSavedFileName } from '@/lib/fileNameStorage';
import ExpenseForm from '@/components/ExpenseForm';
import ExpenseList from '@/components/ExpenseList';
import MonthlySummary from '@/components/MonthlySummary';
import MonthSelector from '@/components/MonthSelector';
import Toast from '@/components/Toast';

type ExpensesResponse = {
  expenses: ExpenseRow[];
  monthlyTotal: number;
  availableMonths: string[];
  selectedMonth: string;
};

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function ExpenseDashboard() {
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchMonth = useCallback(async (month?: string) => {
    const folderId = getSavedFolderId();
    const fileName = getSavedFileName();
    const params = new URLSearchParams();
    if (folderId) params.set('folderId', folderId);
    params.set('fileName', fileName);
    if (month) params.set('month', month);

    const response = await fetch(`/api/expenses?${params.toString()}`);
    if (!response.ok) return;

    const data = (await response.json()) as ExpensesResponse;
    setExpenses(data.expenses);
    setMonthlyTotal(data.monthlyTotal);
    setAvailableMonths(data.availableMonths);
    setSelectedMonth(data.selectedMonth);
  }, []);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(null), 1800);
  }, []);

  useEffect(() => { void fetchMonth(); }, [fetchMonth]);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  return (
    <>
      <div className="flex items-center justify-between px-5 pt-4">
        <MonthSelector
          months={availableMonths}
          selected={selectedMonth}
          onChange={(month) => void fetchMonth(month)}
        />
      </div>
      <MonthlySummary total={monthlyTotal} month={selectedMonth} />
      <section className="border-b border-gray-100 px-5 py-6">
        <h2 className="mb-4 text-[13px] font-semibold text-gray-800">지출 입력</h2>
        <ExpenseForm onSubmitted={(month) => void fetchMonth(month)} onSuccess={showToast} />
      </section>
      <ExpenseList expenses={expenses} />
      <Toast message={toastMessage} />
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `next build --webpack`
Expected: succeeds with no type errors anywhere in `components/` or `app/`.

- [ ] **Step 3: Commit**

```bash
git add components/ExpenseDashboard.tsx
git commit -m "feat: wire month selection through the dashboard"
```

---

## Post-implementation

- [ ] Run the full unit test suite: `npx vitest run` — expect all `lib/*.test.ts` files green, including the untouched `lib/expense.test.ts`, `lib/folderStorage.test.ts`, `lib/ocr.test.ts`, `lib/summary.test.ts`, `lib/token.test.ts`.
- [ ] Run `next build --webpack` once more from a clean state to confirm the whole app compiles.
- [ ] **Supervising Claude Code session only** (Codex cannot do this — no network access): sign in with a real Google account, exercise the flow end-to-end — add an expense, confirm it lands in a `YYYY-MM` sheet tab with a header row, switch months via the selector, rename the file via the new setting and confirm it takes effect, and if a test account with legacy `Sheet1` data is available, confirm migration runs once and `Sheet1` is removed afterward.
- [ ] Update `CLAUDE.md`'s "Recent decisions" section (per its own maintenance rule) once verification passes.
