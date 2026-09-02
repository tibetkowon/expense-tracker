import { z } from 'zod';

export const ExpenseInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  amount: z.number().positive(),
  category: z.string().min(1),
  memo: z.string(),
  method: z.string().min(1),
});

export type ExpenseInput = z.infer<typeof ExpenseInputSchema>;

export function validateExpenseInput(input: unknown): ExpenseInput {
  return ExpenseInputSchema.parse(input);
}
