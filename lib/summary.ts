import type { ExpenseRow } from './sheets';

export function summarizeByMonth(
  rows: ExpenseRow[],
  month: string
): { total: number; count: number } {
  const inMonth = rows.filter((row) => row.date.startsWith(month));
  return {
    total: inMonth.reduce((sum, row) => sum + row.amount, 0),
    count: inMonth.length,
  };
}
