'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExpenseRow } from '@/lib/sheets';
import { getSavedFolderId } from '@/lib/folderStorage';
import ExpenseForm from '@/components/ExpenseForm';
import ExpenseList from '@/components/ExpenseList';
import MonthlySummary from '@/components/MonthlySummary';
import Toast from '@/components/Toast';

type ExpensesResponse = { expenses: ExpenseRow[]; monthlyTotal: number };

export default function ExpenseDashboard() {
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    const folderId = getSavedFolderId();
    const query = folderId ? `?folderId=${encodeURIComponent(folderId)}` : '';
    const response = await fetch(`/api/expenses${query}`);
    if (!response.ok) return;

    const data = (await response.json()) as ExpensesResponse;
    setExpenses(data.expenses);
    setMonthlyTotal(data.monthlyTotal);
  }, []);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(null), 1800);
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  return (
    <>
      <MonthlySummary total={monthlyTotal} />
      <section className="border-b border-gray-100 px-5 py-6">
        <h2 className="mb-4 text-[13px] font-semibold text-gray-800">지출 입력</h2>
        <ExpenseForm onSubmitted={() => void refetch()} onSuccess={showToast} />
      </section>
      <ExpenseList expenses={expenses} />
      <Toast message={toastMessage} />
    </>
  );
}
