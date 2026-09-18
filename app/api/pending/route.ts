import { z } from 'zod';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findOrCreateSpreadsheet } from '@/lib/sheets';
import { readPendingRows, deletePendingRow } from '@/lib/pending';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const url = new URL(request.url);
  const folderId = url.searchParams.get('folderId') ?? undefined;
  const fileName = url.searchParams.get('fileName') ?? undefined;
  const spreadsheetId = await findOrCreateSpreadsheet(session.accessToken, folderId, fileName);
  const items = await readPendingRows(session.accessToken, spreadsheetId);
  return NextResponse.json({ items });
}

const rowLocationSchema = z.object({
  rowNumber: z.number().int().min(2),
});

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const location = rowLocationSchema.safeParse(body);
  if (!location.success) {
    return NextResponse.json({ error: '행 번호를 확인해 주세요.' }, { status: 400 });
  }

  const spreadsheetId = await findOrCreateSpreadsheet(
    session.accessToken, body.folderId ?? undefined, body.fileName ?? undefined
  );
  await deletePendingRow(session.accessToken, spreadsheetId, location.data.rowNumber);
  return NextResponse.json({ ok: true });
}
