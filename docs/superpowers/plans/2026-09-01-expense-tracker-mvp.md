# Expense Tracker MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Project-specific execution note:** Per the design doc's development workflow, tasks in this project are implemented by **Codex** (via the `codex:rescue` skill/agent), not by Claude subagents directly. Claude Code assigns each task below to Codex as a self-contained spec, Codex implements + self-reviews, Claude Code verifies the review and the task's Definition of Done before moving to the next task. See "Execution Handoff" at the end of this document.

**Goal:** Build a working personal expense tracker PWA — manual entry + receipt OCR, storing data in the user's own Google Sheet, deployable to Vercel.

**Architecture:** Next.js App Router single project. No database — Google Sheets is the only persistent store, accessed via the signed-in user's own OAuth token (never stored server-side beyond the session JWT). Gemini (via Vercel AI Gateway) extracts structured data from receipt photos. All money logic is isolated in small, pure, unit-tested functions; API routes and components are thin wrappers around them.

**Tech Stack:** Next.js (App Router, TypeScript), NextAuth (Auth.js) v5 with Google provider, `googleapis` (Sheets API v4), Vercel AI SDK (`ai` package) + AI Gateway for Gemini, Zod for validation, Vitest + Testing Library for tests, Tailwind CSS for styling.

**Spec:** `docs/superpowers/specs/2026-09-01-expense-tracker-design.md`

## Global Constraints

- No server-side database — Google Sheets is the only data store (spec §4).
- Google OAuth scope limited to `drive.file` + `spreadsheets` — never request broader Drive access (spec §4).
- OCR is "auto-draft, human confirms" — never auto-save OCR output without user confirmation (spec §3, item 2).
- Deployment (Vercel `vercel.ts`, custom domain, env var provisioning) is out of scope for this plan — it is Phase 4 in the spec and gets its own plan once the app works locally.
- Every model ID and library API used below was verified live against the AI Gateway model list and Context7 docs on 2026-09-01. If dependency versions have moved on since, re-verify per the note in Task 6 rather than trusting the snippets blindly.

---

## Task 1: Project Scaffolding + App Shell

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `tailwind.config.ts`
- Create: `app/layout.tsx`, `app/page.tsx`, `app/globals.css`
- Create: `vitest.config.ts`, `vitest.setup.ts`
- Create: `.env.local.example`, `.gitignore`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a running Next.js dev server at `/`; `npm test` and `npm run build` commands that later tasks rely on

- [x] **Step 1: Scaffold the Next.js app**

```bash
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --eslint --use-npm
```

When prompted about a non-empty directory (the `.claude/` and `docs/` folders already exist), confirm to proceed.

- [x] **Step 2: Install additional dependencies**

```bash
npm install next-auth@beta googleapis ai zod
npm install -D vitest @testing-library/react @testing-library/jest-dom @vitejs/plugin-react jsdom
```

- [x] **Step 3: Configure Vitest**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
});
```

Create `vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [x] **Step 4: Write a trivial smoke test to confirm the test runner works**

Create `app/page.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';

describe('sanity check', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [x] **Step 5: Run the test suite and the build to confirm the scaffold is sound**

Run: `npm test`
Expected: 1 passed

Run: `npm run build`
Expected: build succeeds with no type errors

- [x] **Step 6: Create `.env.local.example` documenting required env vars (filled in during Task 2 and Task 6)**

```bash
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
AUTH_SECRET=
AI_GATEWAY_API_KEY=
```

- [x] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Vitest"
```

---

## Task 2: Google Sign-In with Sheets/Drive Scopes

**Files:**
- Create: `auth.ts`
- Create: `app/api/auth/[...nextauth]/route.ts`
- Create: `lib/token.ts`, `lib/token.test.ts`
- Modify: `.env.local.example` (already has the keys from Task 1)

**Interfaces:**
- Consumes: nothing new
- Produces: `auth()`, `signIn()`, `signOut()`, `handlers` exported from `auth.ts`. `session.accessToken: string` and `session.error?: "RefreshTokenError"` available server-side via `await auth()`. `isTokenExpired(expiresAt: number): boolean` from `lib/token.ts`, used by later tasks to decide whether to prompt re-auth.

- [x] **Step 1: Write the failing test for the pure expiry-check helper**

Create `lib/token.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { isTokenExpired } from './token';

describe('isTokenExpired', () => {
  it('returns false when expiry is in the future', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const futureExpiry = Math.floor(new Date('2026-01-01T01:00:00Z').getTime() / 1000);
    expect(isTokenExpired(futureExpiry)).toBe(false);
  });

  it('returns true when expiry is in the past', () => {
    vi.setSystemTime(new Date('2026-01-01T02:00:00Z'));
    const pastExpiry = Math.floor(new Date('2026-01-01T01:00:00Z').getTime() / 1000);
    expect(isTokenExpired(pastExpiry)).toBe(true);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/token.test.ts`
Expected: FAIL — `lib/token.ts` does not exist yet

- [x] **Step 3: Implement the helper**

Create `lib/token.ts`:

```ts
export function isTokenExpired(expiresAtSeconds: number): boolean {
  return Date.now() >= expiresAtSeconds * 1000;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/token.test.ts`
Expected: PASS (2 tests)

- [x] **Step 5: Configure NextAuth with Google provider, offline access, and the Sheets/Drive scopes**

Create `auth.ts` (verified against current Auth.js docs — this is the refresh-token-rotation pattern from `authjs.dev/guides/refresh-token-rotation`, adapted with our own `isTokenExpired`):

```ts
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { isTokenExpired } from '@/lib/token';

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ');

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: {
        params: {
          access_type: 'offline',
          prompt: 'consent',
          scope: SCOPES,
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        if (!account.access_token || !account.expires_at) {
          throw new TypeError('Missing access_token or expires_at from Google');
        }
        return {
          ...token,
          access_token: account.access_token,
          expires_at: account.expires_at,
          refresh_token: account.refresh_token,
        };
      }

      if (!isTokenExpired(token.expires_at as number)) {
        return token;
      }

      if (!token.refresh_token) {
        token.error = 'RefreshTokenError';
        return token;
      }

      try {
        const response = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          body: new URLSearchParams({
            client_id: process.env.AUTH_GOOGLE_ID!,
            client_secret: process.env.AUTH_GOOGLE_SECRET!,
            grant_type: 'refresh_token',
            refresh_token: token.refresh_token as string,
          }),
        });
        const newTokens = await response.json();
        if (!response.ok) throw newTokens;

        return {
          ...token,
          access_token: newTokens.access_token,
          expires_at: Math.floor(Date.now() / 1000 + newTokens.expires_in),
          refresh_token: newTokens.refresh_token ?? token.refresh_token,
        };
      } catch (error) {
        console.error('Error refreshing access_token', error);
        token.error = 'RefreshTokenError';
        return token;
      }
    },
    async session({ session, token }) {
      session.accessToken = token.access_token as string;
      session.error = token.error as 'RefreshTokenError' | undefined;
      return session;
    },
  },
});

declare module 'next-auth' {
  interface Session {
    accessToken: string;
    error?: 'RefreshTokenError';
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    access_token: string;
    expires_at: number;
    refresh_token?: string;
    error?: 'RefreshTokenError';
  }
}
```

Create `app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from '@/auth';

export const { GET, POST } = handlers;
```

- [x] **Step 6: Wire a minimal sign-in/sign-out UI into the home page**

Modify `app/page.tsx` to call `auth()` and show a "Sign in with Google" button (using the `signIn`/`signOut` server actions) when signed out, and the user's email when signed in. This is intentionally minimal — the real dashboard UI comes in Task 5.

- [x] **Step 7: Manual verification (cannot be unit-tested — requires real Google OAuth consent)**

1. Create a Google Cloud project, OAuth consent screen (External, Testing mode, your own account as a test user), and OAuth Client ID (Web application) with redirect URI `http://localhost:3000/api/auth/callback/google`.
2. Fill `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and a random `AUTH_SECRET` (generate with `npx auth secret`) into `.env.local`.
3. Run `npm run dev`, click "Sign in with Google", confirm the consent screen lists Drive (app-created files) and Sheets access, and confirm you land back on `/` signed in.

- [x] **Step 8: Run full test suite and build**

Run: `npm test && npm run build`
Expected: all tests pass, build succeeds

- [x] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: Google sign-in with Sheets/Drive scopes and token refresh"
```

---

## Task 3: Google Sheets Client Wrapper

**Files:**
- Create: `lib/sheets.ts`, `lib/sheets.test.ts`

**Interfaces:**
- Consumes: `session.accessToken` from Task 2 (passed in by callers, not read from `auth()` directly — keeps this module framework-agnostic and testable)
- Produces:
  - `type ExpenseRow = { date: string; amount: number; category: string; memo: string; method: string }`
  - `findOrCreateSpreadsheet(accessToken: string): Promise<string>` — returns the spreadsheet ID
  - `appendExpenseRow(accessToken: string, spreadsheetId: string, row: ExpenseRow): Promise<void>`
  - `readExpenseRows(accessToken: string, spreadsheetId: string): Promise<ExpenseRow[]>`

- [x] **Step 1: Write the failing tests using a mocked `googleapis` client**

Create `lib/sheets.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { google } from 'googleapis';
import { findOrCreateSpreadsheet, appendExpenseRow, readExpenseRows } from './sheets';

vi.mock('googleapis', () => {
  const files = {
    list: vi.fn(),
    create: vi.fn(),
  };
  const spreadsheets = {
    values: {
      append: vi.fn(),
      get: vi.fn(),
    },
  };
  return {
    google: {
      auth: { OAuth2: vi.fn(() => ({ setCredentials: vi.fn() })) },
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
  });

  it('creates a new spreadsheet when none is found', async () => {
    (google.drive as any)().files.list.mockResolvedValue({ data: { files: [] } });
    (google.drive as any)().files.create.mockResolvedValue({ data: { id: 'new-id' } });

    const id = await findOrCreateSpreadsheet('token');
    expect(id).toBe('new-id');
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
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/sheets.test.ts`
Expected: FAIL — `lib/sheets.ts` does not exist yet

- [x] **Step 3: Implement the wrapper**

Create `lib/sheets.ts`:

```ts
import { google } from 'googleapis';

export type ExpenseRow = {
  date: string;
  amount: number;
  category: string;
  memo: string;
  method: string;
};

const FILE_NAME = 'expense-tracker';
const SHEET_RANGE = 'Sheet1!A:E';

function authClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

export async function findOrCreateSpreadsheet(accessToken: string): Promise<string> {
  const auth = authClient(accessToken);
  const drive = google.drive({ version: 'v3', auth });

  const existing = await drive.files.list({
    q: `name='${FILE_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  const found = existing.data.files?.[0];
  if (found?.id) return found.id;

  const created = await drive.files.create({
    requestBody: {
      name: FILE_NAME,
      mimeType: 'application/vnd.google-apps.spreadsheet',
    },
    fields: 'id',
  });

  if (!created.data.id) throw new Error('Failed to create spreadsheet');
  return created.data.id;
}

export async function appendExpenseRow(
  accessToken: string,
  spreadsheetId: string,
  row: ExpenseRow
): Promise<void> {
  const auth = authClient(accessToken);
  const sheets = google.sheets({ version: 'v4', auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: SHEET_RANGE,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[row.date, row.amount, row.category, row.memo, row.method]],
    },
  });
}

export async function readExpenseRows(
  accessToken: string,
  spreadsheetId: string
): Promise<ExpenseRow[]> {
  const auth = authClient(accessToken);
  const sheets = google.sheets({ version: 'v4', auth });

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: SHEET_RANGE,
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
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/sheets.test.ts`
Expected: PASS (5 tests)

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: Google Sheets wrapper (find-or-create, append, read)"
```

---

## Task 3b: Drive Folder Picker

**Why this task exists:** originally the app always created/looked for "expense-tracker" at the root of the user's Drive (Task 3). The user asked for control over which folder it lives in, via Google's own folder picker rather than a typed-in name. Added to the spec as §3 item 6 / §4 after Task 3 shipped — see spec for full rationale (Picker-selected items are accessible under `drive.file` scope without requesting broader Drive access).

**Files:**
- Modify: `lib/sheets.ts`, `lib/sheets.test.ts` (add optional `folderId` to `findOrCreateSpreadsheet`)
- Create: `lib/folderStorage.ts`, `lib/folderStorage.test.ts`
- Create: `components/FolderPicker.tsx`
- Modify: `.env.local.example` (add `NEXT_PUBLIC_GOOGLE_API_KEY`)

**Interfaces:**
- Consumes: nothing new from earlier tasks (extends Task 3's `findOrCreateSpreadsheet`)
- Produces:
  - `findOrCreateSpreadsheet(accessToken: string, folderId?: string): Promise<string>` — **signature change**: Task 4/5 must pass the folder id through when calling this
  - `getSavedFolderId(): string | null` and `saveFolderId(id: string): void` from `lib/folderStorage.ts`
  - `<FolderPicker accessToken={string} apiKey={string} onPicked={(folderId: string, folderName: string) => void} />` from `components/FolderPicker.tsx`

**Required manual setup (pending on the user, same as Task 2 Step 7):** in Google Cloud Console, enable the **Google Picker API** (APIs & Services → Library), and create an API key (APIs & Services → Credentials → Create Credentials → API key), restricted to the Picker API. Add it to `.env.local` as `NEXT_PUBLIC_GOOGLE_API_KEY`. Also confirm **Google Drive API** and **Google Sheets API** are enabled there too — these were needed since Task 3 but never explicitly called out to enable them, which will surface as a runtime 403 the first time a real Sheets/Drive call is made if missed.

- [x] **Step 1: Write the failing tests for the folderId-aware Sheets wrapper**

Modify `lib/sheets.test.ts`, adding these cases (keep the existing 5 tests as-is):

```ts
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
```

- [x] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run lib/sheets.test.ts`
Expected: FAIL — current `findOrCreateSpreadsheet` doesn't accept or use a `folderId`

- [x] **Step 3: Update `findOrCreateSpreadsheet` to accept and use `folderId`**

Modify `lib/sheets.ts`:

```ts
export async function findOrCreateSpreadsheet(
  accessToken: string,
  folderId?: string
): Promise<string> {
  const auth = authClient(accessToken);
  const drive = google.drive({ version: 'v3', auth });

  const folderClause = folderId ? ` and '${folderId}' in parents` : '';
  const existing = await drive.files.list({
    q: `name='${FILE_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false${folderClause}`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  const found = existing.data.files?.[0];
  if (found?.id) return found.id;

  const created = await drive.files.create({
    requestBody: {
      name: FILE_NAME,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      ...(folderId ? { parents: [folderId] } : {}),
    },
    fields: 'id',
  });

  if (!created.data.id) throw new Error('Failed to create spreadsheet');
  return created.data.id;
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/sheets.test.ts`
Expected: PASS (7 tests: the original 5 plus 2 new ones)

- [x] **Step 5: Write the failing tests for folder storage**

Create `lib/folderStorage.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getSavedFolderId, saveFolderId } from './folderStorage';

describe('folderStorage', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when nothing has been saved', () => {
    expect(getSavedFolderId()).toBeNull();
  });

  it('returns what was saved', () => {
    saveFolderId('folder-123');
    expect(getSavedFolderId()).toBe('folder-123');
  });
});
```

- [x] **Step 6: Run test to verify it fails**

Run: `npx vitest run lib/folderStorage.test.ts`
Expected: FAIL — `lib/folderStorage.ts` does not exist yet

- [x] **Step 7: Implement folder storage**

Create `lib/folderStorage.ts`:

```ts
const STORAGE_KEY = 'expense-tracker:folderId';

export function getSavedFolderId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function saveFolderId(id: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, id);
}
```

- [x] **Step 8: Run test to verify it passes**

Run: `npx vitest run lib/folderStorage.test.ts`
Expected: PASS (2 tests)

- [x] **Step 9: Build the picker component**

Create `components/FolderPicker.tsx` — a client component (`'use client'`) that:
1. On mount, loads `https://apis.google.com/js/api.js` (skip if already present on `window`), then calls `gapi.load('picker', () => setReady(true))`.
2. Renders a button ("저장 폴더 선택") disabled until ready; on click, builds and shows the picker:

```ts
const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
  .setIncludeFolders(true)
  .setMimeTypes('application/vnd.google-apps.folder')
  .setSelectFolderEnabled(true);

const picker = new google.picker.PickerBuilder()
  .setOAuthToken(accessToken)
  .setDeveloperKey(apiKey)
  .addView(view)
  .setCallback((data: any) => {
    if (data.action === google.picker.Action.PICKED) {
      const doc = data.docs[0];
      onPicked(doc.id, doc.name);
    }
  })
  .build();

picker.setVisible(true);
```

3. This pattern was verified live against Google's current Picker API docs on 2026-09-02 (`DocsView(ViewId.FOLDERS).setIncludeFolders(true).setMimeTypes('application/vnd.google-apps.folder').setSelectFolderEnabled(true)`) — if the implementing agent is running this later and the docs have moved on, re-check `https://developers.google.com/workspace/drive/picker/reference/picker.docsview.setselectfolderenabled` before trusting this snippet.
4. There's no official TypeScript types package for the Picker API's `google`/`gapi` script-loaded globals — declare them loosely at the top of this file (`declare const gapi: any; declare const google: any;`) rather than fighting for exact types, so `tsc`/`next build` don't fail on missing declarations.

- [x] **Step 10: Wire it into `app/page.tsx`**

`app/page.tsx` is a server component (`async function Home()`), so it cannot hold `useState` itself. Render a self-contained client wrapper — e.g. `<FolderPickerSection accessToken={session.accessToken} apiKey={process.env.NEXT_PUBLIC_GOOGLE_API_KEY!} />` — above the expense form, where the wrapper owns its own `folderId`/`folderName` state, initializes it from `getSavedFolderId()` (plus a persisted display name, so a refresh doesn't show a raw folder ID) in a client-side effect, and shows "Drive 루트" when nothing's been picked. Any other component that needs to know the current folder (Task 4/5's form and list) reads `getSavedFolderId()` itself the same way — it's a plain function reading `localStorage`, not something that needs to be threaded down from this wrapper.

**(Already implemented as of 2026-09-02 — see `components/FolderPicker.tsx`'s `FolderPickerSection` export for the actual pattern.)**

- [x] **Step 11: Update `.env.local.example`**

```bash
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
AUTH_SECRET=
AI_GATEWAY_API_KEY=
NEXT_PUBLIC_GOOGLE_API_KEY=
```

- [x] **Step 12: Run full test suite and build**

Run: `npm test && npm run build`
Expected: all tests pass (12 total: 3 token + 7 sheets + 2 folderStorage), build succeeds

- [x] **Step 13: Commit**

```bash
git add -A
git commit -m "feat: Drive folder picker for choosing where the sheet lives"
```

---

## Task 4: Manual Expense Entry

**Files:**
- Create: `lib/expense.ts`, `lib/expense.test.ts`
- Create: `app/api/expenses/route.ts` (POST handler; GET is added in Task 5)
- Create: `components/ExpenseForm.tsx`

**Interfaces:**
- Consumes: `auth()` from Task 2, `findOrCreateSpreadsheet` (now `(accessToken, folderId?)`) + `appendExpenseRow` + `ExpenseRow` from Task 3/3b, `getSavedFolderId` from Task 3b (`lib/folderStorage.ts`)
- Produces:
  - `type ExpenseInput = { date: string; amount: number; category: string; memo: string; method: string }`
  - `validateExpenseInput(input: unknown): ExpenseInput` (throws `ZodError` on invalid input) from `lib/expense.ts`
  - `<ExpenseForm onSubmitted={() => void} initialValues={Partial<ExpenseInput>} />` from `components/ExpenseForm.tsx` — Task 7 passes `initialValues` from OCR results. No `folderId` prop: `app/page.tsx` is a server component and can't hold or pass down that state (see Task 3b Step 10), so `ExpenseForm` itself calls `getSavedFolderId()` at submit time and includes it in the POST body — same "read localStorage where it's needed" pattern `FolderPickerSection` already established

- [x] **Step 1: Write the failing tests for validation**

Create `lib/expense.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateExpenseInput } from './expense';

describe('validateExpenseInput', () => {
  it('accepts a well-formed expense', () => {
    const result = validateExpenseInput({
      date: '2026-09-01',
      amount: 12000,
      category: '식비',
      memo: '점심',
      method: '카드',
    });
    expect(result.amount).toBe(12000);
  });

  it('rejects a negative amount', () => {
    expect(() =>
      validateExpenseInput({
        date: '2026-09-01',
        amount: -1,
        category: '식비',
        memo: '',
        method: '카드',
      })
    ).toThrow();
  });

  it('rejects a missing category', () => {
    expect(() =>
      validateExpenseInput({ date: '2026-09-01', amount: 1000, memo: '', method: '카드' })
    ).toThrow();
  });

  it('rejects a malformed date', () => {
    expect(() =>
      validateExpenseInput({
        date: 'not-a-date',
        amount: 1000,
        category: '식비',
        memo: '',
        method: '카드',
      })
    ).toThrow();
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/expense.test.ts`
Expected: FAIL — `lib/expense.ts` does not exist yet

- [x] **Step 3: Implement validation with Zod**

Create `lib/expense.ts`:

```ts
import { z } from 'zod';

export const ExpenseInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  amount: z.number().positive(),
  category: z.string().min(1),
  memo: z.string(),
  method: z.string().min(1),
});

export type ExpenseInput = z.infer<typeof ExpenseInputSchema>;

export function validateExpenseInput(input: unknown): ExpenseInput {
  return ExpenseInputSchema.parse(input);
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/expense.test.ts`
Expected: PASS (4 tests)

- [x] **Step 5: Implement the POST route**

Create `app/api/expenses/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { validateExpenseInput } from '@/lib/expense';
import { findOrCreateSpreadsheet, appendExpenseRow } from '@/lib/sheets';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const body = await request.json();
  const { folderId, ...expenseInput } = body;
  const expense = validateExpenseInput(expenseInput);

  const spreadsheetId = await findOrCreateSpreadsheet(session.accessToken, folderId ?? undefined);
  await appendExpenseRow(session.accessToken, spreadsheetId, expense);

  return NextResponse.json({ ok: true });
}
```

- [x] **Step 6: Build the form component**

Create `components/ExpenseForm.tsx` — a client component (`'use client'`) with controlled inputs for date/amount/category/memo/method, accepting an optional `initialValues: Partial<ExpenseInput>` prop (used later by Task 7's OCR flow) and an `onSubmitted: () => void` callback. The category field is a text input with a `<datalist>` of preset options (`식비`, `교통`, `쇼핑`, `주거`, `기타`) — this satisfies spec §3 item 4 ("기본 카테고리 + 커스텀 추가") without a separate category-management screen: presets show as suggestions, but any typed value is accepted and saved as-is. On submit, call `getSavedFolderId()` from `@/lib/folderStorage` and `POST` to `/api/expenses` with `fetch`, sending `{ ...formValues, folderId }` as the JSON body, show an inline error if the response is not OK, call `onSubmitted()` on success.

- [x] **Step 7: Wire the form into the signed-in view of `app/page.tsx`**

(Task 5 relocates this render into a new `ExpenseDashboard` client component so it can trigger a list refetch — expected, not a regression.)

- [x] **Step 8: Run full test suite and build**

Run: `npm test && npm run build`
Expected: all tests pass, build succeeds

- [x] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: manual expense entry form and API route"
```

---

## Task 5: Recent List + Monthly Summary + Visual Design

**Design source (read this first):** the user mocked up the main screen in claude.ai/design and exported a handoff bundle. `docs/superpowers/specs/design/ExpenseScreen.dc.html` is the canonical visual reference, committed into the repo — open it and read the `<sc-if value="{{ isMinimal }}">` branch (roughly lines 14-108) plus the `Component` class at the bottom (state shape, `CATEGORIES`, `PAYMENTS`, `dateLabel()` formatting, amount formatting via `toLocaleString('ko-KR') + '원'`). That block **is** the "minimal" variant the user picked — the sibling `isCard` branch is the rejected "card" variant; ignore it. Per the handoff's own README (same directory... actually not committed, but the rule holds): recreate the visual output pixel-for-pixel using our real components and real data — don't port the mock's fake `DCLogic`/`sc-if`/`sc-for` state machinery, just its Tailwind classes, layout structure, and copy.

This task both builds the still-missing list/summary pieces **and** restyles the two pieces Tasks 3b/4 already shipped (`FolderPicker`, `ExpenseForm`) to match, since the design covers the whole screen as one composition — doing it piecemeal later would mean re-touching the same files twice.

**Files:**
- Create: `lib/summary.ts`, `lib/summary.test.ts`
- Modify: `app/api/expenses/route.ts` (add GET handler)
- Create: `components/ExpenseList.tsx`, `components/MonthlySummary.tsx`, `components/ExpenseDashboard.tsx`, `components/Toast.tsx`
- Modify: `components/ExpenseForm.tsx` (restyle to match the design; see Step 6a)
- Modify: `components/FolderPicker.tsx` (restyle `FolderPickerSection` to match; keep the real Google Picker behavior — see Step 6b)
- Modify: `app/page.tsx` (render `<ExpenseDashboard />` instead of the standalone `<ExpenseForm />` from Task 4; restyle the sign-in/sign-out chrome)

**Interfaces:**
- Consumes: `readExpenseRows` + `ExpenseRow` from Task 3, `findOrCreateSpreadsheet` (`(accessToken, folderId?)`) from Task 3/3b, `auth()` from Task 2, `getSavedFolderId` from Task 3b, `<ExpenseForm />` from Task 4
- Produces: `summarizeByMonth(rows: ExpenseRow[], month: string): { total: number; count: number }` from `lib/summary.ts`. GET `/api/expenses?folderId=<id>` (folderId optional) returns `{ expenses: ExpenseRow[], monthlyTotal: number }`. `<Toast message={string | null} />` from `components/Toast.tsx` — a fixed bottom-center pill, reused for both logout confirmation and save-success feedback.

- [x] **Step 1: Write the failing tests for the summary function**

Create `lib/summary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { summarizeByMonth } from './summary';
import type { ExpenseRow } from './sheets';

const rows: ExpenseRow[] = [
  { date: '2026-09-01', amount: 10000, category: '식비', memo: '', method: '카드' },
  { date: '2026-09-15', amount: 5000, category: '교통', memo: '', method: '카드' },
  { date: '2026-08-30', amount: 99999, category: '식비', memo: '', method: '카드' },
];

describe('summarizeByMonth', () => {
  it('sums only rows within the given month', () => {
    expect(summarizeByMonth(rows, '2026-09')).toEqual({ total: 15000, count: 2 });
  });

  it('returns zero for a month with no rows', () => {
    expect(summarizeByMonth(rows, '2026-01')).toEqual({ total: 0, count: 0 });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/summary.test.ts`
Expected: FAIL — `lib/summary.ts` does not exist yet

- [x] **Step 3: Implement the summary function**

Create `lib/summary.ts`:

```ts
import type { ExpenseRow } from './sheets';

export function summarizeByMonth(rows: ExpenseRow[], month: string): { total: number; count: number } {
  const inMonth = rows.filter((row) => row.date.startsWith(month));
  return {
    total: inMonth.reduce((sum, row) => sum + row.amount, 0),
    count: inMonth.length,
  };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/summary.test.ts`
Expected: PASS (2 tests)

- [x] **Step 5: Add the GET handler**

Modify `app/api/expenses/route.ts` to add:

```ts
import { readExpenseRows } from '@/lib/sheets';
import { summarizeByMonth } from '@/lib/summary';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const folderId = new URL(request.url).searchParams.get('folderId') ?? undefined;
  const spreadsheetId = await findOrCreateSpreadsheet(session.accessToken, folderId);
  const expenses = await readExpenseRows(session.accessToken, spreadsheetId);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const { total } = summarizeByMonth(expenses, currentMonth);

  return NextResponse.json({ expenses: expenses.slice(-20).reverse(), monthlyTotal: total });
}
```

- [x] **Step 6a: Restyle `ExpenseForm.tsx` to match the design**

Open the minimal variant's form section in `docs/superpowers/specs/design/ExpenseScreen.dc.html` (the `지출 입력` block) and port it:
- Category field: expand the preset `<datalist>` options to the design's `CATEGORIES` list — `식비`, `카페`, `교통`, `쇼핑`, `구독서비스`, `의료`, `선물`, `문화생활`, `기타` (was a 5-item list; still free text + suggestions, still satisfies spec §3 item 4).
- Payment field: **change from a free-text input to a `<select>`** with the design's fixed `PAYMENTS` options — `체크카드`, `신용카드`, `현금`, `계좌이체`. Update `lib/expense.ts`'s `ExpenseInputSchema` if needed so `method` still validates fine against these values (it's still just `z.string().min(1)`, so no schema change should be needed — just confirm).
- Every input: swap to the design's underline style — transparent background, bottom border only, indigo focus border (`border-0 border-b border-gray-200 focus:border-indigo-500`), matching text sizes (`text-[14px]` for inputs, `text-[11px] text-gray-400` for labels).
- Submit button: full-width, pill-shaped, indigo (`w-full bg-indigo-600 text-white rounded-full py-3 text-[14px] font-semibold active:bg-indigo-700`), label stays "저장" to match the design (rename from whatever Task 4 used).
- Error text: `text-[12px] text-red-500` (keep the existing `role="alert"` for accessibility — the design has no equivalent, but don't drop it).
- On successful submit, in addition to calling `onSubmitted()`, also trigger the toast (see Step 6c) with "저장했습니다" — wire this via a new optional `onSuccess: (message: string) => void` prop `ExpenseDashboard` (Step 6d) passes in, so `ExpenseForm` doesn't need to own toast state itself.

- [x] **Step 6b: Restyle `FolderPicker.tsx`'s `FolderPickerSection` to match the design**

The design's folder section shows a static list of folder names when expanded (`folderOptions`) — that's a mock standing in for a real picker, since the design tool can't call Google APIs. **Do not port that static list.** Keep `FolderPickerSection`'s real behavior (clicking opens the actual Google Picker via `openPicker()`), but restyle its container and copy to match the design's "저장 위치" block: label `저장 위치` (`text-[11px] text-gray-400`) above the current folder name (`text-[14px] text-gray-800 font-medium`), with a `변경` button styled `text-[13px] text-indigo-600 font-semibold` that opens the picker (rename from "저장 폴더 선택"). Wrap the whole block in `px-5 py-4 border-b border-gray-100` to match the design's section rhythm.

- [x] **Step 6c: Build the `Toast` component**

Create `components/Toast.tsx` — a small client component: `<Toast message={string | null} />` renders nothing when `message` is `null`, otherwise renders the design's toast styling (`fixed left-1/2 bottom-6 -translate-x-1/2 bg-gray-900 text-white text-[12px] px-4 py-2 rounded-full shadow-lg`). The parent (`ExpenseDashboard`, Step 6d) owns the message state and clears it after ~1800ms (match the design's `setTimeout`), so `Toast` itself is presentational only — no timers inside it.

- [x] **Step 6d: Build `ExpenseList`, `MonthlySummary`, and the dashboard wrapper**

`components/ExpenseList.tsx`: renders the most recent expenses per the design's list rows — each row `flex items-center justify-between py-3 border-b border-gray-50`, left side stacked `{date}·{category}` (`text-[11px] text-gray-400`) above the memo (`text-[14px] text-gray-800`), right side stacked amount (`text-[15px] font-semibold text-gray-900`, formatted like `12,000원` via `amount.toLocaleString('ko-KR') + '원'`) above the payment method (`text-[11px] text-gray-400`). Date format is `MM.DD(요일)` — port the design's `dateLabel()` helper (or an equivalent) as a small local function; Korean weekday short names are `['일','월','화','수','목','금','토']`.

`components/MonthlySummary.tsx`: renders per the design's summary block — small label (`text-[12px] text-gray-400 mb-1`, e.g. "2026년 9월 총 지출") above the big total (`text-[38px] font-bold text-gray-900 tracking-tight`, same `toLocaleString('ko-KR') + '원'` formatting).

`app/page.tsx` (server component) still can't hold the "fetch on mount, refetch after submit, show a toast" state itself, so create `components/ExpenseDashboard.tsx` — a client component that: reads `getSavedFolderId()`, fetches `GET /api/expenses?folderId=<folderId>` on mount, owns `toastMessage` state, and renders (in this order, matching the design's section stacking below the account row and `<FolderPickerSection />` — both of those stay rendered directly in `app/page.tsx`, unchanged) `<MonthlySummary total={...} />`, `<ExpenseForm onSubmitted={refetch} onSuccess={setToastMessage} />` (moved here from being rendered directly in `app/page.tsx` in Task 4 — same component, just relocated so it can trigger a refetch), `<ExpenseList expenses={...} />`, and `<Toast message={toastMessage} />`. Modify `app/page.tsx` to render `<ExpenseDashboard />` in place of the standalone `<ExpenseForm />` Task 4 put there, and restyle the top-of-screen account row (`로그인 계정` label + email + `로그아웃` button, `flex items-center justify-between px-5 pb-4 border-b border-gray-100`) and the outer page shell (`h-full w-full bg-white flex flex-col`, no more centered/max-w-md layout — this is a full mobile screen now, not a centered card) to match the design. Wire the sign-out server action's toast the same way as save-success ("로그아웃 되었습니다") if it's not too awkward given `signOut()` navigates away — use judgment; a toast that never gets seen because the page redirects immediately is fine to skip.

- [x] **Step 7: Run full test suite and build**

Run: `npm test && npm run build`
Expected: all tests pass, build succeeds

- [x] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: recent expense list and monthly summary"
```

---

## Task 6: Receipt OCR via Gemini (AI Gateway)

**Re-verified 2026-09-03 against the installed `ai@7.0.87` package** (`node_modules/ai/docs/`) and the live AI Gateway model list. Two things drifted since this plan was written and the snippets below have already been corrected for it — implement as written, no further live-doc verification needed:

1. **`generateObject` is deprecated** (`node_modules/ai/docs/08-migration-guides/24-migration-guide-6-0.mdx` line 152) in favor of `generateText` with an `output: Output.object({ schema })` option. `{ object }` becomes `{ output }` on the result.
2. **The `{ type: 'image', image }` message content part is deprecated** (`node_modules/ai/docs/08-migration-guides/23-migration-guide-7-0.mdx` line 1413) in favor of `{ type: 'file', mediaType, data }`. `data` accepts a bare base64 string directly (no data-URL prefix needed) — confirmed via `node_modules/ai/docs/07-reference/01-ai-sdk-core/30-model-message.mdx`'s `FilePart`/`FileData` reference (`data: FileData | DataContent | URL | ProviderReference`, where the bare `DataContent` base64-string shorthand is supported alongside the tagged `{ type: 'data', data }` form).
3. The top vision-capable Flash-Lite model on the Gateway is still `google/gemini-3.5-flash-lite` (confirmed live 2026-09-03 — newer `3.6/3.7/3.8-flash` exist but have no `-flash-lite` variant beyond `3.5`).

If dependency versions have moved on further by the time this is implemented, re-run the same greps as a sanity check before trusting the snippets blindly:

```bash
grep -n "generateObject" node_modules/ai/docs/08-migration-guides/24-migration-guide-6-0.mdx | head -5
curl -s https://ai-gateway.vercel.sh/v1/models | jq -r '[.data[] | select(.id | startswith("google/")) | .id] | sort'
```

**Files:**
- Create: `lib/ocr.ts`, `lib/ocr.test.ts`
- Create: `app/api/ocr/route.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (standalone extraction capability)
- Produces:
  - `type ReceiptExtraction = { date: string | null; amount: number | null; merchant: string | null; categoryGuess: string | null }`
  - `extractReceiptData(imageBase64: string): Promise<ReceiptExtraction>` from `lib/ocr.ts`
  - POST `/api/ocr` accepting `{ imageBase64: string }`, returning `ReceiptExtraction`

- [x] **Step 1: Write the failing test with a mocked `generateText`/`Output.object`**

Create `lib/ocr.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { generateText } from 'ai';
import { extractReceiptData } from './ocr';

vi.mock('ai', () => ({
  generateText: vi.fn(),
  Output: { object: vi.fn((config) => config) },
}));

describe('extractReceiptData', () => {
  it('returns the structured fields from the model response', async () => {
    (generateText as any).mockResolvedValue({
      output: { date: '2026-09-01', amount: 8500, merchant: '스타벅스', categoryGuess: '카페' },
    });

    const result = await extractReceiptData('base64-image-data');

    expect(result).toEqual({
      date: '2026-09-01',
      amount: 8500,
      merchant: '스타벅스',
      categoryGuess: '카페',
    });
  });

  it('propagates nulls when the model cannot read a field', async () => {
    (generateText as any).mockResolvedValue({
      output: { date: null, amount: null, merchant: null, categoryGuess: null },
    });

    const result = await extractReceiptData('base64-image-data');
    expect(result.amount).toBeNull();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ocr.test.ts`
Expected: FAIL — `lib/ocr.ts` does not exist yet

- [x] **Step 3: Implement the extractor**

Create `lib/ocr.ts` (this is the corrected pattern for `ai@7.0.87` — `generateObject` and the `image` content part are both deprecated in this version; see the re-verification note above the task heading):

```ts
import { generateText, Output } from 'ai';
import { z } from 'zod';

const ReceiptSchema = z.object({
  date: z.string().nullable().describe('Transaction date as YYYY-MM-DD, or null if unreadable'),
  amount: z.number().nullable().describe('Total amount as a plain number (KRW), or null if unreadable'),
  merchant: z.string().nullable().describe('Merchant/store name, or null if unreadable'),
  categoryGuess: z
    .string()
    .nullable()
    .describe('Best-guess spending category in Korean (e.g. 식비, 교통, 쇼핑), or null'),
});

export type ReceiptExtraction = z.infer<typeof ReceiptSchema>;

export async function extractReceiptData(imageBase64: string): Promise<ReceiptExtraction> {
  const { output } = await generateText({
    model: 'google/gemini-3.5-flash-lite',
    output: Output.object({ schema: ReceiptSchema }),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Extract the transaction date, total amount, merchant name, and a best-guess Korean spending category from this receipt photo. Use null for any field you cannot read confidently.',
          },
          { type: 'file', mediaType: 'image/jpeg', data: imageBase64 },
        ],
      },
    ],
  });

  return output;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ocr.test.ts`
Expected: PASS (2 tests)

- [x] **Step 5: Implement the route**

Create `app/api/ocr/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { extractReceiptData } from '@/lib/ocr';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { imageBase64 } = await request.json();
  if (typeof imageBase64 !== 'string' || imageBase64.length === 0) {
    return NextResponse.json({ error: 'imageBase64 is required' }, { status: 400 });
  }

  const extraction = await extractReceiptData(imageBase64);
  return NextResponse.json(extraction);
}
```

- [ ] **Step 6: Add `AI_GATEWAY_API_KEY` to `.env.local`**

Get a key from the Vercel dashboard's AI Gateway API Keys page and add it to `.env.local` (already documented in `.env.local.example` from Task 1).

- [x] **Step 7: Run full test suite and build**

Run: `npm test && npm run build`
Expected: all tests pass, build succeeds

- [ ] **Step 8: Manual verification with a real receipt photo**

Use a REST client (or a temporary script) to POST a real base64-encoded receipt photo to `/api/ocr` while signed in, and confirm the extracted fields are reasonable.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: receipt OCR via Gemini through AI Gateway"
```

---

## Task 7: OCR-to-Form Integration

**Files:**
- Create: `components/ReceiptUpload.tsx`
- Modify: `components/ExpenseForm.tsx` (already accepts `initialValues` from Task 4 — no signature change needed)
- Modify: `components/ExpenseDashboard.tsx` (wire `ReceiptUpload` → `ExpenseForm`; **not** `app/page.tsx` — that's a server component and can't hold the `draftValues` state this needs, same reasoning as Task 3b/5)

**Interfaces:**
- Consumes: `ReceiptExtraction` type and `POST /api/ocr` from Task 6; `<ExpenseForm initialValues={...} />` from Task 4; `<ExpenseDashboard />` from Task 5
- Produces: `<ReceiptUpload onExtracted={(data: ReceiptExtraction) => void} />`

- [ ] **Step 1: Write the failing component test**

Create `components/ReceiptUpload.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReceiptUpload } from './ReceiptUpload';

describe('ReceiptUpload', () => {
  it('calls onExtracted with the parsed response after a file is selected', async () => {
    const onExtracted = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ date: '2026-09-01', amount: 8500, merchant: '스타벅스', categoryGuess: '카페' }),
    }) as any;

    render(<ReceiptUpload onExtracted={onExtracted} />);

    const file = new File(['fake-image-bytes'], 'receipt.jpg', { type: 'image/jpeg' });
    const input = screen.getByLabelText(/영수증/i);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(onExtracted).toHaveBeenCalledWith({
        date: '2026-09-01',
        amount: 8500,
        merchant: '스타벅스',
        categoryGuess: '카페',
      })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/ReceiptUpload.test.tsx`
Expected: FAIL — `components/ReceiptUpload.tsx` does not exist yet

- [ ] **Step 3: Implement the component**

Create `components/ReceiptUpload.tsx` — a client component with a labeled file input (`<label htmlFor="receipt-input">영수증 사진</label>`) that, on file selection, reads the file as base64 (via `FileReader`), `POST`s `{ imageBase64 }` to `/api/ocr`, and calls `onExtracted(json)` with the parsed response. Show a loading state while the request is in flight and an inline error if it fails.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/ReceiptUpload.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire it into the dashboard**

In `components/ExpenseDashboard.tsx`, render `<ReceiptUpload onExtracted={setDraftValues} />` above `<ExpenseForm initialValues={draftValues} ... />`, where `draftValues` is state on `ExpenseDashboard` (which is already a client component per Task 5) that starts empty and gets replaced by the OCR result. The user still has to review/submit the form — OCR only pre-fills it (per spec §3, "auto-draft, human confirms").

- [ ] **Step 6: Run full test suite and build**

Run: `npm test && npm run build`
Expected: all tests pass, build succeeds

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: wire receipt OCR into the expense form as a pre-fill"
```

---

## Task 8: PWA Installability

**Files:**
- Create: `app/manifest.ts`
- Create: `public/icons/icon-192.png`, `public/icons/icon-512.png`
- Modify: `app/layout.tsx` (theme-color meta tag)

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed by other tasks (final task)

- [x] **Step 1: Generate app icons**

Create two simple placeholder PNG icons (192x192 and 512x512) — e.g. a solid-color square with "₩" or the app initial, generated with any image tool or a one-off script (e.g. `npx pwa-asset-generator` or manual export from Figma/Preview). Save as `public/icons/icon-192.png` and `public/icons/icon-512.png`. These are placeholders; visual polish is not part of the MVP.

- [x] **Step 2: Add the Next.js native manifest route**

Create `app/manifest.ts`:

```ts
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '지출 추적기',
    short_name: '지출추적',
    description: '개인 지출을 기록하고 Google Sheets에 정리합니다',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#111827',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
```

- [x] **Step 3: Verify the manifest is served correctly**

Run: `npm run dev`, then in another terminal:

```bash
curl -s http://localhost:3000/manifest.webmanifest | jq .
```

Expected: valid JSON matching the manifest above.

- [ ] **Step 4: Manual verification on an actual iPhone**

Open the dev server's URL (or a deployed preview) in Safari on the iPhone, tap Share → "홈 화면에 추가", confirm the icon and name appear correctly and the app opens without browser chrome.

- [x] **Step 5: Run full test suite and build**

Run: `npm test && npm run build`
Expected: all tests pass, build succeeds

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: PWA manifest and home screen icons"
```

---

## Definition of Done (whole plan)

- `npm test` passes with all unit tests green
- `npm run build` succeeds
- Signed-in user can: manually add an expense and see it in the list and monthly total; upload a receipt photo, see OCR-prefilled values, edit and confirm, and see it saved
- Data lands in a Google Sheet named "expense-tracker", in the Drive folder the user picked (or Drive root if none picked)
- User can pick a Drive folder via the Picker and it's remembered across visits (same device)
- App installs to an iPhone home screen and opens in standalone mode

## Execution Handoff

Per the design doc's workflow (spec §5), each task above is handed to **Codex** as a self-contained unit:

1. Claude Code posts the task's Files/Interfaces/Steps block to Codex via `codex:rescue`.
2. Codex implements the task end-to-end (including running the specified test/build commands) and returns a self-review: what changed, assumptions made, any deviation from the plan, and remaining risks.
3. Claude Code checks the self-review against this task's Definition of Done (tests pass, build succeeds, interfaces match what later tasks expect), and reports a short summary back to the user.
4. If issues are found, Claude Code sends them back to Codex for a follow-up pass before moving to the next task.

Ready to start with Task 1?
