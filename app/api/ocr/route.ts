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

  const extraction = await extractReceiptData(imageBase64);
  return NextResponse.json(extraction);
}
