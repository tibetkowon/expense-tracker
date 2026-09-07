import { z } from 'zod';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { validateExpenseInput } from '@/lib/expense';
import {
  findOrCreateSpreadsheet,
  appendExpenseRow,
  readExpenseRows,
  updateExpenseRow,
  deleteExpenseRow,
  listAvailableMonths,
  listPaymentMethods,
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

  const paymentMethods = await listPaymentMethods(session.accessToken, spreadsheetId);

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
    paymentMethods: paymentMethods.length > 0
      ? paymentMethods
      : ['체크카드', '신용카드', '현금', '계좌이체'],
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

const rowLocationSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  rowNumber: z.number().int().min(2).max(Number.MAX_SAFE_INTEGER),
});

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const body = await request.json();
  const location = rowLocationSchema.safeParse(body);
  if (!location.success) {
    return NextResponse.json({ error: '월과 행 번호를 확인해 주세요.' }, { status: 400 });
  }
  const { month, rowNumber } = location.data;
  const { folderId, fileName, ...expenseInput } = body;
  const expense = validateExpenseInput(expenseInput);
  const spreadsheetId = await findOrCreateSpreadsheet(
    session.accessToken, folderId ?? undefined, fileName ?? undefined
  );
  const newMonth = expense.date.slice(0, 7);
  if (newMonth === month) {
    await updateExpenseRow(session.accessToken, spreadsheetId, month, rowNumber, expense);
  } else {
    await deleteExpenseRow(session.accessToken, spreadsheetId, month, rowNumber);
    await appendExpenseRow(session.accessToken, spreadsheetId, newMonth, expense);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const body = await request.json();
  const location = rowLocationSchema.safeParse(body);
  if (!location.success) {
    return NextResponse.json({ error: '월과 행 번호를 확인해 주세요.' }, { status: 400 });
  }
  const { month, rowNumber } = location.data;
  const spreadsheetId = await findOrCreateSpreadsheet(
    session.accessToken, body.folderId ?? undefined, body.fileName ?? undefined
  );
  await deleteExpenseRow(session.accessToken, spreadsheetId, month, rowNumber);
  return NextResponse.json({ ok: true });
}
