import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findOrCreateSpreadsheet, renameSpreadsheetFile } from '@/lib/sheets';

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.accessToken) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '올바른 JSON 요청이 필요합니다.' }, { status: 400 });
    }
    const { folderId, currentFileName, newFileName } = body;

    if (typeof newFileName !== 'string' || newFileName.trim() === '') {
      return NextResponse.json({ error: '새 파일명을 입력해 주세요.' }, { status: 400 });
    }
    if (
      (folderId != null && typeof folderId !== 'string') ||
      (currentFileName != null && typeof currentFileName !== 'string')
    ) {
      return NextResponse.json({ error: '저장 위치와 현재 파일명이 올바르지 않습니다.' }, { status: 400 });
    }

    const spreadsheetId = await findOrCreateSpreadsheet(
      session.accessToken,
      folderId ?? undefined,
      currentFileName ?? undefined
    );
    await renameSpreadsheetFile(session.accessToken, spreadsheetId, newFileName.trim());

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: '파일명 변경 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500 }
    );
  }
}
