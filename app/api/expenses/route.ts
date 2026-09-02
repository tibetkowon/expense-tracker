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
