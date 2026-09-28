import { NextResponse } from 'next/server';
import { z } from 'zod';
import { extractNotificationData } from '@/lib/notificationParse';
import { appendPendingRow } from '@/lib/pending';
import { formatSeoulDate } from '@/lib/seoulDate';
import {
  findServiceAccountSpreadsheetId,
  getServiceAccountAuth,
} from '@/lib/serviceAccount';

const bodySchema = z.object({
  appName: z.string(),
  text: z.string().min(1),
});

export async function POST(request: Request) {
  // 본문 읽기나 모델 응답을 기다리는 동안 자정이 지나도 수신 날짜를 유지한다.
  const receivedDate = formatSeoulDate(new Date());
  const apiKey = process.env.SHORTCUT_API_KEY;
  if (!apiKey || request.headers.get('x-shortcut-api-key') !== apiKey) {
    return NextResponse.json({ error: '인증에 실패했습니다.' }, { status: 401 });
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: 'appName과 text가 필요합니다.' }, { status: 400 });
  }
  const { appName, text } = body.data;

  let extraction;
  try {
    extraction = await extractNotificationData(appName, text);
  } catch {
    return NextResponse.json(
      { error: '알림 파싱 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }

  if (extraction.type === '입금' || extraction.type === '무관') {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: extraction.type === '입금' ? 'deposit' : 'not_transaction',
    });
  }
  const pendingType: '결제' | '취소' = extraction.type === '취소' ? '취소' : '결제';

  try {
    const auth = getServiceAccountAuth();
    const spreadsheetId = await findServiceAccountSpreadsheetId(auth);
    if (spreadsheetId === null) {
      return NextResponse.json(
        { error: '스프레드시트가 아직 서비스 계정과 공유되지 않았습니다.' },
        { status: 500 }
      );
    }
    await appendPendingRow(auth, spreadsheetId, {
      date: receivedDate,
      amount: extraction.amount ?? 0,
      category: extraction.categoryGuess ?? '',
      memo: extraction.merchant ?? '',
      method: extraction.method ?? '',
      type: pendingType,
      rawText: text,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: '알림 저장 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
