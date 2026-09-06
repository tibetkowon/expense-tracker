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
