import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { DriveScopeError, listFolders } from '@/lib/drive';

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.accessToken) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const parentId = new URL(request.url).searchParams.get('parentId') ?? 'root';
    const folders = await listFolders(session.accessToken, parentId);
    return NextResponse.json({ folders });
  } catch (error) {
    if (error instanceof DriveScopeError) {
      return NextResponse.json({ error: 'REAUTH_REQUIRED' }, { status: 403 });
    }
    return NextResponse.json(
      { error: '폴더 목록 조회 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500 }
    );
  }
}
