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
