import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { extractReceiptData } from '@/lib/ocr';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { imageBase64 } = await request.json();
  if (typeof imageBase64 !== 'string' || imageBase64.length === 0) {
    return NextResponse.json({ error: 'imageBase64 is required' }, { status: 400 });
  }

  try {
    const extraction = await extractReceiptData(imageBase64);
    return NextResponse.json(extraction);
  } catch {
    return NextResponse.json(
      { error: '영수증 인식 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500 }
    );
  }
}
