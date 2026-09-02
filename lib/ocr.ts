import { generateText, Output } from 'ai';
import { z } from 'zod';

const ReceiptSchema = z.object({
  date: z.string().nullable().describe('Transaction date as YYYY-MM-DD, or null if unreadable'),
  amount: z.number().nullable().describe('Total amount as a plain number (KRW), or null if unreadable'),
  merchant: z.string().nullable().describe('Merchant/store name, or null if unreadable'),
  categoryGuess: z
    .string()
    .nullable()
    .describe('Best-guess spending category in Korean (e.g. 식비, 교통, 쇼핑), or null'),
});

export type ReceiptExtraction = z.infer<typeof ReceiptSchema>;

export async function extractReceiptData(imageBase64: string): Promise<ReceiptExtraction> {
  const { output } = await generateText({
    model: 'google/gemini-3.5-flash-lite',
    output: Output.object({ schema: ReceiptSchema }),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Extract the transaction date, total amount, merchant name, and a best-guess Korean spending category from this receipt photo. Use null for any field you cannot read confidently.',
          },
          { type: 'file', mediaType: 'image/jpeg', data: imageBase64 },
        ],
      },
    ],
  });

  return output;
}
