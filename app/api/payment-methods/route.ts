import { z } from 'zod';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findOrCreateSpreadsheet, listPaymentMethodEntries, createPaymentMethod, updatePaymentMethod, deletePaymentMethod, PaymentMethodError } from '@/lib/sheets';
import { parseAliases } from '@/lib/paymentMethodAliases';

const name = z.string().trim().min(1);
const location = z.object({ folderId: z.string().nullable().optional(), fileName: z.string().nullable().optional() });
const aliases = z.array(z.string()).transform((items) => parseAliases(items.join(',')));
const schemas = {
  POST: location.extend({ name, aliases: aliases.default([]) }),
  PATCH: location.extend({ originalName: name, name: name.optional(), aliases: aliases.optional() })
    .refine((body) => body.name !== undefined || body.aliases !== undefined),
  DELETE: location.extend({ name }),
};

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  try {
    const id = await findOrCreateSpreadsheet(session.accessToken, params.get('folderId') ?? undefined, params.get('fileName') ?? undefined);
    return NextResponse.json({ entries: await listPaymentMethodEntries(session.accessToken, id) });
  } catch { return NextResponse.json({ error: '결제수단을 불러오지 못했습니다.' }, { status: 500 }); }
}

async function mutate(request: Request, method: keyof typeof schemas) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const parsed = schemas[method].safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '이름과 알림 표기를 확인해 주세요.' }, { status: 400 });
  const body = parsed.data;
  try {
    const id = await findOrCreateSpreadsheet(session.accessToken, body.folderId ?? undefined, body.fileName ?? undefined);
    let replacedCount = 0;
    if (method === 'PATCH' && 'originalName' in body) {
      replacedCount = await updatePaymentMethod(session.accessToken, id, body.originalName, body.name, body.aliases);
    } else if (method === 'POST' && 'aliases' in body && body.name) {
      await createPaymentMethod(session.accessToken, id, body.name, body.aliases ?? []);
    } else if (method === 'DELETE' && body.name) {
      await deletePaymentMethod(session.accessToken, id, body.name);
    }
    return NextResponse.json({ ok: true, replacedCount });
  } catch (error) {
    return NextResponse.json({ error: error instanceof PaymentMethodError ? error.message : '저장에 실패했습니다. 다시 시도해 주세요.' }, { status: error instanceof PaymentMethodError ? error.status : 500 });
  }
}
export const POST = (request: Request) => mutate(request, 'POST');
export const PATCH = (request: Request) => mutate(request, 'PATCH');
export const DELETE = (request: Request) => mutate(request, 'DELETE');
