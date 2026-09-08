import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  findOrCreateSpreadsheet,
  getSpreadsheetLocation,
  moveSpreadsheetFile,
} from '@/lib/sheets';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.accessToken) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const spreadsheetId = await findOrCreateSpreadsheet(session.accessToken);
    const location = await getSpreadsheetLocation(session.accessToken, spreadsheetId);
    return NextResponse.json(location);
  } catch {
    return NextResponse.json(
      { error: '파일 위치 조회 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500 }
    );
  }
}

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
    const { folderId } = body;
    if (typeof folderId !== 'string' || folderId.trim() === '') {
      return NextResponse.json({ error: '저장 위치를 선택해 주세요.' }, { status: 400 });
    }

    const spreadsheetId = await findOrCreateSpreadsheet(session.accessToken);
    await moveSpreadsheetFile(session.accessToken, spreadsheetId, folderId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: '파일 이동 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500 }
    );
  }
}
