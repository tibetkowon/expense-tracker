import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { validateExpenseInput } from '@/lib/expense';
import { findOrCreateSpreadsheet, appendExpenseRow, readExpenseRows } from '@/lib/sheets';
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
