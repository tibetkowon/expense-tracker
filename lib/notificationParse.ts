import { createVertex } from '@ai-sdk/google-vertex';
import { generateText, Output } from 'ai';
import { z } from 'zod';

const NotificationSchema = z.object({
  type: z
    .enum(['결제', '입금', '취소'])
    .nullable()
    .describe("한국어 은행/카드 알림의 거래 유형. 결제/승인/출금은 '결제', 입금/입금완료는 '입금', 승인취소/취소/환불은 '취소'로 분류하라. 애매하면 '결제'로 분류하라."),
  date: z.string().nullable().describe('한국어 은행/카드 알림의 거래 날짜(YYYY-MM-DD), 읽을 수 없으면 null'),
  amount: z.number().nullable().describe('한국어 은행/카드 알림의 해당 거래 금액(원, 숫자만). 누적 금액이나 잔액이 아니며, 읽을 수 없으면 null'),
  merchant: z.string().nullable().describe('한국어 은행/카드 알림의 가맹점명, 읽을 수 없으면 null'),
  categoryGuess: z
    .string()
    .nullable()
    .describe('한국어 은행/카드 알림에서 추정한 한국어 지출 카테고리(예: 식비, 교통, 쇼핑), 알 수 없으면 null'),
  method: z.string().nullable().describe('한국어 은행/카드 알림의 결제수단(카드명 또는 은행 계좌 등), 읽을 수 없으면 null'),
});

export type NotificationExtraction = z.infer<typeof NotificationSchema>;

export async function extractNotificationData(
  appName: string,
  text: string
): Promise<NotificationExtraction> {
  const vertex = createVertex({
    project: process.env.GOOGLE_VERTEX_PROJECT,
    location: process.env.GOOGLE_VERTEX_LOCATION,
    googleAuthOptions: {
      credentials: JSON.parse(process.env.GOOGLE_VERTEX_CREDENTIALS!),
    },
  });

  const { output } = await generateText({
    model: vertex('gemini-3.5-flash-lite'),
    output: Output.object({ schema: NotificationSchema }),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `앱 이름: ${appName}\n알림 원문: ${text}\n\n이 결제/계좌 알림에서 거래 유형, 날짜(YYYY-MM-DD), 금액(원, 숫자만), 가맹점명, 한국어 카테고리 추정, 결제수단을 추출해줘. 읽을 수 없는 필드는 null로 남겨줘.`,
          },
        ],
      },
    ],
  });

  return output;
}
