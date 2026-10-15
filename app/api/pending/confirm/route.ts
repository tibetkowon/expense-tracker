import { z } from 'zod';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { validateExpenseInput } from '@/lib/expense';
import { findOrCreateSpreadsheet, appendExpenseRow, rememberPaymentMethodAlias } from '@/lib/sheets';
import { deletePendingRow } from '@/lib/pending';

const rowLocationSchema = z.object({
  rememberAlias: z.string().trim().min(1).optional(),
  pendingRowNumber: z.number().int().min(2),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const location = rowLocationSchema.safeParse(body);
  if (!location.success) {
    return NextResponse.json({ error: '대기 행 번호를 확인해 주세요.' }, { status: 400 });
  }

  const { folderId, fileName, pendingRowNumber, rememberAlias, ...expenseInput } = body;
  let expense;
  try {
    expense = validateExpenseInput(expenseInput);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    throw error;
  }

  const spreadsheetId = await findOrCreateSpreadsheet(
    session.accessToken, folderId ?? undefined, fileName ?? undefined
  );
  const month = expense.date.slice(0, 7);
  await appendExpenseRow(session.accessToken, spreadsheetId, month, expense);
  await deletePendingRow(session.accessToken, spreadsheetId, pendingRowNumber);
  if (rememberAlias) {
    try {
      await rememberPaymentMethodAlias(session.accessToken, spreadsheetId, expense.method, rememberAlias);
    } catch { /* 별칭 저장 실패에도 지출 확인은 성공합니다. */ }
  }
  return NextResponse.json({ ok: true });
}
