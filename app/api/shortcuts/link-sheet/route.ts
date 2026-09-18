import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findOrCreateSpreadsheet, shareSpreadsheetWithServiceAccount } from '@/lib/sheets';

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
    const { folderId, fileName } = body;
    if (
      (folderId != null && typeof folderId !== 'string') ||
      (fileName != null && typeof fileName !== 'string')
    ) {
      return NextResponse.json({ error: '저장 위치와 파일명이 올바르지 않습니다.' }, { status: 400 });
    }

    const serviceAccountEmail = process.env.SHORTCUT_SERVICE_ACCOUNT_EMAIL;
    if (!serviceAccountEmail) {
      return NextResponse.json(
        { error: '서비스 계정 이메일이 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const spreadsheetId = await findOrCreateSpreadsheet(
      session.accessToken,
      folderId ?? undefined,
      fileName ?? undefined
    );
    await shareSpreadsheetWithServiceAccount(
      session.accessToken, spreadsheetId, serviceAccountEmail
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: '단축어 연동에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500 }
    );
  }
}
