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

- [ ] **Step 1: Scaffold the Next.js app**

```bash
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --eslint --use-npm
```

When prompted about a non-empty directory (the `.claude/` and `docs/` folders already exist), confirm to proceed.

- [ ] **Step 2: Install additional dependencies**

```bash
npm install next-auth@beta googleapis ai zod
npm install -D vitest @testing-library/react @testing-library/jest-dom @vitejs/plugin-react jsdom
```

- [ ] **Step 3: Configure Vitest**

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

- [ ] **Step 4: Write a trivial smoke test to confirm the test runner works**

Create `app/page.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';

describe('sanity check', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the test suite and the build to confirm the scaffold is sound**

Run: `npm test`
Expected: 1 passed

Run: `npm run build`
Expected: build succeeds with no type errors

- [ ] **Step 6: Create `.env.local.example` documenting required env vars (filled in during Task 2 and Task 6)**

```bash
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
AUTH_SECRET=
AI_GATEWAY_API_KEY=
```

- [ ] **Step 7: Commit**

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

- [ ] **Step 1: Write the failing test for the pure expiry-check helper**

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/token.test.ts`
Expected: FAIL — `lib/token.ts` does not exist yet

- [ ] **Step 3: Implement the helper**

Create `lib/token.ts`:

```ts
export function isTokenExpired(expiresAtSeconds: number): boolean {
  return Date.now() >= expiresAtSeconds * 1000;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/token.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Configure NextAuth with Google provider, offline access, and the Sheets/Drive scopes**

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

- [ ] **Step 6: Wire a minimal sign-in/sign-out UI into the home page**

Modify `app/page.tsx` to call `auth()` and show a "Sign in with Google" button (using the `signIn`/`signOut` server actions) when signed out, and the user's email when signed in. This is intentionally minimal — the real dashboard UI comes in Task 5.

- [ ] **Step 7: Manual verification (cannot be unit-tested — requires real Google OAuth consent)**

1. Create a Google Cloud project, OAuth consent screen (External, Testing mode, your own account as a test user), and OAuth Client ID (Web application) with redirect URI `http://localhost:3000/api/auth/callback/google`.
2. Fill `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and a random `AUTH_SECRET` (generate with `npx auth secret`) into `.env.local`.
3. Run `npm run dev`, click "Sign in with Google", confirm the consent screen lists Drive (app-created files) and Sheets access, and confirm you land back on `/` signed in.

- [ ] **Step 8: Run full test suite and build**

Run: `npm test && npm run build`
Expected: all tests pass, build succeeds

- [ ] **Step 9: Commit**

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

- [ ] **Step 1: Write the failing tests using a mocked `googleapis` client**

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

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/sheets.test.ts`
Expected: FAIL — `lib/sheets.ts` does not exist yet

- [ ] **Step 3: Implement the wrapper**

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/sheets.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: Google Sheets wrapper (find-or-create, append, read)"
```

---

## Task 4: Manual Expense Entry

**Files:**
- Create: `lib/expense.ts`, `lib/expense.test.ts`
- Create: `app/api/expenses/route.ts` (POST handler; GET is added in Task 5)
- Create: `components/ExpenseForm.tsx`

**Interfaces:**
- Consumes: `auth()` from Task 2, `findOrCreateSpreadsheet` + `appendExpenseRow` + `ExpenseRow` from Task 3
- Produces:
  - `type ExpenseInput = { date: string; amount: number; category: string; memo: string; method: string }`
  - `validateExpenseInput(input: unknown): ExpenseInput` (throws `ZodError` on invalid input) from `lib/expense.ts`
  - `<ExpenseForm onSubmitted={() => void} initialValues={Partial<ExpenseInput>} />` from `components/ExpenseForm.tsx` — Task 7 passes `initialValues` from OCR results

- [ ] **Step 1: Write the failing tests for validation**

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

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/expense.test.ts`
Expected: FAIL — `lib/expense.ts` does not exist yet

- [ ] **Step 3: Implement validation with Zod**

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/expense.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Implement the POST route**

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
  const expense = validateExpenseInput(body);

  const spreadsheetId = await findOrCreateSpreadsheet(session.accessToken);
  await appendExpenseRow(session.accessToken, spreadsheetId, expense);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Build the form component**

Create `components/ExpenseForm.tsx` — a client component (`'use client'`) with controlled inputs for date/amount/category/memo/method, accepting an optional `initialValues: Partial<ExpenseInput>` prop (used later by Task 7's OCR flow) and an `onSubmitted: () => void` callback. The category field is a text input with a `<datalist>` of preset options (`식비`, `교통`, `쇼핑`, `주거`, `기타`) — this satisfies spec §3 item 4 ("기본 카테고리 + 커스텀 추가") without a separate category-management screen: presets show as suggestions, but any typed value is accepted and saved as-is. On submit, `POST` to `/api/expenses` with `fetch`, show an inline error if the response is not OK, call `onSubmitted()` on success.

- [ ] **Step 7: Wire the form into the signed-in view of `app/page.tsx`**

- [ ] **Step 8: Run full test suite and build**

Run: `npm test && npm run build`
Expected: all tests pass, build succeeds

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: manual expense entry form and API route"
```

---

## Task 5: Recent List + Monthly Summary

**Files:**
- Create: `lib/summary.ts`, `lib/summary.test.ts`
- Modify: `app/api/expenses/route.ts` (add GET handler)
- Create: `components/ExpenseList.tsx`, `components/MonthlySummary.tsx`

**Interfaces:**
- Consumes: `readExpenseRows` + `ExpenseRow` from Task 3, `auth()` from Task 2
- Produces: `summarizeByMonth(rows: ExpenseRow[], month: string): { total: number; count: number }` from `lib/summary.ts`. GET `/api/expenses` returns `{ expenses: ExpenseRow[], monthlyTotal: number }`.

- [ ] **Step 1: Write the failing tests for the summary function**

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/summary.test.ts`
Expected: FAIL — `lib/summary.ts` does not exist yet

- [ ] **Step 3: Implement the summary function**

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/summary.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Add the GET handler**

Modify `app/api/expenses/route.ts` to add:

```ts
import { readExpenseRows } from '@/lib/sheets';
import { summarizeByMonth } from '@/lib/summary';

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const spreadsheetId = await findOrCreateSpreadsheet(session.accessToken);
  const expenses = await readExpenseRows(session.accessToken, spreadsheetId);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const { total } = summarizeByMonth(expenses, currentMonth);

  return NextResponse.json({ expenses: expenses.slice(-20).reverse(), monthlyTotal: total });
}
```

- [ ] **Step 6: Build `ExpenseList` and `MonthlySummary` components**

`components/ExpenseList.tsx`: renders the most recent expenses (date, category, amount, memo) passed in as props.
`components/MonthlySummary.tsx`: renders the monthly total passed in as a prop.

Wire both into `app/page.tsx`, fetching from `GET /api/expenses` after sign-in and after `ExpenseForm`'s `onSubmitted` fires (refetch to show the new row).

- [ ] **Step 7: Run full test suite and build**

Run: `npm test && npm run build`
Expected: all tests pass, build succeeds

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: recent expense list and monthly summary"
```

---

## Task 6: Receipt OCR via Gemini (AI Gateway)

**Before writing this task's code, the implementing agent MUST re-verify it** — `ai` will be installed and `node_modules/ai/docs/` will exist by this point, which was not true when this plan was written. Run:

```bash
grep -rl "generateObject" node_modules/ai/docs/ | head -5
curl -s https://ai-gateway.vercel.sh/v1/models | jq -r '[.data[] | select(.id | startswith("google/")) | .id] | reverse | .[]' | head -10
```

Confirm `generateObject`'s signature (schema/messages/image-content shape) and the current best Gemini Flash-Lite model ID still match what's below — adjust if the library or model list has moved on. As of 2026-09-01, the top vision-capable Flash-Lite model was `google/gemini-3.5-flash-lite`.

**Files:**
- Create: `lib/ocr.ts`, `lib/ocr.test.ts`
- Create: `app/api/ocr/route.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (standalone extraction capability)
- Produces:
  - `type ReceiptExtraction = { date: string | null; amount: number | null; merchant: string | null; categoryGuess: string | null }`
  - `extractReceiptData(imageBase64: string): Promise<ReceiptExtraction>` from `lib/ocr.ts`
  - POST `/api/ocr` accepting `{ imageBase64: string }`, returning `ReceiptExtraction`

- [ ] **Step 1: Write the failing test with a mocked `generateObject`**

Create `lib/ocr.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { generateObject } from 'ai';
import { extractReceiptData } from './ocr';

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}));

describe('extractReceiptData', () => {
  it('returns the structured fields from the model response', async () => {
    (generateObject as any).mockResolvedValue({
      object: { date: '2026-09-01', amount: 8500, merchant: '스타벅스', categoryGuess: '카페' },
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
    (generateObject as any).mockResolvedValue({
      object: { date: null, amount: null, merchant: null, categoryGuess: null },
    });

    const result = await extractReceiptData('base64-image-data');
    expect(result.amount).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ocr.test.ts`
Expected: FAIL — `lib/ocr.ts` does not exist yet

- [ ] **Step 3: Implement the extractor**

Create `lib/ocr.ts` (verify the exact `generateObject` call shape against `node_modules/ai/docs/` per the note above before finalizing — this is the pattern as of 2026-09-01):

```ts
import { generateObject } from 'ai';
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
  const { object } = await generateObject({
    model: 'google/gemini-3.5-flash-lite',
    schema: ReceiptSchema,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Extract the transaction date, total amount, merchant name, and a best-guess Korean spending category from this receipt photo. Use null for any field you cannot read confidently.',
          },
          { type: 'image', image: `data:image/jpeg;base64,${imageBase64}` },
        ],
      },
    ],
  });

  return object;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ocr.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Implement the route**

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

- [ ] **Step 7: Run full test suite and build**

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
- Modify: `app/page.tsx` (wire `ReceiptUpload` → `ExpenseForm`)

**Interfaces:**
- Consumes: `ReceiptExtraction` type and `POST /api/ocr` from Task 6; `<ExpenseForm initialValues={...} />` from Task 4
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

- [ ] **Step 5: Wire it into the page**

In `app/page.tsx`, render `<ReceiptUpload onExtracted={setDraftValues} />` above `<ExpenseForm initialValues={draftValues} ... />`, where `draftValues` is component state that starts empty and gets replaced by the OCR result. The user still has to review/submit the form — OCR only pre-fills it (per spec §3, "auto-draft, human confirms").

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

- [ ] **Step 1: Generate app icons**

Create two simple placeholder PNG icons (192x192 and 512x512) — e.g. a solid-color square with "₩" or the app initial, generated with any image tool or a one-off script (e.g. `npx pwa-asset-generator` or manual export from Figma/Preview). Save as `public/icons/icon-192.png` and `public/icons/icon-512.png`. These are placeholders; visual polish is not part of the MVP.

- [ ] **Step 2: Add the Next.js native manifest route**

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

- [ ] **Step 3: Verify the manifest is served correctly**

Run: `npm run dev`, then in another terminal:

```bash
curl -s http://localhost:3000/manifest.webmanifest | jq .
```

Expected: valid JSON matching the manifest above.

- [ ] **Step 4: Manual verification on an actual iPhone**

Open the dev server's URL (or a deployed preview) in Safari on the iPhone, tap Share → "홈 화면에 추가", confirm the icon and name appear correctly and the app opens without browser chrome.

- [ ] **Step 5: Run full test suite and build**

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
- Data lands in a Google Sheet named "expense-tracker" in the user's own Drive
- App installs to an iPhone home screen and opens in standalone mode

## Execution Handoff

Per the design doc's workflow (spec §5), each task above is handed to **Codex** as a self-contained unit:

1. Claude Code posts the task's Files/Interfaces/Steps block to Codex via `codex:rescue`.
2. Codex implements the task end-to-end (including running the specified test/build commands) and returns a self-review: what changed, assumptions made, any deviation from the plan, and remaining risks.
3. Claude Code checks the self-review against this task's Definition of Done (tests pass, build succeeds, interfaces match what later tasks expect), and reports a short summary back to the user.
4. If issues are found, Claude Code sends them back to Codex for a follow-up pass before moving to the next task.

Ready to start with Task 1?
